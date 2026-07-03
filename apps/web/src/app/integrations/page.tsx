'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type CF = { connected: boolean; verified: boolean; tokenHint: string | null; verifiedAt: string | null }

export default function IntegrationsPage() {
  const router = useRouter()
  const [cf, setCf] = useState<CF | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  function load() { return api<{ cloudflare: CF }>('/account/integrations').then((d) => setCf(d.cloudflare)) }
  useEffect(() => { load().catch(() => router.push('/login')) }, [])

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
        {note && <div className="banner-ok" style={{ marginTop: 12 }}>{note}</div>}
        {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      </div>
    </AppShell>
  )
}
