'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Domain = { id: string; hostname: string; status: string; sslStatus: string; dnsVerifiedAt: string | null }

export default function DomainsPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [serverIp, setServerIp] = useState('')
  const [domains, setDomains] = useState<Domain[]>([])
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [verifyErr, setVerifyErr] = useState<Record<string, string>>({})

  async function load() {
    try {
      const r = await api<{ serverIp: string; domains: Domain[] }>(`/workspaces/${slug}/domains`)
      setServerIp(r.serverIp); setDomains(r.domains)
    } catch { router.push(`/w/${slug}`) }
  }
  useEffect(() => { load() }, [slug])

  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await api(`/workspaces/${slug}/domains`, { method: 'POST', body: JSON.stringify({ hostname: host.trim().toLowerCase() }) })
      setHost(''); load()
    } catch (e: any) { setErr(e.message || 'Could not add domain') } finally { setBusy(false) }
  }

  async function verify(d: Domain) {
    setVerifyErr((m) => ({ ...m, [d.id]: '' })); setVerifyingId(d.id)
    try {
      await api(`/workspaces/${slug}/domains/${d.id}/verify`, { method: 'POST' })
      load()
    } catch (e: any) { setVerifyErr((m) => ({ ...m, [d.id]: e.message || 'Verification failed' })) }
    finally { setVerifyingId(null) }
  }

  async function remove(d: Domain) {
    if (!window.confirm(`Disconnect ${d.hostname}?`)) return
    try { await api(`/workspaces/${slug}/domains/${d.id}`, { method: 'DELETE' }); load() }
    catch (e: any) { alert(e.message || 'Remove failed') }
  }

  const copy = (s: string) => navigator.clipboard?.writeText(s)

  return (
    <AppShell title="Domains" currentSlug={slug} active="Settings">
      <div style={{ maxWidth: 760 }}>
        <form onSubmit={add} style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
          <input className="inp" value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" style={{ flex: 1 }} />
          <button className="btn btn-primary" disabled={busy || !host.trim()}>{busy ? 'Adding…' : 'Add domain'}</button>
        </form>
        {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

        {domains.length === 0 ? (
          <div className="empty">No domains connected yet.</div>
        ) : (
          domains.map((d) => (
            <div className="dom-row" key={d.id}>
              <div className="head">
                <span className="host">{d.hostname}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={`dom-status ${d.status}`}>{d.status}</span>
                  {d.status === 'connected' ? (
                    <a className="btn btn-ghost" href={`https://${d.hostname}/`} target="_blank" rel="noreferrer">Open ↗</a>
                  ) : (
                    <button className="btn btn-primary" onClick={() => verify(d)} disabled={verifyingId === d.id}>
                      {verifyingId === d.id ? 'Verifying…' : 'Verify & connect'}
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={() => remove(d)} title="Disconnect">✕</button>
                </div>
              </div>

              {d.status !== 'connected' && (
                <div className="dns-help">
                  <div style={{ color: 'var(--text-muted)', marginBottom: 8 }}>Add these DNS records at your registrar (Cloudflare, etc.). Set the proxy to <strong>DNS only</strong> (grey cloud) for setup — you can re-enable it after.</div>
                  <table>
                    <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
                    <tbody>
                      <tr><td>A</td><td>@ <span className="copy-tag" onClick={() => copy('@')}>copy</span></td><td>{serverIp} <span className="copy-tag" onClick={() => copy(serverIp)}>copy</span></td></tr>
                      <tr><td>A</td><td>www <span className="copy-tag" onClick={() => copy('www')}>copy</span></td><td>{serverIp} <span className="copy-tag" onClick={() => copy(serverIp)}>copy</span></td></tr>
                    </tbody>
                  </table>
                </div>
              )}
              {verifyErr[d.id] && <div className="err" style={{ marginTop: 10 }}>{verifyErr[d.id]}</div>}
            </div>
          ))
        )}

        <p className="muted" style={{ fontSize: 12, marginTop: 18 }}>
          After "Verify &amp; connect" succeeds, your latest published site is live at <code>https://your-domain</code>. SSL is issued automatically via Let's Encrypt and auto-renews.
        </p>
      </div>
    </AppShell>
  )
}
