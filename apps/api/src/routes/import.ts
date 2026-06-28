import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, pages, redirects } from '@uwebsites/db'
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

async function fetchAll(site: string, endpoint: string, fields: string): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; page <= 20; page++) {
    const url = `${site}/wp-json/wp/v2/${endpoint}?per_page=100&page=${page}&_fields=${fields}&status=publish`
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

// POST /import/scan — preview only (no writes)
importRouter.post('/scan', requireAuth, async (req, res) => {
  if (!req.body?.url) return res.status(400).json({ ok: false, error: 'url required' })
  try {
    res.json({ ok: true, data: await scanSite(req.body.url) })
  } catch {
    res.status(502).json({ ok: false, error: 'Could not scan site — is it WordPress with the REST API enabled?' })
  }
})

// POST /import/commit — scan + persist pages + redirects into a workspace
importRouter.post('/commit', requireAuth, async (req: AuthRequest, res) => {
  const { slug, url } = req.body ?? {}
  if (!slug || !url) return res.status(400).json({ ok: false, error: 'slug and url required' })

  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, req.user!.accountId))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })

  let scan
  try { scan = await scanSite(url) }
  catch { return res.status(502).json({ ok: false, error: 'Could not scan site — is it WordPress with the REST API enabled?' }) }

  const existing = new Set(
    (await db.select({ slug: pages.slug }).from(pages).where(eq(pages.workspaceId, ws.id))).map((r) => r.slug),
  )

  let created = 0, skipped = 0
  for (const item of scan.items) {
    const type = toPageType(item.type)
    if (!type) { skipped++; continue }
    const pslug = slugFromPath(item.path)
    if (existing.has(pslug)) { skipped++; continue }
    existing.add(pslug)
    await db.insert(pages).values({
      workspaceId: ws.id, type: type as any, slug: pslug,
      title: item.title || pslug, status: 'draft', blocks: starterBlocks(item.title) as any,
    })
    created++
  }

  let redirectCount = 0
  for (const r of scan.redirects) {
    await db.insert(redirects).values({ workspaceId: ws.id, fromPath: r.from, toPath: r.to, code: r.code })
    redirectCount++
  }

  res.json({ ok: true, data: { created, skipped, redirects: redirectCount, total: scan.total, slug: ws.slug } })
})
