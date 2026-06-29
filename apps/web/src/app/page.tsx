'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Me = { id: string; email: string }
type SiteItem = {
  id: string; name: string; slug: string; createdAt: string
  pages: number; drafts: number; published: number; articles: number
  internalLinks: number; externalLinks: number
  homeId: string | null; homeTitle: string | null
  importSource: string | null
  lastPublishedAt: string | null
  connectedDomain: string | null
}
type Totals = {
  workspaces: number; pages: number; drafts: number; published: number; articles: number
  internalLinks: number; externalLinks: number; domains: number
}
type AiSummary = { creditsMonth: number; articles: number; rewrites: number; rebuilds: number; chats: number }
type Suggestion = { title: string; rationale: string; action?: string; impact: 'high' | 'medium' | 'low' }

function rel(d: string | null) {
  if (!d) return 'never'
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}
function publicUrl(s: SiteItem) {
  if (s.connectedDomain) return `https://${s.connectedDomain}`
  return `https://${s.slug}.uwebsites.net`
}

export default function Dashboard() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [items, setItems] = useState<SiteItem[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [ai, setAi] = useState<AiSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestLoading, setSuggestLoading] = useState(true)
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [user, overview] = await Promise.all([
          api<Me>('/auth/me'),
          api<{ items: SiteItem[]; totals: Totals; ai: AiSummary }>('/workspaces/overview'),
        ])
        setMe(user); setItems(overview.items); setTotals(overview.totals); setAi(overview.ai)
      } catch { router.push('/login') } finally { setLoading(false) }
      try {
        const s = await api<{ suggestions: Suggestion[] }>('/ai/dashboard-suggestions')
        setSuggestions(s.suggestions || [])
      } catch { /* non-fatal */ } finally { setSuggestLoading(false) }
    })()
  }, [])

  if (loading) return <div className="empty">Loading…</div>
  const name = me?.email?.split('@')[0] || 'there'
  const empty = items.length === 0
  const firstSlug = items[0]?.slug

  function submitPrompt(q: string) {
    const text = q.trim(); if (!text || !firstSlug) return
    router.push(`/w/${firstSlug}?chat=1&q=${encodeURIComponent(text)}`)
  }

  const QUICK_PROMPTS = [
    'Suggest 5 article topics based on this site',
    'Add a testimonials section to the homepage',
    'Rewrite my homepage to be sharper',
    'What\'s missing for a strong launch?',
  ]

  return (
    <AppShell title="Dashboard" active="Dashboard" hideWorkspaceSwitch>
      <div className="dash-greet">Hi, {name}.</div>
      <div className="dash-sub">{empty ? 'Let\'s set up your first website.' : `Here's what's happening across your ${items.length} ${items.length === 1 ? 'workspace' : 'workspaces'}.`}</div>

      {empty && (
        <div className="suggest">
          <div className="text">Create your first workspace to get started.</div>
          <a className="btn btn-primary" href="/onboarding">New workspace →</a>
        </div>
      )}

      {!empty && totals && (
        <>
          {/* TOP — KPI tiles */}
          <div className="dash-h">At a glance</div>
          <div className="kpi-grid">
            <Kpi value={totals.workspaces} label="Sites" />
            <Kpi value={totals.pages} label="Pages" />
            <Kpi value={totals.articles} label="Articles published" />
            <Kpi value={totals.drafts} label="Drafts" hint={totals.drafts > 0 ? 'pending review' : undefined} />
            <Kpi value={totals.internalLinks} label="Internal links" />
            <Kpi value={totals.externalLinks} label="External links" />
            <Kpi value={ai?.articles ?? 0} label="AI runs (30d)" />
            <Kpi value="—" label="Traffic (30d)" hint="Connect analytics" />
            <Kpi value="—" label="Pending articles" hint="From keywords" />
            <Kpi value={totals.domains} label="Custom domains" />
          </div>

          {/* MIDDLE — AI suggestions */}
          <div className="dash-h" style={{ marginTop: 28 }}>What to do next</div>
          {suggestLoading ? (
            <div className="ai-sug-card sk">
              <div className="sk-line" /><div className="sk-line short" /><div className="sk-line" />
            </div>
          ) : suggestions.length === 0 ? (
            <div className="ai-sug-card empty-state"><div>No suggestions right now — keep building.</div></div>
          ) : (
            <div className="ai-sug-list">
              {suggestions.map((s, i) => (
                <div key={i} className={`ai-sug-card impact-${s.impact}`}>
                  <div className="ai-sug-h">
                    <span className={`impact-pill ${s.impact}`}>{s.impact}</span>
                    <div className="ai-sug-title">{s.title}</div>
                  </div>
                  <div className="ai-sug-body">{s.rationale}</div>
                  {s.action && <div className="ai-sug-action">{s.action}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Sites */}
      {!empty && (
        <>
          <div className="dash-h" style={{ marginTop: 28 }}>Your sites</div>
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
                  <div className="site-url" title={publicUrl(s)}>{publicUrl(s).replace(/^https?:\/\//, '')}</div>
                  <div className="info">
                    <span>{s.pages} pages</span>
                    <span className="dot" />
                    <span>{s.drafts} drafts</span>
                    <span className="dot" />
                    <span className={`dot ${s.lastPublishedAt ? 'live' : ''}`} />
                    <span>{s.lastPublishedAt ? `published ${rel(s.lastPublishedAt)}` : 'not published'}</span>
                  </div>
                </div>
              </a>
            ))}
            <a className="site-card-add" href="/onboarding">＋ New site</a>
          </div>
        </>
      )}

      {/* BOTTOM — Prompt section */}
      {!empty && firstSlug && (
        <>
          <div className="dash-h" style={{ marginTop: 28 }}>Ask the AI assistant</div>
          <div className="prompt-card">
            <textarea
              className="prompt-ta"
              placeholder="What do you want to build today? Try 'add a pricing page', 'rewrite my homepage for clarity', or 'plan 10 blog posts on hiking gear'…"
              value={prompt} onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitPrompt(prompt) }}
            />
            <div className="prompt-row">
              <div className="prompt-quick">
                {QUICK_PROMPTS.map((p) => (
                  <button key={p} className="ai-prompt" onClick={() => setPrompt(p)}>{p}</button>
                ))}
              </div>
              <button className="btn btn-primary" onClick={() => submitPrompt(prompt)} disabled={!prompt.trim()}>Send →</button>
            </div>
            <div className="prompt-hint">⌘+Enter to send. Opens the chat panel inside your first workspace.</div>
          </div>
        </>
      )}
    </AppShell>
  )
}

function Kpi({ value, label, hint }: { value: string | number; label: string; hint?: string }) {
  return (
    <div className="kpi">
      <b>{value}</b>
      <span className="kpi-label">{label}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  )
}
