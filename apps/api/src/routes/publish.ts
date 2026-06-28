import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { db, workspaces, pages, brandingTokens, builds } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

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

function esc(s: any) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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
.site-header{border-bottom:var(--bw) solid rgba(0,0,0,.08)}
.site-header .container{display:flex;align-items:center;justify-content:space-between;padding-top:16px;padding-bottom:16px}
.brand{font-family:'${t.font.heading}',sans-serif;font-weight:700;font-size:18px;color:var(--text);text-decoration:none}
.site-footer{border-top:var(--bw) solid rgba(0,0,0,.08);padding:36px 0;font-size:13px;opacity:.65}`
}

function renderBlock(b: any) {
  if (!b || typeof b !== 'object') return ''
  const p = b.props || {}
  if (b.type === 'hero') {
    const cta = p.cta && p.cta.label ? `<p><a class="btn" href="${esc(p.cta.href || '#')}">${esc(p.cta.label)}</a></p>` : ''
    return `<section class="hero"><div class="container"><h1>${esc(p.heading)}</h1>${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ''}${cta}</div></section>`
  }
  if (b.type === 'richtext') {
    return `<section class="rt"><div class="container">${p.html || ''}</div></section>`
  }
  if (b.type === 'image') {
    if (!p.url) return ''
    return `<section class="img"><div class="container"><img src="${esc(p.url)}" alt="${esc(p.alt || '')}" loading="lazy"></div></section>`
  }
  return `<!-- ${esc(b.type)} block not rendered -->`
}

function renderPage(page: any, body: string, t: any, ws: any, base: string) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(page.title)} — ${esc(ws.name)}</title>${fontsHead(t)}<style>${siteCss(t)}</style></head><body>
<header class="site-header"><div class="container"><a class="brand" href="${base}/">${esc(ws.name)}</a></div></header>
<main>${body || ''}</main>
<footer class="site-footer"><div class="container">© ${new Date().getFullYear()} ${esc(ws.name)} · built with uWebsites</div></footer>
</body></html>`
}

// Renderer is exported so the pages router can serve a single-page preview.
export const renderPreview = async (id: string, accountId: string) => {
  const [row] = await db.select({
    title: pages.title, blocks: pages.blocks, wsId: pages.workspaceId,
    wsName: workspaces.name, accId: workspaces.accountId,
  }).from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(eq(pages.id, id)).limit(1)
  if (!row || row.accId !== accountId) return null
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, row.wsId)).limit(1)
  const t = (tok?.tokens as any) ?? DEFAULT_TOKENS
  const blocks = Array.isArray(row.blocks) ? (row.blocks as any[]) : []
  return renderPage({ title: row.title }, blocks.map(renderBlock).join('\n'), t, { name: row.wsName }, '#')
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
    let count = 0
    for (const p of publishable) {
      const blocks = Array.isArray(p.blocks) ? (p.blocks as any[]) : []
      const html = renderPage(p, blocks.map(renderBlock).join('\n'), t, ws, base)
      const rel = p.slug === 'home' ? 'index.html' : path.join(p.slug, 'index.html')
      const file = path.join(outDir, rel)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, html, 'utf8')
      count++
    }
    const urls = publishable.map((p) => (p.slug === 'home' ? `${base}/` : `${base}/${p.slug}/`))
    await writeFile(path.join(outDir, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`)

    await db.insert(builds).values({ workspaceId: ws.id, status: 'deployed', artifactRef: outDir, deployedAt: new Date() })
    res.json({ ok: true, data: { url: `${base}/`, pages: count } })
  } catch (e: any) {
    await db.insert(builds).values({ workspaceId: ws.id, status: 'failed', artifactRef: outDir })
    res.status(500).json({ ok: false, error: 'publish failed: ' + (e?.message || 'unknown') })
  }
})
