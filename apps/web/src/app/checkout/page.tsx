'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PLANS } from '@uwebsites/shared'
import { api } from '@/lib/api'

// The single in-app checkout entry. The marketing pricing page deep-links here
// with ?plan=<id> (auto-starts); in-app "Upgrade" links here with no plan (shows
// the picker). Either way it POSTs /billing/checkout and redirects to Stripe.
export const dynamic = 'force-dynamic'

export default function CheckoutPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><Checkout /></Suspense>
}

function Checkout() {
  const sp = useSearchParams()
  const planParam = sp.get('plan') || ''
  const valid = PLANS.some((p) => p.id === planParam)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function go(plan: string) {
    setErr(''); setBusy(true)
    try {
      const { url } = await api<{ url: string }>('/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) })
      if (url) { window.location.href = url; return }
      setErr('Could not start checkout.'); setBusy(false)
    } catch (e: any) {
      const msg = e?.message || 'Could not start checkout'
      // Not signed in → send to login, then come back to finish this checkout.
      if (/sign in|session/i.test(msg)) {
        window.location.href = `/login?next=${encodeURIComponent('/checkout?plan=' + plan)}`
        return
      }
      setErr(msg); setBusy(false)
    }
  }

  // Auto-start when the URL already names a valid plan (marketing deep-link).
  useEffect(() => { if (valid) go(planParam) }, [planParam]) // eslint-disable-line react-hooks/exhaustive-deps

  if (valid) {
    return <div className="empty">{err ? <div className="err">{err}</div> : 'Starting secure checkout…'}</div>
  }

  return (
    <div className="ob">
      <img className="auth-logo-img" src="/uwebsites.svg" alt="uWebsites" />
      <h1>Choose a plan</h1>
      <p className="muted">Upgrade anytime — you'll be taken to secure Stripe checkout.</p>
      {err && <div className="err" style={{ textAlign: 'center' }}>{err}</div>}
      <div className="choice three" style={{ marginTop: 22, textAlign: 'left' }}>
        {PLANS.map((p) => (
          <div key={p.id} className={`choice-card${p.highlighted ? ' sel' : ''}`}>
            <h3>{p.name}</h3>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', margin: '4px 0' }}>${p.priceUsd}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>/mo</span></div>
            <p className="muted" style={{ fontSize: 13, minHeight: 38 }}>{p.blurb}</p>
            <ul style={{ fontSize: 13, listStyle: 'none', padding: 0, margin: '4px 0 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {p.features.map((f) => <li key={f}>✓ {f}</li>)}
            </ul>
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => go(p.id)}>Choose {p.name}</button>
          </div>
        ))}
      </div>
    </div>
  )
}
