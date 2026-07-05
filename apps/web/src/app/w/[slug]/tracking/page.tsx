'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Seo = { description?: string; gscVerification?: string; bingVerification?: string; ga4Id?: string; gtmId?: string }
type Tokens = { seo?: Seo } & Record<string, any>
type Link = { scProperty: string | null; gaProperty: string | null; googleConnected: boolean; searchConsole: boolean; analytics: boolean; sites: { siteUrl: string }[]; properties: { property: string; displayName: string }[] }
type Report = { scProperty: string | null; searchConsole?: { totals: { clicks: number; impressions: number; ctr: number; position: number }; topQueries: { query: string; clicks: number; impressions: number }[] }; scError?: string }

const nf = (n: number) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n))

export default function TrackingPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [t, setT] = useState<Tokens | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')

  const [link, setLink] = useState<Link | null>(null)
  const [sc, setSc] = useState(''); const [ga, setGa] = useState('')
  const [linking, setLinking] = useState(false)
  const [rep, setRep] = useState<Report | null>(null)

  useEffect(() => {
    api<{ tokens: Tokens }>(`/workspaces/${slug}/branding`).then((d) => setT(d.tokens || {})).catch(() => router.push(`/w/${slug}`))
    loadLink()
  }, [slug])

  function loadLink() {
    return api<Link>(`/account/workspaces/${slug}/analytics`).then((d) => {
      setLink(d); setSc(d.scProperty || ''); setGa(d.gaProperty || '')
      if (d.scProperty) api<Report>(`/account/workspaces/${slug}/insights?days=28`).then(setRep).catch(() => {})
    }).catch(() => setLink(null))
  }
  async function saveLink() {
    setLinking(true); setErr('')
    try { await api(`/account/workspaces/${slug}/analytics`, { method: 'PUT', body: JSON.stringify({ scProperty: sc || null, gaProperty: ga || null }) }); await loadLink() }
    catch (e: any) { setErr(e.message || 'Could not link') } finally { setLinking(false) }
  }

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

      <div className="dash-h" style={{ marginTop: 0 }}>This site's Google data</div>
      <div className="ctl-group card" style={{ marginBottom: 4 }}>
        {!link ? <p className="muted" style={{ fontSize: 13, margin: 0 }}>Loading…</p>
        : !link.googleConnected ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Connect your Google account on <a href="/integrations">Integrations</a> first, then link this site's Search Console &amp; Analytics property here.</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Pin the Google property for <b>this website</b> so its search &amp; traffic data is always available here (and for content ideas).</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Search Console property</label>
                <select className="inp" value={sc} onChange={(e) => setSc(e.target.value)} disabled={!link.searchConsole}>
                  <option value="">— none —</option>
                  {link.sites.map((s) => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '')}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Analytics (GA4) property</label>
                <select className="inp" value={ga} onChange={(e) => setGa(e.target.value)} disabled={!link.analytics}>
                  <option value="">— none —</option>
                  {link.properties.map((p) => <option key={p.property} value={p.property}>{p.displayName}</option>)}
                </select>
                {!link.analytics && <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Analytics connects once Google approves the app (or via a test-user account).</p>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
              <button className="btn btn-primary" onClick={saveLink} disabled={linking}>{linking ? 'Linking…' : 'Link to this site'}</button>
              {link.scProperty && <span className="saved-tag">Linked: {link.scProperty.replace(/^sc-domain:/, '')}</span>}
            </div>
            {rep?.searchConsole && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <b style={{ fontSize: 13 }}>Search — last 28 days</b>
                  <a href="/insights" className="btn-mini">Full dashboard →</a>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
                  {[['Clicks', nf(rep.searchConsole.totals.clicks)], ['Impressions', nf(rep.searchConsole.totals.impressions)], ['CTR', (rep.searchConsole.totals.ctr * 100).toFixed(1) + '%'], ['Avg pos', rep.searchConsole.totals.position.toFixed(1)]].map(([l, v]) => (
                    <div key={l} className="aside-block" style={{ padding: '10px 12px' }}><div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div><div className="muted" style={{ fontSize: 11 }}>{l}</div></div>
                  ))}
                </div>
                {!!rep.searchConsole.topQueries.length && (
                  <div style={{ marginTop: 10, fontSize: 13 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Top queries: </span>
                    {rep.searchConsole.topQueries.slice(0, 5).map((q) => q.query).join(' · ')}
                  </div>
                )}
              </div>
            )}
            {rep?.scError && <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Couldn't load data: {rep.scError}</p>}
          </>
        )}
      </div>

      <div className="dash-h" style={{ marginTop: 22 }}>Tag managers &amp; analytics</div>
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
