// Custom API delivery — the generic alternative to lib/wordpress.ts for a site
// that speaks its own small content contract instead of WordPress's REST API.
// First built for kids.ro (see kids.ro's own ARTICOLE.md for the design
// rationale); reusable by any future site implementing the same two endpoints.
//
// Everything here is server-side; both API keys never reach the browser.

export type CustomApiConn = {
  baseUrl: string
  demandKey?: string | null
  articleKey?: string | null
}

const UA = 'uWebsites/1.0 (+https://uwebsites.net)'

function root(baseUrl: string): string {
  return String(baseUrl).trim().replace(/\/+$/, '')
}

export type DemandTopic = {
  topic: string
  kind: 'no_results' | 'thin_coverage' | 'empty_city_category'
  citySlug: string | null
  category?: string
  count: number
  lastSeen: string | null
}
export type DemandResponse = { generatedAt: string; windowDays: number; note?: string; topics: DemandTopic[] }

/** GET {baseUrl}/internal/content-demand — topics the site's own visitors are asking for and it doesn't have. */
export async function fetchContentDemand(conn: CustomApiConn): Promise<DemandResponse> {
  if (!conn.demandKey) throw new Error('No content-demand key configured for this connection.')
  const res = await fetch(`${root(conn.baseUrl)}/internal/content-demand`, {
    headers: { 'x-api-key': conn.demandKey, 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) {
    const msg = (body && body.error) ? String(body.error) : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body as DemandResponse
}

export type DeliverArticleInput = {
  externalId: string
  slug: string
  title: string
  excerpt?: string
  bodyHtml: string
  kind?: 'educational' | 'informative'
  tag?: string
  sourceTopic?: string
  featuredImage?: string
  featuredAlt?: string
}
export type DeliverArticleResult = { id: string; status: 'draft' | 'published'; updated: boolean; words: number; warnings: string[] }

/**
 * POST {baseUrl}/internal/articles — deliver a finished article. Arrives as a
 * DRAFT on the target site; a human there decides whether it goes live (this
 * is a deliberate product decision on kids.ro's side, not a limitation to
 * work around). Idempotent on externalId: resending something already
 * published there updates the text without unpublishing it.
 */
export async function deliverArticle(conn: CustomApiConn, article: DeliverArticleInput): Promise<DeliverArticleResult> {
  if (!conn.articleKey) throw new Error('No article-delivery key configured for this connection.')
  const res = await fetch(`${root(conn.baseUrl)}/internal/articles`, {
    method: 'POST',
    headers: { 'x-api-key': conn.articleKey, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify(article),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) {
    // A 409 (slug clash with existing content on their side) carries a
    // specific, human-readable reason — surface it as-is rather than a
    // generic "HTTP 409".
    const msg = (body && body.error) ? String(body.error) : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body as DeliverArticleResult
}

/**
 * Verify the demand key works before saving a connection — same "prove it
 * before trusting it" pattern as verifyConnection() in lib/wordpress.ts.
 * There's no read-only way to verify the article key (the only endpoint that
 * accepts it WRITES); callers use a throwaway test article for that instead
 * (mirrors wordpress.ts's /test endpoint).
 */
export async function verifyDemandKey(conn: CustomApiConn): Promise<{ ok: true; topics: number } > {
  const data = await fetchContentDemand(conn)
  return { ok: true, topics: Array.isArray(data.topics) ? data.topics.length : 0 }
}
