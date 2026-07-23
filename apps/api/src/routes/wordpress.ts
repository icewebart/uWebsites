import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, wordpressConnections } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { verifyConnection, publishArticle, decodeConnectionCode, type WpConn } from '../lib/wordpress.js'

// Connect a client's own WordPress site so generated articles publish into it.
// The auth secret is stored server-side and NEVER returned — reads get a masked
// hint only (same rule as the Cloudflare token in accounts.settings).
export const wordpressRouter = Router()

async function ownedWs(slug: string, accountId: string) {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, accountId))).limit(1)
  return ws
}

const mask = (s: string) => (s && s.length > 4 ? `••••${s.replace(/\s+/g, '').slice(-4)}` : '••••')

export async function connectionFor(workspaceId: string) {
  const [c] = await db.select().from(wordpressConnections)
    .where(eq(wordpressConnections.workspaceId, workspaceId)).limit(1)
  return c
}

// GET /workspaces/:slug/wordpress — status (no secret).
wordpressRouter.get('/:slug/wordpress', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const c = await connectionFor(ws.id)
  if (!c) return res.json({ ok: true, data: null })
  res.json({ ok: true, data: {
    siteUrl: c.siteUrl, mode: c.mode, username: c.username, secretHint: mask(c.authSecret),
    defaultStatus: c.defaultStatus, postsCreated: c.postsCreated, lastPostAt: c.lastPostAt, lastError: c.lastError,
  } })
})

// POST /workspaces/:slug/wordpress — verify the credentials, then save.
wordpressRouter.post('/:slug/wordpress', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const { siteUrl, username, appPassword, defaultStatus, connectionCode } = req.body ?? {}

  // Two ways in: the plugin's one-paste connection code, or a site URL +
  // username + Application Password (no plugin needed).
  let conn: WpConn
  if (connectionCode) {
    const decoded = decodeConnectionCode(String(connectionCode))
    if (!decoded) return res.status(400).json({ ok: false, error: 'That connection code is not valid. Copy it again from Settings → uWebsites in your WordPress admin.' })
    conn = { siteUrl: decoded.siteUrl, mode: 'plugin', authSecret: decoded.token }
  } else {
    if (!siteUrl || !username || !appPassword) return res.status(400).json({ ok: false, error: 'siteUrl, username and appPassword are required' })
    if (!/^https?:\/\//i.test(String(siteUrl))) return res.status(400).json({ ok: false, error: 'siteUrl must start with http:// or https://' })
    conn = { siteUrl: String(siteUrl), mode: 'app_password', username: String(username), authSecret: String(appPassword) }
  }
  let check: { name: string; canPublish: boolean; siteName?: string }
  try {
    check = await verifyConnection(conn)
  } catch (e: any) {
    // Surface WP's own message — it distinguishes bad credentials from a host
    // that has disabled the REST API or Application Passwords entirely.
    return res.status(400).json({ ok: false, error: `Could not connect: ${e?.message || 'unknown error'}` })
  }
  if (!check.canPublish) return res.status(400).json({ ok: false, error: `Connected as "${check.name}", but that user cannot create posts. Use an Editor or Administrator account.` })

  const status = defaultStatus === 'publish' ? 'publish' : 'draft'
  const existing = await connectionFor(ws.id)
  const values = {
    workspaceId: ws.id, siteUrl: conn.siteUrl.replace(/\/+$/, ''), mode: conn.mode || 'app_password',
    username: conn.username || null, authSecret: conn.authSecret, defaultStatus: status,
    lastError: null as string | null, updatedAt: new Date(),
  }
  if (existing) await db.update(wordpressConnections).set(values).where(eq(wordpressConnections.id, existing.id))
  else await db.insert(wordpressConnections).values(values)

  res.json({ ok: true, data: { connectedAs: check.name, siteName: check.siteName, defaultStatus: status } })
})

// PATCH /workspaces/:slug/wordpress — change publish mode without re-entering the secret.
wordpressRouter.patch('/:slug/wordpress', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const c = await connectionFor(ws.id)
  if (!c) return res.status(404).json({ ok: false, error: 'not connected' })
  const status = req.body?.defaultStatus === 'publish' ? 'publish' : 'draft'
  await db.update(wordpressConnections).set({ defaultStatus: status, updatedAt: new Date() }).where(eq(wordpressConnections.id, c.id))
  res.json({ ok: true, data: { defaultStatus: status } })
})

// DELETE /workspaces/:slug/wordpress — disconnect.
wordpressRouter.delete('/:slug/wordpress', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  await db.delete(wordpressConnections).where(eq(wordpressConnections.workspaceId, ws.id))
  res.json({ ok: true, data: { disconnected: true } })
})

// POST /workspaces/:slug/wordpress/test — push a throwaway draft to prove the
// pipeline end-to-end before trusting it with real articles.
wordpressRouter.post('/:slug/wordpress/test', requireAuth, async (req: AuthRequest, res) => {
  const ws = await ownedWs(String(req.params.slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const c = await connectionFor(ws.id)
  if (!c) return res.status(404).json({ ok: false, error: 'not connected' })
  try {
    const post = await publishArticle(c as WpConn, {
      externalId: `test-${c.id}`,
      title: 'uWebsites test post',
      content: '<p>If you can read this, uWebsites is connected to your site. You can safely delete this draft.</p>',
      status: 'draft',
    })
    res.json({ ok: true, data: post })
  } catch (e: any) {
    await db.update(wordpressConnections).set({ lastError: String(e?.message || 'unknown'), updatedAt: new Date() }).where(eq(wordpressConnections.id, c.id))
    res.status(502).json({ ok: false, error: `Test post failed: ${e?.message || 'unknown'}` })
  }
})
