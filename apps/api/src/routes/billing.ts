import { Router, type Request, type Response } from 'express'
import { desc, eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { db, accounts, subscriptions } from '@uwebsites/db'
import { PLANS, planById, type Plan, type PlanId } from '@uwebsites/shared'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

// Stripe subscriptions. ONE checkout implementation lives here; both the app's
// Upgrade flow and the marketing pricing page funnel through /billing/checkout.
// Secrets come from the server env only:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//   STRIPE_PRICE_STARTER / _GROWTH / _STUDIO  (see scripts/stripe-setup.ts)

function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  return key ? new Stripe(key) : null
}
const priceIdForPlan = (p: Plan): string | undefined => process.env[p.stripePriceEnv]
function planFromPriceId(priceId?: string | null): PlanId | undefined {
  if (!priceId) return undefined
  for (const p of PLANS) if (process.env[p.stripePriceEnv] === priceId) return p.id
  return undefined
}
const appUrl = () => process.env.FRONTEND_URL || 'http://localhost:3014'

export const billingRouter = Router()

// POST /billing/checkout { plan } — create a Stripe Checkout Session (subscription
// mode) for the signed-in account and return its URL. The client redirects to it.
billingRouter.post('/checkout', requireAuth, async (req: AuthRequest, res) => {
  const s = stripe()
  if (!s) return res.status(503).json({ ok: false, error: 'Billing is not configured yet.' })
  const plan = planById(String(req.body?.plan || ''))
  if (!plan) return res.status(400).json({ ok: false, error: 'Unknown plan' })
  const priceId = priceIdForPlan(plan)
  if (!priceId) return res.status(503).json({ ok: false, error: `No Stripe price configured for ${plan.id} (${plan.stripePriceEnv}).` })

  const [acc] = await db.select().from(accounts).where(eq(accounts.id, req.user!.accountId)).limit(1)
  if (!acc) return res.status(404).json({ ok: false, error: 'account not found' })

  // Reuse the account's Stripe customer, or create one and remember it.
  let customerId = acc.stripeCustomerId
  if (!customerId) {
    const customer = await s.customers.create({ email: req.user!.email, name: acc.name, metadata: { accountId: acc.id } })
    customerId = customer.id
    await db.update(accounts).set({ stripeCustomerId: customerId }).where(eq(accounts.id, acc.id))
  }

  try {
    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: acc.id,
      // Stamp the sub so the webhook can resolve account + plan without a lookup.
      subscription_data: { metadata: { accountId: acc.id, plan: plan.id } },
      metadata: { accountId: acc.id, plan: plan.id },
      allow_promotion_codes: true,
      success_url: `${appUrl()}/?billing=success`,
      cancel_url: `${appUrl()}/?billing=cancel`,
    })
    res.json({ ok: true, data: { url: session.url } })
  } catch (e: any) {
    console.error('[billing] checkout error:', e?.message || e)
    res.status(502).json({ ok: false, error: 'Could not start checkout.' })
  }
})

// POST /billing/portal — Stripe Billing Portal for managing / cancelling.
billingRouter.post('/portal', requireAuth, async (req: AuthRequest, res) => {
  const s = stripe()
  if (!s) return res.status(503).json({ ok: false, error: 'Billing is not configured yet.' })
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, req.user!.accountId)).limit(1)
  if (!acc?.stripeCustomerId) return res.status(400).json({ ok: false, error: 'No subscription to manage yet.' })
  try {
    const session = await s.billingPortal.sessions.create({ customer: acc.stripeCustomerId, return_url: `${appUrl()}/` })
    res.json({ ok: true, data: { url: session.url } })
  } catch (e: any) {
    console.error('[billing] portal error:', e?.message || e)
    res.status(502).json({ ok: false, error: 'Could not open the billing portal.' })
  }
})

// GET /billing/subscription — current plan + status for the account page.
billingRouter.get('/subscription', requireAuth, async (req: AuthRequest, res) => {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.accountId, req.user!.accountId)).orderBy(desc(subscriptions.updatedAt)).limit(1)
  res.json({ ok: true, data: sub ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd } : null })
})

// Upsert a subscription row from a Stripe Subscription object + mirror the plan
// onto accounts.plan (the quick-read field used for entitlements).
async function upsertSubscription(sub: Stripe.Subscription) {
  const accountId = sub.metadata?.accountId
  const priceId = sub.items?.data?.[0]?.price?.id
  const plan = (sub.metadata?.plan as PlanId) || planFromPriceId(priceId)
  if (!accountId || !plan) { console.warn('[billing] subscription missing accountId/plan:', sub.id); return }
  const periodEnd = (sub as any).current_period_end as number | undefined
  const row = {
    accountId,
    stripeCustomerId: String(sub.customer),
    stripeSubscriptionId: sub.id,
    plan,
    status: sub.status,
    priceId: priceId ?? null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: !!(sub as any).cancel_at_period_end,
    updatedAt: new Date(),
  }
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, sub.id)).limit(1)
  if (existing) await db.update(subscriptions).set(row).where(eq(subscriptions.id, existing.id))
  else await db.insert(subscriptions).values(row)

  // Active-ish subscriptions grant the plan; anything else drops to trial.
  const active = sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due'
  await db.update(accounts).set({ plan: active ? plan : 'trial' }).where(eq(accounts.id, accountId))
}

// POST /billing/webhook — MOUNTED WITH express.raw() IN index.ts (before json()),
// because Stripe signature verification needs the exact raw body bytes.
export async function billingWebhookHandler(req: Request, res: Response) {
  const s = stripe()
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!s || !whSecret) return res.status(503).send('billing not configured')
  const sig = req.headers['stripe-signature']
  if (!sig) return res.status(400).send('missing signature')

  let event: Stripe.Event
  try {
    event = s.webhooks.constructEvent(req.body, sig, whSecret) // req.body is the raw Buffer
  } catch (e: any) {
    console.error('[billing] bad webhook signature:', e?.message || e)
    return res.status(400).send('bad signature')
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode === 'subscription' && session.subscription) {
          const sub = await s.subscriptions.retrieve(String(session.subscription))
          await upsertSubscription(sub)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertSubscription(event.data.object as Stripe.Subscription)
        break
      }
      default:
        break // ignore other events
    }
  } catch (e: any) {
    console.error('[billing] webhook handler error:', e?.message || e)
    return res.status(500).send('handler error') // let Stripe retry
  }
  res.json({ received: true })
}
