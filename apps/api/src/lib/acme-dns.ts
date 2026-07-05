import acme from 'acme-client'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Issue a Let's Encrypt certificate via the DNS-01 challenge, using Cloudflare
// to publish the _acme-challenge TXT record. This deliberately avoids HTTP-01 /
// certbot --nginx, which don't work on this AAPanel/OpenResty box (the certbot
// nginx plugin can't load the Lua resty.core module, and the ACME HTTP path
// 404s). DNS-01 needs zero nginx cooperation — just the Cloudflare API token we
// already store for the account.

const CF_API = 'https://api.cloudflare.com/client/v4'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function cf(path: string, token: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${CF_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  return r.json()
}

// Resolve the Cloudflare zone id for a registrable domain (e.g. example.com).
export async function cfZoneId(zoneName: string, token: string): Promise<string | null> {
  const j = await cf(`/zones?name=${encodeURIComponent(zoneName)}`, token)
  return j?.result?.[0]?.id || null
}

async function cfCreateTxt(zoneId: string, token: string, name: string, content: string): Promise<void> {
  await cf(`/zones/${zoneId}/dns_records`, token, { method: 'POST', body: JSON.stringify({ type: 'TXT', name, content, ttl: 120 }) })
}
async function cfDeleteTxt(zoneId: string, token: string, name: string, content: string): Promise<void> {
  const j = await cf(`/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`, token)
  for (const rec of (j?.result || [])) {
    if (rec?.content === content || rec?.content === `"${content}"`) {
      await cf(`/zones/${zoneId}/dns_records/${rec.id}`, token, { method: 'DELETE' }).catch(() => {})
    }
  }
}

// Reuse one ACME account key across issuances (LE rate-limits new accounts).
async function loadOrCreateAccountKey(dataDir: string): Promise<Buffer> {
  const keyPath = path.join(dataDir, 'account.key')
  try { return await readFile(keyPath) } catch { /* create below */ }
  const key = await acme.crypto.createPrivateKey()
  await mkdir(dataDir, { recursive: true })
  await writeFile(keyPath, key)
  return key as Buffer
}

export type IssuedCert = { cert: string; key: string }

// Obtain a cert for `names` (first is the common name). Cloudflare publishes the
// DNS-01 challenge; `dataDir` persists the ACME account key. Returns PEM strings.
export async function issueCertViaDns(
  names: string[],
  opts: { cfToken: string; zoneId: string; email?: string; dataDir: string; staging?: boolean },
): Promise<IssuedCert> {
  const accountKey = await loadOrCreateAccountKey(opts.dataDir)
  const client = new acme.Client({
    directoryUrl: opts.staging ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey,
  })
  const [key, csr] = await acme.crypto.createCsr({ commonName: names[0], altNames: names })

  const cert = await client.auto({
    csr,
    email: opts.email || undefined,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    challengeCreateFn: async (authz: any, challenge: any, keyAuthorization: string) => {
      if (challenge.type !== 'dns-01') throw new Error('expected dns-01 challenge')
      const name = `_acme-challenge.${authz.identifier.value}`
      await cfCreateTxt(opts.zoneId, opts.cfToken, name, keyAuthorization)
      // Give Cloudflare's authoritative servers a moment to serve the record
      // before Let's Encrypt queries it.
      await sleep(15_000)
    },
    challengeRemoveFn: async (authz: any, _challenge: any, keyAuthorization: string) => {
      const name = `_acme-challenge.${authz.identifier.value}`
      await cfDeleteTxt(opts.zoneId, opts.cfToken, name, keyAuthorization).catch(() => {})
    },
  })

  return { cert: cert.toString(), key: key.toString() }
}
