'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Workspace = { id: string; name: string; slug: string; status?: string }
type Me = { id: string; email: string }

export default function Dashboard() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const user = await api<Me>('/auth/me')
      setMe(user)
      const ws = await api<Workspace[]>('/workspaces')
      setWorkspaces(ws)
    } catch {
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function createWorkspace() {
    const name = window.prompt('New workspace name (e.g. Gutenberg)')
    if (!name) return
    try {
      await api('/workspaces', { method: 'POST', body: JSON.stringify({ name }) })
      load()
    } catch (e: any) { alert(e.message || 'Could not create workspace') }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Workspaces">
      {workspaces.length === 0 ? (
        <div className="empty">
          <p>No workspaces yet.</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={createWorkspace}>+ Create your first workspace</button>
        </div>
      ) : (
        <div className="grid">
          {workspaces.map((w) => (
            <div className="card" key={w.id}>
              <div className="ws-ic">{w.name.slice(0, 1).toUpperCase()}</div>
              <h3>{w.name}</h3>
              <div className="meta">/{w.slug}</div>
            </div>
          ))}
          <div className="card add" onClick={createWorkspace}>
            <div style={{ fontSize: 24 }}>＋</div>
            <div>New workspace</div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
