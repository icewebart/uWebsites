/**
 * One-time (idempotent) Stripe product + price setup, driven by PLANS.
 *
 * Run once per Stripe MODE (test, then live) with that mode's secret key:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm --filter @uwebsites/api exec tsx scripts/stripe-setup.ts
 *
 * Creates one product + one monthly USD price per plan, each tagged with the
 * plan's stable lookup_key. Nothing to copy into .env: the API resolves prices
 * by that lookup_key at runtime, and the same key exists in both modes.
 * Safe to re-run — existing prices are reused, not duplicated.
 */
import Stripe from 'stripe'
import { PLANS } from '@uwebsites/shared'

const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('✗ Set STRIPE_SECRET_KEY (test mode) before running this script.')
  process.exit(1)
}
const s = new Stripe(key)

async function main() {
  for (const p of PLANS) {
    const lookupKey = p.stripeLookupKey
    const existing = await s.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
    let price = existing.data[0]
    if (price) {
      console.log(`= ${p.id.padEnd(8)} reused price ${price.id}`)
    } else {
      const product = await s.products.create({
        name: `uWebsites ${p.name}`,
        description: p.blurb,
        metadata: { plan: p.id },
      })
      price = await s.prices.create({
        product: product.id,
        unit_amount: p.priceUsd * 100,
        currency: 'usd',
        recurring: { interval: 'month' },
        lookup_key: lookupKey,
        metadata: { plan: p.id },
      })
      console.log(`+ ${p.id.padEnd(8)} created product ${product.id} + price ${price.id}`)
    }
    console.log(`  $${p.priceUsd}/mo · lookup_key=${lookupKey}`)
  }
  console.log('\n✓ Products ready. Nothing to copy into .env — the API resolves')
  console.log('  these prices by lookup_key at runtime.\n')
  console.log('Remaining setup:')
  console.log('  1. STRIPE_SECRET_KEY  — this mode\'s secret key, on the API server')
  console.log('  2. Register a webhook (Stripe Dashboard → Developers → Webhooks)')
  console.log('     pointing at  <API_URL>/billing/webhook  for events:')
  console.log('       checkout.session.completed, customer.subscription.created/updated/deleted')
  console.log('     then set STRIPE_WEBHOOK_SECRET to its signing secret.')
}

main().catch((e) => { console.error(e); process.exit(1) })
