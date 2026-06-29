import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, menus, pages } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { analyzeBranding } from './import.js'

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

// POST /workspaces/:slug/menus/refresh — re-fetch the source site (using the
// home page's stored import_source.url) and rebuild the header menu from the
// freshly-extracted nav + main CTA. Useful for workspaces imported before
// menu auto-seeding existed.
menusRouter.post('/:slug/menus/refresh', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  // Find a source URL: home page's import_source, or body { url }
  const [home] = await db.select({ seo: pages.seo }).from(pages).where(and(eq(pages.workspaceId, ws.id), eq(pages.type, 'home'))).limit(1)
  const url = req.body?.url || (home?.seo as any)?.import_source?.url
  if (!url) return res.status(400).json({ ok: false, error: 'No source URL on file. Pass { url } in the body to refresh from a specific site.' })
  try {
    const b = await analyzeBranding(url)
    const items = (b.brand_assets?.nav || []).map((n: any) => ({ label: n.text, href: n.href }))
    const cta = b.brand_assets?.cta || null
    if (!items.length && !cta) return res.status(200).json({ ok: true, data: { ...await getMenusFor(ws.id), refreshed: false, reason: 'No nav or CTA found at source.' } })
    await upsertMenu(ws.id, 'header', { items, cta })
    res.json({ ok: true, data: { ...await getMenusFor(ws.id), refreshed: true, source: url } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Could not refresh from source: ' + (e?.message || 'unknown') })
  }
})

menusRouter.put('/:slug/menus', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const { header, footer } = req.body ?? {}
  if (header !== undefined) await upsertMenu(ws.id, 'header', clean(header, 10))
  if (footer !== undefined) await upsertMenu(ws.id, 'footer', clean(footer, 20))
  res.json({ ok: true, data: await getMenusFor(ws.id) })
})
