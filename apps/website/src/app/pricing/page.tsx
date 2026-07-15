import { PLANS } from '@uwebsites/shared'

// The in-app checkout is the single source of truth: every CTA deep-links to
// app.uwebsites.net/checkout?plan=<id>, which signs the user in (if needed) and
// creates the Stripe Checkout Session. The marketing site never touches Stripe.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.uwebsites.net'

export const metadata = {
  title: 'Pricing — uWebsites',
  description: 'Simple monthly plans for AI websites with weekly AI articles. From $5/mo. Cancel anytime.',
}

export default function PricingPage() {
  return (
    <main className="wrap" style={{ maxWidth: 1040 }}>
      <a className="brand" href="/" style={{ textDecoration: 'none' }}><span className="mk">u</span> uWebsites</a>

      <div className="pricing-head">
        <h1>Pricing that grows with you</h1>
        <p>Every plan includes the AI website builder, design import, and hands-off AI articles. Cancel anytime.</p>
      </div>

      <div className="tiers">
        {PLANS.map((p) => (
          <div key={p.id} className={`tier${p.highlighted ? ' featured' : ''}`}>
            {p.highlighted && <div className="tier-badge">Most popular</div>}
            <h2>{p.name}</h2>
            <div className="price"><span className="amt">${p.priceUsd}</span><span className="per">/mo</span></div>
            <p className="blurb">{p.blurb}</p>
            <a className={`tier-cta${p.highlighted ? ' primary' : ''}`} href={`${APP_URL}/checkout?plan=${p.id}`}>Choose {p.name}</a>
            <ul className="feats">
              {p.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <p className="fine">Prices in USD, billed monthly. You can upgrade, downgrade, or cancel anytime from your account.</p>
    </main>
  )
}
