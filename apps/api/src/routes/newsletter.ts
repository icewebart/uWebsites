import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db, workspaces, accounts } from '@uwebsites/db'

// PUBLIC newsletter subscribe — called by the newsletter forms on published
// sites (any origin; mounted with permissive CORS). Routes the email to the
// workspace's account Mailjet integration. No secrets are exposed.
export const newsletterRouter = Router()

newsletterRouter.post('/:slug', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email.' })
  const [ws] = await db.select({ accountId: workspaces.accountId }).from(workspaces).where(eq(workspaces.slug, String(req.params.slug))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'not found' })
  const [acc] = await db.select({ settings: accounts.settings }).from(accounts).where(eq(accounts.id, ws.accountId)).limit(1)
  const mj = (acc?.settings as any)?.mailjet
  // No provider connected yet — accept gracefully so the visitor sees success.
  if (!mj?.apiKey) return res.json({ ok: true, data: { subscribed: true, stored: false } })
  try {
    const auth = 'Basic ' + Buffer.from(`${mj.apiKey}:${mj.apiSecret}`).toString('base64')
    await fetch('https://api.mailjet.com/v3/REST/contact', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ Email: email }) })
    if (mj.listId) await fetch(`https://api.mailjet.com/v3/REST/contactslist/${encodeURIComponent(mj.listId)}/managecontact`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ Email: email, Action: 'addnoforce' }) })
    res.json({ ok: true, data: { subscribed: true } })
  } catch { res.status(502).json({ ok: false, error: 'Subscribe failed — please try again.' }) }
})
