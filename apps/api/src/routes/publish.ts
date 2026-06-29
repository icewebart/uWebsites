import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { db, workspaces, pages, brandingTokens, builds } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { renderSection, SECTION_CSS, SECTIONS, sectionHasContent, esc as escSh } from '../lib/sections.js'
import { getMenusFor } from './menus.js'

// Publisher — compiles a workspace's pages (+ branding tokens) to static
// HTML/CSS on disk, served by nginx. One box (ADR-012), so we write locally;
// a DeployAdapter (ADR-004) would rsync to a CDN/other host later.
export const publishRouter = Router()

const SITES_DIR = process.env.SITES_DIR || '/www/wwwroot/_sites'
const SITES_URL = process.env.PUBLIC_SITES_URL || 'https://app.uwebsites.net/p'

const DEFAULT_TOKENS: any = {
  color: { primary: '#16324A', accent: '#8FD7F1', surface: '#FFFFFF', text: '#16242E' },
  font: { heading: 'Space Grotesk', body: 'Inter', scale: 1.2, lineHeight: 1.6 },
  shape: { buttonRadius: '12px', cardRadius: '16px', borderWidth: '1px' },
  space: { sectionGap: '64px', sectionPaddingY: '48px', container: '1200px' },
}
const GOOGLE_FONTS = new Set(['Space Grotesk', 'Inter', 'Poppins'])

const esc = escSh

function fontsHead(t: any) {
  const fams = [...new Set([t.font.heading, t.font.body])].filter((f) => GOOGLE_FONTS.has(f))
  if (!fams.length) return ''
  const q = fams.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;600;700`).join('&')
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`
}

function siteCss(t: any) {
  return `:root{--primary:${t.color.primary};--accent:${t.color.accent};--surface:${t.color.surface};--text:${t.color.text};--btn-r:${t.shape.buttonRadius};--card-r:${t.shape.cardRadius};--bw:${t.shape.borderWidth};--gap:${t.space.sectionGap};--pad:${t.space.sectionPaddingY};--container:${t.space.container}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'${t.font.body}',system-ui,-apple-system,sans-serif;color:var(--text);background:var(--surface);line-height:${t.font.lineHeight};-webkit-font-smoothing:antialiased}
a{color:var(--primary)}
.container{max-width:var(--container);margin:0 auto;padding:0 24px}
h1,h2,h3{font-family:'${t.font.heading}',system-ui,sans-serif;line-height:1.12;letter-spacing:-.02em}
section{padding:var(--pad) 0}
section + section{padding-top:0}
.hero{padding-bottom:calc(var(--pad))}
.hero h1{font-size:calc(2.1rem * ${t.font.scale});margin-bottom:14px;max-width:18ch}
.hero .sub{font-size:1.1rem;opacity:.78;max-width:60ch;margin-bottom:24px}
.btn{display:inline-block;background:var(--primary);color:#fff;border-radius:var(--btn-r);padding:12px 22px;text-decoration:none;font-weight:600;font-family:'${t.font.heading}',sans-serif}
.rt{font-size:1rem}
.rt :where(p,ul,ol){margin-bottom:1em}
.rt img{max-width:100%;height:auto;border-radius:var(--card-r)}
.img img{display:block;width:100%;height:auto;border-radius:var(--card-r)}
.site-header{border-bottom:var(--bw) solid rgba(0,0,0,.08);background:var(--surface)}
.site-header .container{display:flex;align-items:center;justify-content:space-between;padding-top:16px;padding-bottom:16px;gap:24px}
.site-header .nav{display:flex;gap:22px;align-items:center;flex-wrap:wrap}
.site-header .nav a{color:var(--text);opacity:.78;font-size:14px;text-decoration:none}
.site-header .nav a:hover{opacity:1;color:var(--primary)}
.site-header .header-cta{background:var(--primary);color:#fff;border-radius:var(--btn-r);padding:8px 16px;font-weight:600;font-size:13px;text-decoration:none}
.brand{font-family:'${t.font.heading}',sans-serif;font-weight:700;font-size:18px;color:var(--text);text-decoration:none;display:flex;align-items:center;gap:10px}
.brand img{height:28px;width:auto;display:block}
.site-footer{border-top:var(--bw) solid rgba(0,0,0,.08);padding:36px 0;font-size:13px;opacity:.7}
.site-footer .container{display:flex;flex-wrap:wrap;justify-content:space-between;gap:18px}
.site-footer .nav{display:flex;flex-wrap:wrap;gap:18px}
.site-footer a{color:var(--text);text-decoration:none}
.site-footer a:hover{color:var(--primary)}
@media(max-width:760px){.site-header .container{flex-wrap:wrap}.site-header .nav{gap:14px}.site-header .nav a{font-size:13px}}
${SECTION_CSS}`
}

// Per-section render lives in lib/sections.ts so the catalog drives both the
// renderer and the editor's gallery. publish.ts just composes the page.
const renderBlock = renderSection

type MenuItem = { label: string; href: string }
type MenuTree = { items: MenuItem[]; cta?: { label: string; href: string } | null }

function renderHeader(ws: any, base: string, header: MenuTree | undefined, logoUrl?: string | null): string {
  const brand = logoUrl
    ? `<a class="brand" href="${base}/"><img src="${esc(logoUrl)}" alt="${esc(ws.name)}"></a>`
    : `<a class="brand" href="${base}/">${esc(ws.name)}</a>`
  const navItems = (header?.items || []).map((i) => `<a href="${esc(i.href)}">${esc(i.label)}</a>`).join('')
  const nav = navItems ? `<nav class="nav">${navItems}</nav>` : ''
  const cta = header?.cta?.label ? `<a class="header-cta" href="${esc(header.cta.href || '#')}">${esc(header.cta.label)}</a>` : ''
  return `<header class="site-header"><div class="container">${brand}${nav}${cta}</div></header>`
}

function renderFooter(ws: any, footer: MenuTree | undefined): string {
  const navItems = (footer?.items || []).map((i) => `<a href="${esc(i.href)}">${esc(i.label)}</a>`).join('')
  const nav = navItems ? `<nav class="nav">${navItems}</nav>` : ''
  return `<footer class="site-footer"><div class="container"><div>© ${new Date().getFullYear()} ${esc(ws.name)} · built with uWebsites</div>${nav}</div></footer>`
}

function renderPage(page: any, body: string, t: any, ws: any, base: string, opts?: { header?: MenuTree; footer?: MenuTree }) {
  const logo = (t as any)?.brand_assets?.logo?.url || null
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(page.title)} — ${esc(ws.name)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml">${fontsHead(t)}<style>${siteCss(t)}</style></head><body>
${renderHeader(ws, base, opts?.header, logo)}
<main>${body || ''}</main>
${renderFooter(ws, opts?.footer)}
</body></html>`
}

// Tiny script injected into the editor preview: announces clicks + handles
// inline text edits via contentEditable. NOT included in published output.
const EDIT_SCRIPT = `<style>
[data-field]{ outline-offset:2px; }
[data-field]:hover{ outline:1px dashed rgba(143,215,241,.9); cursor:text; }
[data-field][contenteditable=true]{ outline:2px solid #1D9E75; background:rgba(143,215,241,.08); cursor:text; }
[data-section-index][data-empty="true"]{ position:relative; min-height:90px; border:2px dashed #f5a623; background:rgba(245,166,35,.06); margin:8px 0; border-radius:10px; }
[data-section-index][data-empty="true"]::before{ content:"Empty " attr(data-section-kind) " section — click to edit, or remove it"; position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#a76300; font-family:system-ui,sans-serif; font-size:13px; font-weight:600; pointer-events:none; }
</style>
<script>(function(){
  function send(o){ try{ parent.postMessage(Object.assign({source:'uw-preview'}, o), '*'); }catch(e){} }
  var hov=null;
  // Section selection — click on the section background (not text fields)
  document.addEventListener('click', function(e){
    if(e.target.closest('[data-field]')) return;        // text edit handles its own clicks
    if(e.target.closest('a,button,input,textarea,select')) return;  // don't hijack interactive
    var el=e.target.closest('[data-section-index]'); if(!el) return;
    e.preventDefault(); send({type:'select', index: parseInt(el.getAttribute('data-section-index'),10)});
  }, true);
  document.addEventListener('mouseover', function(e){
    var el=e.target.closest('[data-section-index]'); if(!el) return;
    if(hov && hov!==el){ hov.style.outline=''; hov.style.outlineOffset=''; }
    hov=el; el.style.outline='2px solid rgba(143,215,241,.7)'; el.style.outlineOffset='-2px'; el.style.cursor='pointer';
  });
  document.addEventListener('mouseout', function(){
    if(hov){ hov.style.outline=''; hov.style.outlineOffset=''; hov=null; }
  });
  // Inline text edit — click any [data-field] to edit; blur or Enter commits.
  document.addEventListener('click', function(e){
    var el=e.target.closest('[data-field]'); if(!el) return;
    e.stopPropagation();
    if(el.getAttribute('contenteditable')==='true') return;
    el.setAttribute('contenteditable','true');
    el.focus();
    // place caret at end
    try{ var r=document.createRange(); r.selectNodeContents(el); r.collapse(false); var s=getSelection(); s.removeAllRanges(); s.addRange(r); }catch(e){}
    function commit(){
      el.removeEventListener('blur', commit); el.removeEventListener('keydown', onKey);
      var sec=el.closest('[data-section-index]');
      var idx = sec ? parseInt(sec.getAttribute('data-section-index'),10) : null;
      var field = el.getAttribute('data-field');
      var value = el.innerText.replace(/\\s+$/,'');
      el.removeAttribute('contenteditable');
      if(idx!=null && field) send({type:'text', index: idx, field: field, value: value});
    }
    function onKey(ev){
      if(ev.key==='Enter' && !ev.shiftKey){ ev.preventDefault(); el.blur(); }
      if(ev.key==='Escape'){ ev.preventDefault(); el.blur(); }
    }
    el.addEventListener('blur', commit);
    el.addEventListener('keydown', onKey);
  }, true);
})();</script>`

// Renderer is exported so the pages router can serve a single-page preview.
// opts.edit wraps each section in a data-section-index div + injects the
// click/hover script so the editor can detect selection.
export const renderPreview = async (id: string, accountId: string, opts?: { edit?: boolean; selectedIndex?: number | null }) => {
  const [row] = await db.select({
    title: pages.title, blocks: pages.blocks, wsId: pages.workspaceId,
    wsName: workspaces.name, accId: workspaces.accountId,
  }).from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(eq(pages.id, id)).limit(1)
  if (!row || row.accId !== accountId) return null
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, row.wsId)).limit(1)
  const t = (tok?.tokens as any) ?? DEFAULT_TOKENS
  const blocks = Array.isArray(row.blocks) ? (row.blocks as any[]) : []
  const body = opts?.edit
    ? blocks.map((b, i) => {
        const empty = !sectionHasContent(b)
        const sel = i === opts.selectedIndex ? 'outline:2px solid #1D9E75;outline-offset:-2px;' : ''
        const emptyAttr = empty ? ' data-empty="true"' : ''
        return `<div data-section-index="${i}" data-section-kind="${esc(b.type)}"${emptyAttr} style="${sel}">${empty ? '' : renderSection(b, { edit: true })}</div>`
      }).join('\n') + EDIT_SCRIPT
    : blocks.map((b) => renderBlock(b)).join('\n')
  const menus = await getMenusFor(row.wsId)
  return renderPage({ title: row.title }, body, t, { name: row.wsName }, '#', menus)
}

// POST /workspaces/:slug/publish
publishRouter.post('/:slug/publish', requireAuth, async (req: AuthRequest, res) => {
  const [ws] = await db.select().from(workspaces)
    .where(eq(workspaces.slug, String(req.params.slug))).limit(1)
  if (!ws || ws.accountId !== req.user!.accountId) return res.status(404).json({ ok: false, error: 'workspace not found' })

  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const t = (tok?.tokens as any) ?? DEFAULT_TOKENS
  const pageRows = await db.select().from(pages).where(eq(pages.workspaceId, ws.id))
  const publishable = pageRows.filter((p) => p.status === 'published' || true) // v1: publish all
  if (!publishable.length) return res.status(400).json({ ok: false, error: 'no pages to publish' })

  const outDir = path.join(SITES_DIR, ws.slug)
  const base = `${SITES_URL}/${ws.slug}`
  try {
    await rm(outDir, { recursive: true, force: true })
    await mkdir(outDir, { recursive: true })
    const siteMenus = await getMenusFor(ws.id)
    let count = 0
    for (const p of publishable) {
      const blocks = Array.isArray(p.blocks) ? (p.blocks as any[]) : []
      const html = renderPage(p, blocks.map((b) => renderBlock(b)).join('\n'), t, ws, base, siteMenus)
      const rel = p.slug === 'home' ? 'index.html' : path.join(p.slug, 'index.html')
      const file = path.join(outDir, rel)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, html, 'utf8')
      count++
    }
    const urls = publishable.map((p) => (p.slug === 'home' ? `${base}/` : `${base}/${p.slug}/`))
    await writeFile(path.join(outDir, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`)
    // Default favicon — a small SVG in the brand's primary color. Workspaces
    // can override by setting branding tokens.color.primary; later we'll
    // accept a custom-uploaded icon via Branding.
    const primary = ((tok?.tokens as any)?.color?.primary) || '#16324A'
    const accent = ((tok?.tokens as any)?.color?.accent) || '#8FD7F1'
    const initial = (ws.name || 'u').slice(0, 1).toUpperCase()
    await writeFile(path.join(outDir, 'favicon.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${primary}"/><text x="32" y="42" font-family="system-ui,sans-serif" font-size="32" font-weight="700" text-anchor="middle" fill="${accent}">${esc(initial)}</text></svg>`)

    await db.insert(builds).values({ workspaceId: ws.id, status: 'deployed', artifactRef: outDir, deployedAt: new Date() })
    res.json({ ok: true, data: { url: `${base}/`, pages: count } })
  } catch (e: any) {
    await db.insert(builds).values({ workspaceId: ws.id, status: 'failed', artifactRef: outDir })
    res.status(500).json({ ok: false, error: 'publish failed: ' + (e?.message || 'unknown') })
  }
})
