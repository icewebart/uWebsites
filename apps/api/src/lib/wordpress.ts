// WordPress delivery — publish generated articles into a client's own WP site.
//
// Phase 1 uses WordPress's built-in REST API with an Application Password
// (WP 5.6+), so a client can connect with zero plugin installed. Phase 2's
// plugin will speak the same shape via its own authenticated endpoint.
//
// Everything here is server-side; the auth secret never reaches the browser.

export type WpConn = {
  siteUrl: string
  mode?: string | null
  username?: string | null
  authSecret: string
}

const UA = 'uWebsites/1.0 (+https://uwebsites.net)'

/** Normalise a site URL to its REST root: https://site.com → https://site.com/wp-json */
export function restRoot(siteUrl: string): string {
  const clean = String(siteUrl).trim().replace(/\/+$/, '')
  return /\/wp-json$/.test(clean) ? clean : `${clean}/wp-json`
}

export const isPluginMode = (conn: WpConn) => conn.mode === 'plugin'

function authHeaders(conn: WpConn): Record<string, string> {
  // Plugin mode: our own site token. App-password mode: HTTP Basic. WP accepts
  // the spaces in a generated app password, but strip them defensively —
  // pasting from the WP admin carries them and some proxies mangle the header.
  if (isPluginMode(conn)) return { 'X-UW-Token': conn.authSecret.trim() }
  const pass = conn.authSecret.replace(/\s+/g, '')
  return { Authorization: 'Basic ' + Buffer.from(`${conn.username || ''}:${pass}`).toString('base64') }
}

async function wpFetch(conn: WpConn, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${restRoot(conn.siteUrl)}${path}`
  return fetch(url, {
    ...init,
    headers: {
      ...authHeaders(conn),
      'User-Agent': UA,
      ...(init.headers || {}),
    },
    // A slow shared host shouldn't hang the whole auto-write run.
    signal: AbortSignal.timeout(30_000),
  })
}

/** Decode the plugin's connection code → { siteUrl, token }. */
export function decodeConnectionCode(code: string): { siteUrl: string; token: string } | null {
  try {
    const raw = Buffer.from(String(code).trim(), 'base64').toString('utf8')
    const [siteUrl, token] = raw.split('|')
    if (!/^https?:\/\//i.test(siteUrl || '') || !token) return null
    return { siteUrl: siteUrl.replace(/\/+$/, ''), token }
  } catch { return null }
}

async function wpJson<T = any>(conn: WpConn, path: string, init: RequestInit = {}): Promise<T> {
  const res = await wpFetch(conn, path, init)
  const text = await res.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = text }
  if (!res.ok) {
    // WP returns { code, message } for REST errors — surface that, it's the
    // difference between "wrong password" and "REST API disabled by the host".
    const msg = (body && body.message) ? String(body.message) : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body as T
}

/**
 * Verify a connection before saving it. Confirms the credentials work AND that
 * the user can actually publish (a subscriber-level account authenticates fine
 * but can't create posts — better to fail here than at the first article).
 */
export async function verifyConnection(conn: WpConn): Promise<{ name: string; canPublish: boolean; siteName?: string; seo?: string }> {
  if (isPluginMode(conn)) {
    const s = await wpJson<any>(conn, '/uwebsites/v1/status')
    return { name: 'uWebsites plugin', canPublish: true, siteName: s?.site, seo: s?.seo }
  }
  const me = await wpJson<any>(conn, '/wp/v2/users/me?context=edit')
  const caps = me?.capabilities || {}
  const canPublish = !!(caps.publish_posts || caps.edit_posts || me?.roles?.includes?.('administrator'))
  let siteName: string | undefined
  try {
    const root = await wpJson<any>(conn, '/')
    siteName = root?.name
  } catch { /* the discovery root is optional */ }
  return { name: me?.name || me?.slug || 'unknown', canPublish, siteName }
}

/** Upload an image into the client's media library and return its attachment id. */
export async function uploadMedia(conn: WpConn, imageUrl: string, filename: string, alt = ''): Promise<{ id: number; url: string } | null> {
  try {
    const img = await fetch(imageUrl, { signal: AbortSignal.timeout(20_000) })
    if (!img.ok) return null
    const type = img.headers.get('content-type') || 'image/jpeg'
    const buf = Buffer.from(await img.arrayBuffer())
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'image.jpg'
    const created = await wpJson<any>(conn, '/wp/v2/media', {
      method: 'POST',
      headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${safe}"` },
      body: buf as any,
    })
    if (alt && created?.id) {
      // Alt text is a separate field; best-effort so a failure here doesn't lose the image.
      try { await wpJson(conn, `/wp/v2/media/${created.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alt_text: alt }) }) } catch { /* ignore */ }
    }
    return created?.id ? { id: created.id, url: created.source_url } : null
  } catch { return null }
}

/** Create a post. Returns the remote id + permalink (stored for idempotency). */
export async function createPost(conn: WpConn, post: {
  title: string
  content: string
  excerpt?: string
  slug?: string
  status?: 'draft' | 'publish'
  featuredMedia?: number | null
}): Promise<{ id: number; link: string; status: string }> {
  const body: any = {
    title: post.title,
    content: post.content,
    status: post.status || 'draft',
  }
  if (post.excerpt) body.excerpt = post.excerpt
  if (post.slug) body.slug = post.slug
  if (post.featuredMedia) body.featured_media = post.featuredMedia
  const created = await wpJson<any>(conn, '/wp/v2/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { id: created.id, link: created.link, status: created.status }
}

/**
 * Publish an article — the ONE entry point the article engine calls.
 *
 * Plugin mode sends everything in a single request and the plugin does the
 * heavy lifting on-site (sideloads the image into their media library, writes
 * Yoast/RankMath meta, dedupes by external_id). App-password mode falls back to
 * core REST: upload the media first, then create the post — no SEO meta,
 * because core exposes no field for it.
 */
export async function publishArticle(conn: WpConn, a: {
  externalId?: string
  title: string
  content: string
  excerpt?: string
  slug?: string
  status?: 'draft' | 'publish'
  metaTitle?: string
  metaDescription?: string
  imageUrl?: string
  imageAlt?: string
}): Promise<{ id: number; link: string; status: string }> {
  const status = a.status || 'draft'
  if (isPluginMode(conn)) {
    const created = await wpJson<any>(conn, '/uwebsites/v1/article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_id: a.externalId, title: a.title, content: a.content, excerpt: a.excerpt,
        slug: a.slug, status, meta_title: a.metaTitle, meta_description: a.metaDescription,
        image_url: a.imageUrl, image_alt: a.imageAlt,
      }),
    })
    return { id: created.id, link: created.link, status: created.status }
  }
  let featuredMedia: number | null = null
  if (a.imageUrl && /^https?:\/\//i.test(a.imageUrl)) {
    const up = await uploadMedia(conn, a.imageUrl, `${a.slug || 'image'}.jpg`, a.imageAlt || a.title)
    featuredMedia = up?.id ?? null
  }
  return createPost(conn, {
    title: a.title, content: a.content, excerpt: a.excerpt, slug: a.slug, status, featuredMedia,
  })
}

/**
 * The client's existing posts + pages, as internal-link targets for the writer.
 * Same shape the internal writer already uses, so articles link into THEIR site
 * instead of dead-ending.
 */
export async function linkTargets(conn: WpConn, limit = 50): Promise<Array<{ title: string; url: string }>> {
  const out: Array<{ title: string; url: string }> = []
  for (const type of ['posts', 'pages']) {
    try {
      const rows = await wpJson<any[]>(conn, `/wp/v2/${type}?per_page=${Math.min(limit, 50)}&status=publish&_fields=title,link`)
      for (const r of rows || []) {
        const t = r?.title?.rendered?.replace(/<[^>]+>/g, '').trim()
        if (t && r.link) out.push({ title: t, url: r.link })
      }
    } catch { /* a locked-down endpoint just means fewer link targets */ }
  }
  return out.slice(0, limit)
}
