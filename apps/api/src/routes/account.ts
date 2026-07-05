import { Router } from 'express'
import { and, eq, inArray } from 'drizzle-orm'
import { db, accounts, workspaces, domains } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { getGoogleConn, saveGoogleConn, hasScope, SCOPE_SEARCH, SCOPE_ANALYTICS, scListSites, scQuery, gaListProperties, gaReport } from '../lib/google-data.js'

// Account-level settings: integrations (Cloudflare) + domains across all
// workspaces. Secrets are stored in accounts.settings (jsonb) server-side and
// NEVER returned to the client (only a masked hint + connection status).
export const accountRouter = Router()
const SERVER_IP = process.env.SERVER_IP || '75.119.159.89'
const CF_API = 'https://api.cloudflare.com/client/v4'
const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/

async function getSettings(accountId: string): Promise<any> {
  const [a] = await db.select({ settings: accounts.settings }).from(accounts).where(eq(accounts.id, accountId)).limit(1)
  return (a?.settings as any) || {}
}
async function saveSettings(accountId: string, settings: any) {
  await db.update(accounts).set({ settings }).where(eq(accounts.id, accountId))
}
async function cfToken(accountId: string): Promise<string | null> {
  const s = await getSettings(accountId)
  return s?.cloudflare?.apiToken || null
}
async function cf(path: string, token: string, init?: RequestInit) {
  const r = await fetch(`${CF_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  return r.json() as Promise<any>
}

// ---------------- Integrations ----------------
accountRouter.get('/integrations', requireAuth, async (req: AuthRequest, res) => {
  const s = await getSettings(req.user!.accountId)
  const cf = s?.cloudflare, mj = s?.mailjet
  res.json({ ok: true, data: {
    cloudflare: { connected: !!cf?.apiToken, verified: !!cf?.verified, tokenHint: cf?.apiToken ? '••••••' + String(cf.apiToken).slice(-4) : null, verifiedAt: cf?.verifiedAt || null },
    mailjet: { connected: !!mj?.apiKey, tokenHint: mj?.apiKey ? '••••••' + String(mj.apiKey).slice(-4) : null, listId: mj?.listId || null, verifiedAt: mj?.verifiedAt || null },
  } })
})

// PUT /account/integrations/cloudflare { apiToken } — verify against Cloudflare then store
accountRouter.put('/integrations/cloudflare', requireAuth, async (req: AuthRequest, res) => {
  const apiToken = String(req.body?.apiToken || '').trim()
  if (!apiToken) return res.status(400).json({ ok: false, error: 'API token required' })
  try {
    const j = await cf('/user/tokens/verify', apiToken)
    if (!j?.success) return res.status(400).json({ ok: false, error: 'Cloudflare rejected this token. Create an API token with Zone → DNS → Edit permission.' })
  } catch { return res.status(502).json({ ok: false, error: 'Could not reach Cloudflare — try again.' }) }
  const s = await getSettings(req.user!.accountId)
  await saveSettings(req.user!.accountId, { ...s, cloudflare: { apiToken, verified: true, verifiedAt: new Date().toISOString() } })
  res.json({ ok: true, data: { connected: true, verified: true } })
})

accountRouter.delete('/integrations/cloudflare', requireAuth, async (req: AuthRequest, res) => {
  const s = await getSettings(req.user!.accountId)
  delete s.cloudflare
  await saveSettings(req.user!.accountId, s)
  res.json({ ok: true })
})

// Mailjet — for newsletter signups on published sites.
accountRouter.put('/integrations/mailjet', requireAuth, async (req: AuthRequest, res) => {
  const apiKey = String(req.body?.apiKey || '').trim()
  const apiSecret = String(req.body?.apiSecret || '').trim()
  const listId = String(req.body?.listId || '').trim()
  if (!apiKey || !apiSecret) return res.status(400).json({ ok: false, error: 'API key and secret required' })
  try {
    const auth = 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')
    const r = await fetch('https://api.mailjet.com/v3/REST/apikey', { headers: { Authorization: auth } })
    if (r.status === 401) return res.status(400).json({ ok: false, error: 'Mailjet rejected these credentials.' })
  } catch { return res.status(502).json({ ok: false, error: 'Could not reach Mailjet — try again.' }) }
  const s = await getSettings(req.user!.accountId)
  await saveSettings(req.user!.accountId, { ...s, mailjet: { apiKey, apiSecret, listId: listId || null, verified: true, verifiedAt: new Date().toISOString() } })
  res.json({ ok: true, data: { connected: true } })
})
accountRouter.delete('/integrations/mailjet', requireAuth, async (req: AuthRequest, res) => {
  const s = await getSettings(req.user!.accountId)
  delete s.mailjet
  await saveSettings(req.user!.accountId, s)
  res.json({ ok: true })
})

// ---------------- Google (Search Console + Analytics) ----------------
// The OAuth connect/callback live in routes/google.ts; these expose status +
// data. Tokens themselves are never returned — only connection status + scopes.
accountRouter.get('/google/status', requireAuth, async (req: AuthRequest, res) => {
  const c = await getGoogleConn(req.user!.accountId)
  res.json({ ok: true, data: {
    connected: !!c,
    email: c?.email || null,
    searchConsole: hasScope(c, SCOPE_SEARCH),
    analytics: hasScope(c, SCOPE_ANALYTICS),
    connectedAt: c?.connectedAt || null,
  } })
})

accountRouter.delete('/google', requireAuth, async (req: AuthRequest, res) => {
  await saveGoogleConn(req.user!.accountId, null)
  res.json({ ok: true })
})

const reauth = (res: any, e: any) => {
  const m = String(e?.message || '')
  if (m === 'google-not-connected') return res.status(400).json({ ok: false, error: 'Connect Google first.' })
  if (m === 'google-reauth-required') return res.status(401).json({ ok: false, error: 'Google access expired — reconnect.' })
  return res.status(502).json({ ok: false, error: m || 'Google API error' })
}

// Search Console
accountRouter.get('/google/search-console/sites', requireAuth, async (req: AuthRequest, res) => {
  try { res.json({ ok: true, data: await scListSites(req.user!.accountId) }) } catch (e) { reauth(res, e) }
})
accountRouter.post('/google/search-console/report', requireAuth, async (req: AuthRequest, res) => {
  const siteUrl = String(req.body?.siteUrl || '')
  const days = Math.min(90, Math.max(7, Number(req.body?.days) || 28))
  if (!siteUrl) return res.status(400).json({ ok: false, error: 'siteUrl required' })
  try { res.json({ ok: true, data: await scQuery(req.user!.accountId, siteUrl, days) }) } catch (e) { reauth(res, e) }
})

// Analytics (GA4)
accountRouter.get('/google/analytics/properties', requireAuth, async (req: AuthRequest, res) => {
  try { res.json({ ok: true, data: await gaListProperties(req.user!.accountId) }) } catch (e) { reauth(res, e) }
})
accountRouter.post('/google/analytics/report', requireAuth, async (req: AuthRequest, res) => {
  const propertyId = String(req.body?.propertyId || '')
  const days = Math.min(90, Math.max(7, Number(req.body?.days) || 28))
  if (!propertyId) return res.status(400).json({ ok: false, error: 'propertyId required' })
  try { res.json({ ok: true, data: await gaReport(req.user!.accountId, propertyId, days) }) } catch (e) { reauth(res, e) }
})

// ---------------- Domains ----------------
accountRouter.get('/domains', requireAuth, async (req: AuthRequest, res) => {
  const wss = await db.select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.accountId, req.user!.accountId))
  const ids = wss.map((w) => w.id)
  const rows = ids.length ? await db.select().from(domains).where(inArray(domains.workspaceId, ids)) : []
  const byWs = new Map(wss.map((w) => [w.id, w]))
  const out = rows.map((d) => ({ ...d, workspace: byWs.get(d.workspaceId) || null }))
  const cfConnected = !!(await cfToken(req.user!.accountId))
  res.json({ ok: true, data: { serverIp: SERVER_IP, cfConnected, domains: out, workspaces: wss } })
})

// POST /account/domains { hostname, workspaceId }
accountRouter.post('/domains', requireAuth, async (req: AuthRequest, res) => {
  const hostname = String(req.body?.hostname || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
  const wsId = String(req.body?.workspaceId || '')
  if (!HOSTNAME_RE.test(hostname)) return res.status(400).json({ ok: false, error: 'Enter a valid domain like example.com' })
  const [ws] = await db.select().from(workspaces).where(and(eq(workspaces.id, wsId), eq(workspaces.accountId, req.user!.accountId))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [dup] = await db.select().from(domains).where(eq(domains.hostname, hostname)).limit(1)
  if (dup) return res.status(409).json({ ok: false, error: 'That domain is already added.' })
  const [created] = await db.insert(domains).values({ workspaceId: wsId, hostname, status: 'pending' }).returning()
  res.json({ ok: true, data: created })
})

// PATCH /account/domains/:id { workspaceId } — reassign
accountRouter.patch('/domains/:id', requireAuth, async (req: AuthRequest, res) => {
  const d = await ownedDomain(String(req.params.id), req.user!.accountId)
  if (!d) return res.status(404).json({ ok: false, error: 'domain not found' })
  const wsId = String(req.body?.workspaceId || '')
  const [ws] = await db.select().from(workspaces).where(and(eq(workspaces.id, wsId), eq(workspaces.accountId, req.user!.accountId))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  await db.update(domains).set({ workspaceId: wsId }).where(eq(domains.id, d.id))
  res.json({ ok: true })
})

accountRouter.delete('/domains/:id', requireAuth, async (req: AuthRequest, res) => {
  const d = await ownedDomain(String(req.params.id), req.user!.accountId)
  if (!d) return res.status(404).json({ ok: false, error: 'domain not found' })
  await db.delete(domains).where(eq(domains.id, d.id))
  res.json({ ok: true })
})

// POST /account/domains/:id/cloudflare-dns — auto-create the A records via Cloudflare
accountRouter.post('/domains/:id/cloudflare-dns', requireAuth, async (req: AuthRequest, res) => {
  const d = await ownedDomain(String(req.params.id), req.user!.accountId)
  if (!d) return res.status(404).json({ ok: false, error: 'domain not found' })
  const token = await cfToken(req.user!.accountId)
  if (!token) return res.status(400).json({ ok: false, error: 'Connect Cloudflare first (Integrations).' })
  // The Cloudflare zone is the registrable domain (last two labels — good enough
  // for common TLDs). We ONLY ever create a record for the EXACT hostname the
  // user added: a bare root domain also gets a www alias; a subdomain
  // (nou.example.com) gets ONLY that subdomain — never the root.
  const zoneName = d.hostname.split('.').slice(-2).join('.')
  const isRoot = d.hostname === zoneName
  const names = isRoot ? [zoneName, `www.${zoneName}`] : [d.hostname]
  try {
    const zj = await cf(`/zones?name=${encodeURIComponent(zoneName)}`, token)
    const zone = zj?.result?.[0]
    if (!zone) return res.status(400).json({ ok: false, error: `The zone "${zoneName}" isn't in this Cloudflare account. Add the domain to Cloudflare first, then retry.` })
    const created: string[] = []
    const conflicts: { name: string; current: string }[] = []
    for (const name of names) {
      const ex = await cf(`/zones/${zone.id}/dns_records?type=A&name=${encodeURIComponent(name)}`, token)
      const existing = ex?.result?.[0]
      const rec = { name, type: 'A', content: SERVER_IP, proxied: false, ttl: 3600 }
      if (existing) {
        // Already points at us → fine. Points elsewhere → DO NOT overwrite a
        // live record; flag it so we never break someone's main domain again.
        if (existing.content === SERVER_IP) created.push(name)
        else conflicts.push({ name, current: existing.content })
      } else {
        await cf(`/zones/${zone.id}/dns_records`, token, { method: 'POST', body: JSON.stringify(rec) })
        created.push(name)
      }
    }
    if (conflicts.length) {
      return res.status(409).json({ ok: false, error: `A DNS record already exists for ${conflicts.map((c) => `${c.name} → ${c.current}`).join(', ')}. To avoid breaking a live site it was left untouched — remove/repoint it in Cloudflare, then retry.` })
    }
    await db.update(domains).set({ status: 'dns_set' }).where(eq(domains.id, d.id))
    res.json({ ok: true, data: { zone: zoneName, records: created } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Cloudflare DNS update failed: ' + (e?.message || 'unknown') })
  }
})

async function ownedDomain(id: string, accountId: string) {
  const [row] = await db.select({ id: domains.id, hostname: domains.hostname, workspaceId: domains.workspaceId, wsSlug: workspaces.slug, accId: workspaces.accountId })
    .from(domains).innerJoin(workspaces, eq(domains.workspaceId, workspaces.id)).where(eq(domains.id, id)).limit(1)
  if (!row || row.accId !== accountId) return null
  return row
}
