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

export type HeadlessResult = {
  finalUrl: string                              // after any redirects
  html: string                                  // full document HTML after render
  stylesheets: { href: string; css: string }[]  // every loaded external stylesheet
  inlineStyles: string                          // concatenated <style> blocks (after JS)
  resourceCount: number                         // count of all network responses (debug)
  capturedSections: string[]                    // top-level section/container outerHTML (DOM-split)
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
      const push = (els: Element[], out: string[]) => {
        for (const el of els) { const h = (el as HTMLElement).outerHTML; if (h && h.length < 400_000) out.push(h) }
      }
      // 1) Elementor: top-level sections OR top-level flexbox containers.
      let els = Array.from(document.querySelectorAll(
        '.elementor > .elementor-section.elementor-top-section, ' +
        '.elementor > .e-con.e-parent, ' +
        '.elementor > [data-element_type="container"], ' +
        '[data-elementor-type="wp-page"] > .e-con, ' +
        '[data-elementor-type] > .elementor-section'
      ))
      // Some themes nest the elementor wrapper deeper — widen if nothing matched.
      if (els.length < 2) {
        els = Array.from(document.querySelectorAll('.elementor-top-section, .e-con.e-parent'))
          .filter((el) => !el.parentElement?.closest('.e-con, .elementor-section'))
      }
      // 2) Generic fallback — top-level <section>/<article> in main/body.
      if (els.length < 2) {
        els = Array.from(document.querySelectorAll('main > section, body > section, main > article'))
      }
      const out: string[] = []
      push(els, out)
      return out
    }).catch(() => [] as string[])

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

      return { logo, palette: { cssVars, sampled }, fonts, nav, navFlat, hasMegaMenu }
    })

    return { finalUrl: page.url(), ...(data as any) }
  } finally {
    try { await context?.close() } catch { /* ignore */ }
    release()
  }
}
