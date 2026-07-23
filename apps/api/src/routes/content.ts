import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { and, desc, eq } from 'drizzle-orm'
import { db, workspaces, accounts, pages, brandingTokens, aiJobs, wordpressConnections } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { limitsForPlan } from '@uwebsites/shared'
import { articlesThisWeek } from '../lib/entitlements.js'
import { getGoogleConn, hasScope, SCOPE_SEARCH, scQuery } from '../lib/google-data.js'

// The Website Content cockpit — one endpoint that answers "how is my content
// doing and what should I do next", so the Overview page is a single request.
export const contentRouter = Router()

async function ownedWs(slug: string, accountId: string) {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, accountId))).limit(1)
  return ws
}

const ARTICLE_TYPES = new Set(['article', 'collection_item'])

async function buildOverview(ws: any, accountId: string) {
  const [tokRow] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const tokens: any = tokRow?.tokens || {}
  const plan = tokens.article_plan || { items: [], auto: false }
  const items: any[] = Array.isArray(plan.items) ? plan.items : []

  const pageRows = await db.select({ id: pages.id, title: pages.title, slug: pages.slug, type: pages.type, status: pages.status, seo: pages.seo, updatedAt: pages.updatedAt })
    .from(pages).where(eq(pages.workspaceId, ws.id))
  const articles = pageRows.filter((p) => ARTICLE_TYPES.has(String(p.type)))

  const [acc] = await db.select({ plan: accounts.plan }).from(accounts).where(eq(accounts.id, ws.accountId)).limit(1)
  const limits = limitsForPlan(acc?.plan)
  const usedThisWeek = await articlesThisWeek(ws.accountId)

  const [wp] = await db.select().from(wordpressConnections).where(eq(wordpressConnections.workspaceId, ws.id)).limit(1)

  const [lastJob] = await db.select({ createdAt: aiJobs.createdAt }).from(aiJobs)
    .where(and(eq(aiJobs.workspaceId, ws.id), eq(aiJobs.kind, 'article')))
    .orderBy(desc(aiJobs.createdAt)).limit(1)

  // Search Console performance (gap #7) — totals plus the pages that are
  // actually earning, so the Overview can point at what to refresh.
  let search: any = null
  try {
    const scProperty = tokens?.analytics?.scProperty
    const conn = await getGoogleConn(accountId)
    if (scProperty && conn && hasScope(conn, SCOPE_SEARCH)) {
      const r: any = await scQuery(accountId, scProperty, 28)
      search = { totals: r?.totals || null, topPages: (r?.byPage || r?.pages || []).slice(0, 5), topQueries: (r?.byQuery || r?.queries || []).slice(0, 5) }
    }
  } catch { /* performance data is a bonus, never blocks the page */ }

  const needsReview = articles.filter((a) => (a.seo as any)?.review?.heldForReview).length

  return {
    articles: {
      total: articles.length,
      published: articles.filter((a) => a.status === 'published').length,
      drafts: articles.filter((a) => a.status !== 'published').length,
      needsReview,
    },
    plan: {
      queued: items.filter((i) => i.status === 'idea' || i.status === 'queued').length,
      total: items.length,
      auto: !!plan.auto,
    },
    cadence: { perWeek: limits.articlesPerWeek, usedThisWeek, plan: acc?.plan || 'trial' },
    wordpress: wp ? { siteUrl: wp.siteUrl, postsCreated: wp.postsCreated, lastPostAt: wp.lastPostAt, lastError: wp.lastError, defaultStatus: wp.defaultStatus } : null,
    lastArticleAt: lastJob?.createdAt || null,
    search,
    // Small, high-signal list for the agent + the "what to do next" nudges.
    recent: articles
      .slice()
      .sort((a, b) => (b.updatedAt?.getTime?.() || 0) - (a.updatedAt?.getTime?.() || 0))
      .slice(0, 8)
      .map((a) => ({ id: a.id, title: a.title, status: a.status, score: (a.seo as any)?.review?.score ?? null, keyword: (a.seo as any)?.keyword || null })),
    planItems: items.slice(0, 40).map((i) => ({ keyword: i.keyword, status: i.status, position: i.position ?? null, impressions: i.impressions ?? null })),
  }
}

contentRouter.get('/:slug/content/overview', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  res.json({ ok: true, data: await buildOverview(ws, req.user!.accountId) })
})

// The cockpit agent. Advisory for now: it sees the live snapshot (stats, plan,
// recent articles, Search Console) and answers / recommends. Actions (draft,
// queue, toggle auto-write) are the next step — deliberately not wired yet, so
// it can never take an action the user didn't ask for.
contentRouter.post('/:slug/content/chat', requireAuth, async (req: AuthRequest, res) => {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return res.status(503).json({ ok: false, error: 'AI not configured — set ANTHROPIC_API_KEY on the server.' })
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const msgs = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : []
  if (!msgs.length) return res.status(400).json({ ok: false, error: 'messages required' })

  const snapshot = await buildOverview(ws, req.user!.accountId)
  try {
    const a = new Anthropic({ apiKey: key })
    const r = await a.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: 900,
      system: `You are the content strategist for "${ws.name}". You can see a live snapshot of this site's content operation below. Answer the user's questions about it and recommend the highest-impact next move.

Rules:
- Be concrete and specific to THIS data — cite real numbers, keywords and article titles from the snapshot. Never invent metrics.
- Lead with the answer, then a short reason. Keep it to a few sentences unless asked for detail.
- Prefer recommending: refreshing a page that's slipping, drafting a near-ranking keyword (position 4-20), or fixing anything held for review — over writing brand-new content.
- If the plan is empty or Search Console isn't connected, say so plainly and name the one step that unblocks the most.
- You cannot perform actions yet; tell the user exactly where to click instead.

LIVE SNAPSHOT (JSON):
${JSON.stringify(snapshot).slice(0, 12000)}`,
      messages: msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
    })
    const text = r.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('').trim()
    res.json({ ok: true, data: { reply: text || 'I had nothing to add there — try asking about a specific keyword or article.' } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Agent failed: ' + (e?.message || 'unknown') })
  }
})
