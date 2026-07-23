'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Conn = {
  siteUrl: string; mode: string; username: string | null; secretHint: string
  defaultStatus: 'draft' | 'publish'; postsCreated: number; lastPostAt: string | null; lastError: string | null
}

export default function WordPressPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [conn, setConn] = useState<Conn | null>(null)
  const [loading, setLoading] = useState(true)
  const [siteUrl, setSiteUrl] = useState('')
  const [username, setUsername] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'draft' | 'publish'>('draft')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  function load() {
    return api<Conn | null>(`/workspaces/${slug}/wordpress`)
      .then((d) => { setConn(d); if (d) setStatus(d.defaultStatus) })
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [slug])

  async function connect() {
    setErr(''); setNote(''); setBusy(true)
    try {
      const r = await api<{ connectedAs: string; siteName?: string }>(`/workspaces/${slug}/wordpress`, {
        method: 'POST', body: JSON.stringify({ siteUrl: siteUrl.trim(), username: username.trim(), appPassword, defaultStatus: status }),
      })
      setNote(`Connected to ${r.siteName || siteUrl} as ${r.connectedAs}.`)
      setAppPassword('')
      await load()
    } catch (e: any) { setErr(e.message || 'Could not connect') } finally { setBusy(false) }
  }
  async function connectPlugin() {
    setErr(''); setNote(''); setBusy(true)
    try {
      const r = await api<{ connectedAs: string; siteName?: string }>(`/workspaces/${slug}/wordpress`, {
        method: 'POST', body: JSON.stringify({ connectionCode: code.trim(), defaultStatus: status }),
      })
      setNote(`Connected to ${r.siteName || 'your site'} via the plugin.`)
      setCode('')
      await load()
    } catch (e: any) { setErr(e.message || 'Could not connect') } finally { setBusy(false) }
  }
  async function testPost() {
    setErr(''); setNote(''); setBusy(true)
    try {
      const r = await api<{ link: string }>(`/workspaces/${slug}/wordpress/test`, { method: 'POST' })
      setNote(`Test draft created on your site. Open it: ${r.link}`)
      await load()
    } catch (e: any) { setErr(e.message || 'Test failed') } finally { setBusy(false) }
  }
  async function saveStatus(next: 'draft' | 'publish') {
    setStatus(next); setErr('')
    try { await api(`/workspaces/${slug}/wordpress`, { method: 'PATCH', body: JSON.stringify({ defaultStatus: next }) }); await load() }
    catch (e: any) { setErr(e.message || 'Could not update') }
  }
  async function disconnect() {
    if (!window.confirm('Disconnect this WordPress site? New articles will stop publishing to it.')) return
    setBusy(true); setErr('')
    try { await api(`/workspaces/${slug}/wordpress`, { method: 'DELETE' }); setConn(null); setNote('Disconnected.') }
    catch (e: any) { setErr(e.message || 'Could not disconnect') } finally { setBusy(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="WordPress" currentSlug={slug} active="WordPress">
      <div className="dash-h">Publish to WordPress</div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 720 }}>
        Connect an existing WordPress site and every article this workspace writes is published straight into it —
        with its featured image, SEO meta, and links into your own posts. No migration needed.
      </p>

      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {note && <div className="banner-ok" style={{ marginTop: 10 }}>{note}</div>}

      {conn ? (
        <div className="ctl-group card" style={{ marginTop: 16, maxWidth: 720 }}>
          <h3>Connected</h3>
          <div className="ctl-row"><label>Site</label><span><a href={conn.siteUrl} target="_blank" rel="noreferrer">{conn.siteUrl}</a></span></div>
          <div className="ctl-row"><label>User</label><span>{conn.username} <span className="muted">({conn.secretHint})</span></span></div>
          <div className="ctl-row"><label>Articles sent</label><span>{conn.postsCreated}{conn.lastPostAt ? ` · last ${new Date(conn.lastPostAt).toLocaleDateString()}` : ''}</span></div>
          <div className="ctl-row"><label>New articles arrive as</label>
            <select className="num" value={status} onChange={(e) => saveStatus(e.target.value as 'draft' | 'publish')}>
              <option value="draft">Draft (you review, then publish)</option>
              <option value="publish">Published immediately</option>
            </select>
          </div>
          {conn.lastError && <div className="err" style={{ marginTop: 8 }}>Last error: {conn.lastError}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-secondary" onClick={testPost} disabled={busy}>Send a test draft</button>
            <button className="btn btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button>
          </div>
        </div>
      ) : (
        <>
        <div className="ctl-group card" style={{ marginTop: 16, maxWidth: 720 }}>
          <h3>Option A — with our plugin <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(recommended)</span></h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Install the uWebsites plugin, open <b>Settings → uWebsites</b>, copy the connection code and paste it here.
            The plugin also writes your <b>Yoast / RankMath</b> meta and puts the featured image in your media library —
            things the plain WordPress API can&apos;t do.
          </p>
          <div className="ctl-row"><label>Connection code</label>
            <input className="inp" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste the code from your WordPress admin" />
          </div>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={connectPlugin} disabled={busy || !code.trim()}>
            {busy ? 'Connecting…' : 'Connect with plugin'}
          </button>
        </div>

        <div className="ctl-group card" style={{ marginTop: 16, maxWidth: 720 }}>
          <h3>Option B — without a plugin</h3>
          <ol className="muted" style={{ fontSize: 13, paddingLeft: 18, margin: '4px 0 14px', lineHeight: 1.7 }}>
            <li>In your WordPress admin go to <b>Users → Profile</b>.</li>
            <li>Scroll to <b>Application Passwords</b>, type a name (e.g. “uWebsites”) and click <b>Add New</b>.</li>
            <li>Copy the generated password and paste it below. Use an <b>Administrator</b> or <b>Editor</b> account.</li>
          </ol>
          <div className="ctl-row"><label>Site URL</label>
            <input className="inp" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://yoursite.com" />
          </div>
          <div className="ctl-row"><label>WordPress username</label>
            <input className="inp" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
          </div>
          <div className="ctl-row"><label>Application password</label>
            <input className="inp" type="password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" />
          </div>
          <div className="ctl-row"><label>New articles arrive as</label>
            <select className="num" value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'publish')}>
              <option value="draft">Draft (you review, then publish)</option>
              <option value="publish">Published immediately</option>
            </select>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={connect} disabled={busy || !siteUrl.trim() || !username.trim() || !appPassword}>
            {busy ? 'Connecting…' : 'Connect WordPress'}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            We verify the connection before saving. The application password is kept server-side, never shown again, and
            never sent to your browser — and you can revoke it anytime from WordPress without changing your login password.
          </p>
        </div>
        </>
      )}
    </AppShell>
  )
}
