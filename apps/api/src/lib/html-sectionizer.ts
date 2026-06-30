// HTML Sectionizer — takes a rendered page's HTML and splits it into
// "raw-html" sections that we can store as blocks. The goal: pixel-faithful
// import from Elementor / WordPress sites, with colors+fonts swapped to brand
// tokens and images mirrored to our own host. Result is editable per-section
// (rewrite, AI-polish, convert to typed section) while preserving the visual
// fidelity the user already paid for.
//
// This module is deliberately dependency-light (regex-based) so it has no
// runtime cost compared to spinning up a headless browser. The regexes are
// good enough for Elementor's flat-section layouts; we degrade to "one big
// section" for anything we can't recognise.

import type { ImageMirror } from './image-host.js'

type SectionizeOpts = {
  // The page's URL — used to resolve relative paths in src/href to absolute.
  baseUrl: string
  // The brand primary/accent colors detected from the source site (hex).
  // Any inline style or class declaration that matches one of these gets
  // rewritten to var(--primary) / var(--accent) so the workspace's branding
  // tokens reskin the whole imported site.
  brandColors?: { primary?: string | null; accent?: string | null; secondary?: string | null }
  // The brand fonts detected from the source site. Same idea — rewrite to
  // var(--heading-font) / var(--body-font). NOT yet used by the publisher CSS
  // (it inlines the actual family) but kept here for future use.
  brandFonts?: { heading?: string | null; body?: string | null }
  // Optional image mirror — when present, each <img src> and background-image
  // is downloaded into the workspace's local /img dir and the URL is rewritten
  // to the local path. Skipped if null (URLs stay as-is).
  imageMirror?: ImageMirror | null
}

export type RawSection = { html: string; sourceLabel?: string }

// Pull just the <body> contents from a full HTML document (or return the
// input unchanged if there's no body tag — for fragments).
function extractBody(html: string): string {
  const m = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  return m ? m[1] : html
}

// Strip elements that can't survive an import: scripts, noscripts, link/preload,
// style tags (the sectionizer assumes the section CARRIES enough inline-style
// to render alone — global stylesheet rules wouldn't reach us). Also strip
// common Elementor instrumentation.
function stripUnsafe(html: string): string {
  let s = html
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<link\b[^>]*\/?>/gi, '')
  s = s.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')   // YT, ads, embeds — replace later with placeholder if needed
  s = s.replace(/\son\w+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '')  // strip inline event handlers (onclick, onerror, etc)
  return s
}

// Resolve all relative URLs in href/src/srcset/background-image to absolute,
// using the page's base URL. Anything already http(s) or data:/ stays.
function absolutizeUrls(html: string, baseUrl: string): string {
  let s = html
  const base = (() => {
    try { return new URL(baseUrl) } catch { return null }
  })()
  if (!base) return s
  const abs = (u: string) => {
    try { return new URL(u, base).toString() } catch { return u }
  }
  s = s.replace(/(href|src|action|data-src|data-lazy-src|poster)\s*=\s*"([^"]+)"/gi, (_m, attr, url) => `${attr}="${abs(url)}"`)
  s = s.replace(/(href|src|action|data-src|data-lazy-src|poster)\s*=\s*'([^']+)'/gi, (_m, attr, url) => `${attr}='${abs(url)}'`)
  s = s.replace(/srcset\s*=\s*"([^"]+)"/gi, (_m, val) => {
    const parts = String(val).split(',').map((p) => {
      const trimmed = p.trim()
      const [u, descriptor] = trimmed.split(/\s+/, 2)
      return [abs(u), descriptor].filter(Boolean).join(' ')
    })
    return `srcset="${parts.join(', ')}"`
  })
  s = s.replace(/background(-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi, (_m, suf, url) => `background${suf || ''}:url("${abs(url)}")`)
  return s
}

// Replace occurrences of brand colors (hex, in any case) with CSS variables.
// We match the hex anywhere (style="color:#F9B716", style="background:#F9B716",
// rgb(249,183,22), etc — for now hex only). Same hex with different cases or
// 3-digit forms are normalised first.
function normaliseHex(h: string): string {
  let v = h.toLowerCase()
  if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]
  return v
}
function rewriteBrandColors(html: string, colors: SectionizeOpts['brandColors']): string {
  if (!colors) return html
  const map: Array<[string, string]> = []
  if (colors.primary) map.push([normaliseHex(colors.primary), 'var(--primary)'])
  if (colors.accent) map.push([normaliseHex(colors.accent), 'var(--accent)'])
  if (colors.secondary) map.push([normaliseHex(colors.secondary), 'var(--accent)'])  // collapse secondary→accent for now
  if (!map.length) return html
  let s = html
  for (const [hex, replacement] of map) {
    // Match #rrggbb (case-insensitive). Use a word-boundary on the left to
    // avoid catching unrelated # references; the right side ends naturally.
    const re = new RegExp('(?<![\\w])' + hex.replace('#', '#') + '(?![0-9a-fA-F])', 'gi')
    s = s.replace(re, replacement)
  }
  return s
}

// Replace brand fonts in inline style font-family declarations. Less common
// than colors (most sites use a small number of fonts site-wide) but worth
// catching so font swaps in the branding panel cascade.
function rewriteBrandFonts(html: string, fonts: SectionizeOpts['brandFonts']): string {
  if (!fonts) return html
  let s = html
  if (fonts.heading) {
    const name = fonts.heading.replace(/['"]/g, '')
    const re = new RegExp(`font-family\\s*:\\s*['\"]?${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['\"]?[^;'\"}]*`, 'gi')
    s = s.replace(re, 'font-family:var(--heading-font, inherit)')
  }
  if (fonts.body) {
    const name = fonts.body.replace(/['"]/g, '')
    const re = new RegExp(`font-family\\s*:\\s*['\"]?${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}['\"]?[^;'\"}]*`, 'gi')
    s = s.replace(re, 'font-family:var(--body-font, inherit)')
  }
  return s
}

// Walk every <img src> and background-image:url() through the mirror so all
// images on the imported page resolve to our own host. Same idea for srcset.
async function mirrorImages(html: string, mirror: ImageMirror): Promise<string> {
  // Collect candidate URLs first (so we don't trip over async inside replace).
  const urls = new Set<string>()
  for (const m of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) urls.add(m[1])
  for (const m of html.matchAll(/srcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of m[1].split(',')) {
      const u = part.trim().split(/\s+/)[0]
      if (u) urls.add(u)
    }
  }
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(["']?([^"')]+)["']?\)/gi)) urls.add(m[1])

  // Run all mirrors in parallel (mirror itself has a per-URL cache so dupes
  // are free; concurrency is bounded by the source server's TCP limits).
  const remap = new Map<string, string>()
  await Promise.all([...urls].map(async (u) => {
    const local = await mirror.mirror(u)
    if (local) remap.set(u, local)
  }))

  let s = html
  for (const [from, to] of remap) {
    // Escape from-url so the regex matches the literal string; replace all occurrences.
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    s = s.replace(re, to)
  }
  return s
}

// Try to find the page's top-level visual sections, in priority order:
//   1. Elementor: section[data-element_type="section"] OR .elementor-top-section
//   2. WordPress block theme: <section> tags at top level
//   3. Generic: <section>, <article> at top level
//   4. Last resort: split on <h2> as a rough section divider
// Returns the matched outer HTML for each section. We assume the input has
// been passed through extractBody() already.
function findSections(bodyHtml: string): { html: string; label?: string }[] {
  const out: { html: string; label?: string }[] = []

  // 1. Elementor with the data-element_type attribute (works on any theme)
  const elementorRe = /<section\b[^>]*data-element_type=["']section["'][^>]*>[\s\S]*?<\/section>/gi
  for (const m of bodyHtml.matchAll(elementorRe)) {
    const id = m[0].match(/data-id=["']([^"']+)["']/)?.[1]
    out.push({ html: m[0], label: id ? `Elementor section ${id}` : 'Elementor section' })
  }
  if (out.length >= 1) return out

  // 2. Elementor with the class-based selector (older themes)
  const elClassRe = /<section\b[^>]*class=["'][^"']*elementor-(?:top-)?section[^"']*["'][^>]*>[\s\S]*?<\/section>/gi
  for (const m of bodyHtml.matchAll(elClassRe)) out.push({ html: m[0], label: 'Elementor section' })
  if (out.length >= 1) return out

  // 3. Generic top-level <section> / <article>
  const sectionRe = /<(section|article)\b[^>]*>[\s\S]*?<\/\1>/gi
  for (const m of bodyHtml.matchAll(sectionRe)) out.push({ html: m[0], label: `${m[1]} block` })
  if (out.length >= 1) return out

  // 4. Last resort — one giant section
  return [{ html: `<section>${bodyHtml}</section>`, label: 'Full page' }]
}

export async function sectionizeHtml(html: string, opts: SectionizeOpts): Promise<RawSection[]> {
  const body = extractBody(html)
  const safe = stripUnsafe(body)
  const absolute = absolutizeUrls(safe, opts.baseUrl)
  const sections = findSections(absolute)

  const out: RawSection[] = []
  for (const s of sections) {
    let chunk = s.html
    chunk = rewriteBrandColors(chunk, opts.brandColors)
    chunk = rewriteBrandFonts(chunk, opts.brandFonts)
    if (opts.imageMirror) chunk = await mirrorImages(chunk, opts.imageMirror)
    // Add an onerror handler to every <img> so broken images vanish instead
    // of showing the browser's broken-icon. The CSS in sections.ts hides
    // [data-broken="1"] images for the same reason on SSR.
    chunk = chunk.replace(/<img\b/gi, '<img onerror="this.setAttribute(\'data-broken\',\'1\')"')
    out.push({ html: chunk, sourceLabel: s.label })
  }
  return out
}
