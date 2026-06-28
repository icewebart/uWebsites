import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, pages, workspaces } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { renderPreview } from './publish.js'

// Single-page load/save for the block editor. Account-scoped via the page's
// workspace (page → workspace → account).
export const pagesRouter = Router()

async function loadOwned(id: string, accountId: string) {
  const [row] = await db.select({
    id: pages.id, workspaceId: pages.workspaceId, type: pages.type, slug: pages.slug,
    title: pages.title, status: pages.status, blocks: pages.blocks, seo: pages.seo,
    wsSlug: workspaces.slug, wsName: workspaces.name,
  })
    .from(pages)
    .innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(and(eq(pages.id, id), eq(workspaces.accountId, accountId)))
    .limit(1)
  return row
}

// GET /pages/:id/preview — text/html, rendered with the workspace's branding tokens
pagesRouter.get('/:id/preview', requireAuth, async (req: AuthRequest, res) => {
  const html = await renderPreview(String(req.params.id), req.user!.accountId)
  if (!html) return res.status(404).send('not found')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})

// GET /pages/:id
pagesRouter.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  const row = await loadOwned(String(req.params.id), req.user!.accountId)
  if (!row) return res.status(404).json({ ok: false, error: 'page not found' })
  res.json({ ok: true, data: row })
})

// PUT /pages/:id — save title / blocks / status
pagesRouter.put('/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = String(req.params.id)
  const owned = await loadOwned(id, req.user!.accountId)
  if (!owned) return res.status(404).json({ ok: false, error: 'page not found' })

  const { title, blocks, status } = req.body ?? {}
  const upd: Record<string, any> = { updatedAt: new Date() }
  if (typeof title === 'string' && title.trim()) upd.title = title.trim()
  if (Array.isArray(blocks)) upd.blocks = blocks
  if (status === 'draft' || status === 'published') upd.status = status

  const [updated] = await db.update(pages).set(upd).where(eq(pages.id, id)).returning()
  res.json({ ok: true, data: updated })
})
