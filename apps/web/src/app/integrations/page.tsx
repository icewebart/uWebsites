'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type CF = { connected: boolean; verified: boolean; tokenHint: string | null; verifiedAt: string | null }
type MJ = { connected: boolean; tokenHint: string | null; listId: string | null; verifiedAt: string | null }
type GS = { connected: boolean; email: string | null; searchConsole: boolean; analytics: boolean; connectedAt: string | null }

export default function IntegrationsPage() {
  const router = useRouter()
  const [cf, setCf] = useState<CF | null>(null)
  const [mj, setMj] = useState<MJ | null>(null)
  const [token, setToken] = useState('')
  const [mjKey, setMjKey] = useState(''); const [mjSecret, setMjSecret] = useState(''); const [mjList, setMjList] = useState('')
  const [gs, setGs] = useState<GS | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  function load() {
    return Promise.all([
      api<{ cloudflare: CF; mailjet: MJ }>('/account/integrations').then((d) => { setCf(d.cloudflare); setMj(d.mailjet) }),
      api<GS>('/account/google/status').then(setGs).catch(() => setGs(null)),
    ])
  }
  useEffect(() => { load().catch(() => router.push('/login')) }, [])
  // Surface the result of the Google OAuth redirect (?google=connected|error|…).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get('google')
    if (!p) return
    if (p === 'connected') setNote('Google connected ✓')
    else if (p === 'needlogin') setErr('Please log in, then connect Google again.')
    else if (p === 'norefresh') setErr('Google didn’t return a refresh token — click Disconnect, then Connect again.')
    else if (p === 'unconfigured') setErr('Google OAuth is not configured on the server.')
    else if (p === 'error') setErr('Google connection failed — try again.')
    window.history.replaceState({}, '', '/integrations')
  }, [])

  const goConnectGoogle = (scope: 'search' | 'analytics') => { window.location.href = `${API_URL}/auth/google/data/connect?scope=${scope}` }
  async function disconnectGoogle() {
    if (!window.confirm('Disconnect Google? Search Console / Analytics data will stop loading.')) return
    setBusy(true); try { await api('/account/google', { method: 'DELETE' }); setNote('Google disconnected.'); await load() } finally { setBusy(false) }
  }

  async function connectMj() {
    if (!mjKey.trim() || !mjSecret.trim()) return
    setErr(''); setNote(''); setBusy(true)
    try { await api('/account/integrations/mailjet', { method: 'PUT', body: JSON.stringify({ apiKey: mjKey.trim(), apiSecret: mjSecret.trim(), listId: mjList.trim() }) }); setMjKey(''); setMjSecret(''); setMjList(''); setNote('Mailjet connected ✓'); await load() }
    catch (e: any) { setErr(e.message || 'Could not connect Mailjet') } finally { setBusy(false) }
  }
  async function disconnectMj() {
    if (!window.confirm('Disconnect Mailjet? Newsletter signups will stop being sent to it.')) return
    setBusy(true); try { await api('/account/integrations/mailjet', { method: 'DELETE' }); await load() } finally { setBusy(false) }
  }

  async function connect() {
    if (!token.trim()) return
    setErr(''); setNote(''); setBusy(true)
    try {
      await api('/account/integrations/cloudflare', { method: 'PUT', body: JSON.stringify({ apiToken: token.trim() }) })
      setToken(''); setNote('Cloudflare connected ✓'); await load()
    } catch (e: any) { setErr(e.message || 'Could not connect') } finally { setBusy(false) }
  }
  async function disconnect() {
    if (!window.confirm('Disconnect Cloudflare? Existing DNS records stay; you just remove the API token.')) return
    setBusy(true)
    try { await api('/account/integrations/cloudflare', { method: 'DELETE' }); setNote('Disconnected.'); await load() }
    finally { setBusy(false) }
  }

  return (
    <AppShell title="Integrations" active="Integrations">
      <div className="dash-sub" style={{ marginBottom: 22 }}>Connect external services. Credentials are stored securely on the server and never shown again.</div>

      <div className="ctl-group card" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#F6821F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>CF</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>Cloudflare</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Auto-configure DNS for your custom domains.</p>
          </div>
          {cf?.connected && <span className="status-pill live">Connected</span>}
        </div>

        {cf?.connected ? (
          <>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Token {cf.tokenHint} · verified{cf.verifiedAt ? ` ${new Date(cf.verifiedAt).toLocaleDateString()}` : ''}. You can now auto-set DNS from the <a href="/domains">Domains</a> page.</p>
            <button className="btn btn-secondary" onClick={disconnect} disabled={busy}>Disconnect</button>
          </>
        ) : (
          <>
            <div className="field">
              <label>Cloudflare API token</label>
              <input className="inp" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste your API token" />
              <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Create one at <b>Cloudflare → My Profile → API Tokens</b> with permission <b>Zone → DNS → Edit</b> for your zones. We verify it before saving.
              </p>
            </div>
            <button className="btn btn-primary" onClick={connect} disabled={busy || !token.trim()}>{busy ? 'Connecting…' : 'Connect Cloudflare'}</button>
          </>
        )}
      </div>

      <div className="ctl-group card" style={{ maxWidth: 640, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#FEAB00', color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>MJ</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>Mailjet</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Collect newsletter signups from your published sites.</p>
          </div>
          {mj?.connected && <span className="status-pill live">Connected</span>}
        </div>
        {mj?.connected ? (
          <>
            <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Key {mj.tokenHint}{mj.listId ? ` · list ${mj.listId}` : ''}. Newsletter forms in your footers &amp; articles now send to Mailjet.</p>
            <button className="btn btn-secondary" onClick={disconnectMj} disabled={busy}>Disconnect</button>
          </>
        ) : (
          <>
            <div className="field" style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}><label>API key</label><input className="inp" value={mjKey} onChange={(e) => setMjKey(e.target.value)} placeholder="Mailjet API key" /></div>
              <div style={{ flex: 1 }}><label>Secret key</label><input className="inp" type="password" value={mjSecret} onChange={(e) => setMjSecret(e.target.value)} placeholder="Secret key" /></div>
            </div>
            <div className="field"><label>Contact list ID <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label><input className="inp" value={mjList} onChange={(e) => setMjList(e.target.value)} placeholder="e.g. 10001234" /></div>
            <p className="muted" style={{ fontSize: 11, marginBottom: 12 }}>Find these in <b>Mailjet → Account settings → REST API / API Key Management</b>. The list ID (optional) adds each subscriber to that list.</p>
            <button className="btn btn-primary" onClick={connectMj} disabled={busy || !mjKey.trim() || !mjSecret.trim()}>{busy ? 'Connecting…' : 'Connect Mailjet'}</button>
          </>
        )}
      </div>

      <div className="ctl-group card" style={{ maxWidth: 640, marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#4285F4', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>G</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>Google Search Console &amp; Analytics</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Pull search performance &amp; traffic into your <a href="/insights">Insights</a> dashboard.</p>
          </div>
          {gs?.connected && <span className="status-pill live">Connected</span>}
        </div>

        {gs?.connected && <p className="muted" style={{ fontSize: 13, margin: '0 0 12px' }}>Connected as <b>{gs.email || 'your Google account'}</b>.</p>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="aside-block" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <b style={{ fontSize: 13 }}>Search Console</b>
              {gs?.searchConsole && <span className="status-pill live" style={{ fontSize: 10 }}>on</span>}
            </div>
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 8px' }}>Clicks, impressions, top queries.</p>
            <button className="btn-mini" onClick={() => goConnectGoogle('search')}>{gs?.searchConsole ? 'Reconnect' : 'Connect'}</button>
          </div>
          <div className="aside-block" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <b style={{ fontSize: 13 }}>Analytics (GA4)</b>
              {gs?.analytics && <span className="status-pill live" style={{ fontSize: 10 }}>on</span>}
            </div>
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 8px' }}>Sessions, users, top pages.</p>
            <button className="btn-mini" onClick={() => goConnectGoogle('analytics')}>{gs?.analytics ? 'Reconnect' : 'Connect'}</button>
          </div>
        </div>

        <p className="muted" style={{ fontSize: 11, marginTop: 10, marginBottom: gs?.connected ? 12 : 0 }}>
          Each teammate connects their own Google account. Search Console works immediately; Analytics needs Google to approve the app for the sensitive scope (until then it works for accounts added as test users). Site <b>verification</b> is still per-site under <b>Branding → SEO</b>.
        </p>
        {gs?.connected && <button className="btn btn-secondary" onClick={disconnectGoogle} disabled={busy}>Disconnect Google</button>}
      </div>

      {note && <div className="banner-ok" style={{ marginTop: 12, maxWidth: 640 }}>{note}</div>}
      {err && <div className="err" style={{ marginTop: 12, maxWidth: 640 }}>{err}</div>}
    </AppShell>
  )
}
