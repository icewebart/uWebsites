import { Router } from 'express'
import path from 'node:path'
import { and, eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { db, workspaces, pages, redirects, brandingTokens } from '@uwebsites/db'
import { upsertMenu, navTreeToItems, relinkInternal } from './menus.js'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { sectionizeHtml } from '../lib/html-sectionizer.js'
import { createImageMirror, localImageMissing } from '../lib/image-host.js'
import { headlessRender, extractBrandFromDom, type NavNode } from '../lib/headless.js'
import { fitSection, mirrorBlockImages } from '../lib/section-classifier.js'
import { parseDesignSystem, preprocessLandingHtml } from '../lib/design-system.js'

// ---- Color scale generation (for the design-system palette display) ----
function _toRgb(h: string): [number, number, number] | null {
  let s = h.trim().toLowerCase()
  const rgb = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]]
  if (s[0] === '#') s = s.slice(1)
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/.test(s)) return null
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}
function _toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return '#' + h(r) + h(g) + h(b)
}
function _mix(hex: string, target: [number, number, number], amt: number): string {
  const c = _toRgb(hex); if (!c) return hex
  return _toHex(c[0] + (target[0] - c[0]) * amt, c[1] + (target[1] - c[1]) * amt, c[2] + (target[2] - c[2]) * amt)
}
// Produce a 5-step scale (50/200/400/600/800) from a base color, base ≈ 600.
export function colorScale(primary: string): Record<string, string> {
  const W: [number, number, number] = [255, 255, 255]
  const K: [number, number, number] = [20, 8, 30]
  return {
    '50': _mix(primary, W, 0.90),
    '200': _mix(primary, W, 0.60),
    '400': _mix(primary, W, 0.26),
    '600': primary,
    '800': _mix(primary, K, 0.42),
  }
}

// Ask Claude Vision for real brand colors based on the logo + homepage
// snapshot. Much more reliable than CSS frequency for sites where the brand
// colors live in image assets. Returns null on any failure — caller falls
// back to CSS-based extraction.
async function fetchImageBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
    if (!ct.startsWith('image/')) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 5 * 1024 * 1024) return null
    return { data: buf.toString('base64'), mediaType: ct }
  } catch { return null }
}

async function inferColorsFromVision(logoUrl: string | null, snapshotUrl: string | null, hint?: string): Promise<{ primary?: string; accent?: string; reason?: string } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  const candidates = [logoUrl, snapshotUrl].filter(Boolean) as string[]
  if (!candidates.length) return null
  // Fetch images ourselves and pass as base64 — far more reliable than URL
  // sources (which can fail for thum.io's lazy-rendered snapshots).
  const images = (await Promise.all(candidates.map(fetchImageBase64))).filter(Boolean) as { data: string; mediaType: string }[]
  if (!images.length) { console.error('[vision] no images fetched (logo=', !!logoUrl, 'snapshot=', !!snapshotUrl, ')'); return null }
  try {
    const a = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const content: any[] = [
      ...images.map((img) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: img.mediaType, data: img.data } })),
      { type: 'text' as const, text: `Examine the brand assets above (logo and/or homepage screenshot${hint ? `; site context: ${hint}` : ''}).\n\nIdentify the brand's PRIMARY color (the dominant brand color, usually the logo colour or button colour) and ACCENT color (the secondary highlight). Return ONLY a single JSON object exactly in this format, no commentary:\n{"primary":"#rrggbb","accent":"#rrggbb"}` },
    ]
    const r = await a.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: 200,
      messages: [{ role: 'user', content }],
    })
    const text = r.content.map((b: any) => b.type === 'text' ? b.text : '').join('')
    const m = text.match(/\{[\s\S]*?\}/)
    if (!m) { console.error('[vision] no JSON in reply:', text.slice(0, 200)); return null }
    const parsed = JSON.parse(m[0])
    const ok = (s: any) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
    if (!ok(parsed.primary) && !ok(parsed.accent)) return null
    return {
      primary: ok(parsed.primary) ? parsed.primary.toLowerCase() : undefined,
      accent: ok(parsed.accent) ? parsed.accent.toLowerCase() : undefined,
      reason: `Identified from ${images.length} image${images.length === 1 ? '' : 's'}`,
    }
  } catch (e: any) { console.error('[vision] error:', e?.message || e); return null }
}

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
// Default article layout used at import time (deterministic — no AI) so every
// imported article gets the header + sidebar columns from the get-go. Users can
// change the design in Website → Article Template, or run AI Normalise to clean
// the body markup.
const DEFAULT_ARTICLE_SIDEBAR = [
  { kind: 'cta', title: 'Ready to start?', text: 'A short line about the next step.', cta_label: 'Get in touch', cta_href: '/contact/' },
  { kind: 'newsletter', title: 'Get our newsletter', text: 'Tips in your inbox, no spam.', cta_label: 'Subscribe', placeholder: 'you@email.com' },
]
// Decode HTML entities so imported titles/text read as real characters
// (&#8211; → –, &#8217; → ’, &amp; → &, &hellip; → …, etc.).
export function decodeEntities(s: string): string {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => { try { return String.fromCodePoint(parseInt(n, 16)) } catch { return _m } })
    .replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCodePoint(parseInt(n, 10)) } catch { return _m } })
    .replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '…').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&rdquo;/g, '”').replace(/&ldquo;/g, '“')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&trade;/g, '™').replace(/&copy;/g, '©').replace(/&reg;/g, '®')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
const stripToText = (h: string) => decodeEntities(String(h || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

// DETERMINISTIC full-page structurer (no AI). Splits content into a clean
// hero-image + one section per <h2> (image-text when the section has an image,
// else prose), + a Smart CTA. Alternating tone bands give it landing-page
// rhythm. Used at import and by the "⚡ Structure" button.
export function structuredPageBlocks(title: string, contentHtml: string, featuredImg?: { url: string; alt?: string }): any[] {
  const html = decodeEntities(String(contentHtml || ''))
  const firstP = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  const deck = firstP ? stripToText(firstP[1]).slice(0, 220) : ''
  let heroImg = featuredImg?.url || ''
  const firstImg = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  if (!heroImg && firstImg) heroImg = firstImg[1]
  const ctaM = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*(?:btn|button)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)
  const cta = ctaM ? { label: stripToText(ctaM[2]).slice(0, 40), href: ctaM[1] } : null
  // Body = content minus the lead paragraph and the hero image (avoid dup).
  let body = firstP ? html.replace(firstP[0], '') : html
  if (heroImg) body = body.replace(new RegExp(`<img[^>]+src=["']${heroImg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i'), '')
  const blocks: any[] = [{ type: 'hero-image', props: { eyebrow: '', heading: decodeEntities(title || ''), sub: deck, image_url: heroImg, image_alt: decodeEntities(title || ''), cta_label: cta?.label || '', cta_href: cta?.href || '', variant: 'split' } }]
  // Split the remaining body at each <h2> boundary.
  const parts = body.split(/(?=<h2[\s>])/i).map((s) => s.trim()).filter((s) => stripToText(s).length > 4)
  let alt = 0
  for (const part of parts.slice(0, 12)) {
    const h2 = part.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
    const img = part.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (h2 && img) {
      const heading = stripToText(h2[1]).slice(0, 120)
      const text = part.replace(h2[0], '').replace(/<img[^>]+>/gi, '')
      blocks.push({ type: 'image-text', props: { heading, html: safeHtml(text), image_url: img[1], image_alt: heading, image_side: (alt++ % 2) ? 'left' : 'right' } })
    } else {
      blocks.push({ type: 'richtext', props: { html: safeHtml(part) } })
    }
  }
  blocks.push({ type: 'cta-ref', props: { cta_id: '', variant: 'gradient' } })
  return blocks
}

export function articleBlocksFromImport(title: string, contentHtml: string, featuredImg?: { url: string; alt?: string }, tmpl?: { heroVariant: string; sidebar: any[]; grad_from?: string; grad_to?: string }) {
  const html = decodeEntities(String(contentHtml || ''))
  // Pull the first paragraph as the deck, and drop it from the body to avoid a
  // duplicate lead line.
  const firstP = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
  const deck = firstP ? stripToText(firstP[1]).slice(0, 200) : ''
  const body = firstP ? html.replace(firstP[0], '') : html
  const readMins = Math.max(2, Math.round(html.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean).length / 200))
  const heroVariant = tmpl?.heroVariant || 'classic'
  const sidebar = JSON.parse(JSON.stringify(tmpl?.sidebar?.length ? tmpl.sidebar : DEFAULT_ARTICLE_SIDEBAR))
  return [
    { type: 'article-hero', props: { variant: heroVariant, grad_from: tmpl?.grad_from || 'primary', grad_to: tmpl?.grad_to || 'accent', eyebrow: '', heading: decodeEntities(title || ''), sub: deck, author: '', date: '', readMins, image_url: featuredImg?.url || '', image_alt: decodeEntities(title || '') } },
    { type: 'article-body', props: { html: safeHtml(body), toc: true, headline: decodeEntities(title || ''), author: '', publishedAt: '', readMins, sidebar } },
    { type: 'cta-ref', props: { cta_id: '', variant: 'gradient' } },
  ]
}

function importedBlocks(title: string, contentHtml: string, featuredImg?: { url: string; alt?: string }, opts?: { isHome?: boolean; cta?: { label: string; href: string } | null; pageType?: string; articleTemplate?: { heroVariant: string; sidebar: any[] } }) {
  // Article-type pages import straight into the article template.
  if ((opts?.pageType === 'article' || opts?.pageType === 'collection_item') && contentHtml && contentHtml.trim()) {
    return articleBlocksFromImport(title, contentHtml, featuredImg, opts.articleTemplate)
  }
  // Every other page with content comes in PRE-STRUCTURED (clean hero + a
  // section per H2 + Smart CTA) — deterministic, no AI credits.
  if (contentHtml && contentHtml.trim()) return structuredPageBlocks(title, contentHtml, featuredImg)
  // No content — just a hero.
  const heroProps: any = { heading: decodeEntities(title || ''), sub: '' }
  if (opts?.cta) { heroProps.cta_label = opts.cta.label; heroProps.cta_href = opts.cta.href }
  if (featuredImg?.url) { heroProps.image_url = featuredImg.url; heroProps.image_alt = featuredImg.alt || title || ''; return [{ type: 'hero-image', props: heroProps }] }
  return [{ type: 'hero', props: heroProps }]
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

// Resolve a post's featured image URL. WordPress's `_embed` is silently DROPPED
// when `_fields` is used (it needs `_links` in the field list), so relying on
// _embedded alone loses every featured image. We instead fetch the media items
// by id in one call and look them up here. Falls back to _embedded if present.
async function fetchFeaturedMap(site: string, ids: number[]): Promise<Map<number, { url: string; alt: string }>> {
  const map = new Map<number, { url: string; alt: string }>()
  const uniq = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))]
  const CHUNK = 100
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const batch = uniq.slice(i, i + CHUNK)
    const url = `${site}/wp-json/wp/v2/media?include=${batch.join(',')}&per_page=${batch.length}&_fields=id,source_url,alt_text`
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (!r.ok) continue
      const data = (await r.json()) as any[]
      for (const m of data) if (m?.id && m?.source_url) map.set(m.id, { url: m.source_url, alt: m.alt_text || '' })
    } catch { /* best-effort */ }
  }
  return map
}
function featuredFrom(p: any, mediaMap?: Map<number, { url: string; alt: string }>): { url: string; alt?: string } | null {
  const id = Number(p?.featured_media)
  const fromMap = mediaMap?.get(id)
  if (fromMap?.url) return { url: fromMap.url, alt: fromMap.alt }
  return featuredFromEmbed(p)
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
export async function analyzeBranding(siteUrl: string) {
  const site = String(siteUrl).trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://')
  const home = await (await fetch(site, { headers: { 'User-Agent': UA } })).text()
    // Collect CSS hrefs (same-origin) and Google Fonts families
    const cssHrefs = Array.from(home.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)).map((m) => m[1])
    const inlineCss = Array.from(home.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)).map((m) => m[1]).join('\n')
    const googleFonts: string[] = []
    const pushFont = (name: string) => {
      const n = name.trim().replace(/^["']|["']$/g, '')
      if (n && !/^(serif|sans-serif|monospace|system-ui|-apple-system|blinkmacsystemfont|inherit|initial|unset|var\(|--)/i.test(n) && !googleFonts.includes(n)) googleFonts.push(n)
    }
    // 1) From <link href="fonts.googleapis.com/css?family=A&family=B"> in HTML
    for (const linkMatch of home.matchAll(/fonts\.googleapis\.com\/css[^"'\s]+/gi)) {
      for (const fam of linkMatch[0].matchAll(/family=([^&"']+)/gi)) {
        pushFont(decodeURIComponent(fam[1].split(':')[0].replace(/\+/g, ' ')))
      }
    }

    // Many WP themes (Elementor!) self-host Google Fonts under wp-content paths
    // like /uploads/elementor/google-fonts/css/quicksand.css. The family name is
    // in the URL itself — extract before fetching anything.
    for (const href of cssHrefs) {
      const fileMatch = href.match(/\/(?:google-fonts|fonts)\/(?:css\/)?([a-z][a-z0-9-]+?)(?:\.css|\.min\.css|[\?#])/i)
      if (fileMatch) pushFont(fileMatch[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
    }

    // Prioritise CSS files we know carry brand info so the 8-file cap doesn't
    // burn through layout / WooCommerce CSS while missing the palette.
    //  - fonty: self-hosted google fonts + @font-face files
    //  - branded: Elementor's per-page site-kit CSS (--e-global-color-* lives
    //    in /elementor/css/post-N.css), plus theme-level style.css
    const isFonty = (h: string) => /\b(font|typography|google-fonts)\b/i.test(h)
    const isBranded = (h: string) => /\/elementor\/css\/post-\d+\.css|\/themes\/[^/]+\/style/i.test(h)
    const orderedHrefs = [
      ...cssHrefs.filter(isFonty),
      ...cssHrefs.filter((h) => !isFonty(h) && isBranded(h)),
      ...cssHrefs.filter((h) => !isFonty(h) && !isBranded(h)),
    ]
    let css = inlineCss
    for (const href of orderedHrefs.slice(0, 8)) {
      try {
        const abs = href.startsWith('http') ? href : new URL(href, site).toString()
        if (abs.includes('fonts.googleapis.com')) continue
        const txt = await (await fetch(abs, { headers: { 'User-Agent': UA } })).text()
        css += '\n' + txt.slice(0, 200000) // cap per file
        if (css.length > 600000) break
      } catch { /* skip */ }
    }

    // 2) @font-face + @import in CSS (now that we have it concatenated)
    for (const m of css.matchAll(/@font-face\s*\{[^}]*font-family\s*:\s*([^;]+)/gi)) {
      pushFont(m[1].split(',')[0])
    }
    for (const m of css.matchAll(/@import[^;]*fonts\.googleapis\.com\/css[^;]+/gi)) {
      for (const fam of m[0].matchAll(/family=([^&)"' ;]+)/gi)) {
        pushFont(decodeURIComponent(fam[1].split(':')[0].replace(/\+/g, ' ')))
      }
    }
    // 3) Last-resort: scan every font-family declaration for non-generic names
    for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
      for (const part of m[1].split(',')) pushFont(part)
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

    // ---- CSS-variable based brand-color extraction (much better signal) ----
    // Modern themes (especially Elementor + Astra + GeneratePress + WP block
    // themes) declare brand colors as CSS custom properties. Parse them; they
    // beat raw frequency counts because they're declared, not painted.
    const normalize = (raw: string): string | null => {
      let s = raw.trim().toLowerCase()
      const rgb = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
      if (rgb) s = '#' + [rgb[1], rgb[2], rgb[3]].map((v) => parseInt(v).toString(16).padStart(2, '0')).join('')
      if (s.startsWith('#')) {
        if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
        return /^#[0-9a-f]{6}$/.test(s) ? s : null
      }
      return null
    }
    const varHits: Record<string, string> = {} // intent -> hex
    for (const m of css.matchAll(/--([a-z0-9_-]+)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi)) {
      const name = m[1].toLowerCase()
      const color = normalize(m[2]); if (!color) continue
      // Categorise the var by intent based on its name
      let intent: 'primary' | 'accent' | 'secondary' | null = null
      if (/(global-color-primary|theme-color|brand-?primary|brand-?color|^primary|^main-?color)/.test(name)) intent = 'primary'
      else if (/(global-color-accent|brand-?accent|^accent)/.test(name)) intent = 'accent'
      else if (/(global-color-secondary|brand-?secondary|^secondary)/.test(name)) intent = 'secondary'
      if (intent && !varHits[intent]) varHits[intent] = color
    }

    // WP block-editor + Elementor default palette — recognize and deprioritize
    const WP_DEFAULTS = new Set([
      '#cf2e2e', '#9b51e0', '#0693e3', '#7bdcb5', '#00d084', '#fcb900', '#ff6900',
      '#f78da7', '#8ed1fc', '#abb8c3', '#cd2653', '#cc1818',
      '#6ec1e4', '#54595f', '#7a7a7a', '#61ce70', // Elementor
    ])
    const filteredRanked = ranked.filter((c) => !WP_DEFAULTS.has(c))
    const useRanked = filteredRanked.length >= 2 ? filteredRanked : ranked

    // A "weak" brand color is near-white, near-black, or a low-saturation grey —
    // useless as a primary (white buttons on white bg, etc). Some Elementor kits
    // set --e-global-color-primary to #ffffff, which we must not trust.
    const isWeakBrand = (hex?: string): boolean => {
      const m = (hex || '').match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i)
      if (!m) return true
      const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16)
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      const sat = max === 0 ? 0 : (max - min) / max
      return lum > 0.9 || lum < 0.06 || sat < 0.15
    }
    let finalPrimary = varHits.primary || useRanked[0] || '#16324A'
    let finalAccent = varHits.accent || varHits.secondary || useRanked.find((c) => c !== finalPrimary) || '#8FD7F1'
    // If the extracted primary is weak, promote a real brand color to primary.
    if (isWeakBrand(finalPrimary)) {
      const strong = [finalAccent, varHits.secondary, ...useRanked].find((c) => c && !isWeakBrand(c))
      if (strong) {
        if (strong === finalAccent) finalAccent = useRanked.find((c) => c && !isWeakBrand(c) && c !== strong) || finalAccent
        finalPrimary = strong
      }
    }

    // Font extraction — pick the actual heading + body fonts from CSS rules
    // (not just the first font-family declaration, which is usually a reset).
    const firstFamily = (s: string): string | null => {
      const first = s.split(',')[0].trim().replace(/^["']|["']$/g, '')
      if (!first) return null
      if (/^(serif|sans-serif|monospace|system-ui|-apple-system|blinkmacsystemfont|inherit|initial|unset|var\(|"")$/i.test(first)) return null
      return first
    }
    const findFontFor = (selectorRe: RegExp): string | null => {
      for (const rule of css.matchAll(new RegExp(`(${selectorRe.source})\\s*\\{[^}]*font-family\\s*:\\s*([^;}]+)`, 'gi'))) {
        const f = firstFamily(rule[2])
        if (f) return f
      }
      return null
    }
    let headingFont = findFontFor(/h1|h2|h3|\.h1|\.h2|\.headline|\.hero h1/i)
    let bodyFont = findFontFor(/body|html|\.entry-content|\.content/i)
    // Elementor exposes the site-wide font picks as CSS custom properties
    // (--e-global-typography-primary-font-family etc) — these are the values
    // the user actually chose, so prefer them over inferred selectors.
    const eGlobalFont = (key: string): string | null => {
      const re = new RegExp(`--e-global-typography-${key}-font-family\\s*:\\s*([^;}]+)`, 'i')
      const m = css.match(re); return m ? firstFamily(m[1]) : null
    }
    headingFont = eGlobalFont('primary') || eGlobalFont('secondary') || headingFont
    bodyFont = eGlobalFont('text') || eGlobalFont('accent') || bodyFont
    // Resolve via Google Fonts if CSS gave us a CSS variable or a generic family
    if (!headingFont && googleFonts.length) headingFont = googleFonts[0]
    if (!bodyFont && googleFonts.length) bodyFont = googleFonts.find((f) => f !== headingFont) || googleFonts[0]
    if (!headingFont) headingFont = bodyFont || 'Inter'
    if (!bodyFont) bodyFont = headingFont

    // Button radius — first border-radius near a .btn/button selector
    let btnRadius: string | null = null
    const btnRule = css.match(/(?:button|\.btn|\[type=["']?button["']?\])[^{]*\{[^}]*border-radius\s*:\s*([0-9.]+)(px|rem|em)/i)
    if (btnRule) {
      const n = parseFloat(btnRule[1]); const u = btnRule[2]
      btnRadius = `${u === 'rem' || u === 'em' ? Math.round(n * 16) : Math.round(n)}px`
    }

    const tokens = {
      color: {
        primary: finalPrimary,
        accent: finalAccent,
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

  // Vision pass — only invoked when CSS variable extraction produced no signal,
  // since site-config vars (Elementor / theme.json palette) are what the owner
  // actually picked and beat what Claude sees in a screenshot. We hint Claude
  // with the nav labels so it can reason about the industry.
  const hadVarSignal = !!(varHits.primary || varHits.accent || varHits.secondary)
  let visionRan = false
  if (!hadVarSignal) {
    const visionHint = brand_assets.nav?.length
      ? `Navigation includes: ${brand_assets.nav.slice(0, 6).map((n) => n.text).join(', ')}`
      : undefined
    const vision = await inferColorsFromVision(brand_assets.logo?.url || null, brand_assets.snapshot_url, visionHint)
    if (vision?.primary) tokens.color.primary = vision.primary
    if (vision?.accent) tokens.color.accent = vision.accent
    visionRan = !!vision
  }

  ;(tokens as any).brand_assets = brand_assets
  return { site, tokens, suggestions: { colors: ranked.slice(0, 8), fonts: [...new Set([headingFont, bodyFont].filter(Boolean) as string[])] }, brand_assets, vision: visionRan }
}

// Combine the CSS-based analyzer with a live-DOM headless extraction. DOM wins
// for logo + nav tree (it sees JS-built menus and computed styles); CSS wins
// for the exact brand hex where site-config vars exist. Returns a rich payload
// the branding "brand book" page renders.
export async function richBranding(url: string) {
  const site = String(url).trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://')
  // Run both; DOM extraction is best-effort (never fail the whole call on it).
  const cssResult = await analyzeBranding(site)
  let dom: Awaited<ReturnType<typeof extractBrandFromDom>> | null = null
  try { dom = await extractBrandFromDom(site) } catch (e: any) { console.error('[branding] dom extract failed:', e?.message) }

  const tokens: any = cssResult.tokens
  // Prefer computed fonts from the live DOM, but ONLY when they name a real
  // typeface — computed <body> often resolves to the OS default (-apple-system,
  // system-ui, etc) which would clobber the CSS-derived Google Font.
  const isRealFont = (f?: string) => !!f && !/^(-apple-system|system-ui|blinkmacsystemfont|sans-serif|serif|inherit|initial|"")/i.test(f)
  if (isRealFont(dom?.fonts?.heading)) tokens.font.heading = dom!.fonts.heading
  if (isRealFont(dom?.fonts?.body)) tokens.font.body = dom!.fonts.body

  // Logo — DOM extraction is far more reliable than regex; overwrite when found.
  const logo = dom?.logo || (cssResult.brand_assets?.logo
    ? { kind: 'img' as const, url: cssResult.brand_assets.logo.url, alt: cssResult.brand_assets.logo.alt }
    : null)

  // Nav — prefer the hierarchical DOM tree; fall back to the flat CSS nav.
  const navTree: NavNode[] = (dom?.nav && dom.nav.length) ? dom.nav
    : (cssResult.brand_assets?.nav || []).map((n: any) => ({ text: n.text, href: n.href }))
  const navFlat = navTree.map((n) => ({ text: n.text, href: n.href }))

  const brand_assets = {
    ...cssResult.brand_assets,
    logo: logo && (logo as any).kind === 'img' ? { url: (logo as any).url, alt: (logo as any).alt || '' } : cssResult.brand_assets?.logo || null,
    logo_rich: logo,                 // full {kind:'svg'|'img', ...} for the brand book
    nav: navFlat,                    // keep flat for menu seeding (back-compat)
    nav_tree: navTree,               // hierarchical for the mega-menu
    has_mega_menu: dom?.hasMegaMenu || false,
    footer: dom?.footer || { links: [], tagline: '', social: [] },
    tagline: (cssResult.brand_assets as any)?.tagline || dom?.footer?.tagline || '',
  }
  ;(tokens as any).brand_assets = brand_assets

  return {
    ...cssResult,
    tokens,
    brand_assets,
    logo,
    nav_tree: navTree,
    has_mega_menu: dom?.hasMegaMenu || false,
    palette_scale: {
      primary: colorScale(tokens.color.primary),
      accent: colorScale(tokens.color.accent),
    },
    dom_used: !!dom,
  }
}

// POST /import/branding — branding-first extraction: logo, palette (+ scale),
// fonts, and the full nav tree (with dropdowns). Rendered via headless Chromium.
importRouter.post('/branding', requireAuth, async (req, res) => {
  const raw = req.body?.url
  if (!raw) return res.status(400).json({ ok: false, error: 'url required' })
  try {
    res.json({ ok: true, data: await richBranding(String(raw)) })
  } catch (e: any) {
    console.error('[branding] failed:', e?.message)
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
  if (!ws) return res.status(404).json({ ok: false, error: `Workspace "${slug}" not found. Reload the page and try again — if it persists, create the workspace fresh from “＋ New site”.` })

  let scan
  try { scan = await scanSite(url) }
  catch { return res.status(502).json({ ok: false, error: 'Could not scan site — is it WordPress with the REST API enabled?' }) }

  // Auto-import branding on first contact ('home' or 'all'). Don't fail the
  // whole import if branding analysis hiccups (e.g. CSS not parseable).
  let brandingApplied = false
  let brandCta: { label: string; href: string } | null = null
  let brandTokens: any = null            // captured so we can theme the sectionized home
  if (mode === 'home' || mode === 'all') {
    try {
      // richBranding = headless DOM extraction: real logo (SVG/PNG), computed
      // palette (weak-primary guarded), fonts, and the full nav tree with
      // dropdowns. Much better than the old CSS-only analyzeBranding.
      const b = await richBranding(url)
      brandTokens = b.tokens
      brandCta = (b.brand_assets?.cta) || null
      const [existingTokens] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
      if (existingTokens) await db.update(brandingTokens).set({ tokens: b.tokens }).where(eq(brandingTokens.id, existingTokens.id))
      else await db.insert(brandingTokens).values({ workspaceId: ws.id, tokens: b.tokens })
      // Seed the header menu from the source nav — the hierarchical tree keeps
      // dropdown children (rendered as menus on the published header) + main CTA.
      const fromTree = navTreeToItems(b.nav_tree || [])
      const navItems = fromTree.length ? fromTree : (b.brand_assets?.nav || []).map((n: any) => ({ label: n.text, href: n.href }))
      if (navItems.length || brandCta) {
        await upsertMenu(ws.id, 'header', { items: navItems, cta: brandCta })
      }
      // Seed the FOOTER menu from the footer we captured out of the live DOM
      // (reliable even for JS-built footers). Only when we actually got links —
      // don't clobber an existing footer with an empty one.
      const fLinks = ((b.brand_assets as any)?.footer?.links || []) as Array<{ text: string; href: string }>
      const fSocial = ((b.brand_assets as any)?.footer?.social || []) as Array<{ network: string; href: string }>
      if (fLinks.length) {
        await upsertMenu(ws.id, 'footer', {
          items: fLinks.slice(0, 20).map((l) => ({ label: l.text, href: l.href })),
          social: fSocial,
        } as any)
      }
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
  // Resolve featured images by id (see fetchFeaturedMap — _embed is unreliable
  // with _fields, so this is how article/hero images actually get populated).
  const mediaMap = await fetchFeaturedMap(site, [...pagesFull, ...postsFull].map((p) => Number(p?.featured_media)).filter(Boolean))

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
    const featured = src ? featuredFrom(src, mediaMap) : null
    const isHome = item.type === 'home'
    const sourceUrl = src?.link || (site + item.path)

    // The HOME page is the one people judge the import on — render it in a real
    // browser and split into styled raw-html sections (Elementor layout + CSS +
    // real images preserved), themed with the workspace's brand colors/fonts.
    // Everything else uses the light REST body (they can 'Re-import from source'
    // per page later). Fall back to REST blocks if the headless render fails.
    let blocks: any[]
    if (isHome) {
      try {
        blocks = await sectionizeUrl(sourceUrl, ws.slug,
          { primary: brandTokens?.color?.primary, accent: brandTokens?.color?.accent },
          { heading: brandTokens?.font?.heading, body: brandTokens?.font?.body })
        if (!blocks.length) throw new Error('no sections')
      } catch {
        blocks = importedBlocks(item.title, contentHtml, featured || undefined, { isHome, cta: brandCta })
      }
    } else {
      blocks = importedBlocks(item.title, contentHtml, featured || undefined, { isHome, cta: isHome ? brandCta : null, pageType: type })
    }

    await db.insert(pages).values({
      workspaceId: ws.id, type: type as any, slug: pslug,
      title: decodeEntities(item.title || pslug), status: 'draft', blocks: blocks as any,
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

  // Rewrite links that point to the original site into internal links now that
  // all the pages exist — so the imported site is correctly cross-linked.
  let relinked = 0
  try { relinked = (await relinkInternal(ws.id)).totalFixed } catch { /* non-fatal */ }

  res.json({ ok: true, data: { created, skipped, discarded, redirects: redirectCount, total: scan.total, slug: ws.slug, mode, brandingApplied, relinked } })
})

// Reusable core: render `sourceUrl` in Chromium, split into styled raw-html
// sections (colors/fonts rewritten to brand tokens, images mirrored to the
// workspace's /img dir). Returns raw-html blocks. Used by the import commit
// (home page) AND the /import/sectionize-page endpoint. Throws on failure.
export async function sectionizeUrl(
  sourceUrl: string,
  slug: string,
  sourceColors: { primary?: string | null; accent?: string | null } = {},
  sourceFonts: { heading?: string | null; body?: string | null } = {},
): Promise<Array<{ type: 'raw-html'; props: { html: string; sourceLabel: string } }>> {
  const r = await headlessRender(sourceUrl)
  const mirror = createImageMirror(slug)
  const sections = await sectionizeHtml(r.html, {
    baseUrl: r.finalUrl || sourceUrl,
    brandColors: sourceColors,
    brandFonts: sourceFonts,
    imageMirror: mirror,
    preloadedStylesheets: r.stylesheets,
    preloadedInlineStyles: r.inlineStyles,
    preSplitSections: r.capturedSections.map((s) => s.html),
  })
  return sections.map((s) => ({ type: 'raw-html' as const, props: { html: s.html, sourceLabel: s.sourceLabel || '' } }))
}

// DETERMINISTIC page reproduction (0 credits). Re-render `sourceUrl` in a real
// browser, then for EACH captured top-level section decide — from its
// structural fingerprint — which semantic section kind from our catalog it is
// and build the block props (hero, features/cards, image-text, stats, faq,
// gallery, cta, …). When the classifier isn't confident, fall back to the
// styled raw-html for that exact section so fidelity is never lost. Images are
// mirrored to the workspace's /img dir. This is the engine behind the Structure
// button: it "understands the whole page and reproduces it" without AI.
export async function structureFromSource(
  sourceUrl: string,
  slug: string,
  brandColors: { primary?: string | null; accent?: string | null } = {},
  brandFonts: { heading?: string | null; body?: string | null } = {},
): Promise<{ blocks: any[]; stats: { total: number; semantic: number; raw: number } } | null> {
  const r = await headlessRender(sourceUrl)
  if (!r.capturedSections.length) return null
  const mirror = createImageMirror(slug)

  // Styled raw-html for every section (same order) — our confidence-gated
  // fallback. sectionizeHtml inlines all the page CSS into raw[0].html.
  const raw = await sectionizeHtml(r.html, {
    baseUrl: r.finalUrl || sourceUrl,
    brandColors, brandFonts, imageMirror: mirror,
    preloadedStylesheets: r.stylesheets,
    preloadedInlineStyles: r.inlineStyles,
    preSplitSections: r.capturedSections.map((s) => s.html),
  })
  // The <style>…</style> the sectionizer parked on section 0. If section 0 is
  // classified into a semantic block (so we drop its raw-html), a later raw-html
  // fallback still needs that CSS — carry it to the first raw block we emit.
  const cssPrefix = raw[0]?.html.match(/^<style>[\s\S]*?<\/style>/)?.[0] || ''
  let cssCarried = false

  const blocks: any[] = []
  let semantic = 0, rawCount = 0
  const n = Math.min(r.capturedSections.length, 24)
  for (let i = 0; i < n; i++) {
    const cap = r.capturedSections[i]
    // The fitter maps almost every region to an editable typed section; it only
    // sets needsAi (→ raw-html fallback below) for regions with no mappable
    // content (forms/maps/embeds). This replaces the old raw-html-heavy path.
    const cls = fitSection(cap.fp, cap.html)
    if (cls.block && !cls.needsAi) {
      await mirrorBlockImages(cls.block, mirror)
      blocks.push(cls.block); semantic++
      continue
    }
    let html = raw[i]?.html || ''
    if (html) {
      if (cssPrefix && !cssCarried && !html.startsWith('<style>')) html = cssPrefix + html
      if (cssPrefix && (html.startsWith('<style>') || !cssCarried)) cssCarried = true
      blocks.push({ type: 'raw-html', props: { html, sourceLabel: raw[i].sourceLabel || '' } }); rawCount++
    } else if (cls.block) {
      await mirrorBlockImages(cls.block, mirror)
      blocks.push(cls.block); semantic++
    }
  }
  // End every page on a Smart CTA unless the source already ended with one.
  const last = blocks[blocks.length - 1]
  if (!last || !['cta-ref', 'cta-banner'].includes(last.type)) blocks.push({ type: 'cta-ref', props: { cta_id: '', variant: 'gradient' } })
  return { blocks, stats: { total: n, semantic, raw: rawCount } }
}

// POST /import/heal-images — walk a page's blocks and repair broken image
// references. For each <img src> that points to our own /p/<slug>/img/<hash>.<ext>
// and 404s on disk, we (a) try to COPY the file from another workspace's img
// folder if the same hashed filename exists there (same source URL → same
// content hash, so copies are safe), and (b) if that fails and the source
// URL is on file, we rerun the sectionizer to re-mirror the page in full.
// POST /import/mirror-images { slug } — download EVERY remote image referenced
// on the workspace's pages to the VPS and rewrite the URLs to local. Essential
// before the source site disappears. Handles <img src>, background-image, and
// typed image props. Images already hosted locally are skipped.
importRouter.post('/mirror-images', requireAuth, async (req: AuthRequest, res) => {
  const { slug } = req.body ?? {}
  const [ws] = await db.select().from(workspaces).where(and(eq(workspaces.slug, String(slug || '')), eq(workspaces.accountId, req.user!.accountId))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const mirror = createImageMirror(ws.slug)
  const rows = await db.select().from(pages).where(eq(pages.workspaceId, ws.id))
  const localRe = new RegExp(`/p/${ws.slug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}/img/`)
  const isExternal = (u: string) => /^https?:\/\//i.test(u) && !localRe.test(u) && !/^data:/i.test(u)

  // A string value is an image if it lives under an image-ish key OR ends in an
  // image extension. `url` alone is ambiguous (often a page link) so it only
  // counts with an image extension. `*_orig` keys hold the ORIGINAL source URL
  // we keep for healing — never rewrite those, but they're fine to download.
  const IMG_KEY = /^(image|image_url|imageurl|img|cover|banner|media|background|bg|bg_image|photo|avatar|logo|poster|thumb|thumbnail|icon|featured|hero_image)$/i
  const IMG_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico)(\?|#|$)/i
  const looksHtml = (s: string) => /<img|background(?:-image)?\s*:\s*url\(|srcset=/i.test(s)

  // 1) collect every external image URL across all pages (deduped) — deep-walk
  // the ENTIRE props tree (any depth, any array) plus the page's seo blob, so
  // no image-bearing key or nested card/slide/logo is missed.
  const urls = new Set<string>()
  const collectFromHtml = (html: string) => {
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) if (isExternal(m[1])) urls.add(m[1])
    for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi)) if (isExternal(m[1])) urls.add(m[1])
    for (const m of html.matchAll(/srcset=["']([^"']+)["']/gi)) for (const part of m[1].split(',')) { const u = part.trim().split(/\s+/)[0]; if (u && isExternal(u)) urls.add(u) }
  }
  const collect = (node: any) => {
    if (Array.isArray(node)) { for (const v of node) collect(v); return }
    if (!node || typeof node !== 'object') return
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') {
        if (looksHtml(v)) collectFromHtml(v)
        if (isExternal(v) && (IMG_KEY.test(k) || IMG_EXT.test(v))) urls.add(v)
      } else collect(v)
    }
  }
  for (const p of rows) {
    for (const b of (Array.isArray(p.blocks) ? p.blocks as any[] : [])) collect(b?.props)
    collect(p.seo)
  }

  // 2) download each (bounded concurrency) → remap old→local.
  const list = [...urls]
  const remap = new Map<string, string>()
  let downloaded = 0, failed = 0
  const CONC = 6
  for (let i = 0; i < list.length; i += CONC) {
    const batch = list.slice(i, i + CONC)
    await Promise.all(batch.map(async (u) => { const local = await mirror.mirror(u); if (local) { remap.set(u, local); downloaded++ } else failed++ }))
  }

  // 3) rewrite every reference (deep-walk again). Skip `*_orig` keys so the
  // original source URL stays available for later healing.
  let pagesChanged = 0, refs = 0
  const rewrite = (node: any) => {
    if (Array.isArray(node)) { for (const v of node) rewrite(v); return }
    if (!node || typeof node !== 'object') return
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') {
        if (k.endsWith('_orig')) continue
        if (remap.has(v)) { (node as any)[k] = remap.get(v); refs++ }
        else if (looksHtml(v)) { let s = v; for (const [from, to] of remap) if (s.includes(from)) { s = s.split(from).join(to); refs++ } if (s !== v) (node as any)[k] = s }
      } else rewrite(v)
    }
  }
  for (const p of rows) {
    const blocks = Array.isArray(p.blocks) ? JSON.parse(JSON.stringify(p.blocks)) : []
    const seo = p.seo ? JSON.parse(JSON.stringify(p.seo)) : p.seo
    const before = JSON.stringify(blocks) + JSON.stringify(seo ?? null)
    for (const b of blocks) rewrite(b?.props)
    rewrite(seo)
    if (JSON.stringify(blocks) + JSON.stringify(seo ?? null) !== before) {
      await db.update(pages).set({ blocks: blocks as any, seo: seo as any, updatedAt: new Date() }).where(eq(pages.id, p.id)); pagesChanged++
    }
  }
  res.json({ ok: true, data: { found: urls.size, downloaded, failed, pagesChanged, refs } })
})

// POST /import/backfill-featured { slug } — repair articles imported BEFORE the
// featured-image fix: for every article whose hero has no image, re-fetch the
// source post's featured image (by media id) and fill it in. Match source posts
// to pages by slug (page slug or the last segment of the stored source URL).
// After this, run "Save images" to mirror the newly-filled URLs locally.
importRouter.post('/backfill-featured', requireAuth, async (req: AuthRequest, res) => {
  const { slug } = req.body ?? {}
  const [ws] = await db.select().from(workspaces).where(and(eq(workspaces.slug, String(slug || '')), eq(workspaces.accountId, req.user!.accountId))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const rows = await db.select().from(pages).where(eq(pages.workspaceId, ws.id))

  // Find the source site URL from any page's stored import_source.
  let site = ''
  for (const p of rows) { const u = (p.seo as any)?.import_source?.url; if (u) { site = String(u); break } }
  if (!site) return res.status(400).json({ ok: false, error: 'No source URL on any page — can\'t reach the original site to fetch featured images.' })
  const origin = (() => { try { return new URL(site).origin } catch { return '' } })()
  if (!origin) return res.status(400).json({ ok: false, error: 'Bad source URL.' })

  // Pull posts + pages (id, slug, link, featured_media) and resolve media urls.
  const [postsFull, pagesFull] = await Promise.all([
    fetchAll(origin, 'posts', 'id,slug,link,featured_media').catch(() => []),
    fetchAll(origin, 'pages', 'id,slug,link,featured_media').catch(() => []),
  ])
  const all = [...postsFull, ...pagesFull]
  const mediaMap = await fetchFeaturedMap(origin, all.map((p) => Number(p?.featured_media)).filter(Boolean))
  const lastSeg = (u: string) => { try { return new URL(u).pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '' } catch { return '' } }
  const featBySlug = new Map<string, { url: string; alt: string }>()
  for (const p of all) {
    const f = mediaMap.get(Number(p?.featured_media)); if (!f?.url) continue
    if (p?.slug) featBySlug.set(String(p.slug).toLowerCase(), f)
    const seg = lastSeg(String(p?.link || '')); if (seg) featBySlug.set(seg.toLowerCase(), f)
  }

  let filled = 0, pagesChanged = 0
  for (const p of rows) {
    const blocks = Array.isArray(p.blocks) ? JSON.parse(JSON.stringify(p.blocks)) : []
    let changed = false
    for (const b of blocks) {
      if (b?.type !== 'article-hero' && b?.type !== 'hero-image') continue
      if (b.props?.image_url) continue // already has one
      const key = String(p.slug || '').toLowerCase()
      const srcSeg = lastSeg(String((p.seo as any)?.import_source?.url || '')).toLowerCase()
      const f = featBySlug.get(key) || (srcSeg ? featBySlug.get(srcSeg) : undefined)
      if (f?.url) { b.props = { ...b.props, image_url: f.url, image_url_orig: f.url, image_alt: b.props?.image_alt || f.alt || p.title || '' }; changed = true; filled++ }
    }
    if (changed) { await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, p.id)); pagesChanged++ }
  }
  res.json({ ok: true, data: { filled, pagesChanged, source: origin } })
})

importRouter.post('/heal-images', requireAuth, async (req: AuthRequest, res) => {
  const { pageId } = req.body ?? {}
  if (!pageId) return res.status(400).json({ ok: false, error: 'pageId required' })
  const [row] = await db.select({
    id: pages.id, title: pages.title, seo: pages.seo, blocks: pages.blocks,
    wsId: pages.workspaceId, slug: workspaces.slug, accId: workspaces.accountId,
  }).from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(eq(pages.id, String(pageId))).limit(1)
  if (!row || row.accId !== req.user!.accountId) return res.status(404).json({ ok: false, error: 'page not found' })
  const SITES_DIR = process.env.SITES_DIR || '/www/wwwroot/_sites'
  const wsImgDir = path.join(SITES_DIR, row.slug, 'img')
  const fs = await import('node:fs/promises')
  const exists = async (p: string) => { try { await fs.access(p); return true } catch { return false } }

  const blocks = Array.isArray(row.blocks) ? row.blocks as any[] : []

  // Pass 0 — semantic block image props: if an image points at one of OUR files
  // that's now missing on disk AND we kept its original source URL (stamped by
  // the classifier as <key>_orig), re-download it from source. This recovers
  // mirrored images whose local files were wiped, with no sibling copy needed.
  const remirror = createImageMirror(row.slug)
  let refetched = 0
  const healProp = async (obj: any, key: string) => {
    const url = obj?.[key]; const orig = obj?.[`${key}_orig`]
    if (typeof url === 'string' && typeof orig === 'string' && await localImageMissing(url, row.slug)) {
      const m = await remirror.mirror(orig); if (m) { obj[key] = m; refetched++ }
    }
  }
  for (const b of blocks) {
    const p = b?.props || {}
    await healProp(p, 'image_url'); await healProp(p, 'url')
    if (Array.isArray(p.items)) for (const it of p.items) { await healProp(it, 'image_url'); await healProp(it, 'image') }
    if (Array.isArray(p.logos)) for (const l of p.logos) await healProp(l, 'url')
    if (Array.isArray(p.tiers)) for (const t of p.tiers) await healProp(t, 'image_url')
  }
  if (refetched) await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, row.id))

  // Collect every /p/<slug>/img/<file> reference in the page's HTML.
  const refRe = /\/p\/([^/]+)\/img\/([a-f0-9]+\.[a-z0-9]+)/gi
  const refs = new Set<string>()
  for (const b of blocks) if (typeof b?.props?.html === 'string') {
    for (const m of b.props.html.matchAll(refRe)) refs.add(`${m[1]}|${m[2]}`)
  }
  // Enumerate broken ones (files missing under our workspace's img dir).
  const broken: Array<{ slug: string; file: string }> = []
  for (const r of refs) {
    const [slug, file] = r.split('|')
    if (slug !== row.slug) continue      // referenced under a foreign slug — will get rewritten below
    if (!(await exists(path.join(wsImgDir, file)))) broken.push({ slug, file })
  }
  // Also: images referenced under a FOREIGN workspace slug are broken by definition
  const foreignRefs: Array<{ slug: string; file: string }> = []
  for (const r of refs) {
    const [slug, file] = r.split('|')
    if (slug !== row.slug) foreignRefs.push({ slug, file })
  }
  // Ensure our img dir exists.
  await fs.mkdir(wsImgDir, { recursive: true })

  // Strategy 1: copy from a sibling workspace's img/ folder that has the same
  // content-hashed filename (same source URL → same hash across imports).
  let copied = 0, remapped = 0, stillMissing: string[] = []
  const siblings: string[] = []
  try {
    const entries = await fs.readdir(SITES_DIR)
    for (const e of entries) if (e !== row.slug && await exists(path.join(SITES_DIR, e, 'img'))) siblings.push(e)
  } catch { /* SITES_DIR might not exist locally in dev */ }
  const findInSiblings = async (file: string): Promise<string | null> => {
    for (const sib of siblings) {
      const p = path.join(SITES_DIR, sib, 'img', file)
      if (await exists(p)) return p
    }
    return null
  }
  // Heal locally-broken (right workspace slug, missing file)
  for (const { file } of broken) {
    const src = await findInSiblings(file)
    if (src) { await fs.copyFile(src, path.join(wsImgDir, file)); copied++ }
    else stillMissing.push(file)
  }
  // Rewrite HTML refs that used a FOREIGN slug → our slug (and copy the file).
  if (foreignRefs.length) {
    // Copy the underlying files into our dir if not already present.
    for (const { slug: foreignSlug, file } of foreignRefs) {
      const target = path.join(wsImgDir, file)
      if (!(await exists(target))) {
        const src = path.join(SITES_DIR, foreignSlug, 'img', file)
        if (await exists(src)) { await fs.copyFile(src, target); copied++ }
        else {
          const anywhere = await findInSiblings(file)
          if (anywhere) { await fs.copyFile(anywhere, target); copied++ }
          else stillMissing.push(file)
        }
      }
    }
    // Rewrite HTML: /p/<any-foreign-slug>/img/<file> → /p/<row.slug>/img/<file>
    const foreignFiles = new Set(foreignRefs.map((r) => r.file))
    const foreignSlugs = new Set(foreignRefs.map((r) => r.slug))
    let rewroteBlocks = 0
    for (const b of blocks) if (typeof b?.props?.html === 'string') {
      const before = b.props.html
      b.props.html = before.replace(refRe, (m: string, slug: string, file: string) => {
        if (foreignSlugs.has(slug) && foreignFiles.has(file)) { remapped++; return m.replace(`/p/${slug}/img/`, `/p/${row.slug}/img/`) }
        return m
      })
      if (b.props.html !== before) rewroteBlocks++
    }
    if (rewroteBlocks) await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, row.id))
  }

  res.json({ ok: true, data: {
    referenced: refs.size,
    brokenBefore: broken.length + foreignRefs.length,
    refetchedFromSource: refetched,
    copiedFromSibling: copied,
    urlsRemapped: remapped,
    stillMissing: stillMissing.slice(0, 20),
    stillMissingCount: stillMissing.length,
  } })
})

// POST /import/sectionize-page — pixel-faithful rebuild of one page from its
// source URL. Fetches the rendered HTML, splits it into top-level sections
// (Elementor or generic), swaps the source's brand colors/fonts for our brand
// tokens, mirrors images to the workspace's local /img dir, and replaces the
// page's blocks with raw-html sections. This is the "Approach A" import — the
// alternative to AI Rebuild, and the foundation for AI polish (Approach C).
importRouter.post('/sectionize-page', requireAuth, async (req: AuthRequest, res) => {
  const { pageId, url: overrideUrl } = req.body ?? {}
  if (!pageId) return res.status(400).json({ ok: false, error: 'pageId required' })

  const [row] = await db.select({
    id: pages.id, title: pages.title, seo: pages.seo, blocks: pages.blocks,
    wsId: pages.workspaceId, slug: workspaces.slug, accId: workspaces.accountId,
  }).from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(eq(pages.id, String(pageId))).limit(1)
  if (!row || row.accId !== req.user!.accountId) return res.status(404).json({ ok: false, error: 'page not found' })

  const sourceUrl = overrideUrl || (row.seo as any)?.import_source?.url
  if (!sourceUrl) return res.status(400).json({ ok: false, error: 'no source URL on file; pass {url} to specify' })

  // Pull the brand colors + fonts that were extracted on the original import,
  // so the sectionizer can rewrite the source's brand colors into our tokens.
  const [tokRow] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, row.wsId)).limit(1)
  const tokens: any = tokRow?.tokens || {}

  // Re-analyse the SOURCE site's colors so we know what to swap out. (The
  // workspace's brandingTokens hold the values to swap IN.) We rerun
  // analyzeBranding rather than caching because the user may have edited the
  // workspace's tokens since import — the source values are deterministic.
  let sourceColors: { primary?: string | null; accent?: string | null; secondary?: string | null } = {}
  let sourceFonts: { heading?: string | null; body?: string | null } = {}
  try {
    const b = await analyzeBranding(sourceUrl)
    sourceColors = { primary: b.tokens.color.primary, accent: b.tokens.color.accent }
    sourceFonts = { heading: b.tokens.font.heading, body: b.tokens.font.body }
  } catch {
    // best-effort; sectionizer still runs without color rewrites
  }

  // Default: render in real Chromium so we capture the page exactly as a
  // browser sees it (Elementor JS-driven classes, lazy-loaded images, dynamic
  // CSS). Body param { mode: 'fetch' } opts out for debugging.
  const useHeadless = (req.body?.mode ?? 'headless') === 'headless'
  let html: string
  let preloadedStylesheets: { href: string; css: string }[] | undefined
  let preloadedInlineStyles: string | undefined
  let capturedSections: string[] | undefined
  let resolvedUrl = sourceUrl

  try {
    if (useHeadless) {
      const r = await headlessRender(sourceUrl)
      html = r.html
      preloadedStylesheets = r.stylesheets
      preloadedInlineStyles = r.inlineStyles
      capturedSections = r.capturedSections.map((s) => s.html)
      resolvedUrl = r.finalUrl || sourceUrl
    } else {
      const r = await fetch(sourceUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
      if (!r.ok) return res.status(502).json({ ok: false, error: `Source fetch ${r.status}` })
      html = await r.text()
    }
  } catch (e: any) {
    return res.status(502).json({ ok: false, error: 'Could not render source: ' + (e?.message || 'unknown') })
  }

  const mirror = createImageMirror(row.slug)
  const sections = await sectionizeHtml(html, {
    baseUrl: resolvedUrl,
    brandColors: sourceColors,
    brandFonts: sourceFonts,
    imageMirror: mirror,
    preloadedStylesheets,
    preloadedInlineStyles,
    preSplitSections: capturedSections,
  })

  if (!sections.length) {
    return res.status(502).json({ ok: false, error: 'Sectionizer found no usable sections in the source page' })
  }

  const blocks = sections.map((s) => ({ type: 'raw-html', props: { html: s.html, sourceLabel: s.sourceLabel || '' } }))

  await db.update(pages).set({
    blocks: blocks as any,
    updatedAt: new Date(),
    seo: { ...(row.seo as any || {}), sectionized_at: new Date().toISOString() } as any,
  }).where(eq(pages.id, row.id))

  res.json({ ok: true, data: { pageId: row.id, sections: sections.length, blocks } })
})

// POST /import/design-system — the RELIABLE import path. Body:
//   { slug, html, assetsBaseUrl?, apply? }
// Parses a clean design-system HTML doc → brand tokens (colors, fonts) + logo
// (mirrored) + a home page built from the doc's SAMPLE LANDING. When apply is
// true (default), writes the workspace branding + home page. assetsBaseUrl is
// where the doc's relative assets (logo SVG, images, fonts) are hosted so we
// can mirror them into our own store — no hotlinking, nothing breaks.
importRouter.post('/design-system', requireAuth, async (req: AuthRequest, res) => {
  const { slug, html, landingHtml, assetsBaseUrl, apply = true } = req.body ?? {}
  if (!slug || !html) return res.status(400).json({ ok: false, error: 'slug and html required' })
  const ws = await db.select().from(workspaces).where(and(eq(workspaces.slug, String(slug)), eq(workspaces.accountId, req.user!.accountId))).limit(1).then((r) => r[0])
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })

  const base = String(assetsBaseUrl || '').trim() || 'https://example.com/'
  let parsed
  try { parsed = parseDesignSystem(String(html), base) }
  catch (e: any) { return res.status(400).json({ ok: false, error: 'Could not parse design system: ' + (e?.message || 'unknown') }) }

  const mirror = createImageMirror(ws.slug)

  // Mirror the logo into our store so it never hotlinks.
  let logoLocal: string | null = null
  if (parsed.logoUrl) {
    try { logoLocal = await mirror.mirror(parsed.logoUrl) } catch { /* keep null */ }
    if (!logoLocal) logoLocal = parsed.logoUrl
  }

  // Home page source: a dedicated landing page HTML (preferred — a full page
  // with real sections) or the design system's own SAMPLE LANDING. Clean
  // inline-styled HTML, so no headless needed. Images mirrored; brand hexes
  // rewritten to var(--primary)/--accent so token edits cascade; Claude-Design
  // template tags + <image-slot> placeholders resolved.
  let blocks: any[] = []
  const homeSource = landingHtml ? preprocessLandingHtml(String(landingHtml)) : parsed.sampleLandingHtml
  if (homeSource) {
    const sections = await sectionizeHtml(homeSource, {
      baseUrl: base,
      brandColors: { primary: parsed.tokens.color.primary, accent: parsed.tokens.color.accent },
      brandFonts: { heading: parsed.tokens.font.heading, body: parsed.tokens.font.body },
      imageMirror: mirror,
    })
    blocks = sections.map((s) => ({ type: 'raw-html', props: { html: s.html, sourceLabel: s.sourceLabel || '' } }))
  }

  const tokens = { ...parsed.tokens, brand_assets: {
    logo: logoLocal ? { url: logoLocal, alt: parsed.logoAlt } : null,
    font_faces: parsed.fontFaces,
    nav_tree: parsed.navTree,       // header nav with dropdowns (from the doc's <header>)
    has_mega_menu: parsed.navTree.some((n) => (n.children?.length || 0) > 6),
    cta: parsed.cta,
    tagline: parsed.footer.tagline || undefined,
  } }
  const headerItems = navTreeToItems(parsed.navTree)
  // Footer menu — each column becomes a top-level item (title) with its links as
  // children, so the published footer mirrors the kit's footer columns AND stays
  // editable in the footer editor (which already supports child items).
  const footerItems = parsed.footer.columns
    .filter((col) => col.items.length)
    .map((col) => ({ label: col.title, href: '#', children: col.items.map((i) => ({ label: i.text, href: i.href })) }))

  if (apply) {
    // Branding
    const [existing] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
    if (existing) await db.update(brandingTokens).set({ tokens }).where(eq(brandingTokens.id, existing.id))
    else await db.insert(brandingTokens).values({ workspaceId: ws.id, tokens })
    // Header menu — seed from the doc's nav (dropdowns preserved) + primary CTA
    if (headerItems.length || parsed.cta) {
      await upsertMenu(ws.id, 'header', { items: headerItems, cta: parsed.cta })
    }
    // Footer menu — seed from the doc's footer links
    if (footerItems.length) {
      await upsertMenu(ws.id, 'footer', { items: footerItems })
    }
    // Home page — replace blocks if a home exists, else create one
    if (blocks.length) {
      const [home] = await db.select({ id: pages.id }).from(pages).where(and(eq(pages.workspaceId, ws.id), eq(pages.type, 'home'))).limit(1)
      if (home) await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, home.id))
      else await db.insert(pages).values({ workspaceId: ws.id, type: 'home' as any, slug: 'home', title: ws.name, status: 'draft', blocks: blocks as any })
    }
  }

  res.json({ ok: true, data: {
    primary: tokens.color.primary, accent: tokens.color.accent,
    heading: tokens.font.heading, body: tokens.font.body,
    logo: logoLocal, fontFaces: parsed.fontFaces.length, sections: blocks.length,
    navItems: headerItems.length, dropdowns: headerItems.filter((i) => i.children?.length).length, applied: apply,
  } })
})
