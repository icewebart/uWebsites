'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

type Workspace = { id: string; name: string; slug: string }
type Me = { id: string; email: string }

const NAV = ['Workspaces', 'Imports', 'Articles', 'Branding', 'Settings']
const PROFILE_ITEMS = ['Settings', 'Integrations', 'Email Setup', 'Billing']

export function AppShell({ title, currentSlug, children }: { title: string; currentSlug?: string; children: React.ReactNode }) {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsOpen, setWsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    api<Me>('/auth/me').then(setMe).catch(() => {})
    api<Workspace[]>('/workspaces').then(setWorkspaces).catch(() => {})
  }, [])

  const current = workspaces.find((w) => w.slug === currentSlug) || workspaces[0] || null
  const others = workspaces.filter((w) => w.id !== current?.id)
  const displayName = me?.email ? me.email.split('@')[0] : 'You'

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    router.push('/login')
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand"><img className="logo-full" src="/uwebsites.svg" alt="uWebsites" /></div>
        <nav className="sidebar-nav">
          {NAV.map((label) => (
            <div key={label} className={`sidebar-link${label === 'Workspaces' ? ' active' : ''}`}>{label}</div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-link" onClick={logout}>Sign out</div>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h2>{title}</h2>
          <div className="topbar-right">
            <input className="topbar-search" placeholder="Search…" />

            <div className="ws-switch">
              <button className="ws-chip" onClick={() => setWsOpen((o) => !o)} onBlur={() => setTimeout(() => setWsOpen(false), 150)}>
                <span className="ws-ava">{(current?.name || '·').slice(0, 1).toUpperCase()}</span>
                {current?.name || 'Workspace'} <span className="chev">▾</span>
              </button>
              {wsOpen && (
                <div className="ws-menu">
                  {current && (<>
                    <div className="ws-menu-label">Current workspace</div>
                    <div className="ws-item"><span className="ws-ava">{current.name.slice(0, 1).toUpperCase()}</span>{current.name}<span className="check">✓</span></div>
                  </>)}
                  {others.length > 0 && <div className="ws-menu-label">Switch to</div>}
                  {others.map((w) => (
                    <a key={w.id} className="ws-item" href={`/w/${w.slug}`}>
                      <span className="ws-ava">{w.name.slice(0, 1).toUpperCase()}</span>{w.name}
                    </a>
                  ))}
                  <a className="ws-item add" href="/onboarding">＋ Create new workspace</a>
                </div>
              )}
            </div>

            <span className="plan-badge">FREE</span>
            <button className="bell" aria-label="Notifications">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              <span className="dot" />
            </button>

            <div className="profile-switch">
              <button className="user" onClick={() => setProfileOpen((o) => !o)} onBlur={() => setTimeout(() => setProfileOpen(false), 150)}>
                <div className="user-meta"><b>{displayName}</b><span>{current?.name || ''}</span></div>
                <span className="user-ava">{displayName.slice(0, 1).toUpperCase()}</span>
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <div className="profile-head"><b>{displayName}</b><span>{current?.name || ''}</span></div>
                  {PROFILE_ITEMS.map((label) => (
                    <button key={label} className="profile-item" onClick={() => { /* TODO: route */ }}>{label}</button>
                  ))}
                  <button className="profile-item danger" onClick={logout}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  )
}
