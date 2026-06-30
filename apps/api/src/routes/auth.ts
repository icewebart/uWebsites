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

  // No default workspace — the first workspace is created in onboarding so the
  // user names it once (avoids a stray "My workspace"). Only create here if a
  // workspace name was explicitly provided.
  let workspaceOut: { id: string; name: string } | null = null
  if (workspace && String(workspace).trim()) {
    const wsName = String(workspace).trim()
    const [ws] = await db.insert(workspaces)
      .values({ accountId: account.id, name: wsName, slug: slugify(wsName) }).returning()
    await db.insert(memberships).values({ userId: user.id, workspaceId: ws.id, role: 'owner' })
    workspaceOut = { id: ws.id, name: ws.name }
  }

  const token = await signSession({ id: user.id, accountId: account.id, email })
  setSessionCookie(res, token)
  res.json({ ok: true, data: { user: { id: user.id, name, email }, workspace: workspaceOut } })
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

// GET /auth/me — JWT carries id+accountId+email, hydrate name from the DB so
// the UI can show the user's real name (not the email handle).
authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const [row] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, req.user!.id)).limit(1)
  res.json({ ok: true, data: { user: row ? { ...row, accountId: req.user!.accountId } : req.user } })
})

// PUT /auth/me — update name (email change requires re-verification, out of scope for v1)
authRouter.put('/me', requireAuth, async (req: AuthRequest, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80)
  if (!name) return res.status(400).json({ ok: false, error: 'name required' })
  const [row] = await db.update(users).set({ name }).where(eq(users.id, req.user!.id)).returning({ id: users.id, name: users.name, email: users.email })
  res.json({ ok: true, data: { user: { ...row, accountId: req.user!.accountId } } })
})

// POST /auth/logout
authRouter.post('/logout', (_req, res) => { clearSessionCookie(res); res.json({ ok: true, data: null }) })

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'workspace'
}
