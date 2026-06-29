'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Totals = { workspaces: number; pages: number; drafts: number; published: number; domains: number }

// Stats page — real numbers where we have them, "Coming soon" placeholders for
// what's still wiring (analytics, AI usage, SEO scores). Linked properly later.
export default function StatsPage() {
  const router = useRouter()
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api<{ totals: Totals }>('/workspaces/overview').then((o) => setTotals(o.totals)).catch(() => router.push('/login')).finally(() => setLoading(false))
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

      <div className="dash-h">AI</div>
      <div className="dash-totals">
        <div className="t"><b>0</b><span>AI credits used (mo)</span></div>
        <div className="t"><b>0</b><span>Articles generated</span></div>
        <div className="t"><b>0</b><span>Sections rewritten</span></div>
        <div className="t"><b>0</b><span>Pages rebuilt</span></div>
      </div>

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
