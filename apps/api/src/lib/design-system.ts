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

export type ParsedDesignSystem = {
  tokens: any
  logoUrl: string | null           // resolved (absolute) source URL of the logo
  logoAlt: string
  sampleLandingHtml: string | null // the SAMPLE LANDING region, for sectionizing
  fontFaces: Array<{ family: string; srcUrl: string; format?: string }>  // custom @font-face to self-host
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

  const tokens = {
    color: { primary, accent, surface, text },
    font: { heading, body, scale: 1.3, lineHeight: 1.6 },
    shape: { buttonRadius: '999px', cardRadius: '20px', borderWidth: '2px' },
    space: { sectionGap: '80px', sectionPaddingY: '72px', container: '1180px' },
  }
  return { tokens, logoUrl, logoAlt, sampleLandingHtml, fontFaces: faces }
}
