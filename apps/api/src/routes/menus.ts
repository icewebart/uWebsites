import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, menus } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

// Workspace-level menus — header + footer — applied to every published page.
// The data shape kept flat for v1: tree = { items: [{label, href}], cta? }.
// Auto-populated on import from the source site's <nav> + main CTA.

export const menusRouter = Router()
type MenuItem = { label: string; href: string }
export type MenuTree = { items: MenuItem[]; cta?: { label: string; href: string } | null }

async function ownedWs(slug: string, accountId: string) {
  const [ws] = await db.select().from(workspaces).where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, accountId))).limit(1)
  return ws
}

export async function getMenusFor(workspaceId: string): Promise<{ header: MenuTree; footer: MenuTree }> {
  const rows = await db.select().from(menus).where(eq(menus.workspaceId, workspaceId))
  const find = (loc: string) => (rows.find((r) => r.location === loc)?.tree as MenuTree | undefined) || { items: [] }
  return { header: find('header'), footer: find('footer') }
}

async function upsertMenu(workspaceId: string, location: 'header' | 'footer', tree: MenuTree) {
  const [existing] = await db.select().from(menus).where(and(eq(menus.workspaceId, workspaceId), eq(menus.location, location))).limit(1)
  if (existing) await db.update(menus).set({ tree: tree as any }).where(eq(menus.id, existing.id))
  else await db.insert(menus).values({ workspaceId, location, tree: tree as any })
}
export { upsertMenu }

menusRouter.get('/:slug/menus', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  res.json({ ok: true, data: await getMenusFor(ws.id) })
})

// Sanitiser — keep items minimal {label, href}, drop empties, cap counts
function clean(tree: any, maxItems: number): MenuTree {
  if (!tree || typeof tree !== 'object') return { items: [] }
  const items = Array.isArray(tree.items) ? tree.items
    .map((i: any) => ({ label: String(i?.label || '').trim().slice(0, 60), href: String(i?.href || '').trim().slice(0, 500) }))
    .filter((i: any) => i.label && i.href)
    .slice(0, maxItems) : []
  const cta = tree.cta?.label
    ? { label: String(tree.cta.label).trim().slice(0, 40), href: String(tree.cta.href || '').trim().slice(0, 500) }
    : null
  return { items, cta }
}

menusRouter.put('/:slug/menus', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const { header, footer } = req.body ?? {}
  if (header !== undefined) await upsertMenu(ws.id, 'header', clean(header, 10))
  if (footer !== undefined) await upsertMenu(ws.id, 'footer', clean(footer, 20))
  res.json({ ok: true, data: await getMenusFor(ws.id) })
})
