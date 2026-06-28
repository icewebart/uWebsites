import { Router } from 'express'
import { Google, generateState, generateCodeVerifier } from 'arctic'
import { eq } from 'drizzle-orm'
import { db, accounts, users, workspaces, memberships } from '@uwebsites/db'
import { signSession, setSessionCookie } from '../middleware/auth.js'

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
      const [ws] = await db.insert(workspaces).values({ accountId: account.id, name: 'My workspace', slug: slugify('my-workspace') }).returning()
      await db.insert(memberships).values({ userId: user.id, workspaceId: ws.id, role: 'owner' })
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
