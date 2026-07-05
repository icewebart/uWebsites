import { Router } from 'express'
import { Google, generateState, generateCodeVerifier } from 'arctic'
import { eq } from 'drizzle-orm'
import { db, accounts, users, workspaces, memberships } from '@uwebsites/db'
import { signSession, setSessionCookie, sessionFromReq, requireAuth, type AuthRequest } from '../middleware/auth.js'
import { dataClient, SCOPE_SEARCH, SCOPE_ANALYTICS, getGoogleConn, saveGoogleConn } from '../lib/google-data.js'

// Google OAuth (OpenID Connect) via arctic. Secrets come from env
// (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) — never committed.
export const googleRouter = Router()

const APP_URL = process.env.APP_URL || 'https://app.uwebsites.net'
const REDIRECT = process.env.GOOGLE_REDIRECT_URI || 'https://api.uwebsites.net/auth/google/callback'

function client() {
  return new Google(process.env.GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!, REDIRECT)
}

// Short-lived state/PKCE cookies (host-only on api.uwebsites.net, lax so they
// survive the top-level redirect back from Google).
const tmp = { httpOnly: true, secure: true, sameSite: 'lax' as const, maxAge: 10 * 60 * 1000, path: '/' }

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'workspace'
}

googleRouter.get('/google', async (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.redirect(`${APP_URL}/login?error=oauth_unconfigured`)
  const state = generateState()
  const codeVerifier = generateCodeVerifier()
  const url = client().createAuthorizationURL(state, codeVerifier, ['openid', 'profile', 'email'])
  res.cookie('g_state', state, tmp)
  res.cookie('g_verifier', codeVerifier, tmp)
  res.redirect(url.toString())
})

googleRouter.get('/google/callback', async (req, res) => {
  const code = req.query.code as string | undefined
  const state = req.query.state as string | undefined
  const storedState = req.cookies?.g_state
  const verifier = req.cookies?.g_verifier
  if (!code || !state || !storedState || state !== storedState || !verifier) {
    return res.redirect(`${APP_URL}/login?error=oauth`)
  }
  try {
    const tokens = await client().validateAuthorizationCode(code, verifier)
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.accessToken()}` },
    })
    const profile = (await r.json()) as { sub: string; email?: string; name?: string; email_verified?: boolean }
    if (!profile.email) return res.redirect(`${APP_URL}/login?error=oauth`)

    let [user] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1)
    let isNew = false
    if (!user) {
      isNew = true
      const name = profile.name || profile.email.split('@')[0]
      const [account] = await db.insert(accounts).values({ name }).returning()
      ;[user] = await db.insert(users).values({ accountId: account.id, email: profile.email, name }).returning()
      // No default workspace — new users create their first one in onboarding.
    }

    const token = await signSession({ id: user.id, accountId: user.accountId, email: user.email })
    setSessionCookie(res, token)
    res.clearCookie('g_state', { path: '/' })
    res.clearCookie('g_verifier', { path: '/' })
    res.redirect(isNew ? `${APP_URL}/onboarding` : `${APP_URL}/`)
  } catch {
    res.redirect(`${APP_URL}/login?error=oauth`)
  }
})

// ---------------- Google DATA connect (Search Console + Analytics) ----------
// Separate flow from login: the logged-in user grants read access to their
// Search Console / Analytics; we keep an offline refresh token per account.
// Reuses the same OAuth client, a DIFFERENT redirect URI.

googleRouter.get('/google/data/connect', requireAuth, async (req: AuthRequest, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.redirect(`${APP_URL}/integrations?google=unconfigured`)
  const which = String(req.query.scope || 'search')
  // Re-request any scopes already granted so the fresh consent's refresh token
  // covers everything (incremental auth), plus the newly requested one.
  const existing = (await getGoogleConn(req.user!.accountId))?.scopes || []
  const want = new Set<string>(['openid', 'email', ...existing])
  if (which === 'search' || which === 'both') want.add(SCOPE_SEARCH)
  if (which === 'analytics' || which === 'both') want.add(SCOPE_ANALYTICS)
  const state = generateState()
  const codeVerifier = generateCodeVerifier()
  const url = dataClient().createAuthorizationURL(state, codeVerifier, [...want])
  url.searchParams.set('access_type', 'offline')       // → refresh token
  url.searchParams.set('prompt', 'consent')            // force it even on re-connect
  url.searchParams.set('include_granted_scopes', 'true')
  res.cookie('gd_state', state, tmp)
  res.cookie('gd_verifier', codeVerifier, tmp)
  res.redirect(url.toString())
})

googleRouter.get('/google/data/callback', async (req, res) => {
  const code = req.query.code as string | undefined
  const state = req.query.state as string | undefined
  const storedState = req.cookies?.gd_state
  const verifier = req.cookies?.gd_verifier
  const back = (q: string) => res.redirect(`${APP_URL}/integrations?${q}`)
  // Identify the account from the session cookie (carried on this redirect).
  const sess = await sessionFromReq(req)
  if (!sess) return back('google=needlogin')
  if (!code || !state || !storedState || state !== storedState || !verifier) return back('google=error')
  try {
    const tokens = await dataClient().validateAuthorizationCode(code, verifier)
    let refreshToken: string | null = null
    try { refreshToken = tokens.refreshToken() } catch { /* none returned */ }
    // Which scopes were actually granted.
    let scopes: string[] = []
    try { scopes = (tokens as any).scopes?.() || [] } catch { /* fall back below */ }
    // Identify the connected Google account email.
    let email: string | undefined
    try {
      const u = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.accessToken()}` } })
      email = ((await u.json()) as any)?.email
    } catch { /* optional */ }
    const prev = await getGoogleConn(sess.accountId)
    // Merge scopes with previously-granted; keep old refresh token if Google
    // didn't return a new one (happens when the user already consented).
    const mergedScopes = [...new Set([...(prev?.scopes || []), ...scopes])]
    const finalRefresh = refreshToken || prev?.refreshToken
    if (!finalRefresh) return back('google=norefresh')
    await saveGoogleConn(sess.accountId, { refreshToken: finalRefresh, scopes: mergedScopes.length ? mergedScopes : (prev?.scopes || []), email: email || prev?.email, connectedAt: new Date().toISOString() })
    res.clearCookie('gd_state', { path: '/' })
    res.clearCookie('gd_verifier', { path: '/' })
    back('google=connected')
  } catch {
    back('google=error')
  }
})
