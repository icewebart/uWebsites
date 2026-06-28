'use client'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

export function AppShell({ title, email, children }: { title: string; email?: string; children: React.ReactNode }) {
  const router = useRouter()
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    router.push('/login')
  }
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="mk">u</span> uWebsites</div>
        <nav className="sidebar-nav">
          <div className="sidebar-link active">🗂️ Workspaces</div>
          <div className="sidebar-link">📥 Imports</div>
          <div className="sidebar-link">✍️ Articles</div>
          <div className="sidebar-link">🎨 Branding</div>
          <div className="sidebar-link">⚙️ Settings</div>
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-link" onClick={logout}>↩︎ Sign out</div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <h2>{title}</h2>
          {email ? <span className="muted" style={{ fontSize: 13 }}>{email}</span> : null}
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  )
}
