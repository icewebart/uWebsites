import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, menus, pages, brandingTokens } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { analyzeBranding } from './import.js'
import { renderHeader, renderFooter, fontsHead, siteCss, DEFAULT_TOKENS } from './publish.js'

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

// GET /workspaces/:slug/menus/preview — full HTML doc with just the rendered
// header + a thin placeholder body + rendered footer, using the workspace's
// real branding tokens. The frontend drops this into an iframe (srcDoc) so
// the user sees exactly how their nav will look on a live page.
menusRouter.get('/:slug/menus/preview', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const { header, footer } = await getMenusFor(ws.id)
  const [tokRow] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const t: any = tokRow?.tokens ?? DEFAULT_TOKENS
  const logo = t?.brand_assets?.logo?.url || null
  const base = `https://${ws.slug}.uwebsites.net`
  const placeholder = `<section style="padding:60px 0;text-align:center"><div class="container"><div style="color:var(--text);opacity:.45;font-size:13px;letter-spacing:.04em;text-transform:uppercase">Your page content</div><div style="height:200px;margin-top:14px;border:2px dashed rgba(0,0,0,.08);border-radius:12px;background:rgba(0,0,0,.015);display:flex;align-items:center;justify-content:center;color:rgba(0,0,0,.25);font-size:12px">— page body lives here —</div></div></section>`
  // If the iframe URL has a #footer hash, jump straight to the footer on load
  // so the footer editor preview opens with the footer in view.
  const scrollScript = `<script>(function(){if(location.hash==='#footer'){var el=document.getElementById('footer');if(el)el.scrollIntoView({block:'start'})}})()</script>`
  const footerHtml = renderFooter(ws, footer).replace('<footer class="site-footer">', '<footer id="footer" class="site-footer">')
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ws.name)} — nav preview</title>${fontsHead(t)}<style>${siteCss(t)}body{background:#f3f5f7}main{min-height:240px;background:#fff}</style></head><body>
${renderHeader(ws, base, header, logo)}
<main>${placeholder}</main>
${footerHtml}
${scrollScript}
</body></html>`
  res.type('text/html').send(html)
})

// Tiny escaper for the preview placeholder above.
function esc(s: string): string { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' } as any)[c]) }

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
