// Design-system importer — parse a clean, self-contained design-system HTML
// document (like the Kids.ro export) into brand tokens + a home page. This is
// the RELIABLE import path: the input is an intentional brief (inline styles,
// bundled assets, a SAMPLE LANDING) rather than a scraped live site.
//
// The doc has two halves we care about:
//   - the design-system sections (COLORS / TYPOGRAPHY / …) → drive brand tokens
//   - a SAMPLE LANDING section → becomes the workspace home page

type Rgb = [number, number, number]
function toRgb(h: string): Rgb | null {
  let s = h.trim().toLowerCase()
  const rgb = s.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]]
  if (s[0] === '#') s = s.slice(1)
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/.test(s)) return null
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}
function lum(c: Rgb): number { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 }
function sat(c: Rgb): number { const mx = Math.max(...c), mn = Math.min(...c); return mx === 0 ? 0 : (mx - mn) / mx }
function isNeutral(hex: string): boolean {
  const c = toRgb(hex); if (!c) return true
  return lum(c) > 0.92 || lum(c) < 0.05 || sat(c) < 0.16
}
// crude hue for distinctness comparison
function hue(c: Rgb): number {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  if (d === 0) return 0
  let h = 0
  if (mx === r) h = ((g - b) / d) % 6
  else if (mx === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (h * 60 + 360) % 360
}

export type NavNode = { text: string; href: string; children?: NavNode[] }
export type ParsedDesignSystem = {
  tokens: any
  logoUrl: string | null           // resolved (absolute) source URL of the logo
  logoAlt: string
  sampleLandingHtml: string | null // the SAMPLE LANDING region, for sectionizing
  fontFaces: Array<{ family: string; srcUrl: string; format?: string }>  // custom @font-face to self-host
  navTree: NavNode[]               // header navigation, with dropdown children
  cta: { label: string; href: string } | null  // primary header button
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/[▾▸▼⌄►▶◀◄▴▵▿☰]/g, '')  // drop decorative dropdown carets / menu glyphs
    .replace(/\s+/g, ' ').trim()
}

// Split a fragment into its top-level element nodes, respecting nesting depth.
// Used to walk a <nav>'s direct children (dropdown groups vs bare links).
function splitTopLevel(html: string): string[] {
  const nodes: string[] = []
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
  const voids = new Set(['img', 'br', 'input', 'hr', 'meta', 'source', 'path', 'circle', 'rect', 'use'])
  let depth = 0, start = -1, m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    const selfClose = m[4] === '/' || voids.has(tag)
    if (selfClose) continue
    if (!closing) { if (depth === 0) start = m.index; depth++ }
    else { depth--; if (depth === 0 && start >= 0) { nodes.push(html.slice(start, m.index + m[0].length)); start = -1 } }
  }
  return nodes
}

// Parse the header navigation into a tree. Handles the Claude-Design markup
// (a `.navitem` container holding a trigger <a> + a `.dropdown` panel of child
// links) as well as plain top-level <a> links. sc-if/{{…}} template tags are
// stripped first so the structure is plain HTML.
export function parseNavTree(html: string): { navTree: NavNode[]; cta: { label: string; href: string } | null } {
  const header = html.match(/<header[\s\S]*?<\/header>/i)?.[0] || ''
  const region = header
    .replace(/<\/?sc-[a-z-]+[^>]*>/gi, '')
    .replace(/\{\{[^}]*\}\}/g, '')
  const navInner = region.match(/<nav[^>]*>([\s\S]*?)<\/nav>/i)?.[1]
  const navTree: NavNode[] = []
  if (navInner) {
    for (const node of splitTopLevel(navInner)) {
      const trimmed = node.trim()
      const firstA = trimmed.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i)
      if (!firstA) continue
      const text = stripTags(firstA[2])
      if (!text) continue
      const href = firstA[1] || '#'
      if (/^<a\b/i.test(trimmed)) { navTree.push({ text, href }); continue }
      // container → collect child links from the dropdown panel
      const panel = trimmed.match(/<div[^>]*class=["'][^"']*(?:dropdown|submenu|sub-menu|mega)[^"']*["'][^>]*>([\s\S]*)$/i)
      const scope = panel ? panel[1] : trimmed
      const children: NavNode[] = []
      for (const cm of scope.matchAll(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const ct = stripTags(cm[2])
        if (ct && ct !== text) children.push({ text: ct, href: cm[1] || '#' })
      }
      navTree.push(children.length ? { text, href, children } : { text, href })
    }
  }
  // Primary CTA = first header <button> (or a .btn-styled link) label.
  const btn = region.match(/<button[^>]*>([\s\S]*?)<\/button>/i)
  const ctaLabel = btn ? stripTags(btn[1]) : ''
  const cta = ctaLabel ? { label: ctaLabel, href: '#' } : null
  return { navTree, cta }
}

function absolutize(url: string, base: string): string {
  if (!url) return url
  if (/^(https?:|data:)/i.test(url)) return url
  try { return new URL(url, base.endsWith('/') ? base : base + '/').toString() } catch { return url }
}

// Extract the region of HTML that follows a `<!-- ... NAME ... -->` marker up
// to the next section marker (or end).
function regionAfterMarker(html: string, name: string): string | null {
  const markers = [...html.matchAll(/<!--\s*=+\s*([A-Z &]+?)\s*=+\s*-->/g)]
  for (let i = 0; i < markers.length; i++) {
    if (markers[i][1].trim().toUpperCase().includes(name.toUpperCase())) {
      const start = markers[i].index! + markers[i][0].length
      const end = i + 1 < markers.length ? markers[i + 1].index! : html.length
      return html.slice(start, end)
    }
  }
  return null
}

// Preprocess a Claude-Design landing page for import: strip its template tags
// (<sc-if>/{{…}}) and turn <image-slot> placeholders into fillable image
// placeholders that carry the slot id + caption (so we can later fill them
// with an uploaded/stock/generated image, targeted by [data-slot-id]).
export function preprocessLandingHtml(html: string): string {
  let s = html
  // Claude-Design conditionals/loops — keep inner content, drop the wrapper.
  s = s.replace(/<\/?sc-(?:if|for|each|show|else|slot)[^>]*>/gi, '')
  s = s.replace(/<sc-[a-z-]+[^>]*\/>/gi, '')
  // Mustache expressions → empty.
  s = s.replace(/\{\{[^}]*\}\}/g, '')
  const slotDiv = (attrs: string) => {
    const id = attrs.match(/id=["']([^"']+)["']/)?.[1] || ''
    const cap = attrs.match(/placeholder=["']([^"']+)["']/)?.[1] || 'Imagine'
    const src = attrs.match(/src=["']([^"']+)["']/)?.[1]
    if (src) return `<img data-slot-id="${id}" src="${src}" alt="${cap}" style="width:100%;height:100%;object-fit:cover;display:block;">`
    return `<div class="uw-img-slot" data-slot-id="${id}" data-caption="${cap}" style="width:100%;height:100%;min-height:180px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 50%,#fff),color-mix(in srgb,var(--primary) 40%,#fff));color:#4a2a6a;font-size:13px;font-weight:600;text-align:center;padding:16px;">${cap}</div>`
  }
  s = s.replace(/<image-slot([^>]*)>[\s\S]*?<\/image-slot>/gi, (_m, a) => slotDiv(a))
  s = s.replace(/<image-slot([^>]*)\/>/gi, (_m, a) => slotDiv(a))
  return s
}

export function parseDesignSystem(html: string, assetsBaseUrl: string): ParsedDesignSystem {
  // ---- Colors ----
  // surface + text come from the body{} rule; primary/accent from frequency of
  // saturated non-neutral hexes across the whole doc.
  const bodyRule = html.match(/body\s*\{[^}]*\}/i)?.[0] || ''
  const surface = bodyRule.match(/background\s*:\s*(#[0-9a-f]{3,6})/i)?.[1] || '#FFFFFF'
  const text = bodyRule.match(/color\s*:\s*(#[0-9a-f]{3,6})/i)?.[1] || '#16242E'

  // Score = frequency × saturation^1.5. Pure frequency picks the soft-text grey
  // (used in every paragraph); weighting by saturation surfaces the real brand
  // colors. Buttons/CTA backgrounds get an extra boost since the primary is
  // almost always a button fill.
  const btnColors = new Set<string>()
  for (const m of html.matchAll(/(?:background(?:-color)?)\s*:\s*(#[0-9a-fA-F]{6})/gi)) btnColors.add(m[1].toUpperCase())
  const score: Record<string, number> = {}
  for (const m of html.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
    const hex = m[0].toUpperCase()
    if (isNeutral(hex)) continue
    const c = toRgb(hex)!
    const w = Math.pow(sat(c), 1.5) * (btnColors.has(hex) ? 2.2 : 1)
    score[hex] = (score[hex] || 0) + w
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]).map(([h]) => h)
  const primary = ranked[0] || '#16324A'
  // accent = highest-scored color with a hue distinct enough from primary
  const pHue = toRgb(primary) ? hue(toRgb(primary)!) : 0
  const accent = ranked.find((h) => { const c = toRgb(h); return c && Math.abs(((hue(c) - pHue + 540) % 360) - 180) > 40 }) || ranked[1] || '#8FD7F1'

  // ---- Fonts ----
  const faces: ParsedDesignSystem['fontFaces'] = []
  for (const m of html.matchAll(/@font-face\s*\{[^}]*\}/gi)) {
    const block = m[0]
    const fam = block.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/i)?.[1]?.trim()
    const src = block.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i)?.[1]
    const fmt = block.match(/format\(\s*['"]?([^'")]+)['"]?\s*\)/i)?.[1]
    if (fam && src) faces.push({ family: fam, srcUrl: absolutize(src, assetsBaseUrl), format: fmt })
  }
  // heading font = font-family on the first <h1>; body = body{} font-family
  const h1Fam = html.match(/<h1[^>]*font-family\s*:\s*([^;"']+)/i)?.[1]?.split(',')[0].replace(/['"]/g, '').trim()
  const bodyFam = bodyRule.match(/font-family\s*:\s*([^;}]+)/i)?.[1]?.split(',')[0].replace(/['"]/g, '').trim()
  const heading = h1Fam || bodyFam || 'Inter'
  const body = bodyFam || 'Inter'

  // ---- Logo ---- prefer the cover <img> (top of doc)
  let logoUrl: string | null = null, logoAlt = ''
  const logoImg = html.match(/<img[^>]+src=["']([^"']*(?:logo|kids|brand)[^"']*\.(?:svg|png))["'][^>]*>/i)
    || html.match(/<img[^>]+src=["']([^"']+\.svg)["'][^>]*>/i)
  if (logoImg) { logoUrl = absolutize(logoImg[1], assetsBaseUrl); logoAlt = logoImg[0].match(/alt=["']([^"']*)["']/i)?.[1] || '' }

  // ---- Sample landing ----
  const sampleLandingHtml = regionAfterMarker(html, 'SAMPLE LANDING')

  // ---- Navigation (header menu with dropdowns) ---- prefer the sample landing
  // (a real page header); fall back to the whole doc.
  const { navTree, cta } = parseNavTree(sampleLandingHtml || html)

  const tokens = {
    color: { primary, accent, surface, text },
    font: { heading, body, scale: 1.3, lineHeight: 1.6 },
    shape: { buttonRadius: '999px', cardRadius: '20px', borderWidth: '2px' },
    space: { sectionGap: '80px', sectionPaddingY: '72px', container: '1180px' },
  }
  return { tokens, logoUrl, logoAlt, sampleLandingHtml, fontFaces: faces, navTree, cta }
}
