'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type CF = { connected: boolean; verified: boolean; tokenHint: string | null; verifiedAt: string | null }
type MJ = { connected: boolean; tokenHint: string | null; listId: string | null; verifiedAt: string | null }

export default function IntegrationsPage() {
  const router = useRouter()
  const [cf, setCf] = useState<CF | null>(null)
  const [mj, setMj] = useState<MJ | null>(null)
  const [token, setToken] = useState('')
  const [mjKey, setMjKey] = useState(''); const [mjSecret, setMjSecret] = useState(''); const [mjList, setMjList] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  function load() { return api<{ cloudflare: CF; mailjet: MJ }>('/account/integrations').then((d) => { setCf(d.cloudflare); setMj(d.mailjet) }) }
  useEffect(() => { load().catch(() => router.push('/login')) }, [])

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
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#4285F4', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>GSC</div>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>Google Search Console</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Get your site indexed &amp; track search performance.</p>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          Verification is per-site: add your <b>google-site-verification</b> tag under each workspace's <b>Branding → SEO &amp; Search Console</b>, then Publish. Every published site also ships a <code>robots.txt</code> + <code>sitemap.xml</code> and pings Bing on publish. (Full search-performance dashboards via OAuth are on the roadmap.)
        </p>
      </div>

      {note && <div className="banner-ok" style={{ marginTop: 12, maxWidth: 640 }}>{note}</div>}
      {err && <div className="err" style={{ marginTop: 12, maxWidth: 640 }}>{err}</div>}
    </AppShell>
  )
}
