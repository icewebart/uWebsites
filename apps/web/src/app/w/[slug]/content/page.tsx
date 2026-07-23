'use client'
import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Overview = {
  articles: { total: number; published: number; drafts: number; needsReview: number }
  plan: { queued: number; total: number; auto: boolean }
  cadence: { perWeek: number; usedThisWeek: number; plan: string }
  wordpress: { siteUrl: string; postsCreated: number; lastPostAt: string | null; lastError: string | null; defaultStatus: string } | null
  lastArticleAt: string | null
  search: { totals?: { clicks?: number; impressions?: number; position?: number } | null } | null
  recent: { id: string; title: string; status: string; score: number | null; keyword: string | null }[]
}
type Msg = { role: 'user' | 'assistant'; content: string }

const nf = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(Math.round(n)))

export default function ContentOverviewPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [d, setD] = useState<Overview | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [err, setErr] = useState('')
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<Overview>(`/workspaces/${slug}/content/overview`).then(setD).catch(() => router.push(`/w/${slug}`))
  }, [slug])

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [msgs, thinking])

  async function send(text: string) {
    const q = text.trim()
    if (!q || thinking) return
    setErr(''); setInput('')
    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next); setThinking(true)
    try {
      const r = await api<{ reply: string }>(`/workspaces/${slug}/content/chat`, { method: 'POST', body: JSON.stringify({ messages: next }) })
      setMsgs([...next, { role: 'assistant', content: r.reply }])
    } catch (e: any) { setErr(e.message || 'The agent could not answer') } finally { setThinking(false) }
  }

  if (!d) return <div className="empty">Loading…</div>

  const cad = d.cadence
  const clicks = d.search?.totals?.clicks
  const stats: { label: string; value: string; hint?: string }[] = [
    { label: 'Published', value: String(d.articles.published) },
    { label: 'Drafts', value: String(d.articles.drafts) },
    ...(d.articles.needsReview ? [{ label: 'Needs review', value: String(d.articles.needsReview) }] : []),
    { label: 'Queued', value: String(d.plan.queued), hint: 'keywords waiting' },
    { label: 'Auto-write', value: d.plan.auto ? `on · ${cad.perWeek}/wk` : 'off' },
    { label: 'This week', value: `${cad.usedThisWeek}/${cad.perWeek >= 9999 ? '∞' : cad.perWeek}` },
    ...(clicks != null ? [{ label: 'Clicks 28d', value: nf(clicks) }] : []),
    ...(d.wordpress ? [{ label: 'WordPress', value: `${d.wordpress.postsCreated} sent` }] : []),
  ]

  const suggestions = [
    'What should I write next?',
    d.articles.needsReview ? 'What needs review and why?' : 'How is my content performing?',
    'Which page should I refresh?',
  ]

  return (
    <AppShell title="Content Overview" currentSlug={slug} active="Overview">
      {/* Stats — one line across the top */}
      <div className="cx-stats">
        {stats.map((s) => (
          <div className="cx-stat" key={s.label} title={s.hint || ''}>
            <span className="cx-stat-v">{s.value}</span>
            <span className="cx-stat-l">{s.label}</span>
          </div>
        ))}
      </div>

      {d.wordpress?.lastError && <div className="err" style={{ marginTop: 10 }}>WordPress: {d.wordpress.lastError}</div>}

      {/* Agent — scrollable transcript, composer pinned below */}
      <div className="cx-agent">
        <div className="cx-log" ref={scroller}>
          {msgs.length === 0 && (
            <div className="cx-empty">
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Ask about your content. I can see your plan, your articles and your Search Console data.
              </p>
              <div className="cx-sugg">
                {suggestions.map((s) => <button key={s} className="build-chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`cx-msg ${m.role}`}>
              <div className="cx-bubble">{m.content}</div>
            </div>
          ))}
          {thinking && <div className="cx-msg assistant"><div className="cx-bubble muted">Thinking…</div></div>}
        </div>
        {err && <div className="err" style={{ margin: '0 12px 8px' }}>{err}</div>}
        <form className="cx-composer" onSubmit={(e) => { e.preventDefault(); send(input) }}>
          <input className="inp" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your content, or what to write next…" />
          <button className="btn btn-primary" disabled={thinking || !input.trim()}>Send</button>
        </form>
      </div>
    </AppShell>
  )
}
