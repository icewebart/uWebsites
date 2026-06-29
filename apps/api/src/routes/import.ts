import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, pages, redirects, brandingTokens } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

// Importer — TS port of the Phase-0 spike. `scanSite` pulls a WordPress site
// via the public REST API and classifies every URL; /scan previews it, /commit
// writes pages + redirects into a workspace.
export const importRouter = Router()

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const CITY = ['cluj', 'bucuresti', 'bucurești', 'iasi', 'iași', 'timisoara', 'timișoara', 'munte', 'brasov', 'brașov', 'sibiu', 'constanta', 'constanța']
const KW: Record<string, string[]> = {
  legal: ['termeni', 'conditii', 'condiții', 'privacy', 'policy', 'gdpr', 'cookie', 'confidentialitate', 'confidențialitate', 'politica', 'politică'],
  faq: ['intrebari-frecvente', 'întrebari', 'intrebari', 'faq'],
  contact: ['contact'],
  about: ['despre', 'about', 'cine-suntem', 'echipa', 'trainerii', 'traineri'],
  partners: ['parteneri', 'partners'],
  thank_you: ['multumim', 'mulțumim', 'thank-you', 'thank', 'confirmare', 'success'],
  commerce: ['cos', 'cart', 'checkout', 'finalizare', 'my-account', 'contul-meu', 'produse', 'products', 'produs', 'inscrieri', 'inscriere', 'comanda'],
  lead_magnet: ['gratis', 'gratuit', 'free'],
  blog_index: ['noutati', 'noutați', 'articole', 'blog', 'stiri', 'știri'],
  hub: ['tabere', 'cursuri', 'cursuri-si-ateliere', 'online', 'produse', 'ateliere'],
  service: ['tabara', 'tabere', 'curs', 'cursuri', 'atelier', 'ateliere', 'scoala', 'școala', 'wintercamp', 'germana', 'germană', 'elevi', 'clasele'],
}
const HUB_EXACT = new Set(['tabere', 'cursuri', 'cursuri-si-ateliere', 'online', 'produse', 'ateliere', 'tabere-2'])
const JUNK = new Set(['test', 'home', 'tabere-2'])

// Valid page_type enum values (must match packages/db schema)
const PAGE_TYPES = new Set(['home', 'service', 'location', 'hub', 'blog_index', 'article', 'category', 'collection_item', 'about', 'contact', 'faq', 'lead_magnet', 'legal', 'thank_you'])

function pathOf(link: string): string {
  try { return new URL(link).pathname || '/' } catch { return '/' }
}

function classify(slug: string, title: string, link: string): { type: string; confidence: number; note: string } {
  const full = pathOf(link).replace(/^\/|\/$/g, '').toLowerCase()
  const tokens = full.split(/[-/]/)
  const blob = full + ' ' + (title || '').toLowerCase()
  const hit = (words: string[]) => words.some((w) => blob.includes(w))
  const s = slug.toLowerCase()

  if (pathOf(link).replace(/\/$/, '') === '') return { type: 'home', confidence: 0.99, note: '' }
  if (hit(KW.legal)) return { type: 'legal', confidence: 0.95, note: '' }
  if (hit(KW.partners)) return { type: 'partners', confidence: 0.85, note: '' }
  if (hit(KW.faq)) return { type: 'faq', confidence: 0.95, note: '' }
  if (s === 'contact' || hit(KW.contact)) return { type: 'contact', confidence: 0.95, note: '' }
  if (hit(KW.thank_you)) return { type: 'thank_you', confidence: 0.9, note: '' }
  if (hit(KW.commerce)) return { type: 'commerce', confidence: 0.9, note: 'woocommerce/functional — dropped' }
  if (hit(KW.about)) return { type: 'about', confidence: 0.85, note: '' }
  if (hit(KW.blog_index)) return { type: 'blog_index', confidence: 0.85, note: '' }
  if (hit(KW.lead_magnet)) return { type: 'lead_magnet', confidence: 0.85, note: 'free-offer landing' }
  if (tokens.some((t) => CITY.includes(t)) || CITY.some((c) => blob.includes(c))) return { type: 'location', confidence: 0.8, note: 'programmatic-SEO candidate' }
  if (HUB_EXACT.has(full) || HUB_EXACT.has(s)) return { type: 'hub', confidence: 0.75, note: '' }
  if (hit(KW.service)) return { type: 'service', confidence: 0.7, note: '' }
  if (/^[a-zăâîșțţ]+-[a-zăâîșțţ]+(-\d+)?$/.test(s) && !Object.values(KW).some((v) => tokens.some((t) => v.includes(t)))) {
    const words = (title || '').split(/\s+/).filter(Boolean)
    if (words.length >= 1 && words.length <= 3 && words.every((w) => w[0] === w[0]?.toUpperCase())) {
      return { type: 'collection_item:trainers', confidence: 0.6, note: 'person-name heuristic — verify' }
    }
  }
  return { type: 'page', confidence: 0.3, note: 'unclassified — needs review' }
}

// Map a scan type to a valid page_type enum, or null to skip (commerce/unclassified).
function toPageType(scanType: string): string | null {
  const base = scanType.split(':')[0]
  if (base === 'commerce') return null
  if (base === 'partners') return 'about'
  if (PAGE_TYPES.has(base)) return base
  return null // 'page' / unknown — left for human review, not auto-created
}

function slugFromPath(p: string): string {
  return p.replace(/^\/+|\/+$/g, '') || 'home'
}

function starterBlocks(title: string) {
  return [
    { type: 'hero', props: { heading: title || '', sub: '' } },
    { type: 'richtext', props: { html: '' } },
  ]
}

// Light HTML sanitiser — strips scripts/styles/iframes/event handlers + js: URIs.
// Imported HTML still goes through the editor for review.
function safeHtml(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '#')
    .trim()
}

// Build the block tree for an imported page.
// - Home pages: if there's a featured image, build a hero-image with the
//   extracted main CTA; otherwise a centered hero carrying the same CTA.
// - Other pages: simple hero + (optional) image + richtext body.
function importedBlocks(title: string, contentHtml: string, featuredImg?: { url: string; alt?: string }, opts?: { isHome?: boolean; cta?: { label: string; href: string } | null }) {
  const blocks: any[] = []
  const cta = opts?.isHome ? (opts.cta || null) : null

  if (opts?.isHome && featuredImg?.url) {
    blocks.push({
      type: 'hero-image',
      props: {
        heading: title || '', sub: '',
        image_url: featuredImg.url, image_alt: featuredImg.alt || title || '',
        cta_label: cta?.label || '', cta_href: cta?.href || '',
      },
    })
  } else {
    const heroProps: any = { heading: title || '', sub: '' }
    if (cta) { heroProps.cta_label = cta.label; heroProps.cta_href = cta.href }
    blocks.push({ type: 'hero', props: heroProps })
    if (featuredImg?.url) blocks.push({ type: 'image', props: { url: featuredImg.url, alt: featuredImg.alt || title || '' } })
  }
  if (contentHtml && contentHtml.trim()) blocks.push({ type: 'richtext', props: { html: safeHtml(contentHtml) } })
  return blocks
}

function snapshotUrl(sourceUrl: string): string {
  // thum.io — free screenshot service, no key, returns a real image (cached).
  // We just store the URL; the browser fetches it on demand in the editor.
  return `https://image.thum.io/get/width/1200/crop/900/${sourceUrl}`
}

async function fetchAll(site: string, endpoint: string, fields: string, opts: { embed?: boolean } = {}): Promise<any[]> {
  const out: any[] = []
  const embed = opts.embed ? '&_embed=1' : ''
  for (let page = 1; page <= 20; page++) {
    const url = `${site}/wp-json/wp/v2/${endpoint}?per_page=100&page=${page}&_fields=${fields}&status=publish${embed}`
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (r.status === 400) break
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = (await r.json()) as any[]
    if (!data.length) break
    out.push(...data)
    const totalPages = parseInt(r.headers.get('x-wp-totalpages') || '1', 10)
    if (page >= totalPages) break
  }
  return out
}

// Extract featured image from a WP _embedded response
function featuredFromEmbed(p: any): { url: string; alt?: string } | null {
  const media = p?._embedded?.['wp:featuredmedia']?.[0]
  if (!media?.source_url) return null
  return { url: media.source_url, alt: media.alt_text || '' }
}

export async function scanSite(rawUrl: string) {
  const site = String(rawUrl).trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://')
  const [pagesData, posts, cats] = await Promise.all([
    fetchAll(site, 'pages', 'id,slug,link,title,parent,status'),
    fetchAll(site, 'posts', 'id,slug,link,title,status'),
    fetchAll(site, 'categories', 'id,slug,link,name,count'),
  ])

  const items: any[] = []
  const counts: Record<string, number> = {}
  const bump = (t: string) => { counts[t] = (counts[t] || 0) + 1 }

  for (const p of pagesData) {
    const title = p.title?.rendered ?? ''
    const c = classify(p.slug ?? '', title, p.link ?? '')
    items.push({ source: 'page', path: pathOf(p.link), slug: p.slug, title, type: c.type, confidence: c.confidence, note: c.note })
    bump(c.type)
  }
  for (const po of posts) {
    items.push({ source: 'post', path: pathOf(po.link), slug: po.slug, title: po.title?.rendered ?? '', type: 'article', confidence: 0.97, note: '' })
    bump('article')
  }
  for (const cat of cats) {
    items.push({ source: 'category', path: pathOf(cat.link), slug: cat.slug, title: cat.name ?? '', type: 'category', confidence: 0.95, note: `${cat.count ?? 0} posts` })
    bump('category')
  }

  const redirectList = items
    .filter((i) => i.type === 'commerce' || JUNK.has(i.slug) || JUNK.has(i.path.replace(/^\/|\/$/g, '')))
    .map((i) => ({ from: i.path, to: '/', code: 301, reason: i.type === 'commerce' ? 'WooCommerce/functional page dropped' : 'staging/duplicate page' }))

  items.sort((a, b) => (a.type + a.path).localeCompare(b.type + b.path))
  return { site, total: items.length, counts, redirects: redirectList, items }
}

// ----- Brand asset extraction (logo, nav, CTA) from the source HTML -----
function absUrl(href: string, base: string): string {
  try { return new URL(href, base).toString() } catch { return href }
}
function stripTags(s: string): string { return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }

function extractLogo(html: string, base: string): { url: string; alt: string } | null {
  // og:image as the most reliable signal
  const og = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i)
              || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i)
  if (og) return { url: absUrl(og[1], base), alt: '' }
  // first <img> inside <header> or a <a class="...logo...">
  const headerImg = html.match(/<header[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?[\s\S]*?<\/header>/i)
  if (headerImg) return { url: absUrl(headerImg[1], base), alt: headerImg[2] || '' }
  const logoAnchor = html.match(/<a[^>]+class=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?/i)
  if (logoAnchor) return { url: absUrl(logoAnchor[1], base), alt: logoAnchor[2] || '' }
  return null
}

function extractNav(html: string, base: string): Array<{ text: string; href: string }> {
  // Try <nav> first, fall back to a header's primary menu
  const navMatch = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i) || html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i)
  if (!navMatch) return []
  const items: Array<{ text: string; href: string }> = []
  const seenText = new Set<string>()
  for (const m of navMatch[1].matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]
    const text = stripTags(m[2])
    if (!text || text.length > 40 || seenText.has(text.toLowerCase())) continue
    if (href.startsWith('javascript:') || href === '#' || href.startsWith('mailto:') || href.startsWith('tel:')) continue
    seenText.add(text.toLowerCase())
    items.push({ text, href: absUrl(href, base) })
    if (items.length >= 8) break
  }
  return items
}

function extractCta(html: string, base: string): { label: string; href: string } | null {
  // First btn-like anchor in the <header>; if not, first one anywhere in the top 8KB
  const headerMatch = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/i)
  const region = (headerMatch ? headerMatch[1] : html).slice(0, 8000)
  // class containing btn|cta|button|nav__cta
  const m = region.match(/<a[^>]+class=["'][^"']*(?:btn|cta|button|menu-cta)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
            || region.match(/<a[^>]+href=["']([^"']+)["'][^>]+class=["'][^"']*(?:btn|cta|button|menu-cta)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
  if (!m) return null
  const label = stripTags(m[2])
  if (!label || label.length > 30) return null
  return { label, href: absUrl(m[1], base) }
}

// Core: fetch homepage + main CSS, then extract branding tokens AND brand assets.
async function analyzeBranding(siteUrl: string) {
  const site = String(siteUrl).trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://')
  const home = await (await fetch(site, { headers: { 'User-Agent': UA } })).text()
    // Collect CSS hrefs (same-origin) and Google Fonts families
    const cssHrefs = Array.from(home.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)).map((m) => m[1])
    const inlineCss = Array.from(home.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]).join('\n')
    const googleFonts = Array.from(home.matchAll(/fonts\.googleapis\.com[^"']*family=([^"'&]+)/gi)).map((m) => decodeURIComponent(m[1].split(':')[0].replace(/\+/g, ' ')))

    let css = inlineCss
    for (const href of cssHrefs.slice(0, 4)) {
      try {
        const abs = href.startsWith('http') ? href : new URL(href, site).toString()
        if (abs.includes('fonts.googleapis.com')) continue
        const txt = await (await fetch(abs, { headers: { 'User-Agent': UA } })).text()
        css += '\n' + txt.slice(0, 200000) // cap per file
        if (css.length > 600000) break
      } catch { /* skip */ }
    }

    // Color tally (hex only — fast & deterministic; rgb() converted on the fly)
    const tally: Record<string, number> = {}
    const bumpHex = (h: string) => {
      h = h.toLowerCase()
      if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]
      if (!/^#[0-9a-f]{6}$/.test(h)) return
      // Drop near-white / near-black / common greys (they're not brand colors)
      const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16)
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max
      if (max > 245 || max < 15) return // pure white/black noise
      if (sat < 0.18 && Math.abs(r - g) < 12 && Math.abs(g - b) < 12) return // grey
      tally[h] = (tally[h] || 0) + 1
    }
    for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) bumpHex(m[0].slice(0, 7))
    for (const m of css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
      const h = '#' + [m[1], m[2], m[3]].map((v) => parseInt(v).toString(16).padStart(2, '0')).join('')
      bumpHex(h)
    }
    const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([h]) => h)

    // Font: first non-generic family from stack, else first Google font
    const famMatch = css.match(/font-family\s*:\s*([^;}]+)/i)
    let bodyFont: string | null = null
    if (famMatch) {
      const first = famMatch[1].split(',')[0].trim().replace(/^["']|["']$/g, '')
      if (first && !/^(serif|sans-serif|monospace|system-ui|inherit|initial)$/i.test(first)) bodyFont = first
    }
    if (!bodyFont && googleFonts.length) bodyFont = googleFonts[0]
    const headingFont = googleFonts.length > 1 ? googleFonts[0] : bodyFont || 'Inter'

    // Button radius — first border-radius near a .btn/button selector
    let btnRadius: string | null = null
    const btnRule = css.match(/(?:button|\.btn|\[type=["']?button["']?\])[^{]*\{[^}]*border-radius\s*:\s*([0-9.]+)(px|rem|em)/i)
    if (btnRule) {
      const n = parseFloat(btnRule[1]); const u = btnRule[2]
      btnRadius = `${u === 'rem' || u === 'em' ? Math.round(n * 16) : Math.round(n)}px`
    }

    const tokens = {
      color: {
        primary: ranked[0] || '#16324A',
        accent: ranked[1] || '#8FD7F1',
        surface: '#FFFFFF',
        text: '#16242E',
      },
      font: { heading: headingFont, body: bodyFont || 'Inter', scale: 1.2, lineHeight: 1.6 },
      shape: { buttonRadius: btnRadius || '12px', cardRadius: '16px', borderWidth: '1px' },
      space: { sectionGap: '64px', sectionPaddingY: '48px', container: '1200px' },
    }
  const brand_assets = {
    logo: extractLogo(home, site),
    nav: extractNav(home, site),
    cta: extractCta(home, site),
    snapshot_url: snapshotUrl(site),
  }
  ;(tokens as any).brand_assets = brand_assets
  return { site, tokens, suggestions: { colors: ranked.slice(0, 8), fonts: [...new Set([headingFont, bodyFont].filter(Boolean) as string[])] }, brand_assets }
}

// POST /import/branding — public endpoint that uses analyzeBranding
importRouter.post('/branding', requireAuth, async (req, res) => {
  const raw = req.body?.url
  if (!raw) return res.status(400).json({ ok: false, error: 'url required' })
  try {
    res.json({ ok: true, data: await analyzeBranding(String(raw)) })
  } catch {
    res.status(502).json({ ok: false, error: 'Could not read branding from that URL.' })
  }
})

// POST /import/scan — preview only (no writes)
importRouter.post('/scan', requireAuth, async (req, res) => {
  if (!req.body?.url) return res.status(400).json({ ok: false, error: 'url required' })
  try {
    res.json({ ok: true, data: await scanSite(req.body.url) })
  } catch {
    res.status(502).json({ ok: false, error: 'Could not scan site — is it WordPress with the REST API enabled?' })
  }
})

// POST /import/commit — scan + persist pages + redirects into a workspace.
// Body: { slug, url, mode? = 'all' | 'home' | 'rest' }
//   home  — only the page classified as 'home' (great first step)
//   rest  — everything except the home (or anything already in the workspace)
//   all   — full import (default for back-compat)
importRouter.post('/commit', requireAuth, async (req: AuthRequest, res) => {
  const { slug, url, keepPaths } = req.body ?? {}
  const mode: 'all' | 'home' | 'rest' = ['home', 'rest', 'all'].includes(req.body?.mode) ? req.body.mode : 'all'
  if (!slug || !url) return res.status(400).json({ ok: false, error: 'slug and url required' })
  // Optional allowlist of paths to import (user toggles Keep/Discard in the UI).
  const allowSet: Set<string> | null = Array.isArray(keepPaths) ? new Set(keepPaths.map(String)) : null

  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, req.user!.accountId))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })

  let scan
  try { scan = await scanSite(url) }
  catch { return res.status(502).json({ ok: false, error: 'Could not scan site — is it WordPress with the REST API enabled?' }) }

  // Auto-import branding on first contact ('home' or 'all'). Don't fail the
  // whole import if branding analysis hiccups (e.g. CSS not parseable).
  let brandingApplied = false
  let brandCta: { label: string; href: string } | null = null
  if (mode === 'home' || mode === 'all') {
    try {
      const b = await analyzeBranding(url)
      brandCta = (b.brand_assets?.cta) || null
      const [existingTokens] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
      if (existingTokens) await db.update(brandingTokens).set({ tokens: b.tokens }).where(eq(brandingTokens.id, existingTokens.id))
      else await db.insert(brandingTokens).values({ workspaceId: ws.id, tokens: b.tokens })
      brandingApplied = true
    } catch { /* swallow — pages still import */ }
  }
  // If we're only importing 'rest', the workspace already has branding; pull
  // the CTA back out so home wouldn't get re-imported but other modes work.
  if (mode === 'rest') {
    try {
      const [existingTokens] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
      brandCta = ((existingTokens?.tokens as any)?.brand_assets?.cta) || null
    } catch { /* swallow */ }
  }

  // Re-fetch with content + embedded media so each page gets its real body + featured image
  const site = String(url).trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://')
  const [pagesFull, postsFull] = await Promise.all([
    fetchAll(site, 'pages', 'id,slug,link,title,content,featured_media', { embed: true }).catch(() => []),
    fetchAll(site, 'posts', 'id,slug,link,title,content,featured_media', { embed: true }).catch(() => []),
  ])
  const bySlug = new Map<string, any>()
  for (const p of [...pagesFull, ...postsFull]) if (p?.slug) bySlug.set(p.slug, p)

  const existing = new Set(
    (await db.select({ slug: pages.slug }).from(pages).where(eq(pages.workspaceId, ws.id))).map((r) => r.slug),
  )

  let created = 0, skipped = 0, discarded = 0
  for (const item of scan.items) {
    // mode filter
    if (mode === 'home' && item.type !== 'home') { skipped++; continue }
    if (mode === 'rest' && item.type === 'home') { skipped++; continue }

    // Honour keep/discard from the UI (if provided)
    if (allowSet && !allowSet.has(item.path)) { discarded++; continue }

    const type = toPageType(item.type)
    if (!type) { skipped++; continue }
    const pslug = slugFromPath(item.path)
    if (existing.has(pslug)) { skipped++; continue }
    existing.add(pslug)

    const src = bySlug.get(item.slug)
    const contentHtml = src?.content?.rendered ?? ''
    const featured = src ? featuredFromEmbed(src) : null
    const isHome = item.type === 'home'
    const blocks = importedBlocks(item.title, contentHtml, featured || undefined, { isHome, cta: isHome ? brandCta : null })
    const sourceUrl = src?.link || (site + item.path)

    await db.insert(pages).values({
      workspaceId: ws.id, type: type as any, slug: pslug,
      title: item.title || pslug, status: 'draft', blocks: blocks as any,
      seo: { import_source: { url: sourceUrl, snapshot_url: snapshotUrl(sourceUrl), imported_at: new Date().toISOString() } } as any,
    })
    created++
  }

  // redirects only on first import (avoid duplicates on staged runs)
  let redirectCount = 0
  if (mode === 'home' || mode === 'all') {
    for (const r of scan.redirects) {
      await db.insert(redirects).values({ workspaceId: ws.id, fromPath: r.from, toPath: r.to, code: r.code })
      redirectCount++
    }
  }

  res.json({ ok: true, data: { created, skipped, discarded, redirects: redirectCount, total: scan.total, slug: ws.slug, mode, brandingApplied } })
})
