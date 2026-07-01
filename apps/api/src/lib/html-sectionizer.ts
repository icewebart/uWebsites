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
  // When a headless render already captured every stylesheet the browser
  // loaded, pass them here so we skip the (less reliable) re-fetch path. Both
  // external + inline blocks are accepted. Provided in render order; we
  // concatenate verbatim.
  preloadedStylesheets?: Array<{ href: string; css: string }>
  preloadedInlineStyles?: string
  // Sections already split by the headless DOM query (handles nested container
  // layouts regex can't). When present, we use these instead of regex findSections.
  preSplitSections?: string[]
}

export type RawSection = { html: string; sourceLabel?: string }

// Pull just the <body> contents from a full HTML document (or return the
// input unchanged if there's no body tag — for fragments).
function extractBody(html: string): string {
  const m = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
  return m ? m[1] : html
}

// Strip elements that genuinely can't survive an import: scripts, iframes,
// inline event handlers, link/style tags (we re-inline cleaned CSS separately).
// NOTE: <style> blocks get removed here AFTER we've extracted their contents
// in collectInlineStyles(). Class names stay on the elements so the inlined
// CSS can target them.
function stripUnsafe(html: string): string {
  let s = html
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<link\b[^>]*\/?>/gi, '')
  s = s.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
  s = s.replace(/\son\w+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  return s
}

// Pull every <style> block's contents out of the raw HTML BEFORE stripUnsafe
// erases them. These hold the inline rules (especially Elementor's
// per-post CSS embedded in the head).
function collectInlineStyles(html: string): string {
  let css = ''
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css += m[1] + '\n'
  return css
}

// Collect <link rel="stylesheet"> hrefs from the raw HTML; we'll fetch each
// one and concatenate its contents into the section's inline CSS. We cap the
// number of stylesheets so a runaway WP install with 40+ CSS files can't
// blow our budget — we skip WooCommerce and font-awesome by default since
// they bloat the output without adding layout signal.
function collectStylesheetHrefs(html: string, baseUrl: string): string[] {
  const out: string[] = []
  const matches = Array.from(html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi))
  for (const m of matches) {
    const raw = m[1]
    if (/woocommerce|font-awesome|jet-elements|wc-blocks|smallscreen/i.test(raw)) continue
    try { out.push(new URL(raw, baseUrl).toString()) } catch { /* skip */ }
  }
  return out.slice(0, 12)  // sanity cap
}

// Fetch a list of stylesheets and return the concatenated CSS. Each file is
// capped at 250KB and the total at 800KB to avoid embedding mountains of CSS
// on every saved block.
async function fetchAndConcatCss(urls: string[], ua: string): Promise<string> {
  const out: string[] = []
  let totalLen = 0
  for (const u of urls) {
    if (totalLen > 800_000) break
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 8_000)
      const r = await fetch(u, { headers: { 'User-Agent': ua }, signal: ctrl.signal })
      clearTimeout(t)
      if (!r.ok) continue
      const txt = (await r.text()).slice(0, 250_000)
      // Resolve relative URLs INSIDE the CSS (background-image:url(...), @import)
      // against the CSS file's own URL.
      const cssBase = u
      const resolved = txt.replace(/url\(["']?([^"')]+)["']?\)/gi, (_m, p) => {
        try { return `url("${new URL(p, cssBase).toString()}")` } catch { return _m }
      })
      out.push(`/* ${u} */\n${resolved}`)
      totalLen += resolved.length
    } catch { /* skip */ }
  }
  return out.join('\n\n')
}

const UA = 'Mozilla/5.0 (compatible; uWebsitesImporter/1.0)'

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
  // 1. CSS strategy depends on whether the caller pre-loaded stylesheets (the
  //    headless render path) or not (raw-fetch fallback).
  let allCss = ''
  if (opts.preloadedStylesheets && opts.preloadedStylesheets.length) {
    // Headless render gave us EXACTLY the stylesheets the browser used —
    // includes Elementor's post-N.css, theme CSS, and any JS-injected styles
    // captured as text/css responses. Skip the WP defaults that bloat without
    // adding layout signal.
    const skip = /wp-emoji|wp-block-library|classic-themes|woocommerce|font-awesome|wc-blocks|smallscreen/i
    const useful = opts.preloadedStylesheets.filter((s) => !skip.test(s.href))
    allCss = useful.map((s) => `/* ${s.href} */\n${s.css}`).join('\n\n')
    if (opts.preloadedInlineStyles) allCss += '\n\n' + opts.preloadedInlineStyles
  } else {
    // Raw-fetch fallback (no headless render): try the link tags in the HTML.
    // Less reliable for JS-driven sites but cheap.
    const inlineCss = collectInlineStyles(html)
    const sheetUrls = collectStylesheetHrefs(html, opts.baseUrl)
    const externalCss = await fetchAndConcatCss(sheetUrls, UA)
    allCss = `${inlineCss}\n${externalCss}`
  }

  // Apply the same brand-token rewrites to the CSS itself, so .my-button
  // { color: #F9B716 } becomes color: var(--primary) and the workspace's
  // primary takes over wherever it's painted.
  allCss = rewriteBrandColors(allCss, opts.brandColors)
  allCss = rewriteBrandFonts(allCss, opts.brandFonts)
  // Mirror background-image:url() references inside the CSS so they don't
  // hotlink either.
  if (opts.imageMirror) allCss = await mirrorImages(allCss, opts.imageMirror)

  // 2. Strip + absolutise + sectionize the body. Prefer the DOM-split sections
  // from the headless render (handles nested Elementor containers); fall back
  // to regex findSections over the body.
  const sections = (opts.preSplitSections && opts.preSplitSections.length >= 2)
    ? opts.preSplitSections.map((h, i) => ({ html: h, label: `Section ${i + 1}` }))
    : findSections(absolutizeUrls(stripUnsafe(extractBody(html)), opts.baseUrl))

  const usingPreSplit = !!(opts.preSplitSections && opts.preSplitSections.length >= 2)
  const out: RawSection[] = []
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]
    let chunk = s.html
    // DOM-split chunks are raw outerHTML — sanitise + absolutise them here
    // (the regex path already did this on the whole body).
    if (usingPreSplit) {
      chunk = absolutizeUrls(stripUnsafe(chunk), opts.baseUrl)
    }
    // Strip leaked server-side PHP notices/warnings that some WP sites emit
    // into the page ("Warning: Undefined array key … on line 1788").
    chunk = chunk.replace(/(?:Notice|Warning|Deprecated|Fatal error)\s*:.*?on line\s*\d+/gi, '')
    chunk = rewriteBrandColors(chunk, opts.brandColors)
    chunk = rewriteBrandFonts(chunk, opts.brandFonts)
    if (opts.imageMirror) chunk = await mirrorImages(chunk, opts.imageMirror)
    chunk = chunk.replace(/<img\b/gi, '<img onerror="this.setAttribute(\'data-broken\',\'1\')"')

    // Inline the collected CSS at the top of the FIRST section only — it's
    // global to the whole imported page. Cheap and effective; modern browsers
    // dedupe identical <style> blocks anyway if other sections did the same.
    if (i === 0 && allCss.trim()) {
      chunk = `<style>${allCss}</style>${chunk}`
    }
    out.push({ html: chunk, sourceLabel: s.label })
  }
  return out
}
