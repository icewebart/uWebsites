'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Workspace = { id: string; name: string; slug: string }
type Me = { user: { id: string; name: string; email: string } }

export default function WorkspaceSettings() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [ws, setWs] = useState<Workspace | null>(null)
  const [wsName, setWsName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [loading, setLoading] = useState(true)

  const [savingWs, setSavingWs] = useState(false)
  const [savingAcc, setSavingAcc] = useState(false)
  const [wsSavedAt, setWsSavedAt] = useState('')
  const [accSavedAt, setAccSavedAt] = useState('')
  const [wsErr, setWsErr] = useState('')
  const [accErr, setAccErr] = useState('')

  useEffect(() => {
    Promise.all([
      api<Workspace[]>('/workspaces'),
      api<Me>('/auth/me'),
    ]).then(([list, me]) => {
      const found = list.find((w) => w.slug === slug)
      if (!found) { router.push('/'); return }
      setWs(found); setWsName(found.name)
      setAccountName(me.user.name || ''); setAccountEmail(me.user.email || '')
    }).catch(() => router.push('/login')).finally(() => setLoading(false))
  }, [slug])

  async function saveWs() {
    setWsErr(''); setSavingWs(true)
    try {
      await api(`/workspaces/${slug}`, { method: 'PUT', body: JSON.stringify({ name: wsName }) })
      setWsSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setWsErr(e.message || 'Save failed') } finally { setSavingWs(false) }
  }

  async function saveAccount() {
    setAccErr(''); setSavingAcc(true)
    try {
      await api('/auth/me', { method: 'PUT', body: JSON.stringify({ name: accountName }) })
      setAccSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setAccErr(e.message || 'Save failed') } finally { setSavingAcc(false) }
  }

  if (loading || !ws) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Settings" currentSlug={slug} active="Settings">
      <div style={{ maxWidth: 640 }}>
        <div className="ctl-group">
          <h3>Your account</h3>
          <div className="field"><label>Name</label>
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Your name" />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Shown in the topbar and greetings.</p>
          </div>
          <div className="field" style={{ marginBottom: 0 }}><label>Email</label>
            <input value={accountEmail} disabled style={{ opacity: 0.6 }} />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Email changes need re-verification — coming soon.</p>
          </div>
          <div className="err">{accErr}</div>
          <div className="save-row">
            <button className="btn btn-primary" onClick={saveAccount} disabled={savingAcc || !accountName.trim()}>{savingAcc ? 'Saving…' : 'Save account'}</button>
            {accSavedAt && <span className="saved-tag">Saved {accSavedAt}</span>}
          </div>
        </div>

        <div className="ctl-group" style={{ marginTop: 32 }}>
          <h3>Workspace</h3>
          <div className="field"><label>Workspace name</label>
            <input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Workspace name" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}><label>URL slug</label>
            <input value={ws.slug} disabled style={{ opacity: 0.6 }} />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>The slug is fixed to keep published URLs stable.</p>
          </div>
          <div className="err">{wsErr}</div>
          <div className="save-row">
            <button className="btn btn-primary" onClick={saveWs} disabled={savingWs || !wsName.trim()}>{savingWs ? 'Saving…' : 'Save workspace'}</button>
            {wsSavedAt && <span className="saved-tag">Saved {wsSavedAt}</span>}
          </div>
        </div>

        <div className="ctl-group" style={{ marginTop: 32 }}>
          <h3>Domains</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Connect a custom domain so your published site lives at your own URL with HTTPS.</p>
          <a className="btn btn-secondary" href={`/w/${slug}/domains`}>Manage domains</a>
        </div>

        <div className="ctl-group" style={{ marginTop: 32 }}>
          <h3>Danger zone</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Workspace deletion is destructive and currently unsupported in the UI. Reach out at <a href="mailto:support@uwebsites.net">support@uwebsites.net</a> if you need to remove a workspace.</p>
        </div>
      </div>
    </AppShell>
  )
}
