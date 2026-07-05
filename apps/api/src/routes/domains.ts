import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { promises as dns } from 'node:dns'
import { writeFile, unlink } from 'node:fs/promises'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { db, workspaces, domains } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

// Custom domains for a workspace. Flow:
//   1) POST /domains { hostname } -> stored as pending (with DNS instructions returned)
//   2) POST /domains/:id/verify  -> resolve DNS, write nginx vhost serving /www/wwwroot/_sites/<slug>/,
//                                    run certbot --nginx to add HTTPS, mark connected.
// Runs as root under PM2 (single-box deploy, ADR-012). Vhost is written next
// to AAPanel's other vhosts so its UI also sees the site.

export const domainsRouter = Router()
const execFile = promisify(execFileCb)

const SERVER_IP = process.env.SERVER_IP || '75.119.159.89'
const SITES_DIR = process.env.SITES_DIR || '/www/wwwroot/_sites'
const VHOST_DIR = process.env.VHOST_DIR || '/www/server/panel/vhost/nginx'
const CERTBOT_EMAIL = process.env.CERTBOT_EMAIL || ''  // optional but recommended

// hostname must be lowercase domain (no protocol, no path)
const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/

async function ownedWs(slug: string, accountId: string) {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, accountId))).limit(1)
  return ws
}

// An apex domain (example.com) also serves www.example.com. A subdomain
// (nou.example.com) must NOT — www.nou.example.com has no DNS, so including it
// makes certbot fail and produces the "Website not found" default page.
function isApex(hostname: string) {
  return hostname.split('.').length <= 2
}
function serverNames(hostname: string) {
  return isApex(hostname) ? `${hostname} www.${hostname}` : hostname
}

function vhostHttp(hostname: string, slug: string) {
  return `# uWebsites custom domain — ${hostname} -> workspace "${slug}"
server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames(hostname)};
    root ${SITES_DIR}/${slug};
    index index.html;
    location / { try_files $uri $uri/index.html =404; }
    location ~ /\\.well-known/acme-challenge/ { allow all; }
    access_log /www/wwwlogs/${hostname}.log;
    error_log  /www/wwwlogs/${hostname}.error.log;
}
`
}

// HTTPS vhost we write OURSELVES once the cert exists — 80 redirects to 443
// (but still answers ACME challenges for renewals), 443 serves the static site
// with the Let's Encrypt cert. We never let `certbot --nginx` edit/reload nginx
// because this box runs OpenResty and certbot's plugin invokes an nginx that
// can't load the Lua `resty.core` module (its reload fails and rolls back).
const LE_LIVE = process.env.LE_LIVE || '/etc/letsencrypt/live'
function vhostHttps(hostname: string, slug: string) {
  const cert = `${LE_LIVE}/${hostname}/fullchain.pem`
  const key = `${LE_LIVE}/${hostname}/privkey.pem`
  return `# uWebsites custom domain (SSL) — ${hostname} -> workspace "${slug}"
server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames(hostname)};
    location ~ /\\.well-known/acme-challenge/ { root ${SITES_DIR}/${slug}; allow all; }
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${serverNames(hostname)};
    ssl_certificate ${cert};
    ssl_certificate_key ${key};
    root ${SITES_DIR}/${slug};
    index index.html;
    location / { try_files $uri $uri/index.html =404; }
    access_log /www/wwwlogs/${hostname}.log;
    error_log  /www/wwwlogs/${hostname}.error.log;
}
`
}

async function writeVhost(hostname: string, slug: string) {
  await writeFile(`${VHOST_DIR}/${hostname}.conf`, vhostHttp(hostname, slug), 'utf8')
}

async function nginxReload() {
  // -t first so a bad vhost doesn't tank the running config
  await execFile('nginx', ['-t'])
  await execFile('/etc/init.d/nginx', ['reload'])
}

// Obtain the cert via the WEBROOT method (drops a challenge file under the
// site's dir, which our HTTP vhost already serves) — no nginx editing by
// certbot. Then we swap in the HTTPS vhost and reload nginx ourselves.
async function issueCert(hostname: string, slug: string) {
  const args = ['certonly', '--webroot', '-w', `${SITES_DIR}/${slug}`,
    '--non-interactive', '--agree-tos', '--keep-until-expiring', '-d', hostname]
  if (isApex(hostname)) args.push('-d', `www.${hostname}`)
  if (CERTBOT_EMAIL) args.push('--email', CERTBOT_EMAIL)
  else args.push('--register-unsafely-without-email')
  await execFile('certbot', args, { timeout: 120_000 })
  // Cert is now at ${LE_LIVE}/${hostname}/ — write the 443 vhost + reload.
  await writeFile(`${VHOST_DIR}/${hostname}.conf`, vhostHttps(hostname, slug), 'utf8')
  await nginxReload()
}

// GET /workspaces/:slug/domains
domainsRouter.get('/:slug/domains', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const rows = await db.select().from(domains).where(eq(domains.workspaceId, ws.id))
  res.json({ ok: true, data: { serverIp: SERVER_IP, domains: rows } })
})

// POST /workspaces/:slug/domains  { hostname }
domainsRouter.post('/:slug/domains', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const hostname = String(req.body?.hostname || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!HOSTNAME_RE.test(hostname)) return res.status(400).json({ ok: false, error: 'invalid hostname (e.g. example.com — no protocol, no path)' })
  if (hostname.startsWith('www.')) return res.status(400).json({ ok: false, error: 'omit "www." — we cover www automatically' })
  try {
    const [row] = await db.insert(domains).values({ workspaceId: ws.id, hostname, status: 'pending', sslStatus: 'none' }).returning()
    res.json({ ok: true, data: row })
  } catch (e: any) {
    if (String(e?.message || '').includes('duplicate')) return res.status(409).json({ ok: false, error: 'this domain is already connected to a workspace' })
    res.status(500).json({ ok: false, error: e?.message || 'could not add domain' })
  }
})

// POST /workspaces/:slug/domains/:id/verify — DNS check + provision + SSL
domainsRouter.post('/:slug/domains/:id/verify', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [d] = await db.select().from(domains).where(and(eq(domains.id, String(req.params.id)), eq(domains.workspaceId, ws.id))).limit(1)
  if (!d) return res.status(404).json({ ok: false, error: 'domain not found' })

  // 1) DNS check
  let ips: string[] = []
  try { ips = await dns.resolve4(d.hostname) } catch {
    return res.status(400).json({ ok: false, error: `DNS A record for ${d.hostname} not found yet — add it and try again.` })
  }
  const cfRange = /^(104\.16\.|104\.17\.|104\.18\.|104\.19\.|104\.2[01]\.|172\.6[4-9]\.|172\.7[01]\.|173\.245\.|188\.114\.|190\.93\.|197\.234\.|198\.41\.)/
  if (!ips.includes(SERVER_IP)) {
    const looksCF = ips.some((ip) => cfRange.test(ip))
    return res.status(400).json({
      ok: false,
      error: looksCF
        ? `Looks Cloudflare-proxied (${ips[0]}). For setup, set the A record's proxy to "DNS only" (grey cloud). After we connect HTTPS, you can turn proxy back on with SSL/TLS mode "Full (strict)".`
        : `DNS A record for ${d.hostname} resolves to ${ips.join(', ')} — should be ${SERVER_IP}. Update it and try again.`,
    })
  }

  // 2) ensure publish dir exists (don't fail just because nothing's published yet)
  try { await execFile('mkdir', ['-p', `${SITES_DIR}/${ws.slug}`]) } catch {}

  // 3) write http vhost + reload
  try {
    await writeVhost(d.hostname, ws.slug)
    await nginxReload()
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: 'failed to write nginx vhost: ' + (e?.message || 'unknown') })
  }

  await db.update(domains).set({ status: 'verified', dnsVerifiedAt: new Date(), sslStatus: 'issuing', sslError: null }).where(eq(domains.id, d.id))

  // 4) issue cert in the BACKGROUND. certbot takes 20–120s and reloads nginx —
  // both would break a synchronous response (60s proxy timeout + the reload can
  // drop this very request's connection -> the client sees "failed to fetch").
  // So we respond now and let the client poll GET /domains for sslStatus.
  void (async () => {
    try {
      await issueCert(d.hostname, ws.slug)
      await db.update(domains).set({ status: 'connected', sslStatus: 'active', sslError: null }).where(eq(domains.id, d.id))
    } catch (e: any) {
      await db.update(domains).set({ sslStatus: 'failed', sslError: String(e?.message || 'certbot failed').slice(0, 500) }).where(eq(domains.id, d.id)).catch(() => {})
    }
  })()

  res.status(202).json({ ok: true, data: { hostname: d.hostname, status: 'verified', sslStatus: 'issuing', url: `https://${d.hostname}/` } })
})

// DELETE /workspaces/:slug/domains/:id
domainsRouter.delete('/:slug/domains/:id', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [d] = await db.select().from(domains).where(and(eq(domains.id, String(req.params.id)), eq(domains.workspaceId, ws.id))).limit(1)
  if (!d) return res.status(404).json({ ok: false, error: 'domain not found' })
  try { await unlink(`${VHOST_DIR}/${d.hostname}.conf`) } catch {}
  try { await nginxReload() } catch {}
  // best-effort revoke; ignore failures (cert dir may be missing if SSL never issued)
  try { await execFile('certbot', ['delete', '--cert-name', d.hostname, '--non-interactive'], { timeout: 30_000 }) } catch {}
  await db.delete(domains).where(eq(domains.id, d.id))
  res.json({ ok: true, data: null })
})
