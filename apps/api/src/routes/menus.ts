import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, menus, pages, brandingTokens } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { analyzeBranding, richBranding, articleBlocksFromImport } from './import.js'
import { saveImageBytes } from '../lib/image-host.js'
import { renderHeader, renderFooter, fontsHead, siteCss, DEFAULT_TOKENS, HEADER_SCRIPT } from './publish.js'

// Workspace-level menus — header + footer — applied to every published page.
// The data shape kept flat for v1: tree = { items: [{label, href}], cta? }.
// Auto-populated on import from the source site's <nav> + main CTA.

export const menusRouter = Router()
type MenuItem = { label: string; href: string; children?: MenuItem[] }
export type HeaderStyle = 'glass' | 'solid' | 'minimal'
export const HEADER_STYLES: HeaderStyle[] = ['glass', 'solid', 'minimal']
export type MenuTree = { items: MenuItem[]; cta?: { label: string; href: string } | null; style?: HeaderStyle }

// Map an imported nav tree ({ text, href, children }) to menu items
// ({ label, href, children }). One level of children is kept — enough for
// dropdowns and mega-menus, which is all the published header renders.
export function navTreeToItems(tree: any[]): MenuItem[] {
  return (Array.isArray(tree) ? tree : [])
    .map((n) => {
      const label = String(n?.text ?? n?.label ?? '').trim()
      const href = String(n?.href ?? '').trim()
      if (!label) return null
      const kids = (Array.isArray(n?.children) ? n.children : [])
        .map((c: any) => ({ label: String(c?.text ?? c?.label ?? '').trim(), href: String(c?.href ?? '').trim() }))
        .filter((c: MenuItem) => c.label)
        .slice(0, 16)
      const item: MenuItem = { label, href: href || '#' }
      if (kids.length) item.children = kids
      return item
    })
    .filter(Boolean) as MenuItem[]
}

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
  const fWhite = t?.brand_assets?.logo_white?.url || null
  const fLogo = fWhite || t?.brand_assets?.logo?.url || null
  const footerHtml = renderFooter(ws, footer, t?.brand_assets?.tagline, fLogo, { invert: !fWhite && !!t?.brand_assets?.logo?.url }).replace('<footer class="site-footer">', '<footer id="footer" class="site-footer">')
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ws.name)} — nav preview</title>${fontsHead(t)}<style>${siteCss(t)}body{background:#f3f5f7}main{min-height:240px;background:#fff}</style></head><body>
${renderHeader(ws, base, header, logo)}
<main>${placeholder}</main>
${footerHtml}
${HEADER_SCRIPT}
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

// Sanitiser — keep items minimal {label, href, children?}, drop empties, cap
// counts. One level of children is preserved (dropdown / mega-menu groups).
function clean(tree: any, maxItems: number): MenuTree {
  if (!tree || typeof tree !== 'object') return { items: [] }
  const cleanChildren = (kids: any): MenuItem[] | undefined => {
    if (!Array.isArray(kids)) return undefined
    const out = kids
      .map((c: any) => ({ label: String(c?.label || '').trim().slice(0, 60), href: String(c?.href || '').trim().slice(0, 500) }))
      .filter((c: MenuItem) => c.label && c.href)
      .slice(0, 16)
    return out.length ? out : undefined
  }
  const items = Array.isArray(tree.items) ? tree.items
    .map((i: any) => {
      const item: MenuItem = { label: String(i?.label || '').trim().slice(0, 60), href: String(i?.href || '').trim().slice(0, 500) }
      const kids = cleanChildren(i?.children)
      if (kids) item.children = kids
      return item
    })
    // a parent with children may have an empty href (label-only dropdown trigger)
    .filter((i: MenuItem) => i.label && (i.href || i.children))
    .map((i: MenuItem) => ({ ...i, href: i.href || '#' }))
    .slice(0, maxItems) : []
  const cta = tree.cta?.label
    ? { label: String(tree.cta.label).trim().slice(0, 40), href: String(tree.cta.href || '').trim().slice(0, 500) }
    : null
  const style = HEADER_STYLES.includes(tree.style) ? tree.style as HeaderStyle : undefined
  return { items, cta, ...(style ? { style } : {}) }
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

  // No source URL to re-fetch (e.g. design-system imports) — rebuild the header
  // from the nav tree already captured in the workspace's branding tokens.
  if (!url) {
    const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
    const assets = (tok?.tokens as any)?.brand_assets || {}
    const items = navTreeToItems(assets.nav_tree || [])
    const cta = assets.cta || null
    if (!items.length && !cta) return res.status(400).json({ ok: false, error: 'No source URL on file and no captured navigation to rebuild from. Pass { url } in the body to refresh from a specific site.' })
    await upsertMenu(ws.id, 'header', { items, cta })
    return res.json({ ok: true, data: { ...await getMenusFor(ws.id), refreshed: true, source: 'brand navigation' } })
  }

  try {
    // Headless render captures the full nav tree (with dropdown children); fall
    // back to the CSS-only analyzer if the browser render fails.
    let items: MenuItem[] = []
    let cta: MenuTree['cta'] = null
    try {
      const b = await richBranding(url)
      items = navTreeToItems(b.nav_tree || [])
      cta = (b.brand_assets?.cta) || null
    } catch {
      const b = await analyzeBranding(url)
      items = (b.brand_assets?.nav || []).map((n: any) => ({ label: n.text, href: n.href }))
      cta = b.brand_assets?.cta || null
    }
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

// ---- CTA library (Website → CTAs) — stored on brandingTokens.tokens.ctas ----
// A reusable set of call-to-action banners with situational rules. A page's
// 'cta-ref' section resolves to one at render time (see publish.resolveCta).
function cleanCtas(input: any): any[] {
  if (!Array.isArray(input)) return []
  return input.slice(0, 40).map((c: any, i: number) => ({
    id: String(c?.id || `cta-${i}-${Math.abs((String(c?.name || c?.cta_label || i)).split('').reduce((a: number, ch: string) => a + ch.charCodeAt(0), 0))}`),
    name: String(c?.name || '').slice(0, 80),
    heading: String(c?.heading || '').slice(0, 200),
    sub: String(c?.sub || '').slice(0, 400),
    cta_label: String(c?.cta_label || '').slice(0, 80),
    cta_href: String(c?.cta_href || '').slice(0, 400),
    variant: c?.variant === 'solid' ? 'solid' : 'gradient',
    isDefault: !!c?.isDefault,
    pageTypes: Array.isArray(c?.pageTypes) ? c.pageTypes.filter((x: any) => typeof x === 'string').slice(0, 20) : [],
    slugContains: String(c?.slugContains || '').slice(0, 80),
  }))
}

// ---- Article template (Website → Article Template) ----
// A workspace-wide default for article pages: which hero design + the default
// sidebar cards. Stored on brandingTokens.tokens.article_template.
const DEFAULT_ARTICLE_TEMPLATE = {
  heroVariant: 'classic',
  sidebar: [
    { kind: 'cta', title: 'Ready to start?', text: 'A short line about the next step.', cta_label: 'Get in touch', cta_href: '/contact/' },
    { kind: 'newsletter', title: 'Get our newsletter', text: 'Tips in your inbox, no spam.', cta_label: 'Subscribe', placeholder: 'you@email.com' },
  ],
}
const GRAD_KEYS = ['primary', 'accent', 'accent2', 'text']
export function articleTemplateOf(tokens: any) {
  const at = tokens?.article_template
  return {
    heroVariant: ['classic', 'centered', 'boxed', 'cover', 'gradient', 'minimal'].includes(at?.heroVariant) ? at.heroVariant : 'classic',
    grad_from: GRAD_KEYS.includes(at?.grad_from) ? at.grad_from : 'primary',
    grad_to: GRAD_KEYS.includes(at?.grad_to) ? at.grad_to : 'accent',
    sidebar: Array.isArray(at?.sidebar) && at.sidebar.length ? at.sidebar : DEFAULT_ARTICLE_TEMPLATE.sidebar,
  }
}

// POST /workspaces/:slug/relink-internal — DETERMINISTIC (no AI, no credits).
// Rewrites links that point to the ORIGINAL imported site into INTERNAL links
// to the matching downloaded page, so the site is correctly cross-linked before
// go-live. Matches by the page's import_source URL path, then by slug. Links to
// the source domain that we DIDN'T import are left alone; so are real externals,
// mailto:, tel:, and #anchors. Optional { pageId } scopes to one page.
export async function relinkInternal(workspaceId: string, onlyId?: string | null): Promise<{ totalFixed: number; pages: number; importedPages: number }> {
  const rows = await db.select({ id: pages.id, slug: pages.slug, type: pages.type, blocks: pages.blocks, seo: pages.seo }).from(pages).where(eq(pages.workspaceId, workspaceId))

  const norm = (path: string) => { try { return (decodeURIComponent(String(path || '')).toLowerCase().split('#')[0].split('?')[0].replace(/\/+$/, '')) || '/' } catch { return String(path || '').toLowerCase().replace(/\/+$/, '') || '/' } }
  const internalUrl = (p: any) => (p.type === 'home' || p.slug === 'home') ? '/' : `/${p.slug}/`
  const pathMap = new Map<string, string>(), slugMap = new Map<string, string>()
  const hosts = new Set<string>()
  for (const p of rows) {
    const src = (p.seo as any)?.import_source?.url
    if (src) { try { const u = new URL(src); hosts.add(u.host.replace(/^www\./, '')); pathMap.set(norm(u.pathname), internalUrl(p)) } catch { /* ignore */ } }
    slugMap.set(String(p.slug).toLowerCase(), internalUrl(p))
  }
  // Resolve one href to an internal URL, or null to leave it unchanged.
  const rewrite = (href: string): string | null => {
    const h = String(href || '').trim()
    if (!h || h.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(h)) return null
    let path: string | null = null, fromSource = false
    if (/^https?:\/\//i.test(h)) {
      try { const u = new URL(h); if (hosts.has(u.host.replace(/^www\./, ''))) { path = u.pathname; fromSource = true } } catch { return null }
    } else if (h.startsWith('/')) { path = h }  // root-relative (may already be internal)
    if (path == null) return null
    const key = norm(path)
    if (key === '/') return fromSource ? '/' : null
    const seg = key.replace(/^\//, '').split('/').filter(Boolean).pop() || ''
    const target = pathMap.get(key) || slugMap.get(seg)
    if (target && target !== h) return target
    return null
  }

  const scope = onlyId ? rows.filter((p) => p.id === onlyId) : rows
  let totalFixed = 0
  for (const p of scope) {
    const blocks = Array.isArray(p.blocks) ? JSON.parse(JSON.stringify(p.blocks)) : []
    let fixed = 0
    const walk = (props: any) => {
      if (!props || typeof props !== 'object') return
      for (const k of ['cta_href', 'cta2_href', 'href']) if (typeof props[k] === 'string') { const r = rewrite(props[k]); if (r) { props[k] = r; fixed++ } }
      for (const key of ['items', 'tiers', 'sidebar']) if (Array.isArray(props[key])) for (const it of props[key]) walk(it)
      if (typeof props.html === 'string') {
        props.html = props.html.replace(/(<a\b[^>]*?\bhref=)(["'])([^"']*)\2/gi, (m: string, pre: string, q: string, href: string) => {
          const r = rewrite(href); if (r) { fixed++; return `${pre}${q}${r}${q}` } return m
        })
      }
    }
    for (const b of blocks) walk(b?.props)
    if (fixed) await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, p.id))
    totalFixed += fixed
  }
  return { totalFixed, pages: scope.length, importedPages: pathMap.size }
}

menusRouter.post('/:slug/relink-internal', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const data = await relinkInternal(ws.id, req.body?.pageId ? String(req.body.pageId) : null)
  res.json({ ok: true, data })
})

// POST /workspaces/:slug/rewrap-articles — DETERMINISTIC (no AI, no credits).
// Rebuilds every article into the article template using its existing content:
// article-hero (title + first paragraph + first image) → article-body (content
// + sidebar + auto TOC) → Smart CTA. The structure is identical across articles,
// so there's no reason to spend AI on it — that's what this does for free.
// AI Normalise stays for cleaning up genuinely messy body markup, per article.
menusRouter.post('/:slug/rewrap-articles', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const tmpl = articleTemplateOf(tok?.tokens as any)
  const onlyId = req.body?.pageId ? String(req.body.pageId) : null
  const arts = await db.select().from(pages).where(and(eq(pages.workspaceId, ws.id), eq(pages.type, 'article' as any)))
  const targets = onlyId ? arts.filter((p) => p.id === onlyId) : arts

  // Pull the readable content HTML + first image out of whatever blocks the
  // article currently has (raw-html, richtext, or an existing article-body).
  const cleanRaw = (h: string) => String(h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\sstyle=("[^"]*"|'[^']*')/gi, '')
  function extract(blocks: any[]): { html: string; image: string } {
    const parts: string[] = []; let image = ''
    for (const b of blocks) {
      const p = b?.props || {}
      if (typeof p.html === 'string' && p.html.trim()) parts.push(b.type === 'raw-html' ? cleanRaw(p.html) : p.html)
      else if (typeof p.sub === 'string' && p.heading) parts.push(`<p>${p.sub}</p>`)
      if (!image) {
        if (p.image_url) image = p.image_url
        else if (p.url && b.type === 'image') image = p.url
        else if (typeof p.html === 'string') { const m = p.html.match(/<img[^>]+src=["']([^"']+)["']/i); if (m) image = m[1] }
      }
    }
    return { html: parts.join('\n'), image }
  }

  let count = 0
  for (const p of targets) {
    const blocks = Array.isArray(p.blocks) ? (p.blocks as any[]) : []
    const { html, image } = extract(blocks)
    if (!html.trim()) continue
    const newBlocks = articleBlocksFromImport(p.title, html, image ? { url: image } : undefined, tmpl)
    await db.update(pages).set({ blocks: newBlocks as any, seo: { ...((p.seo as any) || {}), schemaType: 'Article' } as any, updatedAt: new Date() }).where(eq(pages.id, p.id))
    count++
  }
  res.json({ ok: true, data: { rewrapped: count, total: targets.length } })
})

// POST /workspaces/:slug/upload-image — accept a base64 data URL, save it to
// the workspace's local img dir, return the public URL. Used by the editor's
// image-upload widgets (hero banner, etc.).
menusRouter.post('/:slug/upload-image', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const dataUrl = String(req.body?.dataUrl || '')
  const m = dataUrl.match(/^data:image\/(png|jpe?g|webp|gif|avif);base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return res.status(400).json({ ok: false, error: 'Expected an image data URL (png/jpg/webp/gif/avif).' })
  const ext = '.' + (m[1] === 'jpeg' ? 'jpg' : m[1])
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 5 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Image is over 5MB — please use a smaller file.' })
  const url = await saveImageBytes(ws.slug, buf, ext, dataUrl.slice(0, 64) + buf.length)
  res.json({ ok: true, data: { url } })
})

menusRouter.get('/:slug/article-template', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  res.json({ ok: true, data: articleTemplateOf(tok?.tokens as any) })
})

menusRouter.put('/:slug/article-template', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const heroVariant = ['classic', 'centered', 'boxed', 'cover', 'gradient', 'minimal'].includes(req.body?.heroVariant) ? req.body.heroVariant : 'classic'
  const grad_from = GRAD_KEYS.includes(req.body?.grad_from) ? req.body.grad_from : 'primary'
  const grad_to = GRAD_KEYS.includes(req.body?.grad_to) ? req.body.grad_to : 'accent'
  const sidebar = Array.isArray(req.body?.sidebar) ? req.body.sidebar.slice(0, 6) : DEFAULT_ARTICLE_TEMPLATE.sidebar
  const article_template = { heroVariant, grad_from, grad_to, sidebar }
  const [existing] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  if (existing) await db.update(brandingTokens).set({ tokens: { ...(existing.tokens as any), article_template } }).where(eq(brandingTokens.id, existing.id))
  else await db.insert(brandingTokens).values({ workspaceId: ws.id, tokens: { ...DEFAULT_TOKENS, article_template } as any })

  // Optionally push the template onto every existing article now.
  let applied = 0
  if (req.body?.applyToAll) {
    const arts = await db.select().from(pages).where(and(eq(pages.workspaceId, ws.id), eq(pages.type, 'article' as any)))
    for (const p of arts) {
      const blocks = Array.isArray(p.blocks) ? JSON.parse(JSON.stringify(p.blocks)) : []
      let changed = false
      for (const b of blocks) {
        if (b?.type === 'article-hero') { b.props = { ...b.props, variant: heroVariant, grad_from, grad_to }; changed = true }
        if (b?.type === 'article-body') { b.props = { ...b.props, sidebar }; changed = true }
      }
      if (changed) { await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, p.id)); applied++ }
    }
  }
  res.json({ ok: true, data: { article_template, applied } })
})

menusRouter.get('/:slug/ctas', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  res.json({ ok: true, data: { ctas: ((tok?.tokens as any)?.ctas) || [] } })
})

menusRouter.put('/:slug/ctas', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const ctas = cleanCtas(req.body?.ctas)
  // Ensure at most one default.
  let seenDefault = false
  for (const c of ctas) { if (c.isDefault && !seenDefault) seenDefault = true; else c.isDefault = false }
  const [existing] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  if (existing) {
    const merged = { ...(existing.tokens as any), ctas }
    await db.update(brandingTokens).set({ tokens: merged }).where(eq(brandingTokens.id, existing.id))
  } else {
    await db.insert(brandingTokens).values({ workspaceId: ws.id, tokens: { ...DEFAULT_TOKENS, ctas } as any })
  }
  res.json({ ok: true, data: { ctas } })
})
