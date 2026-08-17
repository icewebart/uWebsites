import { Router } from 'express'
import { and, eq, inArray } from 'drizzle-orm'
import { db, accounts, workspaces, domains, brandingTokens, pages } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { getGoogleConn, saveGoogleConn, hasScope, SCOPE_SEARCH, SCOPE_ANALYTICS, scListSites, scQuery, scOpportunities, gaListProperties, gaReport } from '../lib/google-data.js'
import { fetchSerp, fetchAutocomplete, serpEnabled } from '../lib/serp.js'
import { scoreOpportunity, estimateDifficultyFromSerp, fetchKeywordMetrics, keywordDataEnabled, type OppInput } from '../lib/opportunity.js'

// Account-level settings: integrations (Cloudflare) + domains across all
// workspaces. Secrets are stored in accounts.settings (jsonb) server-side and
// NEVER returned to the client (only a masked hint + connection status).
export const accountRouter = Router()
const SERVER_IP = process.env.SERVER_IP || '75.119.159.89'
const CF_API = 'https://api.cloudflare.com/client/v4'
const HOSTNAME_RE = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/

export async function getSettings(accountId: string): Promise<any> {
  const [a] = await db.select({ settings: accounts.settings }).from(accounts).where(eq(accounts.id, accountId)).limit(1)
  return (a?.settings as any) || {}
}
export async function saveSettings(accountId: string, settings: any) {
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

// ---------------- Preferences ----------------
// Small account-level toggles that don't warrant their own table. Currently
// just the dashboard AI-suggestions call (GET /ai/dashboard-suggestions) —
// it burns a real LLM call on every dashboard load, so it's opt-out-able.
// Undefined = on, matching the feature's existing default behavior.
accountRouter.get('/preferences', requireAuth, async (req: AuthRequest, res) => {
  const s = await getSettings(req.user!.accountId)
  res.json({ ok: true, data: { dashboardSuggestions: s?.preferences?.dashboardSuggestions !== false } })
})
accountRouter.put('/preferences', requireAuth, async (req: AuthRequest, res) => {
  const s = await getSettings(req.user!.accountId)
  const dashboardSuggestions = !!req.body?.dashboardSuggestions
  await saveSettings(req.user!.accountId, { ...s, preferences: { ...(s.preferences || {}), dashboardSuggestions } })
  res.json({ ok: true, data: { dashboardSuggestions } })
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

// ---------------- Per-workspace analytics link ----------------
// Pin a Search Console property + GA4 property to a workspace so its search /
// traffic data is always available for that site (analysis, content ideas).
// Stored in the workspace's branding tokens (tokens.analytics).
async function ownedWsTokens(slug: string, accountId: string) {
  const [ws] = await db.select().from(workspaces).where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, accountId))).limit(1)
  if (!ws) return null
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  return { ws, tok }
}
const clampDays = (v: any) => Math.min(90, Math.max(7, Number(v) || 28))

// GET the current link + the account's available Google properties to pick from.
accountRouter.get('/workspaces/:slug/analytics', requireAuth, async (req: AuthRequest, res) => {
  const r = await ownedWsTokens(String(req.params.slug), req.user!.accountId)
  if (!r) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const link = (r.tok?.tokens as any)?.analytics || {}
  const conn = await getGoogleConn(req.user!.accountId)
  let sites: any[] = [], properties: any[] = []
  if (conn && hasScope(conn, SCOPE_SEARCH)) sites = await scListSites(req.user!.accountId).catch(() => [])
  if (conn && hasScope(conn, SCOPE_ANALYTICS)) properties = await gaListProperties(req.user!.accountId).catch(() => [])
  res.json({ ok: true, data: { scProperty: link.scProperty || null, gaProperty: link.gaProperty || null, googleConnected: !!conn, searchConsole: hasScope(conn, SCOPE_SEARCH), analytics: hasScope(conn, SCOPE_ANALYTICS), sites, properties } })
})

// PUT the link { scProperty, gaProperty } (either may be null to unlink).
accountRouter.put('/workspaces/:slug/analytics', requireAuth, async (req: AuthRequest, res) => {
  const r = await ownedWsTokens(String(req.params.slug), req.user!.accountId)
  if (!r) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const scProperty = req.body?.scProperty ? String(req.body.scProperty) : null
  const gaProperty = req.body?.gaProperty ? String(req.body.gaProperty) : null
  const tokens = { ...((r.tok?.tokens as any) || {}), analytics: { scProperty, gaProperty } }
  if (r.tok) await db.update(brandingTokens).set({ tokens }).where(eq(brandingTokens.id, r.tok.id))
  else await db.insert(brandingTokens).values({ workspaceId: r.ws.id, tokens })
  res.json({ ok: true, data: { scProperty, gaProperty } })
})

// GET this workspace's data using its linked properties — the always-available
// per-site report (drives the Tracking-page panel and future content tools).
accountRouter.get('/workspaces/:slug/insights', requireAuth, async (req: AuthRequest, res) => {
  const r = await ownedWsTokens(String(req.params.slug), req.user!.accountId)
  if (!r) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const link = (r.tok?.tokens as any)?.analytics || {}
  const days = clampDays(req.query.days)
  const out: any = { scProperty: link.scProperty || null, gaProperty: link.gaProperty || null }
  if (link.scProperty) { try { out.searchConsole = await scQuery(req.user!.accountId, link.scProperty, days) } catch (e: any) { out.scError = String(e?.message || 'error') } }
  if (link.gaProperty) { try { out.analytics = await gaReport(req.user!.accountId, link.gaProperty, days) } catch (e: any) { out.gaError = String(e?.message || 'error') } }
  res.json({ ok: true, data: out })
})

// ---------------- Article Plan (keyword pipeline) ----------------
// A per-workspace list of target keywords the content engine works through.
// Sources: manual add, bulk paste, "Pull from Search Console", (later) other
// tools. Stored in tokens.article_plan { items:[], auto:bool }.
type PlanItem = { id: string; keyword: string; status: 'idea' | 'queued' | 'drafted' | 'published'; priority: number; source: string; impressions?: number; position?: number; pageId?: string; createdAt: string }

// Keyword cannibalisation guard (gap #6): flag plan keywords this site ALREADY
// has an article for. Two pages chasing one query compete with each other and
// both rank worse — better to refresh the existing piece than write a rival.
const normKw = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()

async function coverageMap(workspaceId: string, keywords: string[]): Promise<Record<string, { pageId: string; title: string }>> {
  const out: Record<string, { pageId: string; title: string }> = {}
  const wanted = keywords.map(normKw).filter(Boolean)
  if (!wanted.length) return out
  const rows = await db.select({ id: pages.id, title: pages.title, seo: pages.seo, type: pages.type }).from(pages).where(eq(pages.workspaceId, workspaceId))
  for (const p of rows) {
    if (!String(p.type || '').includes('article') && p.type !== 'collection_item') continue
    const pageKw = normKw((p.seo as any)?.keyword || '')
    const pageTitle = normKw(p.title || '')
    for (const kw of wanted) {
      if (out[kw]) continue
      // Conservative: the page explicitly targets this keyword, or its title
      // contains the whole phrase. Avoids false positives on shared words.
      if ((pageKw && pageKw === kw) || (kw.length > 6 && pageTitle.includes(kw))) {
        out[kw] = { pageId: p.id, title: p.title || '' }
      }
    }
  }
  return out
}

accountRouter.get('/workspaces/:slug/article-plan', requireAuth, async (req: AuthRequest, res) => {
  const r = await ownedWsTokens(String(req.params.slug), req.user!.accountId)
  if (!r) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const plan = (r.tok?.tokens as any)?.article_plan || { items: [], auto: false }
  const link = (r.tok?.tokens as any)?.analytics || {}
  const items = plan.items || []
  const covered = await coverageMap(r.ws.id, items.map((i: any) => i?.keyword || ''))
  const annotated = items.map((i: any) => ({ ...i, coveredBy: covered[normKw(i?.keyword || '')] || null }))
  res.json({ ok: true, data: { items: annotated, auto: !!plan.auto, pillars: plan.pillars || [], autoApproveBriefs: !!plan.autoApproveBriefs, cadenceDays: plan.cadenceDays || null, scLinked: !!link.scProperty } })
})

accountRouter.put('/workspaces/:slug/article-plan', requireAuth, async (req: AuthRequest, res) => {
  const r = await ownedWsTokens(String(req.params.slug), req.user!.accountId)
  if (!r) return res.status(404).json({ ok: false, error: 'workspace not found' })
  // `coveredBy` is annotated on read (cannibalisation guard) — never persist it.
  const items = (Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [])
    .map(({ coveredBy, ...rest }: any) => rest)
  const auto = !!req.body?.auto
  // Pillars (the topic map). Kept alongside items so a cluster name on an item
  // resolves to a pillar with a description + business value.
  const prevPlan = ((r.tok?.tokens as any) || {}).article_plan || {}
  const pillars = Array.isArray(req.body?.pillars)
    ? req.body.pillars.slice(0, 30).map((p: any) => ({
        name: String(p?.name || '').slice(0, 120),
        description: String(p?.description || '').slice(0, 400),
        businessValue: ['high', 'medium', 'low'].includes(p?.businessValue) ? p.businessValue : 'medium',
      })).filter((p: any) => p.name)
    : (prevPlan.pillars || [])
  // Auto-approve: briefs are still generated and stored (so the outline, the
  // interlinks and the compliance gate all still apply) but don't block the
  // weekly cron. Hands-on clients approve each one; set-and-forget clients don't.
  const autoApproveBriefs = req.body?.autoApproveBriefs === undefined
    ? !!prevPlan.autoApproveBriefs : !!req.body.autoApproveBriefs
  // Minimum days between auto-written articles for THIS workspace, on top of
  // (never instead of) the account's plan-tier cadence — the account cap is
  // shared across every workspace on it; this is the one dial that slows a
  // single workspace down without touching the others. null/0 = no override,
  // just the account cadence as before.
  const cadenceDays = req.body?.cadenceDays === undefined
    ? (prevPlan.cadenceDays ?? null)
    : (Number(req.body.cadenceDays) > 0 ? Math.min(30, Math.round(Number(req.body.cadenceDays))) : null)
  const tokens = { ...((r.tok?.tokens as any) || {}), article_plan: { items, auto, pillars, autoApproveBriefs, cadenceDays } }
  if (r.tok) await db.update(brandingTokens).set({ tokens }).where(eq(brandingTokens.id, r.tok.id))
  else await db.insert(brandingTokens).values({ workspaceId: r.ws.id, tokens })
  res.json({ ok: true, data: { items, auto, pillars, autoApproveBriefs, cadenceDays } })
})

// Pull keyword ideas from the workspace's LINKED Search Console property.
accountRouter.post('/workspaces/:slug/article-plan/pull-search-console', requireAuth, async (req: AuthRequest, res) => {
  const r = await ownedWsTokens(String(req.params.slug), req.user!.accountId)
  if (!r) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const link = (r.tok?.tokens as any)?.analytics || {}
  if (!link.scProperty) return res.status(400).json({ ok: false, error: 'Link a Search Console property on the Tracking page first.' })
  const days = Math.min(90, Math.max(28, Number(req.body?.days) || 90))
  try {
    const rows = await scOpportunities(req.user!.accountId, link.scProperty, days)
    res.json({ ok: true, data: rows })
  } catch (e: any) { reauth(res, e) }
})

// The OPPORTUNITY ENGINE — score every keyword by ROI and rank them, so a
// client always knows what to write next. Three layers, each optional:
//   1. Search Console standing — near-ranking (pos 4–20) queries with real
//      impressions are the highest-ROI, cheapest wins. Also doubles as a
//      content audit for imported articles (are they earning?).
//   2. SERP-estimated difficulty — for the shortlist, how locked-down the SERP
//      is (authority of the ranking domains). On when SERPER_API_KEY is set.
//   3. Real volume + difficulty — from a keyword-data provider when wired
//      (KEYWORD_API_KEY); the maths already reads it, no code change needed.
// Everything degrades gracefully: with nothing linked it still ranks by
// business value + coverage, and sharpens as each data source comes online.
accountRouter.post('/workspaces/:slug/article-plan/opportunities', requireAuth, async (req: AuthRequest, res) => {
  const r = await ownedWsTokens(String(req.params.slug), req.user!.accountId)
  if (!r) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const tokens = (r.tok?.tokens as any) || {}
  const plan = tokens.article_plan || {}
  const items: any[] = Array.isArray(plan.items) ? plan.items : []
  const pillars: any[] = Array.isArray(plan.pillars) ? plan.pillars : []
  const link = tokens.analytics || {}
  const days = Math.min(90, Math.max(28, Number(req.body?.days) || 90))
  // How many top candidates to enrich with a live SERP look-up (bounded — each
  // is a serper.dev call). Difficulty for the rest stays neutral.
  const enrichN = Math.min(20, Math.max(0, Number(req.body?.enrich ?? 12) || 0))

  // pillar name → business value, so an item's cluster resolves to a value.
  const valueOf = new Map<string, 'high' | 'medium' | 'low'>()
  for (const p of pillars) if (p?.name) valueOf.set(normKw(p.name), (['high', 'medium', 'low'].includes(p?.businessValue) ? p.businessValue : 'medium'))

  // Search Console standing — position + impressions per query.
  const sc = new Map<string, { position: number; impressions: number; clicks: number }>()
  let scLinked = false
  try {
    const conn = await getGoogleConn(req.user!.accountId)
    if (link.scProperty && conn && hasScope(conn, SCOPE_SEARCH)) {
      scLinked = true
      const [opps, q] = await Promise.all([
        scOpportunities(req.user!.accountId, link.scProperty, days).catch(() => []),
        scQuery(req.user!.accountId, link.scProperty, days).catch(() => null),
      ])
      for (const o of (opps as any[]) || []) sc.set(normKw(o.query), { position: o.position, impressions: o.impressions, clicks: o.clicks })
      for (const o of (q as any)?.topQueries || []) if (!sc.has(normKw(o.query))) sc.set(normKw(o.query), { position: o.position, impressions: o.impressions, clicks: o.clicks })
    }
  } catch { /* performance data is a bonus, never blocks scoring */ }

  // Coverage (cannibalisation guard). coverageMap keys results by normalised
  // keyword, so one call over both plan keywords and discovered SC queries.
  const planKeys = items.map((i) => String(i?.keyword || '')).filter(Boolean)
  const discovered = [...sc.keys()].filter((k) => !planKeys.some((pk) => normKw(pk) === k))
  const covered = await coverageMap(r.ws.id, [...planKeys, ...sc.keys()])
  const coveredDisc = covered

  // Candidate = every plan item, plus SC queries we rank for but haven't planned.
  type Cand = OppInput & { source: 'plan' | 'search-console'; cluster?: string; coveredBy?: { pageId: string; title: string } | null; id?: string; intentSource?: 'plan' | 'serp' }
  const cands: Cand[] = []
  for (const it of items) {
    const key = normKw(String(it?.keyword || ''))
    if (!key) continue
    const s = sc.get(key)
    cands.push({
      id: it.id, keyword: String(it.keyword), source: 'plan', cluster: it.cluster || undefined,
      intent: it.intent || null,
      position: s?.position ?? (it.position ?? null),
      impressions: s?.impressions ?? (it.impressions ?? null),
      clicks: s?.clicks ?? null,
      businessValue: (it.cluster && valueOf.get(normKw(it.cluster))) || 'medium',
      covered: !!covered[key],
      coveredBy: covered[key] || null,
    })
  }
  for (const key of discovered) {
    const s = sc.get(key)!
    cands.push({
      keyword: key, source: 'search-console',
      position: s.position, impressions: s.impressions, clicks: s.clicks,
      businessValue: 'medium', intent: null,
      covered: !!coveredDisc[key], coveredBy: coveredDisc[key] || null,
    })
  }

  // Optional real volume/difficulty from a provider (inert until wired).
  if (keywordDataEnabled()) {
    try {
      const km = await fetchKeywordMetrics(cands.map((c) => c.keyword))
      for (const c of cands) { const m = km.get(normKw(c.keyword)); if (m) { c.volume = m.volume ?? c.volume; c.difficulty = m.difficulty ?? c.difficulty } }
    } catch { /* provider is a bonus */ }
  }

  // Preliminary score (no SERP difficulty yet) to pick the shortlist to enrich.
  const prelim = cands.map((c) => ({ c, s: scoreOpportunity(c) })).sort((a, b) => b.s.score - a.s.score)

  // Enrich the top N with a live SERP difficulty estimate, in parallel.
  let serpUsed = false
  if (serpEnabled() && enrichN > 0) {
    serpUsed = true
    const shortlist = prelim.slice(0, enrichN).filter(({ c }) => c.difficulty == null)
    await Promise.all(shortlist.map(async ({ c }) => {
      try {
        const d = await fetchSerp(c.keyword)
        if (!d) return
        c.difficulty = estimateDifficultyFromSerp(d.results)
        // The live SERP is ground truth for intent — let it override a guessed
        // (or missing) intent when it's confident, so value weighting is right.
        if (d.intent && d.intent.confidence !== 'low') { c.intent = d.intent.kind; c.intentSource = 'serp' }
      } catch { /* skip */ }
    }))
  }

  // Final score (with whatever difficulty we now have) and rank.
  const ranked = cands.map((c) => {
    const s = scoreOpportunity(c)
    return {
      id: c.id || null,
      keyword: c.keyword,
      source: c.source,
      score: s.score,
      tier: s.tier,
      reason: s.reason,
      position: c.position ?? null,
      impressions: c.impressions ?? null,
      clicks: c.clicks ?? null,
      volume: c.volume ?? null,
      difficulty: c.difficulty ?? null,
      businessValue: c.businessValue || 'medium',
      cluster: c.cluster || null,
      intent: c.intent || null,
      intentSource: c.intentSource || null,
      inPlan: c.source === 'plan',
      coveredBy: c.coveredBy || null,
    }
  }).sort((a, b) => b.score - a.score)

  res.json({
    ok: true,
    data: {
      opportunities: ranked,
      signals: {
        searchConsole: scLinked,
        serpDifficulty: serpUsed,
        keywordProvider: keywordDataEnabled(),
        days,
      },
      counts: {
        total: ranked.length,
        quickWins: ranked.filter((o) => o.tier === 'quick-win').length,
        discovered: discovered.length,
      },
    },
  })
})

// Keyword DISCOVERY via Google Autocomplete (serper) — a free way to surface
// real phrases people type around a seed, including ones the site doesn't rank
// for yet (which Search Console can't show). Returns suggestions minus the ones
// already in the plan, so every row is a one-click add.
accountRouter.post('/workspaces/:slug/article-plan/expand', requireAuth, async (req: AuthRequest, res) => {
  const r = await ownedWsTokens(String(req.params.slug), req.user!.accountId)
  if (!r) return res.status(404).json({ ok: false, error: 'workspace not found' })
  if (!serpEnabled()) return res.status(400).json({ ok: false, error: 'Connect a SERP tool (SERPER_API_KEY) to expand keywords.' })
  const seed = String(req.body?.seed || '').trim()
  if (!seed) return res.status(400).json({ ok: false, error: 'Enter a seed keyword to expand.' })
  const gl = String(req.body?.gl || '').trim().slice(0, 2) || undefined
  const hl = String(req.body?.hl || '').trim().slice(0, 5) || undefined
  const suggestions = await fetchAutocomplete(seed, { gl, hl })
  const tokens = (r.tok?.tokens as any) || {}
  const items: any[] = Array.isArray(tokens.article_plan?.items) ? tokens.article_plan.items : []
  const have = new Set(items.map((i) => normKw(String(i?.keyword || ''))))
  res.json({ ok: true, data: { seed, suggestions: suggestions.filter((s) => !have.has(normKw(s))) } })
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
