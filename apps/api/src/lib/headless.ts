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

    if (!html && goError) throw goError
    return { finalUrl, html, stylesheets, inlineStyles, resourceCount }
  } finally {
    try { await context?.close() } catch { /* ignore */ }
    release()
  }
}
