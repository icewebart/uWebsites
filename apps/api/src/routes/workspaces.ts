import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, memberships, pages, brandingTokens } from '@uwebsites/db'
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
  res.json({ ok: true, data: ws })
})

// GET /workspaces/:slug/pages — list pages in a workspace (account-scoped)
workspacesRouter.get('/:slug/pages', requireAuth, async (req: AuthRequest, res) => {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, String(req.params.slug)), eq(workspaces.accountId, req.user!.accountId))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const rows = await db.select({ id: pages.id, type: pages.type, slug: pages.slug, title: pages.title, status: pages.status })
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
