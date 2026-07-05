'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Seo = { description?: string; gscVerification?: string; bingVerification?: string; ga4Id?: string; gtmId?: string }
type Tokens = { seo?: Seo } & Record<string, any>

export default function TrackingPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [t, setT] = useState<Tokens | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ tokens: Tokens }>(`/workspaces/${slug}/branding`).then((d) => setT(d.tokens || {})).catch(() => router.push(`/w/${slug}`))
  }, [slug])

  const setSeo = (key: keyof Seo, value: string) => setT((c) => c ? { ...c, seo: { ...(c.seo || {}), [key]: value } } : c)

  async function save() {
    if (!t) return
    setErr(''); setSaving(true)
    try { await api(`/workspaces/${slug}/branding`, { method: 'PUT', body: JSON.stringify({ tokens: t }) }); setSavedAt(new Date().toLocaleTimeString()) }
    catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (!t) return <div className="empty">Loading…</div>
  const seo = t.seo || {}

  return (
    <AppShell title="Tracking" currentSlug={slug} active="Tracking">
      <div className="dash-sub" style={{ marginBottom: 18 }}>
        Analytics, tag managers &amp; search-engine verification for this site. Values here are emitted into every published page's <code>&lt;head&gt;</code> — <b>Publish</b> after changing them.
      </div>

      <div className="dash-h" style={{ marginTop: 0 }}>Tag managers &amp; analytics</div>
      <div className="ctl-group card">
        <div className="field">
          <label>Google Tag Manager — Container ID</label>
          <input className="inp" value={seo.gtmId || ''} placeholder="GTM-XXXXXXX" onChange={(e) => setSeo('gtmId', e.target.value.replace(/.*?(GTM-[A-Z0-9]+).*/i, '$1').trim())} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>From <b>tagmanager.google.com</b> → your container (top bar, <code>GTM-…</code>). We add both the head snippet and the <code>&lt;noscript&gt;</code> fallback. Use GTM <i>or</i> the GA4 field below — not both, to avoid double-counting.</p>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Google Analytics 4 — Measurement ID</label>
          <input className="inp" value={seo.ga4Id || ''} placeholder="G-XXXXXXXXXX" onChange={(e) => setSeo('ga4Id', e.target.value.replace(/.*?(G-[A-Z0-9]+).*/i, '$1').trim())} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Google Analytics → <b>Admin → Data Streams</b> → Measurement ID (<code>G-…</code>). Loads gtag.js directly — skip this if you fire GA4 through GTM above.</p>
        </div>
      </div>

      <div className="dash-h" style={{ marginTop: 22 }}>Search-engine verification</div>
      <div className="ctl-group card">
        <div className="field">
          <label>Google Search Console verification</label>
          <input className="inp" value={seo.gscVerification || ''} placeholder="paste the content value of the google-site-verification meta tag" onChange={(e) => setSeo('gscVerification', e.target.value.replace(/.*content=["']?([^"'>]+).*/i, '$1').trim())} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>In Search Console pick <b>HTML tag</b> verification, paste the tag (or just its code) → Publish → click Verify. To also see stats inside the app, connect it on <a href="/integrations">Integrations</a>.</p>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Bing Webmaster verification</label>
          <input className="inp" value={seo.bingVerification || ''} placeholder="msvalidate.01 content value" onChange={(e) => setSeo('bingVerification', e.target.value.replace(/.*content=["']?([^"'>]+).*/i, '$1').trim())} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Bing Webmaster Tools → <b>Add site → HTML meta tag</b>. Every published site also ships <code>robots.txt</code> + <code>sitemap.xml</code> and pings Bing on publish.</p>
        </div>
      </div>

      <div className="dash-h" style={{ marginTop: 22 }}>Default SEO</div>
      <div className="ctl-group card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Default meta description</label>
          <textarea className="inp" rows={2} value={seo.description || ''} placeholder="One or two sentences describing the site — used when a page has no description of its own." onChange={(e) => setSeo('description', e.target.value)} />
        </div>
      </div>

      {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
      <div className="save-row" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
      </div>
    </AppShell>
  )
}
