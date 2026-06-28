'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Workspace = { id: string; name: string; slug: string }
type Overview = { workspaces: number; pages: number; articles: number; published: number }

const FEATURES = [
  { title: 'Import & rebuild', desc: 'Pull a WordPress site in and rebuild it as clean, typed pages with redirects.', status: 'live' },
  { title: 'Page editor', desc: 'Edit any page as on-brand blocks — hero, text and more.', status: 'live' },
  { title: 'Branding', desc: 'Per-workspace colors, fonts, roundedness and spacing — importable from any site.', status: 'live' },
  { title: 'Static publishing', desc: 'Compile a workspace to a fast, secure static site.', status: 'live' },
  { title: 'AI page generation', desc: 'Generate full pages and rewrite sections with Claude.', status: 'live' },
  { title: 'AI content engine', desc: 'Search-Console-driven weekly articles with images and a learning loop.', status: 'soon' },
  { title: 'Keyword & content gaps', desc: "Find what competitors rank for and you don't.", status: 'soon' },
  { title: 'Backlink network', desc: 'Matched link partners with AI-drafted outreach.', status: 'soon' },
  { title: 'Site audit', desc: 'Crawl-based health checks with AI prioritisation.', status: 'soon' },
  { title: 'Content calendar', desc: 'Plan and schedule publishing across workspaces.', status: 'soon' },
]

export default function Dashboard() {
  const router = useRouter()
  const [ov, setOv] = useState<Overview | null>(null)
  const [wss, setWss] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [o, w] = await Promise.all([api<Overview>('/workspaces/overview'), api<Workspace[]>('/workspaces')])
        setOv(o); setWss(w)
      } catch { router.push('/login') } finally { setLoading(false) }
    })()
  }, [])

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Dashboard" active="Dashboard">
      <div className="dash-stats">
        <div className="dstat"><b>{wss.length}</b><span>Workspaces</span></div>
        <div className="dstat"><b>{ov?.pages ?? 0}</b><span>Pages</span></div>
        <div className="dstat"><b>{ov?.articles ?? 0}</b><span>Articles</span></div>
        <div className="dstat"><b>{ov?.published ?? 0}</b><span>Published sites</span></div>
      </div>

      <div className="dash-h">Your workspaces</div>
      <div className="ws-cards">
        {wss.map((w) => (
          <a className="ws-card" key={w.id} href={`/w/${w.slug}`}>
            <div className="ic">{w.name.slice(0, 1).toUpperCase()}</div>
            <h3>{w.name}</h3>
            <div className="meta">/{w.slug}</div>
          </a>
        ))}
        <a className="ws-card add" href="/onboarding">＋ New workspace</a>
      </div>

      <div className="dash-h">Your platform</div>
      <div className="feat-grid">
        {FEATURES.map((f) => (
          <div className="feat" key={f.title}>
            <span className={`fbadge ${f.status}`}>{f.status === 'live' ? 'Live' : 'Soon'}</span>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>
    </AppShell>
  )
}
