'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type GS = { connected: boolean; email: string | null; searchConsole: boolean; analytics: boolean }
type Site = { siteUrl: string; permissionLevel: string }
type SCData = {
  totals: { clicks: number; impressions: number; ctr: number; position: number }
  topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>
  topPages: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }>
}
type Prop = { property: string; displayName: string; account: string }
type GAData = {
  totals: { sessions: number; users: number; pageviews: number; bounceRate: number }
  topPages: Array<{ page: string; views: number }>
  channels: Array<{ channel: string; sessions: number }>
}

const nf = (n: number) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n))
const pct = (n: number) => (n * 100).toFixed(1) + '%'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="aside-block" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </div>
  )
}

export default function InsightsPage() {
  const router = useRouter()
  const [gs, setGs] = useState<GS | null>(null)
  const [days, setDays] = useState(28)
  const [err, setErr] = useState('')

  const [sites, setSites] = useState<Site[]>([])
  const [site, setSite] = useState('')
  const [sc, setSc] = useState<SCData | null>(null)
  const [scBusy, setScBusy] = useState(false)

  const [props, setProps] = useState<Prop[]>([])
  const [prop, setProp] = useState('')
  const [ga, setGa] = useState<GAData | null>(null)
  const [gaBusy, setGaBusy] = useState(false)

  useEffect(() => {
    api<GS>('/account/google/status').then(async (s) => {
      setGs(s)
      if (s.searchConsole) {
        const list = await api<Site[]>('/account/google/search-console/sites').catch(() => [])
        setSites(list); if (list[0]) setSite(list[0].siteUrl)
      }
      if (s.analytics) {
        const list = await api<Prop[]>('/account/google/analytics/properties').catch(() => [])
        setProps(list); if (list[0]) setProp(list[0].property)
      }
    }).catch(() => router.push('/login'))
  }, [])

  useEffect(() => {
    if (!site) return
    setScBusy(true); setErr('')
    api<SCData>('/account/google/search-console/report', { method: 'POST', body: JSON.stringify({ siteUrl: site, days }) })
      .then(setSc).catch((e) => setErr(e.message || 'Search Console error')).finally(() => setScBusy(false))
  }, [site, days])

  useEffect(() => {
    if (!prop) return
    setGaBusy(true)
    api<GAData>('/account/google/analytics/report', { method: 'POST', body: JSON.stringify({ propertyId: prop, days }) })
      .then(setGa).catch((e) => setErr(e.message || 'Analytics error')).finally(() => setGaBusy(false))
  }, [prop, days])

  if (!gs) return <div className="empty">Loading…</div>

  if (!gs.connected) return (
    <AppShell title="Insights" active="Insights">
      <div className="aside-block" style={{ textAlign: 'center', padding: 40, maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Connect Google to see your stats</h3>
        <p className="muted">Link Search Console &amp; Analytics on the Integrations page to pull clicks, impressions, top queries and traffic into this dashboard.</p>
        <a className="btn btn-primary" href="/integrations">Go to Integrations</a>
      </div>
    </AppShell>
  )

  return (
    <AppShell title="Insights" active="Insights">
      <div className="ev-actions-row" style={{ marginBottom: 16 }}>
        <div className="dash-sub" style={{ margin: 0 }}>Search &amp; traffic performance {gs.email ? `· ${gs.email}` : ''}</div>
        <select className="inp" style={{ maxWidth: 150 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={28}>Last 28 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {/* Search Console */}
      <div className="dash-h">Search Console {scBusy && <span className="muted" style={{ fontSize: 12 }}>· loading…</span>}</div>
      {!gs.searchConsole ? (
        <p className="muted" style={{ fontSize: 13 }}>Not connected. <a href="/integrations">Connect Search Console</a>.</p>
      ) : (
        <>
          {sites.length > 1 && (
            <select className="inp" style={{ maxWidth: 340, marginBottom: 12 }} value={site} onChange={(e) => setSite(e.target.value)}>
              {sites.map((s) => <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>)}
            </select>
          )}
          {sites.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No verified properties on this Google account yet.</p>}
          {sc && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
                <Stat label="Clicks" value={nf(sc.totals.clicks)} />
                <Stat label="Impressions" value={nf(sc.totals.impressions)} />
                <Stat label="Avg CTR" value={pct(sc.totals.ctr)} />
                <Stat label="Avg position" value={sc.totals.position.toFixed(1)} />
              </div>
              <div className="tblwrap"><table className="tbl">
                <thead><tr><th>Top query</th><th style={{ width: 80 }}>Clicks</th><th style={{ width: 90 }}>Impr.</th><th style={{ width: 70 }}>CTR</th><th style={{ width: 70 }}>Pos.</th></tr></thead>
                <tbody>
                  {sc.topQueries.slice(0, 12).map((q) => (
                    <tr key={q.query}><td>{q.query}</td><td>{q.clicks}</td><td>{nf(q.impressions)}</td><td>{pct(q.ctr)}</td><td>{q.position.toFixed(1)}</td></tr>
                  ))}
                  {!sc.topQueries.length && <tr><td colSpan={5} className="muted">No query data for this range.</td></tr>}
                </tbody>
              </table></div>
            </>
          )}
        </>
      )}

      {/* Analytics */}
      <div className="dash-h" style={{ marginTop: 26 }}>Analytics (GA4) {gaBusy && <span className="muted" style={{ fontSize: 12 }}>· loading…</span>}</div>
      {!gs.analytics ? (
        <p className="muted" style={{ fontSize: 13 }}>Not connected. <a href="/integrations">Connect Analytics</a> <span style={{ opacity: .7 }}>(works for test users until Google approves the app).</span></p>
      ) : (
        <>
          {props.length > 1 && (
            <select className="inp" style={{ maxWidth: 340, marginBottom: 12 }} value={prop} onChange={(e) => setProp(e.target.value)}>
              {props.map((p) => <option key={p.property} value={p.property}>{p.displayName}{p.account ? ` — ${p.account}` : ''}</option>)}
            </select>
          )}
          {props.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No GA4 properties on this Google account.</p>}
          {ga && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
                <Stat label="Sessions" value={nf(ga.totals.sessions)} />
                <Stat label="Users" value={nf(ga.totals.users)} />
                <Stat label="Pageviews" value={nf(ga.totals.pageviews)} />
                <Stat label="Bounce rate" value={pct(ga.totals.bounceRate)} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
                <div className="tblwrap"><table className="tbl">
                  <thead><tr><th>Top page</th><th style={{ width: 90 }}>Views</th></tr></thead>
                  <tbody>
                    {ga.topPages.slice(0, 10).map((p) => <tr key={p.page}><td>{p.page}</td><td>{nf(p.views)}</td></tr>)}
                    {!ga.topPages.length && <tr><td colSpan={2} className="muted">No data.</td></tr>}
                  </tbody>
                </table></div>
                <div className="tblwrap"><table className="tbl">
                  <thead><tr><th>Channel</th><th style={{ width: 90 }}>Sessions</th></tr></thead>
                  <tbody>
                    {ga.channels.map((c) => <tr key={c.channel}><td>{c.channel}</td><td>{nf(c.sessions)}</td></tr>)}
                    {!ga.channels.length && <tr><td colSpan={2} className="muted">No data.</td></tr>}
                  </tbody>
                </table></div>
              </div>
            </>
          )}
        </>
      )}
    </AppShell>
  )
}
