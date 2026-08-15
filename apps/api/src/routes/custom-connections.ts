import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, pages, customConnections } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { fetchContentDemand, deliverArticle, verifyDemandKey, type CustomApiConn } from '../lib/custom-api.js'

// Connect a site that speaks the "custom API" content contract (GET
// content-demand + POST articles — see kids.ro's ARTICOLE.md) instead of
// WordPress's REST API. Generic and reusable: kids.ro is the first, any
// future site implementing the same two endpoints connects the same way.
// Both keys are stored server-side and NEVER returned to the client (masked
// hint only), same rule as wordpressConnections.authSecret.
export const customConnectionsRouter = Router()

async function ownedWs(slug: string, accountId: string) {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, accountId))).limit(1)
  return ws
}

const mask = (s: string | null) => (s && s.length > 4 ? `••••${s.slice(-4)}` : (s ? '••••' : null))

async function connectionFor(workspaceId: string) {
  const [c] = await db.select().from(customConnections)
    .where(eq(customConnections.workspaceId, workspaceId)).limit(1)
  return c
}

// GET /workspaces/:slug/custom-connection — status (no secrets).
customConnectionsRouter.get('/:slug/custom-connection', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const c = await connectionFor(ws.id)
  if (!c) return res.json({ ok: true, data: null })
  res.json({ ok: true, data: {
    name: c.name, baseUrl: c.baseUrl,
    demandKeyHint: mask(c.demandKey), articleKeyHint: mask(c.articleKey),
    defaultKind: c.defaultKind, postsCreated: c.postsCreated, lastPostAt: c.lastPostAt,
    lastPullAt: c.lastPullAt, lastPullCount: c.lastPullCount, lastError: c.lastError,
  } })
})

// POST /workspaces/:slug/custom-connection — save (and verify the demand key, if given).
customConnectionsRouter.post('/:slug/custom-connection', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const name = String(req.body?.name || '').trim()
  const baseUrl = String(req.body?.baseUrl || '').trim().replace(/\/+$/, '')
  const demandKey = req.body?.demandKey != null ? String(req.body.demandKey).trim() : undefined
  const articleKey = req.body?.articleKey != null ? String(req.body.articleKey).trim() : undefined
  const defaultKind = req.body?.defaultKind === 'educational' ? 'educational' : 'informative'
  if (!name) return res.status(400).json({ ok: false, error: 'name required' })
  if (!/^https?:\/\//i.test(baseUrl)) return res.status(400).json({ ok: false, error: 'baseUrl must start with http:// or https://' })

  const existing = await connectionFor(ws.id)
  // A key field left blank on an update keeps the existing stored key —
  // callers only send a key when they're actually setting/changing it (the
  // client never receives the real value back to re-submit).
  const finalDemandKey = demandKey || existing?.demandKey || null
  const finalArticleKey = articleKey || existing?.articleKey || null

  let demandCheck: { ok: true; topics: number } | null = null
  if (demandKey) {
    try { demandCheck = await verifyDemandKey({ baseUrl, demandKey: finalDemandKey }) }
    catch (e: any) { return res.status(400).json({ ok: false, error: `Could not verify the content-demand key: ${e?.message || 'unknown error'}` }) }
  }

  const values = {
    workspaceId: ws.id, name, baseUrl, demandKey: finalDemandKey, articleKey: finalArticleKey,
    defaultKind, lastError: null as string | null, updatedAt: new Date(),
  }
  if (existing) await db.update(customConnections).set(values).where(eq(customConnections.id, existing.id))
  else await db.insert(customConnections).values(values)

  res.json({ ok: true, data: { name, baseUrl, defaultKind, demandVerified: !!demandCheck, topicsAvailable: demandCheck?.topics ?? null } })
})

// DELETE /workspaces/:slug/custom-connection — disconnect.
customConnectionsRouter.delete('/:slug/custom-connection', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  await db.delete(customConnections).where(eq(customConnections.workspaceId, ws.id))
  res.json({ ok: true, data: { disconnected: true } })
})

// POST /workspaces/:slug/custom-connection/test — push a throwaway draft to
// prove the article-delivery key + pipeline work end-to-end before trusting
// it with real articles (mirrors POST /wordpress/test).
customConnectionsRouter.post('/:slug/custom-connection/test', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const c = await connectionFor(ws.id)
  if (!c) return res.status(404).json({ ok: false, error: 'not connected' })
  try {
    const result = await deliverArticle(c as CustomApiConn, {
      externalId: `uwebsites-test-${c.id}`,
      slug: `uwebsites-test-post-${Date.now()}`,
      title: 'uWebsites test post — safe to reject',
      bodyHtml: '<p>If you can read this in your moderation queue, uWebsites is connected. '
        + 'This test article has no real content — reject it, that will not affect the connection. '
        + 'It links back to the homepage so the internal-link check passes: <a href="/">home</a>.</p>'
        + '<p>'.padEnd(0) + 'Padding so the word-count threshold does not also warn on this test: '
        + Array(120).fill('word').join(' ') + '</p>',
      kind: c.defaultKind as 'educational' | 'informative',
    })
    res.json({ ok: true, data: result })
  } catch (e: any) {
    await db.update(customConnections).set({ lastError: String(e?.message || 'unknown'), updatedAt: new Date() }).where(eq(customConnections.id, c.id))
    res.status(502).json({ ok: false, error: `Test delivery failed: ${e?.message || 'unknown'}` })
  }
})

// POST /workspaces/:slug/custom-connection/pull-demand — the topics the
// connected site's own visitors are searching for and it doesn't have.
// Returns the raw list; the caller (Keywords tab) offers them as one-click
// adds to the Article Plan, same shape as "Pull from Search Console".
customConnectionsRouter.post('/:slug/custom-connection/pull-demand', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const c = await connectionFor(ws.id)
  if (!c) return res.status(404).json({ ok: false, error: 'not connected' })
  if (!c.demandKey) return res.status(400).json({ ok: false, error: 'No content-demand key configured for this connection.' })
  try {
    const data = await fetchContentDemand(c as CustomApiConn)
    await db.update(customConnections).set({ lastPullAt: new Date(), lastPullCount: data.topics?.length || 0, lastError: null, updatedAt: new Date() }).where(eq(customConnections.id, c.id))
    res.json({ ok: true, data })
  } catch (e: any) {
    await db.update(customConnections).set({ lastError: String(e?.message || 'unknown'), updatedAt: new Date() }).where(eq(customConnections.id, c.id))
    res.status(502).json({ ok: false, error: `Pull failed: ${e?.message || 'unknown'}` })
  }
})

// POST /workspaces/:slug/custom-connection/publish-page — deliver a written
// article to the connected site. It arrives there as a DRAFT (their
// moderation gate, by design — see ARTICOLE.md); this button hands it off,
// it does not make it live. Idempotent: externalId (the uWebsites page id)
// dedupes, so re-running updates the same remote article.
customConnectionsRouter.post('/:slug/custom-connection/publish-page', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const c = await connectionFor(ws.id)
  if (!c) return res.status(404).json({ ok: false, error: 'This workspace is not connected to a custom API.' })
  const pageId = String(req.body?.pageId || '')
  if (!pageId) return res.status(400).json({ ok: false, error: 'pageId required' })

  const [page] = await db.select().from(pages).where(and(eq(pages.id, pageId), eq(pages.workspaceId, ws.id))).limit(1)
  if (!page) return res.status(404).json({ ok: false, error: 'article not found' })
  const seo: any = page.seo || {}
  if (seo.wp_imported) return res.status(400).json({ ok: false, error: 'This article was imported FROM another site — publish it there, not here.' })

  const blocks: any[] = Array.isArray(page.blocks) ? (page.blocks as any[]) : []
  const html = blocks.find((b) => b?.type === 'article-body')?.props?.html
    || blocks.filter((b) => typeof b?.props?.html === 'string').map((b) => b.props.html).join('\n')
  if (!html || !html.trim()) return res.status(400).json({ ok: false, error: 'This article has no body content to publish.' })
  const heroImg = blocks.find((b) => b?.type === 'article-hero')?.props
  // A slug the connected site will accept: lowercase-kebab, matching its own
  // validation (see kids.ro's zod schema) — the platform's own page slugs
  // already satisfy this, but re-derive defensively rather than trust it blind.
  const slug = String(page.slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)

  try {
    const result = await deliverArticle(c as CustomApiConn, {
      externalId: page.id,
      slug,
      title: page.title,
      excerpt: String(seo.description || '').slice(0, 400) || undefined,
      bodyHtml: html,
      kind: c.defaultKind as 'educational' | 'informative',
      sourceTopic: seo.keyword ? String(seo.keyword).slice(0, 200) : undefined,
      featuredImage: heroImg?.image_url || undefined,
      featuredAlt: heroImg?.image_alt || page.title,
    })
    await db.update(pages).set({ seo: { ...seo, customDelivery: { connectionName: c.name, remoteId: result.id, status: result.status, deliveredAt: new Date().toISOString() } }, updatedAt: new Date() }).where(eq(pages.id, page.id))
    await db.update(customConnections).set({ postsCreated: (c.postsCreated || 0) + 1, lastPostAt: new Date(), lastError: null, updatedAt: new Date() }).where(eq(customConnections.id, c.id))
    res.json({ ok: true, data: result })
  } catch (e: any) {
    await db.update(customConnections).set({ lastError: String(e?.message || 'unknown'), updatedAt: new Date() }).where(eq(customConnections.id, c.id))
    res.status(502).json({ ok: false, error: `Delivery failed: ${e?.message || 'unknown'}` })
  }
})
