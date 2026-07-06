import { chromium, type Browser, type BrowserContext } from 'playwright'

// Headless render — opens a URL in a real Chromium, waits for fonts/network
// idle / lazy-loaders, then returns the fully-rendered HTML AND every
// stylesheet that was actually loaded. This is the input the sectionizer
// needs to produce a faithful import: Elementor's JS-driven classes,
// data-lazy-src images, dynamic CSS — all resolved.
//
// One global browser instance shared across requests (cheap to keep around;
// expensive to relaunch). One page at a time per request (Chromium is fine
// with concurrent pages but our memory budget on the VPS prefers serial).

let browser: Browser | null = null
let launching: Promise<Browser> | null = null
let mutex: Promise<void> = Promise.resolve()

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser
  if (launching) return launching
  launching = chromium.launch({
    headless: true,
    // Production-safe defaults — no sandbox in containers, dev/shm size capped
    // to avoid /dev/shm exhaustion on small VPS instances.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  }).then((b) => {
    browser = b
    launching = null
    b.on('disconnected', () => { browser = null })
    return b
  }).catch((e) => { launching = null; throw e })
  return launching
}

// Structural fingerprint of one top-level section — computed IN the browser
// where we have a real DOM + geometry + computed styles. The deterministic
// section-classifier (lib/section-classifier.ts) reads this to decide which
// semantic section kind the block is, WITHOUT any AI. Rich enough that the
// classifier rarely needs to re-parse the HTML.
export type SectionFP = {
  tag: string
  id: string
  classes: string
  index: number
  isFirst: boolean
  rect: { w: number; h: number; top: number }
  bg: { color: string; hasImage: boolean; imageUrl: string }
  kicker: string           // small text above the heading (eyebrow)
  heading: string          // the section's primary heading text
  deck: string             // first substantial paragraph
  counts: { img: number; heading: number; p: number; li: number; a: number; button: number; blockquote: number; icon: number }
  row: { kind: 'grid' | 'flex' | 'stack'; cols: number }
  cards: Array<{ heading: string; text: string; imgUrl: string; imgAlt: string; icon: boolean; href: string; label: string }>
  buttons: Array<{ label: string; href: string }>
  images: Array<{ url: string; alt: string; w: number; h: number }>
  stats: Array<{ value: string; label: string }>
  faqs: Array<{ q: string; a: string }>
  listItems: string[]
  numbered: boolean
  textLen: number
}
export type CapturedSection = { html: string; fp: SectionFP }

export type HeadlessResult = {
  finalUrl: string                              // after any redirects
  html: string                                  // full document HTML after render
  stylesheets: { href: string; css: string }[]  // every loaded external stylesheet
  inlineStyles: string                          // concatenated <style> blocks (after JS)
  resourceCount: number                         // count of all network responses (debug)
  capturedSections: CapturedSection[]           // top-level sections: outerHTML + fingerprint
}

// Render `url` with a real browser and return everything the sectionizer needs.
// Times out after 30s; resources are released even on failure.
export async function headlessRender(url: string): Promise<HeadlessResult> {
  // Mutex — serialize so we never have two concurrent renders on the same
  // small VPS. Memory budget rules over parallelism here.
  let release: () => void = () => {}
  const wait = new Promise<void>((r) => { release = r })
  const prev = mutex
  mutex = wait
  await prev

  let context: BrowserContext | null = null
  try {
    const b = await getBrowser()
    context = await b.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    })
    const page = await context.newPage()

    // Collect every successful CSS response. We do this VIA the network event
    // (rather than re-fetching stylesheets later) because some sites serve
    // different CSS to bots vs browsers — only the in-browser response is
    // guaranteed to match what the page actually used.
    const sheetByHref: Map<string, string> = new Map()
    let resourceCount = 0
    page.on('response', async (res) => {
      resourceCount++
      try {
        const ct = (res.headers()['content-type'] || '').split(';')[0].toLowerCase().trim()
        if (ct !== 'text/css') return
        const css = await res.text().catch(() => '')
        if (css) sheetByHref.set(res.url(), css)
      } catch { /* ignore */ }
    })

    // Try networkidle first (everything settled). Some pages with chat widgets
    // / analytics never go idle — fall back to domcontentloaded + a 4s nudge.
    let goError: Error | null = null
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
    } catch (e: any) {
      goError = e
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }) } catch { /* keep first error */ }
    }

    // Trigger lazy-load on images that use IntersectionObserver: scroll to the
    // bottom in steps so each comes into view. Cheap and broadly effective.
    await page.evaluate(async () => {
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
      const max = document.body.scrollHeight
      for (let y = 0; y < max; y += 800) { window.scrollTo(0, y); await sleep(120) }
      window.scrollTo(0, 0)
      await sleep(200)
    }).catch(() => {/* ignore */})

    // Rewrite lazy-load image attrs so the captured HTML has real src attributes.
    await page.evaluate(() => {
      document.querySelectorAll('img').forEach((img) => {
        const lazy = img.getAttribute('data-lazy-src') || img.getAttribute('data-src')
        if (lazy && !img.getAttribute('src')) img.setAttribute('src', lazy)
        const srcsetLazy = img.getAttribute('data-lazy-srcset') || img.getAttribute('data-srcset')
        if (srcsetLazy && !img.getAttribute('srcset')) img.setAttribute('srcset', srcsetLazy)
      })
    }).catch(() => {/* ignore */})

    const finalUrl = page.url()
    const html = await page.content()
    // Concatenate every <style> block currently in the DOM (after any JS-added
    // styles). Cap each at 250KB.
    const inlineStyles = await page.evaluate(() => {
      const out: string[] = []
      document.querySelectorAll('style').forEach((s) => out.push(s.textContent || ''))
      return out.join('\n').slice(0, 250_000)
    }).catch(() => '')

    const stylesheets = Array.from(sheetByHref.entries()).map(([href, css]) => ({ href, css: css.slice(0, 300_000) }))

    // Split the page into top-level visual sections IN THE BROWSER — a DOM query
    // handles nested <div> containers that regex can't. Covers newer Elementor
    // flexbox containers (data-element_type=container / e-parent), classic
    // Elementor sections, and generic <section>. Returns each block's outerHTML.
    const capturedSections = await page.evaluate(() => {
      // ---- in-browser helpers (self-contained; no outer scope) ----
      const clean = (s: string) => (s || '').replace(/\s+/g, ' ').trim()
      const abs = (u: string) => { try { return new URL(u, location.href).href } catch { return u } }
      const bestSrc = (img: HTMLImageElement): string => {
        const ss = img.getAttribute('srcset') || img.getAttribute('data-srcset')
        if (ss) {
          const parts = ss.split(',').map((x) => x.trim().split(/\s+/)).filter((p) => p[0])
          parts.sort((a, b) => (parseInt(b[1] || '0') - parseInt(a[1] || '0')))
          if (parts[0]) return abs(parts[0][0])
        }
        return abs(img.currentSrc || img.getAttribute('src') || '')
      }
      const rectOf = (el: Element) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + window.scrollY) } }
      const isVisible = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 30 && r.height > 12 && cs.display !== 'none' && cs.visibility !== 'hidden' }
      const headingOf = (el: Element): string => {
        const h = el.querySelector('h1,h2,h3,h4,h5,.elementor-heading-title,[class*="title" i]')
        return h ? clean((h as HTMLElement).innerText).slice(0, 140) : ''
      }
      const BTN_SEL = 'a.btn, a.button, a[class*="button" i], a[class*="btn" i], button, [role="button"], .elementor-button, .wp-block-button__link, .wp-element-button'
      const iconOf = (el: Element) => !!el.querySelector('svg, i[class*="icon" i], i[class*="fa-" i], .elementor-icon')

      // Find the child container that best looks like a row of equal-width
      // cards/columns (the strongest layout signal for features/cards/stats).
      const bestRow = (section: Element): { kind: 'grid' | 'flex' | 'stack'; cols: number; kids: Element[] } => {
        const cands: Element[] = [section, ...Array.from(section.querySelectorAll('*'))].filter((el) => {
          const d = getComputedStyle(el).display
          return d === 'flex' || d === 'grid' || d === 'inline-flex' || d === 'inline-grid'
        }).slice(0, 400)
        let best: { kind: 'grid' | 'flex' | 'stack'; cols: number; kids: Element[] } = { kind: 'stack', cols: 0, kids: [] }
        let bestScore = 0
        for (const el of cands) {
          const cs = getComputedStyle(el)
          const kids = Array.from(el.children).filter(isVisible)
          if (kids.length < 2) continue
          const tops = kids.map((k) => k.getBoundingClientRect().top)
          const sameRow = Math.max(...tops) - Math.min(...tops) < 80   // roughly aligned horizontally
          const widths = kids.map((k) => k.getBoundingClientRect().width)
          const avg = widths.reduce((a, b) => a + b, 0) / widths.length
          const equal = avg > 0 && widths.every((w) => Math.abs(w - avg) / avg < 0.35)
          if (!sameRow && cs.display !== 'grid') continue
          const kind = cs.display.includes('grid') ? 'grid' : 'flex'
          const score = kids.length + (equal ? 3 : 0) + (sameRow ? 2 : 0)
          if (score > bestScore) { bestScore = score; best = { kind, cols: kids.length, kids } }
        }
        return best
      }

      // Many card designs put the photo as a CSS background (Elementor,
      // WP themes) rather than an <img> — find the first background-image URL
      // on the card or a descendant so those images aren't lost.
      const bgUrlIn = (root: Element): string => {
        const els: Element[] = [root, ...Array.from(root.querySelectorAll('*')).slice(0, 80)]
        for (const el of els) {
          const bi = getComputedStyle(el).backgroundImage || ''
          if (/gradient/i.test(bi)) continue
          const m = bi.match(/url\(["']?([^"')]+)["']?\)/i)
          if (m) return abs(m[1])
        }
        return ''
      }
      const cardOf = (el: Element) => {
        const img = el.querySelector('img') as HTMLImageElement | null
        const p = el.querySelector('p, .elementor-text-editor, [class*="description" i]') as HTMLElement | null
        const a = el.querySelector('a[href]') as HTMLAnchorElement | null
        const imgUrl = img ? bestSrc(img) : bgUrlIn(el)
        return {
          heading: headingOf(el),
          text: p ? clean(p.innerText).slice(0, 400) : '',
          imgUrl,
          imgAlt: img ? (img.getAttribute('alt') || '') : '',
          icon: iconOf(el) && !imgUrl,
          href: a ? abs(a.getAttribute('href') || '') : '',
          label: a ? clean(a.innerText).slice(0, 40) : '',
        }
      }

      const statsOf = (section: Element) => {
        const out: { value: string; label: string }[] = []
        const leaves = Array.from(section.querySelectorAll('*')).filter((el) => el.children.length === 0)
        for (const el of leaves) {
          const t = clean((el as HTMLElement).innerText)
          if (t.length <= 8 && /^[€$£+]?\d[\d.,]*\s*[%+kKmM]?\+?$/.test(t)) {
            let label = ''
            const sib = el.nextElementSibling || el.parentElement?.nextElementSibling
            if (sib) label = clean((sib as HTMLElement).innerText).slice(0, 48)
            out.push({ value: t, label })
          }
          if (out.length >= 8) break
        }
        return out
      }

      const faqsOf = (section: Element) => {
        const out: { q: string; a: string }[] = []
        // details/summary
        section.querySelectorAll('details').forEach((d) => {
          const s = d.querySelector('summary')
          if (s) out.push({ q: clean(s.textContent || '').slice(0, 200), a: clean((d.textContent || '').replace(s.textContent || '', '')).slice(0, 800) })
        })
        // Elementor accordion / toggle
        const titles = section.querySelectorAll('.elementor-accordion-item .elementor-tab-title, .elementor-toggle-item .elementor-tab-title')
        titles.forEach((t) => {
          const item = t.closest('.elementor-accordion-item, .elementor-toggle-item')
          const content = item?.querySelector('.elementor-tab-content')
          if (content) out.push({ q: clean((t as HTMLElement).innerText).slice(0, 200), a: clean((content as HTMLElement).innerText).slice(0, 800) })
        })
        return out.slice(0, 12)
      }

      const bgOf = (el: Element) => {
        const cs = getComputedStyle(el)
        const bi = cs.backgroundImage || ''
        const m = bi.match(/url\(["']?([^"')]+)["']?\)/i)
        return { color: cs.backgroundColor || '', hasImage: !!m, imageUrl: m ? abs(m[1]) : '' }
      }

      const fpOf = (section: Element, index: number): SectionFP => {
        const imgs = Array.from(section.querySelectorAll('img')).filter(isVisible) as HTMLImageElement[]
        const buttons = Array.from(section.querySelectorAll(BTN_SEL)).slice(0, 8).map((b) => ({ label: clean((b as HTMLElement).innerText).slice(0, 40), href: abs((b as HTMLElement).getAttribute('href') || '') })).filter((b) => b.label)
        const row = bestRow(section)
        const heading = headingOf(section)
        // kicker = a short text node just before the heading
        let kicker = ''
        const hEl = section.querySelector('h1,h2,h3,.elementor-heading-title')
        if (hEl) {
          const prev = hEl.previousElementSibling || hEl.parentElement?.previousElementSibling
          if (prev) { const pt = clean((prev as HTMLElement).innerText); if (pt && pt.length < 40 && pt !== heading) kicker = pt }
        }
        const firstP = section.querySelector('p, .elementor-text-editor p, [class*="subtitle" i]')
        const deck = firstP ? clean((firstP as HTMLElement).innerText).slice(0, 260) : ''
        const cards = row.cols >= 2 ? row.kids.slice(0, 8).map(cardOf) : []
        const lists = Array.from(section.querySelectorAll('li')).slice(0, 20).map((li) => clean((li as HTMLElement).innerText)).filter(Boolean)
        return {
          tag: section.tagName.toLowerCase(),
          id: section.id || '',
          classes: (section.getAttribute('class') || '').slice(0, 200),
          index, isFirst: index === 0,
          rect: rectOf(section),
          bg: bgOf(section),
          kicker, heading, deck,
          counts: {
            img: imgs.length,
            heading: section.querySelectorAll('h1,h2,h3,h4').length,
            p: section.querySelectorAll('p').length,
            li: section.querySelectorAll('li').length,
            a: section.querySelectorAll('a').length,
            button: buttons.length,
            blockquote: section.querySelectorAll('blockquote').length,
            icon: section.querySelectorAll('svg, i[class*="icon" i], .elementor-icon').length,
          },
          row: { kind: row.kind, cols: row.cols },
          cards,
          buttons,
          images: imgs.slice(0, 16).map((im) => ({ url: bestSrc(im), alt: im.getAttribute('alt') || '', w: im.naturalWidth || Math.round(im.getBoundingClientRect().width), h: im.naturalHeight || Math.round(im.getBoundingClientRect().height) })),
          stats: statsOf(section),
          faqs: faqsOf(section),
          listItems: lists,
          numbered: !!section.querySelector('ol') || /^\s*(step\s*)?\d/i.test(heading),
          textLen: clean((section as HTMLElement).innerText).length,
        }
      }

      // ---- section selection (same strategy as before) ----
      let els = Array.from(document.querySelectorAll(
        '.elementor > .elementor-section.elementor-top-section, ' +
        '.elementor > .e-con.e-parent, ' +
        '.elementor > [data-element_type="container"], ' +
        '[data-elementor-type="wp-page"] > .e-con, ' +
        '[data-elementor-type] > .elementor-section'
      ))
      if (els.length < 2) {
        els = Array.from(document.querySelectorAll('.elementor-top-section, .e-con.e-parent'))
          .filter((el) => !el.parentElement?.closest('.e-con, .elementor-section'))
      }
      if (els.length < 2) {
        els = Array.from(document.querySelectorAll('main > section, body > section, main > article'))
      }
      const out: { html: string; fp: SectionFP }[] = []
      let i = 0
      for (const el of els) {
        const h = (el as HTMLElement).outerHTML
        if (h && h.length < 400_000) { out.push({ html: h, fp: fpOf(el, i) }); i++ }
      }
      return out
    }).catch(() => [] as CapturedSection[]) as CapturedSection[]

    if (!html && goError) throw goError
    return { finalUrl, html, stylesheets, inlineStyles, resourceCount, capturedSections }
  } finally {
    try { await context?.close() } catch { /* ignore */ }
    release()
  }
}

// ---------------------------------------------------------------------------
// Brand extraction — render the page and query the LIVE DOM for logo, palette,
// fonts, and the full nav hierarchy (top-level + dropdowns). Far more reliable
// than regex over raw HTML because computed styles + JS-built menus are all
// resolved. Used by the branding-first import flow.
// ---------------------------------------------------------------------------

export type NavNode = { text: string; href: string; children?: NavNode[] }
export type BrandExtract = {
  finalUrl: string
  logo:
    | { kind: 'svg'; svg: string; alt?: string }
    | { kind: 'img'; url: string; alt?: string; naturalWidth?: number; naturalHeight?: number }
    | null
  palette: {
    cssVars: Record<string, string>
    sampled: { headerBg?: string; buttonBg?: string; linkColor?: string; headingColor?: string; bodyBg?: string }
  }
  fonts: { heading?: string; body?: string }
  nav: NavNode[]
  navFlat: { text: string; href: string }[]
  hasMegaMenu: boolean
  footer: { links: { text: string; href: string }[]; tagline: string; social: { network: string; href: string }[] }
}

export async function extractBrandFromDom(url: string): Promise<BrandExtract> {
  let release: () => void = () => {}
  const wait = new Promise<void>((r) => { release = r })
  const prev = mutex
  mutex = wait
  await prev

  let context: BrowserContext | null = null
  try {
    const b = await getBrowser()
    context = await b.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    })
    const page = await context.newPage()
    try { await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }) }
    catch { try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }) } catch { /* keep going */ } }

    // Hover the top-level menu items so CSS-only dropdowns render into the DOM
    // before we read them. Best-effort; JS-driven menus already have the markup.
    await page.evaluate(() => {
      const nav = document.querySelector('header nav, nav, #site-navigation, .main-navigation')
      if (!nav) return
      nav.querySelectorAll('li').forEach((li) => {
        try { li.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })) } catch { /* ignore */ }
      })
    }).catch(() => {})
    await page.waitForTimeout(400)

    const data = await page.evaluate(() => {
      const abs = (u: string | null | undefined): string => {
        if (!u) return ''
        try { return new URL(u, location.href).toString() } catch { return u || '' }
      }
      const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim()

      // ---- LOGO ----
      const headerEl = document.querySelector('header, [role="banner"], .site-header, #masthead, .site-header__inner, .header') || document.body
      let logo: any = null
      // Prefer an inline <svg> logo
      const svgCandidates = Array.from(headerEl.querySelectorAll('a[class*="logo" i] svg, .logo svg, svg[class*="logo" i], [class*="brand" i] svg')) as SVGElement[]
      for (const svg of svgCandidates) {
        const r = svg.getBoundingClientRect()
        if (r.width > 16 && r.width < 460 && r.height > 8 && r.top < 220) {
          const outer = svg.outerHTML
          if (outer && outer.length < 120_000) { logo = { kind: 'svg', svg: outer, alt: svg.getAttribute('aria-label') || '' }; break }
        }
      }
      // Else an <img> logo — prefer ones with logo/brand hints, else first header img
      if (!logo) {
        const imgs = Array.from(headerEl.querySelectorAll('img')) as HTMLImageElement[]
        const scored = imgs.map((img) => {
          const r = img.getBoundingClientRect()
          const cls = (img.className + ' ' + (img.alt || '') + ' ' + (img.closest('a')?.className || '')).toLowerCase()
          let score = 0
          if (/logo|brand/.test(cls)) score += 100
          if (r.top < 160) score += 20
          if (r.width > 40 && r.width < 420) score += 10
          const src = (img.currentSrc || img.src || '').toLowerCase()
          if (src.endsWith('.svg')) score += 30
          if (/logo/.test(src)) score += 25
          return { img, r, score, src: img.currentSrc || img.src }
        }).filter((x) => x.r.width > 16 && x.r.top < 240 && x.src)
          .sort((a, b) => b.score - a.score)
        if (scored.length) {
          const top = scored[0]
          logo = { kind: 'img', url: abs(top.src), alt: top.img.alt || '', naturalWidth: top.img.naturalWidth, naturalHeight: top.img.naturalHeight }
        }
      }

      // ---- PALETTE ----
      const cssVars: Record<string, string> = {}
      try {
        const rootStyle = getComputedStyle(document.documentElement)
        // Read declared custom props by scanning stylesheets for --names, then resolve
        const names = new Set<string>()
        for (const sheet of Array.from(document.styleSheets)) {
          let rules: CSSRuleList | null = null
          try { rules = sheet.cssRules } catch { continue }
          if (!rules) continue
          for (const rule of Array.from(rules) as any[]) {
            const style = rule.style
            if (!style) continue
            for (let i = 0; i < style.length; i++) {
              const p = style[i]
              if (p && p.startsWith('--') && /color|primary|accent|brand|secondary|e-global/i.test(p)) names.add(p)
            }
          }
        }
        for (const n of Array.from(names).slice(0, 60)) {
          const v = rootStyle.getPropertyValue(n).trim()
          if (v && /^#|rgb|hsl/.test(v)) cssVars[n] = v
        }
      } catch { /* ignore */ }

      const sample = (sel: string, prop: string): string | undefined => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) return undefined
        const v = getComputedStyle(el).getPropertyValue(prop)
        return v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent' ? v.trim() : undefined
      }
      const sampled = {
        headerBg: sample('header, .site-header, #masthead', 'background-color'),
        buttonBg: sample('a.btn, .button, button.btn, .elementor-button, .wp-block-button__link, [class*="cta" i]', 'background-color'),
        linkColor: sample('a', 'color'),
        headingColor: sample('h1, h2', 'color'),
        bodyBg: sample('body', 'background-color'),
      }

      // ---- FONTS ----
      const famOf = (sel: string): string | undefined => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) return undefined
        const f = getComputedStyle(el).fontFamily
        return f ? f.split(',')[0].replace(/['"]/g, '').trim() : undefined
      }
      const fonts = { heading: famOf('h1') || famOf('h2') || famOf('.elementor-heading-title'), body: famOf('body') || famOf('p') }

      // ---- NAV TREE (with dropdowns) ----
      const isBad = (href: string, text: string) =>
        !text || text.length > 44 || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')
      const walk = (ul: Element, depth: number): any[] => {
        const out: any[] = []
        const lis = Array.from(ul.children).filter((c) => c.tagName === 'LI')
        for (const li of lis) {
          const a = (li.querySelector(':scope > a') || li.querySelector('a')) as HTMLAnchorElement | null
          if (!a) continue
          const text = norm(a.textContent || '')
          const href = abs(a.getAttribute('href'))
          if (isBad(href, text)) continue
          const node: any = { text, href }
          if (depth < 2) {
            const sub = li.querySelector(':scope > ul, :scope > .sub-menu, :scope > .dropdown, :scope > div ul, :scope > .elementor-nav-menu--dropdown') as Element | null
            if (sub) {
              const subUl = sub.tagName === 'UL' ? sub : (sub.querySelector('ul') || sub)
              const children = walk(subUl, depth + 1)
              if (children.length) node.children = children
            }
          }
          out.push(node)
          if (out.length >= 12) break
        }
        return out
      }
      // Pick the nav container with the most top-level links
      const navRoots = Array.from(document.querySelectorAll('header nav ul, #primary-menu, .main-navigation ul, nav ul[class*="menu" i], ul[class*="menu" i], ul[id*="menu" i]'))
      let best: Element | null = null, bestCount = 0
      for (const root of navRoots) {
        const count = Array.from(root.children).filter((c) => c.tagName === 'LI').length
        if (count > bestCount) { bestCount = count; best = root }
      }
      const nav = best ? walk(best, 0) : []
      const navFlat = nav.map((n) => ({ text: n.text, href: n.href }))
      const hasMegaMenu = nav.some((n) => n.children && n.children.length >= 4)

      // ---- FOOTER ----
      // Read the footer straight out of the rendered DOM (reliable even when the
      // site builds its footer with JS or doesn't use a <footer> tag). Pick the
      // footer-like container that sits lowest on the page and holds the most
      // links, then harvest its nav links, tagline, and social icons.
      const footerOut: { links: { text: string; href: string }[]; tagline: string; social: { network: string; href: string }[] } = { links: [], tagline: '', social: [] }
      try {
        const cands = Array.from(document.querySelectorAll(
          'footer, [role="contentinfo"], .site-footer, #colophon, #footer, .elementor-location-footer, [data-elementor-type="footer"], [class*="footer" i]'
        )) as HTMLElement[]
        const pageH = document.documentElement.scrollHeight || window.innerHeight
        let fEl: HTMLElement | null = null, fScore = -1
        for (const el of cands) {
          const r = el.getBoundingClientRect()
          const top = r.top + window.scrollY
          const linkN = el.querySelectorAll('a').length
          if (linkN === 0) continue
          // Reward being near the bottom of the page and having several links;
          // penalise huge containers (a wrapper that swallows the whole page).
          const nearBottom = top > pageH * 0.5 ? 40 : 0
          const score = nearBottom + Math.min(linkN, 30) + top / 1000
          if (score > fScore) { fScore = score; fEl = el }
        }
        // Prefer the innermost matching footer if the winner just wraps another.
        if (fEl) {
          const inner = fEl.querySelector('footer, [role="contentinfo"], .site-footer, #colophon') as HTMLElement | null
          if (inner && inner.querySelectorAll('a').length >= 3 && inner !== fEl) fEl = inner
        }
        if (fEl) {
          const SOCIAL = /facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|pinterest|whatsapp|telegram/i
          const seen = new Set<string>()
          const legalRe = /^(©|copyright)|toate drepturile|drepturile rezervate|all rights reserved/i
          for (const a of Array.from(fEl.querySelectorAll('a')) as HTMLAnchorElement[]) {
            const href = abs(a.getAttribute('href'))
            const text = norm(a.textContent || '')
            if (!href || href.startsWith('javascript:') || /^#/.test(a.getAttribute('href') || '')) continue
            // Social links: keyed by network, label from the URL host.
            const m = href.match(SOCIAL)
            if (m && (!text || text.length < 3 || a.querySelector('svg,img,i'))) {
              const network = m[0].replace(/\.com/, '').toLowerCase()
              if (!footerOut.social.some((s) => s.network === network)) footerOut.social.push({ network, href })
              continue
            }
            if (!text || text.length > 48 || legalRe.test(text)) continue
            const key = text.toLowerCase()
            if (seen.has(key)) continue
            seen.add(key)
            footerOut.links.push({ text, href })
            if (footerOut.links.length >= 24) break
          }
          // Tagline: the longest short paragraph in the footer (skip copyright).
          const ps = Array.from(fEl.querySelectorAll('p, .elementor-widget-text-editor')) as HTMLElement[]
          let best = ''
          for (const p of ps) {
            const t = norm(p.textContent || '')
            if (t.length >= 20 && t.length <= 220 && !legalRe.test(t) && t.length > best.length) best = t
          }
          footerOut.tagline = best
        }
      } catch { /* ignore */ }

      return { logo, palette: { cssVars, sampled }, fonts, nav, navFlat, hasMegaMenu, footer: footerOut }
    })

    return { finalUrl: page.url(), ...(data as any) }
  } finally {
    try { await context?.close() } catch { /* ignore */ }
    release()
  }
}
