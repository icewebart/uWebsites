import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db, workspaces, memberships } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

export const workspacesRouter = Router()

// GET /workspaces — workspaces in the caller's account.
// NOTE: hard isolation is enforced by Postgres RLS in production (ADR-007);
// this account scope is the app-level guard on top.
workspacesRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  const rows = await db.select().from(workspaces).where(eq(workspaces.accountId, req.user!.accountId))
  res.json({ ok: true, data: rows })
})

// POST /workspaces — add another workspace to the account.
workspacesRouter.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { name } = req.body ?? {}
  if (!name) return res.status(400).json({ ok: false, error: 'name required' })
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const [ws] = await db.insert(workspaces).values({ accountId: req.user!.accountId, name, slug }).returning()
  res.json({ ok: true, data: ws })
})
