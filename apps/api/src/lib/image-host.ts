import { mkdir, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

// Image mirror — downloads external images into /www/wwwroot/_sites/<slug>/img/
// so the imported site doesn't hotlink from the source's WordPress (which we
// don't control and which might block hotlinks). Returns the URL the published
// site can use to load the local copy. Cached by URL → hash so we don't
// re-download the same image across pages.

const SITES_DIR = process.env.SITES_DIR || '/www/wwwroot/_sites'
// Public URL prefix where nginx serves _sites/<slug>/ as static. Mirrored
// images become ${SITES_URL}/<slug>/img/<hash>.<ext> so the same URL works
// in BOTH the editor preview iframe and the published static HTML.
const SITES_URL = process.env.PUBLIC_SITES_URL || 'https://app.uwebsites.net/p'
const UA = 'Mozilla/5.0 (compatible; uWebsitesImporter/1.0)'
const MAX_BYTES = 8 * 1024 * 1024  // 8 MB per image
const TIMEOUT_MS = 15_000

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg',
  'image/avif': '.avif',
}

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u)
}

function hashUrl(u: string): string {
  return crypto.createHash('sha1').update(u).digest('hex').slice(0, 16)
}

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true } catch { return false }
}

// True when `url` is one of OUR hosted image URLs (mirrored or generated) but
// the backing file is missing on disk — a broken <img>. External URLs return
// false (we can't cheaply verify them and they aren't ours to heal). Callers
// (fill-images, heal) use this to treat a dangling local image as an empty slot
// so re-running regenerates it. `expectSlug` scopes it to the current workspace.
export async function localImageMissing(url: string, expectSlug?: string): Promise<boolean> {
  if (!url || typeof url !== 'string') return false
  const prefix = SITES_URL.replace(/\/+$/, '') + '/'
  if (!url.startsWith(prefix)) return false            // not one of ours → not our problem
  const rest = url.slice(prefix.length)                // "<slug>/img/<name>"
  const m = rest.match(/^([^/]+)\/img\/([^/?#]+)/)
  if (!m) return false
  if (expectSlug && m[1] !== expectSlug) return false
  return !(await fileExists(path.join(SITES_DIR, m[1], 'img', m[2])))
}

// Save raw image bytes (e.g. an AI-generated image) into the workspace's img
// dir and return the public URL. `keyHint` makes the filename deterministic so
// re-running with the same hint overwrites rather than piling up files.
export async function saveImageBytes(slug: string, buf: Buffer, ext: string, keyHint: string): Promise<string> {
  const baseDir = path.join(SITES_DIR, slug, 'img')
  const name = 'gen-' + crypto.createHash('sha1').update(keyHint).digest('hex').slice(0, 16) + ext
  const dest = path.join(baseDir, name)
  await mkdir(baseDir, { recursive: true })
  await writeFile(dest, buf)
  return `${SITES_URL}/${slug}/img/${name}`
}

export type ImageMirror = {
  // Try to download `url` into the workspace's local img dir. Returns the
  // public path (/img/<hash>.<ext>) on success, or null on any failure (so
  // the caller can decide to drop the <img> tag or keep the original URL).
  mirror(url: string): Promise<string | null>
}

// One mirror instance per slug — keeps a per-call cache so a page with N
// references to the same image only fetches it once.
export function createImageMirror(slug: string): ImageMirror {
  const cache = new Map<string, string | null>()
  const baseDir = path.join(SITES_DIR, slug, 'img')

  async function mirror(rawUrl: string): Promise<string | null> {
    if (!rawUrl || typeof rawUrl !== 'string') return null
    const url = rawUrl.trim()
    if (!isHttpUrl(url)) return null
    if (cache.has(url)) return cache.get(url)!

    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
      clearTimeout(t)
      if (!r.ok) { cache.set(url, null); return null }

      const ct = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      if (!ct.startsWith('image/')) { cache.set(url, null); return null }

      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > MAX_BYTES) { cache.set(url, null); return null }

      // Pick extension from content-type; fall back to the URL's extension.
      let ext = EXT_BY_TYPE[ct]
      if (!ext) {
        const m = url.match(/\.([a-z0-9]{2,5})(?:\?|$)/i)
        ext = m ? '.' + m[1].toLowerCase() : '.img'
      }
      const name = hashUrl(url) + ext
      const dest = path.join(baseDir, name)

      if (!(await fileExists(dest))) {
        await mkdir(baseDir, { recursive: true })
        await writeFile(dest, buf)
      }
      // Absolute URL — works in editor preview (api.uwebsites.net pulls from
      // app.uwebsites.net/p/<slug>/img/...) AND in the published static HTML
      // (same-origin relative resolution would also work, but absolute keeps
      // life simple across contexts).
      const localUrl = `${SITES_URL}/${slug}/img/${name}`
      cache.set(url, localUrl)
      return localUrl
    } catch {
      cache.set(url, null)
      return null
    }
  }

  return { mirror }
}
