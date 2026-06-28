'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Workspace = { id: string; name: string; slug: string }

export default function WorkspaceSettings() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [ws, setWs] = useState<Workspace | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    api<Workspace[]>('/workspaces').then((list) => {
      const found = list.find((w) => w.slug === slug)
      if (!found) { router.push('/'); return }
      setWs(found); setName(found.name)
    }).catch(() => router.push('/login')).finally(() => setLoading(false))
  }, [slug])

  async function save() {
    setErr(''); setSaving(true)
    try {
      await api(`/workspaces/${slug}`, { method: 'PUT', body: JSON.stringify({ name }) })
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading || !ws) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Settings" currentSlug={slug} active="Settings">
      <div style={{ maxWidth: 560 }}>
        <div className="ctl-group">
          <h3>Workspace</h3>
          <div className="field"><label>Workspace name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace name" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}><label>URL slug</label>
            <input value={ws.slug} disabled style={{ opacity: 0.6 }} />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>The slug is fixed to keep published URLs stable.</p>
          </div>
        </div>
        <div className="err">{err}</div>
        <div className="save-row">
          <button className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save changes'}</button>
          {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
        </div>

        <div className="ctl-group" style={{ marginTop: 32 }}>
          <h3>Domains</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Connect a custom domain so your published site lives at your own URL with HTTPS.</p>
          <a className="btn btn-secondary" href={`/w/${slug}/domains`}>Manage domains</a>
        </div>
      </div>
    </AppShell>
  )
}
