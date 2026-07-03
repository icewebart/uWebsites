'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Ws = { id: string; name: string; slug: string }
type Dom = { id: string; hostname: string; status: string; sslStatus: string; workspaceId: string; workspace: Ws | null }
type Data = { serverIp: string; cfConnected: boolean; domains: Dom[]; workspaces: Ws[] }

export default function DomainsPage() {
  const router = useRouter()
  const [d, setD] = useState<Data | null>(null)
  const [host, setHost] = useState('')
  const [wsId, setWsId] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  function load() { return api<Data>('/account/domains').then((r) => { setD(r); if (!wsId && r.workspaces[0]) setWsId(r.workspaces[0].id) }) }
  useEffect(() => { load().catch(() => router.push('/login')) }, [])

  async function add() {
    if (!host.trim() || !wsId) return
    setErr(''); setNote(''); setAdding(true)
    try { await api('/account/domains', { method: 'POST', body: JSON.stringify({ hostname: host.trim(), workspaceId: wsId }) }); setHost(''); await load() }
    catch (e: any) { setErr(e.message || 'Could not add domain') } finally { setAdding(false) }
  }
  async function reassign(dom: Dom, workspaceId: string) {
    await api(`/account/domains/${dom.id}`, { method: 'PATCH', body: JSON.stringify({ workspaceId }) }); await load()
  }
  async function del(dom: Dom) {
    if (!window.confirm(`Remove ${dom.hostname}?`)) return
    setBusyId(dom.id); try { await api(`/account/domains/${dom.id}`, { method: 'DELETE' }); await load() } finally { setBusyId(null) }
  }
  async function autoDns(dom: Dom) {
    setBusyId(dom.id); setErr(''); setNote('')
    try { const r = await api<{ zone: string; records: string[] }>(`/account/domains/${dom.id}/cloudflare-dns`, { method: 'POST' }); setNote(`DNS set on ${r.zone}: ${r.records.join(', ')} → ${d?.serverIp}. Give it a few minutes to propagate.`); await load() }
    catch (e: any) { setErr(e.message || 'DNS setup failed') } finally { setBusyId(null) }
  }

  if (!d) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Domains" active="Domains">
      <div className="dash-sub" style={{ marginBottom: 18 }}>Connect your own domains and assign each to a workspace. Point the domain's DNS to <b>{d.serverIp}</b> — or let Cloudflare do it automatically.</div>

      <div className="ctl-group card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px' }}><label className="muted" style={{ fontSize: 12 }}>Domain</label><input className="inp" value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" /></div>
          <div style={{ flex: '1 1 200px' }}><label className="muted" style={{ fontSize: 12 }}>Workspace</label>
            <select className="inp" value={wsId} onChange={(e) => setWsId(e.target.value)}>{d.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </div>
          <button className="btn btn-primary" onClick={add} disabled={adding || !host.trim()}>{adding ? 'Adding…' : '＋ Add domain'}</button>
        </div>
        {!d.cfConnected && <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>Tip: <a href="/integrations">connect Cloudflare</a> to auto-configure DNS instead of editing records by hand.</p>}
      </div>

      {note && <div className="banner-ok" style={{ marginBottom: 12 }}>{note}</div>}
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {d.domains.length === 0 ? (
        <div className="aside-block" style={{ textAlign: 'center', padding: 36 }}><p className="muted">No domains yet. Add your first one above.</p></div>
      ) : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Domain</th><th style={{ width: 200 }}>Workspace</th><th style={{ width: 110 }}>Status</th><th style={{ width: 260 }}>Actions</th></tr></thead>
          <tbody>
            {d.domains.map((dom) => (
              <tr key={dom.id}>
                <td><b>{dom.hostname}</b></td>
                <td>
                  <select className="inp" style={{ padding: '5px 8px', fontSize: 13 }} value={dom.workspaceId} onChange={(e) => reassign(dom, e.target.value)}>
                    {d.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </td>
                <td><span className={`status-pill ${dom.status === 'connected' ? 'live' : 'draft'}`}>{dom.status}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {d.cfConnected && <button className="btn-mini" disabled={busyId === dom.id} onClick={() => autoDns(dom)} title="Create the A records on Cloudflare automatically">{busyId === dom.id ? '…' : '☁ Auto DNS'}</button>}
                    {dom.workspace && <a className="btn-mini" href={`/w/${dom.workspace.slug}/domains`} title="Verify DNS + issue HTTPS">Verify / SSL</a>}
                    <button className="btn-mini danger" disabled={busyId === dom.id} onClick={() => del(dom)}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <div className="ctl-group card" style={{ marginTop: 20 }}>
        <h3>DNS records (manual)</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>If you're not using Cloudflare auto-DNS, add these at your registrar:</p>
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>A</td><td>@</td><td>{d.serverIp}</td></tr>
            <tr><td>A</td><td>www</td><td>{d.serverIp}</td></tr>
          </tbody>
        </table></div>
      </div>
    </AppShell>
  )
}
