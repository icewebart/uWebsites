'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Totals = { workspaces: number; pages: number; drafts: number; published: number; domains: number }
type Ai = { creditsMonth: number; articles: number; rewrites: number; rebuilds: number; chats: number }

// Stats page — real numbers where we have them, "—" for ones still wiring
// (analytics, SEO scores). Linked properly later.
export default function StatsPage() {
  const router = useRouter()
  const [totals, setTotals] = useState<Totals | null>(null)
  const [ai, setAi] = useState<Ai | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api<{ totals: Totals; ai: Ai }>('/workspaces/overview').then((o) => { setTotals(o.totals); setAi(o.ai) }).catch(() => router.push('/login')).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Stats" active="Stats">
      <div className="dash-greet">Stats</div>
      <div className="dash-sub">Snapshot of your sites, content, and AI usage. Charts and SEO metrics are coming soon.</div>

      <div className="dash-h">Sites &amp; content</div>
      <div className="dash-totals">
        <div className="t"><b>{totals?.workspaces ?? 0}</b><span>Sites</span></div>
        <div className="t"><b>{totals?.pages ?? 0}</b><span>Pages</span></div>
        <div className="t"><b>{totals?.published ?? 0}</b><span>Published</span></div>
        <div className="t"><b>{totals?.drafts ?? 0}</b><span>Drafts</span></div>
      </div>

      <div className="dash-h">AI (last 30 days)</div>
      <div className="dash-totals">
        <div className="t"><b>{ai?.creditsMonth ?? 0}</b><span>AI credits used</span></div>
        <div className="t"><b>{ai?.articles ?? 0}</b><span>Articles generated</span></div>
        <div className="t"><b>{ai?.rewrites ?? 0}</b><span>Sections rewritten</span></div>
        <div className="t"><b>{ai?.rebuilds ?? 0}</b><span>Pages rebuilt</span></div>
      </div>
      {ai && ai.chats > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: -16, marginBottom: 24 }}>+ {ai.chats} chat turn{ai.chats === 1 ? '' : 's'}</div>
      )}

      <div className="dash-h">Performance</div>
      <div className="dash-totals">
        <div className="t"><b>{totals?.domains ?? 0}</b><span>Custom domains</span></div>
        <div className="t"><b>—</b><span>Page views (last 30d)</span></div>
        <div className="t"><b>—</b><span>Avg SEO score</span></div>
        <div className="t"><b>—</b><span>Avg CWV (mobile)</span></div>
      </div>

      <div className="dash-h">Trends</div>
      <div className="stats-placeholder">
        <div className="ph-chart">Publishing activity — chart coming soon</div>
        <div className="ph-chart">Content growth — chart coming soon</div>
      </div>
    </AppShell>
  )
}
