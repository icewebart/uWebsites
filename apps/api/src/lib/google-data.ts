import { Google } from 'arctic'
import { eq } from 'drizzle-orm'
import { db, accounts } from '@uwebsites/db'

// Google data integrations (Search Console + GA4). We reuse the SAME OAuth
// client as login (env GOOGLE_CLIENT_ID/SECRET); each USER connects their own
// Google account and we store their refresh token + granted scopes per account
// in accounts.settings.google — never returned to the client.

export const SCOPE_SEARCH = 'https://www.googleapis.com/auth/webmasters.readonly'
export const SCOPE_ANALYTICS = 'https://www.googleapis.com/auth/analytics.readonly'
const DATA_REDIRECT = process.env.GOOGLE_DATA_REDIRECT_URI || 'https://api.uwebsites.net/auth/google/data/callback'

export function dataClient() {
  return new Google(process.env.GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!, DATA_REDIRECT)
}

export type GoogleConn = { refreshToken: string; scopes: string[]; email?: string; connectedAt?: string }

export async function getGoogleConn(accountId: string): Promise<GoogleConn | null> {
  const [a] = await db.select({ settings: accounts.settings }).from(accounts).where(eq(accounts.id, accountId)).limit(1)
  const g = (a?.settings as any)?.google
  return g?.refreshToken ? g : null
}
export async function saveGoogleConn(accountId: string, conn: GoogleConn | null): Promise<void> {
  const [a] = await db.select({ settings: accounts.settings }).from(accounts).where(eq(accounts.id, accountId)).limit(1)
  const s = (a?.settings as any) || {}
  if (conn) s.google = conn; else delete s.google
  await db.update(accounts).set({ settings: s }).where(eq(accounts.id, accountId))
}
export function hasScope(conn: GoogleConn | null, scope: string): boolean {
  return !!conn?.scopes?.includes(scope)
}

// Short-lived access-token cache so we don't hit Google's token endpoint on
// every API call. Keyed by accountId.
const atCache = new Map<string, { token: string; exp: number }>()

export async function freshAccessToken(accountId: string): Promise<string> {
  const cached = atCache.get(accountId)
  if (cached && cached.exp > Date.now() + 30_000) return cached.token
  const conn = await getGoogleConn(accountId)
  if (!conn) throw new Error('google-not-connected')
  let tokens
  try {
    tokens = await dataClient().refreshAccessToken(conn.refreshToken)
  } catch (e: any) {
    // Refresh token revoked/expired → drop the connection so the UI reconnects.
    await saveGoogleConn(accountId, null).catch(() => {})
    throw new Error('google-reauth-required')
  }
  const token = tokens.accessToken()
  let exp = Date.now() + 55 * 60 * 1000
  try { exp = tokens.accessTokenExpiresAt().getTime() } catch { /* keep default */ }
  atCache.set(accountId, { token, exp })
  return token
}

async function gapi(url: string, accessToken: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `Google API ${r.status}`)
  return j
}

// ---- Search Console ----
export async function scListSites(accountId: string): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
  const at = await freshAccessToken(accountId)
  const j = await gapi('https://www.googleapis.com/webmasters/v3/sites', at)
  return (j.siteEntry || []).filter((s: any) => s.permissionLevel !== 'siteUnverifiedUser')
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10) }
export function rangeDays(days: number): { startDate: string; endDate: string } {
  const end = new Date(Date.now() - 2 * 86400000)   // Search Console data lags ~2 days
  const start = new Date(end.getTime() - (days - 1) * 86400000)
  return { startDate: ymd(start), endDate: ymd(end) }
}

export async function scQuery(accountId: string, siteUrl: string, days: number) {
  const at = await freshAccessToken(accountId)
  const range = rangeDays(days)
  const enc = encodeURIComponent(siteUrl)
  const base = `https://www.googleapis.com/webmasters/v3/sites/${enc}/searchAnalytics/query`
  const [totals, byQuery, byDate, byPage] = await Promise.all([
    gapi(base, at, { method: 'POST', body: JSON.stringify({ ...range, dimensions: [] }) }),
    gapi(base, at, { method: 'POST', body: JSON.stringify({ ...range, dimensions: ['query'], rowLimit: 25 }) }),
    gapi(base, at, { method: 'POST', body: JSON.stringify({ ...range, dimensions: ['date'] }) }),
    gapi(base, at, { method: 'POST', body: JSON.stringify({ ...range, dimensions: ['page'], rowLimit: 15 }) }),
  ])
  const t = totals.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 }
  return {
    range,
    totals: { clicks: t.clicks || 0, impressions: t.impressions || 0, ctr: t.ctr || 0, position: t.position || 0 },
    byDate: (byDate.rows || []).map((r: any) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
    topQueries: (byQuery.rows || []).map((r: any) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    topPages: (byPage.rows || []).map((r: any) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
  }
}

// ---- Google Analytics 4 ----
export async function gaListProperties(accountId: string): Promise<Array<{ property: string; displayName: string; account: string }>> {
  const at = await freshAccessToken(accountId)
  const j = await gapi('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', at)
  const out: Array<{ property: string; displayName: string; account: string }> = []
  for (const acc of (j.accountSummaries || [])) {
    for (const p of (acc.propertySummaries || [])) {
      out.push({ property: p.property, displayName: p.displayName || p.property, account: acc.displayName || '' })
    }
  }
  return out
}

export async function gaReport(accountId: string, propertyId: string, days: number) {
  const at = await freshAccessToken(accountId)
  const end = new Date(Date.now() - 86400000)
  const start = new Date(end.getTime() - (days - 1) * 86400000)
  const range = { startDate: ymd(start), endDate: ymd(end) }
  const id = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`
  const base = `https://analyticsdata.googleapis.com/v1beta/${id}:runReport`
  const metrics = [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }, { name: 'bounceRate' }]
  const [totals, byDate, byPage, bySource] = await Promise.all([
    gapi(base, at, { method: 'POST', body: JSON.stringify({ dateRanges: [range], metrics }) }),
    gapi(base, at, { method: 'POST', body: JSON.stringify({ dateRanges: [range], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }], dimensions: [{ name: 'date' }], orderBys: [{ dimension: { dimensionName: 'date' } }] }) }),
    gapi(base, at, { method: 'POST', body: JSON.stringify({ dateRanges: [range], metrics: [{ name: 'screenPageViews' }], dimensions: [{ name: 'pagePath' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: 15 }) }),
    gapi(base, at, { method: 'POST', body: JSON.stringify({ dateRanges: [range], metrics: [{ name: 'sessions' }], dimensions: [{ name: 'sessionDefaultChannelGroup' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 8 }) }),
  ])
  const row0 = totals.rows?.[0]?.metricValues || []
  const num = (i: number) => Number(row0[i]?.value || 0)
  const fmtDate = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return {
    range,
    totals: { sessions: num(0), users: num(1), pageviews: num(2), bounceRate: num(3) },
    byDate: (byDate.rows || []).map((r: any) => ({ date: fmtDate(r.dimensionValues[0].value), sessions: Number(r.metricValues[0].value), users: Number(r.metricValues[1].value) })),
    topPages: (byPage.rows || []).map((r: any) => ({ page: r.dimensionValues[0].value, views: Number(r.metricValues[0].value) })),
    channels: (bySource.rows || []).map((r: any) => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) })),
  }
}
