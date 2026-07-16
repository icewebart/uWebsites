/**
 * One-time (idempotent) Stripe product + price setup, driven by PLANS.
 *
 * Run with your Stripe TEST secret key in the env:
 *   STRIPE_SECRET_KEY=sk_test_... pnpm --filter @uwebsites/api exec tsx scripts/stripe-setup.ts
 *
 * It creates one product + one monthly USD price per plan (reusing any that
 * already exist, keyed by a stable lookup_key), then prints the
 * STRIPE_PRICE_* env lines to paste into the API server env.
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
  const envLines: string[] = []
  for (const p of PLANS) {
    const lookupKey = `uwebsites_${p.id}_monthly`
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
    envLines.push(`${p.stripePriceEnv}=${price.id}`)
  }
  console.log('\n— Add these to the API server env —\n')
  console.log(envLines.join('\n'))
  console.log('\nThen register a webhook (Stripe Dashboard → Developers → Webhooks)')
  console.log('pointing at  <API_URL>/billing/webhook  for events:')
  console.log('  checkout.session.completed, customer.subscription.created/updated/deleted')
  console.log('and set STRIPE_WEBHOOK_SECRET to its signing secret.')
}

main().catch((e) => { console.error(e); process.exit(1) })
