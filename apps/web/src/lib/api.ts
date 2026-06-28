// Client-side API helper. All requests carry the shared `.uwebsites.net`
// session cookie (credentials: include). Throws on non-ok responses.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.uwebsites.net'

export async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const data = await res.json().catch(() => ({ ok: false, error: 'Bad response' }))
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data.data as T
}
