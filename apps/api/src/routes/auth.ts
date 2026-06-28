import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, accounts, users, workspaces, memberships } from '@uwebsites/db'
import { signSession, setSessionCookie, clearSessionCookie, requireAuth, type AuthRequest } from '../middleware/auth.js'

export const authRouter = Router()

// POST /auth/signup — creates account + owner user + first workspace.
// TODO: enforce mandatory 2FA enrolment for owners (ADR-010) before first publish.
authRouter.post('/signup', async (req, res) => {
  const { name, email, password, workspace } = req.body ?? {}
  if (!name || !email || !password) return res.status(400).json({ ok: false, error: 'name, email, password required' })

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (existing.length) return res.status(409).json({ ok: false, error: 'email already registered' })

  const [account] = await db.insert(accounts).values({ name }).returning()
  const passwordHash = await bcrypt.hash(password, 12)
  const [user] = await db.insert(users).values({ accountId: account.id, email, name, passwordHash }).returning()

  const wsName = workspace || 'My workspace'
  const [ws] = await db.insert(workspaces)
    .values({ accountId: account.id, name: wsName, slug: slugify(wsName) }).returning()
  await db.insert(memberships).values({ userId: user.id, workspaceId: ws.id, role: 'owner' })

  const token = await signSession({ id: user.id, accountId: account.id, email })
  setSessionCookie(res, token)
  res.json({ ok: true, data: { user: { id: user.id, name, email }, workspace: { id: ws.id, name: wsName } } })
})

// POST /auth/login
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ ok: false, error: 'invalid credentials' })
  const token = await signSession({ id: user.id, accountId: user.accountId, email: user.email })
  setSessionCookie(res, token)
  res.json({ ok: true, data: { user: { id: user.id, name: user.name, email: user.email } } })
})

// GET /auth/me
authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  res.json({ ok: true, data: { user: req.user } })
})

// POST /auth/logout
authRouter.post('/logout', (_req, res) => { clearSessionCookie(res); res.json({ ok: true, data: null }) })

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'workspace'
}
