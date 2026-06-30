// Client-side API helper. All requests carry the shared `.uwebsites.net`
// session cookie (credentials: include). Throws on non-ok responses.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.uwebsites.net'

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  // Some upstream errors (413 Payload Too Large, 502/504 from nginx during a
  // restart) come back as plain text — json() throws. Surface a meaningful
  // message instead of the generic 'Bad response' so the UI can show what
  // went wrong.
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const body = await res.text().catch(() => '')
    if (!res.ok) {
      const msg = res.status === 413 ? 'Page too large to save (likely too many imported sections — try re-importing or splitting).'
        : res.status === 502 || res.status === 504 ? 'API is restarting — try again in a moment.'
        : res.status === 401 ? 'Session expired — please sign in again.'
        : (body.slice(0, 200) || `HTTP ${res.status}`)
      throw new Error(msg)
    }
    return ({} as T)
  }
  const data = await res.json().catch(() => ({ ok: false, error: 'Malformed API response' }))
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data.data as T
}
