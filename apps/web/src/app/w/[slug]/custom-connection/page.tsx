'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Conn = {
  name: string; baseUrl: string
  demandKeyHint: string | null; articleKeyHint: string | null
  defaultKind: 'educational' | 'informative'
  postsCreated: number; lastPostAt: string | null
  lastPullAt: string | null; lastPullCount: number | null
  lastError: string | null
}

// Generic "custom API" delivery — for a site that speaks its own small
// content contract (GET content-demand + POST articles, see kids.ro's
// ARTICOLE.md) instead of WordPress's REST API. Same shape as the WordPress
// connection screen: connect, test, and (uniquely here) pull real content
// demand from the site's own visitors straight into the Article Plan.
export default function CustomConnectionPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [conn, setConn] = useState<Conn | null>(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [demandKey, setDemandKey] = useState('')
  const [articleKey, setArticleKey] = useState('')
  const [defaultKind, setDefaultKind] = useState<'educational' | 'informative'>('informative')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  function load() {
    return api<Conn | null>(`/workspaces/${slug}/custom-connection`)
      .then((d) => { setConn(d); if (d) { setName(d.name); setBaseUrl(d.baseUrl); setDefaultKind(d.defaultKind) } })
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [slug])

  async function connect() {
    setErr(''); setNote(''); setBusy(true)
    try {
      const r = await api<{ demandVerified: boolean; topicsAvailable: number | null }>(`/workspaces/${slug}/custom-connection`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), baseUrl: baseUrl.trim(), demandKey: demandKey.trim(), articleKey: articleKey.trim(), defaultKind }),
      })
      setNote(r.demandVerified ? `Connected — ${r.topicsAvailable} topics available right now.` : 'Connected.')
      setDemandKey(''); setArticleKey('')
      await load()
    } catch (e: any) { setErr(e.message || 'Could not connect') } finally { setBusy(false) }
  }
  async function testDelivery() {
    setErr(''); setNote(''); setBusy(true)
    try {
      const r = await api<{ id: string; status: string }>(`/workspaces/${slug}/custom-connection/test`, { method: 'POST' })
      setNote(`Test article delivered as a ${r.status} — check its moderation queue. It's safe to reject.`)
      await load()
    } catch (e: any) { setErr(e.message || 'Test failed') } finally { setBusy(false) }
  }
  async function disconnect() {
    if (!window.confirm(`Disconnect ${conn?.name || 'this connection'}? New articles will stop delivering to it.`)) return
    setBusy(true); setErr('')
    try { await api(`/workspaces/${slug}/custom-connection`, { method: 'DELETE' }); setConn(null); setNote('Disconnected.') }
    catch (e: any) { setErr(e.message || 'Could not disconnect') } finally { setBusy(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Custom API" currentSlug={slug} active="Custom API">
      <div className="dash-h">Custom API connection</div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 720 }}>
        For a site with its own content API instead of WordPress — two endpoints, two separate keys: one that reads what
        its visitors search for and can't find, one that writes finished articles (which arrive as drafts there, never
        published automatically). Built first for kids.ro; any site implementing the same two endpoints connects the same way.
      </p>

      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {note && <div className="banner-ok" style={{ marginTop: 10 }}>{note}</div>}

      {conn ? (
        <div className="ctl-group card" style={{ marginTop: 16, maxWidth: 720 }}>
          <h3>Connected — {conn.name}</h3>
          <div className="ctl-row"><label>Site</label><span><a href={conn.baseUrl} target="_blank" rel="noreferrer">{conn.baseUrl}</a></span></div>
          <div className="ctl-row"><label>Content-demand key</label><span className="muted">{conn.demandKeyHint || 'not set'}</span></div>
          <div className="ctl-row"><label>Article-delivery key</label><span className="muted">{conn.articleKeyHint || 'not set'}</span></div>
          <div className="ctl-row"><label>Articles delivered</label><span>{conn.postsCreated}{conn.lastPostAt ? ` · last ${new Date(conn.lastPostAt).toLocaleDateString()}` : ''}</span></div>
          {conn.lastPullAt && <div className="ctl-row"><label>Last demand pull</label><span>{conn.lastPullCount} topics · {new Date(conn.lastPullAt).toLocaleDateString()}</span></div>}
          <div className="ctl-row"><label>Default article kind</label>
            <span className="muted">{conn.defaultKind === 'educational' ? 'Educational (answers a question)' : 'Informative (covers a demand gap)'}</span>
          </div>
          {conn.lastError && <div className="err" style={{ marginTop: 8 }}>Last error: {conn.lastError}</div>}
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Pull topics from this connection on the <a href={`/w/${slug}/article-plan`}>Keywords tab</a>. Deliver a written
            article to it from the article&apos;s own page.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-secondary" onClick={testDelivery} disabled={busy || !conn.articleKeyHint}>Send a test article</button>
            <button className="btn btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button>
          </div>
        </div>
      ) : (
        <div className="ctl-group card" style={{ marginTop: 16, maxWidth: 720 }}>
          <h3>Connect a site</h3>
          <div className="ctl-row"><label>Name</label>
            <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. kids.ro" />
          </div>
          <div className="ctl-row"><label>Base URL</label>
            <input className="inp" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://kids.ro" />
          </div>
          <div className="ctl-row"><label>Content-demand key</label>
            <input className="inp" type="password" value={demandKey} onChange={(e) => setDemandKey(e.target.value)} placeholder="x-api-key for GET /internal/content-demand" />
          </div>
          <div className="ctl-row"><label>Article-delivery key</label>
            <input className="inp" type="password" value={articleKey} onChange={(e) => setArticleKey(e.target.value)} placeholder="x-api-key for POST /internal/articles" />
          </div>
          <div className="ctl-row"><label>Articles are written as</label>
            <select className="num" value={defaultKind} onChange={(e) => setDefaultKind(e.target.value as 'educational' | 'informative')}>
              <option value="informative">Informative (covers a demand gap)</option>
              <option value="educational">Educational (answers a question)</option>
            </select>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={connect} disabled={busy || !name.trim() || !baseUrl.trim()}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            The content-demand key is verified with a live call before saving. Both keys are kept server-side, never shown
            again and never sent to your browser. You only need the delivery key to start — add the demand key later once
            the connected site has real search data.
          </p>
        </div>
      )}
    </AppShell>
  )
}
