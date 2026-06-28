import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'

// Importer scan — TS port of the Phase-0 spike. Pulls a WordPress site via the
// public REST API, classifies every URL into the page-type taxonomy, and
// proposes 301 redirects for dropped/junk pages. Read-only; no DB writes yet.
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

function pathOf(link: string): string {
  try { return new URL(link).pathname || '/' } catch { return '/' }
}

function classify(slug: string, title: string, link: string, parent: number): { type: string; confidence: number; note: string } {
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
  if (hit(KW.commerce)) return { type: 'commerce', confidence: 0.9, note: 'woocommerce/functional — likely dropped' }
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

async function fetchAll(site: string, endpoint: string, fields: string): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; page <= 20; page++) {
    const url = `${site}/wp-json/wp/v2/${endpoint}?per_page=100&page=${page}&_fields=${fields}&status=publish`
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (r.status === 400) break // past last page
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = (await r.json()) as any[]
    if (!data.length) break
    out.push(...data)
    const totalPages = parseInt(r.headers.get('x-wp-totalpages') || '1', 10)
    if (page >= totalPages) break
  }
  return out
}

importRouter.post('/scan', requireAuth, async (req, res) => {
  let { url } = req.body ?? {}
  if (!url) return res.status(400).json({ ok: false, error: 'url required' })
  const site = String(url).trim().replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://')

  try {
    const [pages, posts, cats] = await Promise.all([
      fetchAll(site, 'pages', 'id,slug,link,title,parent,status'),
      fetchAll(site, 'posts', 'id,slug,link,title,status'),
      fetchAll(site, 'categories', 'id,slug,link,name,count'),
    ])

    const items: any[] = []
    const counts: Record<string, number> = {}
    const bump = (t: string) => { counts[t] = (counts[t] || 0) + 1 }

    for (const p of pages) {
      const title = p.title?.rendered ?? ''
      const c = classify(p.slug ?? '', title, p.link ?? '', p.parent ?? 0)
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

    const redirects = items
      .filter((i) => i.type === 'commerce' || JUNK.has(i.slug) || JUNK.has(i.path.replace(/^\/|\/$/g, '')))
      .map((i) => ({ from: i.path, to: '/', code: 301, reason: i.type === 'commerce' ? 'WooCommerce/functional page dropped' : 'staging/duplicate page' }))

    items.sort((a, b) => (a.type + a.path).localeCompare(b.type + b.path))
    res.json({ ok: true, data: { site, total: items.length, counts, redirects, items } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Could not scan site — is it WordPress with the REST API enabled?' })
  }
})
