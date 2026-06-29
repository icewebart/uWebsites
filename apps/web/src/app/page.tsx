'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Me = { id: string; email: string }
type SiteItem = {
  id: string; name: string; slug: string; createdAt: string
  pages: number; drafts: number; published: number
  homeId: string | null; homeTitle: string | null
  importSource: string | null
  lastPublishedAt: string | null
  connectedDomain: string | null
}
type Totals = { workspaces: number; pages: number; drafts: number; published: number; domains: number }

function rel(d: string | null) {
  if (!d) return 'never'
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

export default function Dashboard() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<SiteItem[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const [user, overview] = await Promise.all([
          api<Me>('/auth/me'),
          api<{ items: SiteItem[]; totals: Totals }>('/workspaces/overview'),
        ])
        setMe(user); setItems(overview.items); setTotals(overview.totals)
      } catch { router.push('/login') } finally { setLoading(false) }
    })()
  }, [])

  if (loading) return <div className="empty">Loading…</div>
  const name = me?.email?.split('@')[0] || 'there'
  const empty = items.length === 0

  // Pick the most actionable nudge to surface up top.
  const suggestion = (() => {
    if (empty) return { text: 'Welcome — create your first workspace to get started.', cta: 'New workspace', href: '/onboarding' }
    const homeOnly = items.find((i) => i.pages === 1 && i.importSource)
    if (homeOnly) return { text: `${homeOnly.name}: homepage imported. Continue with the rest of ${homeOnly.importSource}.`, cta: 'Open workspace', href: `/w/${homeOnly.slug}` }
    const drafts = items.find((i) => i.drafts > 0)
    if (drafts) return { text: `${drafts.name} has ${drafts.drafts} drafts ready to review.`, cta: 'Review', href: `/w/${drafts.slug}` }
    const neverPublished = items.find((i) => !i.lastPublishedAt && i.pages > 0)
    if (neverPublished) return { text: `${neverPublished.name} has pages but isn’t published yet.`, cta: 'Publish', href: `/w/${neverPublished.slug}` }
    const noDomain = items.find((i) => i.lastPublishedAt && !i.connectedDomain)
    if (noDomain) return { text: `${noDomain.name} is live on a preview URL. Connect a custom domain.`, cta: 'Connect domain', href: `/w/${noDomain.slug}/domains` }
    return null
  })()

  return (
    <AppShell title="Dashboard" active="Dashboard">
      <div className="dash-greet">Hi, {name}.</div>
      <div className="dash-sub">{empty ? 'Let’s set up your first website.' : `Here’s what’s happening across your ${items.length} ${items.length === 1 ? 'workspace' : 'workspaces'}.`}</div>

      {suggestion && (
        <div className="suggest">
          <div className="text">{suggestion.text}</div>
          <a className="btn btn-primary" href={suggestion.href}>{suggestion.cta} →</a>
        </div>
      )}

      {!empty && totals && (
        <div className="dash-totals">
          <div className="t"><b>{totals.workspaces}</b><span>Sites</span></div>
          <div className="t"><b>{totals.pages}</b><span>Pages</span></div>
          <div className="t"><b>{totals.published}</b><span>Published</span></div>
          <div className="t"><b>{totals.drafts}</b><span>Drafts</span></div>
          <div className="t"><b>{totals.domains}</b><span>Custom domains</span></div>
        </div>
      )}

      <div className="dash-h">Your sites</div>
      <div className="site-cards">
        {items.map((s) => (
          <a className="site-card" key={s.id} href={`/w/${s.slug}`}>
            <div className="thumb">
              {s.homeId
                ? <iframe src={`${API_URL}/pages/${s.homeId}/preview`} title={s.name} />
                : <div className="ph">No homepage yet</div>}
            </div>
            <div className="body">
              <div className="name">{s.name}</div>
              <div className="info">
                <span>{s.pages} pages</span>
                <span className="dot" />
                <span>{s.drafts} drafts</span>
                <span className="dot" />
                <span className={`dot ${s.lastPublishedAt ? 'live' : ''}`} />
                <span>{s.lastPublishedAt ? `published ${rel(s.lastPublishedAt)}` : 'not published'}</span>
              </div>
              {s.connectedDomain && <div className="domain">{s.connectedDomain}</div>}
            </div>
          </a>
        ))}
        <a className="site-card-add" href="/onboarding">＋ New site</a>
      </div>
    </AppShell>
  )
}
