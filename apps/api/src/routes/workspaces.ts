import { Router } from 'express'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db, workspaces, memberships, pages, brandingTokens, builds, domains, aiJobs } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

export const workspacesRouter = Router()

// Default design tokens (ADR-005) — navy/sky, matches the uWebsites brand.
const DEFAULT_TOKENS = {
  color: { primary: '#16324A', accent: '#8FD7F1', surface: '#FFFFFF', text: '#16242E' },
  font: { heading: 'Space Grotesk', body: 'Inter', scale: 1.2, lineHeight: 1.6 },
  shape: { buttonRadius: '12px', cardRadius: '16px', borderWidth: '1px' },
  space: { sectionGap: '64px', sectionPaddingY: '48px', container: '1200px' },
}

async function ownedWorkspace(slug: string, accountId: string) {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, accountId))).limit(1)
  return ws
}

// GET /workspaces — workspaces in the caller's account.
// NOTE: hard isolation is enforced by Postgres RLS in production (ADR-007);
// this account scope is the app-level guard on top.
workspacesRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  const rows = await db.select().from(workspaces).where(eq(workspaces.accountId, req.user!.accountId))
  res.json({ ok: true, data: rows })
})

// POST /workspaces — add another workspace to the account.
workspacesRouter.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { name } = req.body ?? {}
  if (!name) return res.status(400).json({ ok: false, error: 'name required' })
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const [ws] = await db.insert(workspaces).values({ accountId: req.user!.accountId, name, slug }).returning()
  await db.insert(memberships).values({ userId: req.user!.id, workspaceId: ws.id, role: 'owner' })
  res.json({ ok: true, data: ws })
})

// PUT /workspaces/:slug — rename a workspace (slug kept stable to preserve URLs)
workspacesRouter.put('/:slug', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWorkspace(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const { name } = req.body ?? {}
  if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: 'name required' })
  const [updated] = await db.update(workspaces).set({ name: String(name).trim() }).where(eq(workspaces.id, ws.id)).returning()
  res.json({ ok: true, data: updated })
})

// GET /workspaces/overview — dashboard summary for the account.
// Returns per-workspace page counts, draft/published splits, latest build, a
// connected domain (if any), the homepage id (for previews), and the source
// import URL (so the dashboard can offer "continue importing").
workspacesRouter.get('/overview', requireAuth, async (req: AuthRequest, res) => {
  const wss = await db.select().from(workspaces).where(eq(workspaces.accountId, req.user!.accountId))
  const items = await Promise.all(wss.map(async (w) => {
    const [count] = await db.select({ all: sql<number>`count(*)::int`, drafts: sql<number>`sum(case when ${pages.status}='draft' then 1 else 0 end)::int`, pub: sql<number>`sum(case when ${pages.status}='published' then 1 else 0 end)::int` }).from(pages).where(eq(pages.workspaceId, w.id))
    const [home] = await db.select({ id: pages.id, title: pages.title, seo: pages.seo }).from(pages).where(and(eq(pages.workspaceId, w.id), eq(pages.type, 'home'))).limit(1)
    const [lastBuild] = await db.select().from(builds).where(eq(builds.workspaceId, w.id)).orderBy(desc(builds.deployedAt)).limit(1)
    const [domain] = await db.select().from(domains).where(and(eq(domains.workspaceId, w.id), eq(domains.status, 'connected'))).limit(1)
    return {
      id: w.id, name: w.name, slug: w.slug, createdAt: w.createdAt,
      pages: count?.all ?? 0, drafts: count?.drafts ?? 0, published: count?.pub ?? 0,
      homeId: home?.id ?? null, homeTitle: home?.title ?? null,
      importSource: ((home?.seo as any)?.import_source?.url) ?? null,
      lastPublishedAt: lastBuild?.deployedAt ?? null,
      connectedDomain: domain?.hostname ?? null,
    }
  }))
  const totals = items.reduce((a, x) => ({
    workspaces: a.workspaces + 1,
    pages: a.pages + x.pages,
    drafts: a.drafts + x.drafts,
    published: a.published + x.published,
    domains: a.domains + (x.connectedDomain ? 1 : 0),
  }), { workspaces: 0, pages: 0, drafts: 0, published: 0, domains: 0 })

  // Real AI metering — last 30 days, across the account's workspaces.
  const wsIds = wss.map((w) => w.id)
  let ai = { creditsMonth: 0, articles: 0, rewrites: 0, rebuilds: 0, chats: 0 }
  if (wsIds.length) {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const rows = await db.select({ kind: aiJobs.kind, cost: aiJobs.costCredits, input: aiJobs.input })
      .from(aiJobs).where(and(inArray(aiJobs.workspaceId, wsIds), gte(aiJobs.createdAt, since), eq(aiJobs.status, 'done')))
    for (const r of rows) {
      ai.creditsMonth += r.cost ?? 0
      const src = (r.input as any)?.source
      if (r.kind === 'article' && src === 'rebuild') ai.rebuilds++
      else if (r.kind === 'article') ai.articles++
      else if (r.kind === 'edit' && (src === 'chat' || src === 'page-chat')) ai.chats++
      else if (r.kind === 'edit') ai.rewrites++
    }
  }
  res.json({ ok: true, data: { items, totals, ai } })
})

// GET /workspaces/:slug/pages — list pages in a workspace (account-scoped)
workspacesRouter.get('/:slug/pages', requireAuth, async (req: AuthRequest, res) => {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, String(req.params.slug)), eq(workspaces.accountId, req.user!.accountId))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const rows = await db.select({ id: pages.id, type: pages.type, slug: pages.slug, title: pages.title, status: pages.status, seo: pages.seo })
    .from(pages).where(eq(pages.workspaceId, ws.id)).orderBy(pages.type)
  res.json({ ok: true, data: { workspace: { id: ws.id, name: ws.name, slug: ws.slug }, pages: rows } })
})

// GET /workspaces/:slug/branding — design tokens (defaults if unset)
workspacesRouter.get('/:slug/branding', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWorkspace(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [row] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  res.json({ ok: true, data: { tokens: row?.tokens ?? DEFAULT_TOKENS } })
})

// PUT /workspaces/:slug/branding — upsert design tokens
workspacesRouter.put('/:slug/branding', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWorkspace(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const tokens = req.body?.tokens
  if (!tokens || typeof tokens !== 'object') return res.status(400).json({ ok: false, error: 'tokens object required' })
  const [existing] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  if (existing) await db.update(brandingTokens).set({ tokens }).where(eq(brandingTokens.id, existing.id))
  else await db.insert(brandingTokens).values({ workspaceId: ws.id, tokens })
  res.json({ ok: true, data: { tokens } })
})
