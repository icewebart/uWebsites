'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Tokens = { article_rules?: string[] } & Record<string, any>

// Kept in sync with DEFAULT_ARTICLE_RULES on the server.
const DEFAULT_RULES = [
  'Match the dominant search intent for the keyword (informational / how-to / comparison / commercial) and use the format searchers expect for it.',
  "Write in the site's own language and brand voice; never sound like a generic template or obvious AI filler.",
  'Answer the main question directly in the first 2–3 sentences (featured-snippet ready), then expand.',
  'Put the keyword near the front of the title (≤60 chars, click-worthy) and in the first 100 words, the meta description, and 1–2 H2s — naturally, never stuffed.',
  'Open with a specific hook (a number, outcome, or pain), not "Welcome" / "In this article".',
  'Cover the topic comprehensively: the main query plus the sub-questions and related searches a reader asks; match or exceed the depth of what already ranks.',
  'Turn "People Also Ask"-style questions into H2/H3 headings and answer each concisely.',
  'Use ordered lists for step-by-step processes and a comparison table when weighing options (snippet-friendly).',
  "Include the keyword's close variants and related entities/terms naturally (semantic coverage).",
  'Structure with a clear H1 → H2 → H3 hierarchy; one idea per paragraph; paragraphs under ~80 words; short sentences.',
  'Make it scannable: descriptive subheads, bullet lists, and bold the key takeaways.',
  'Add internal links to relevant pages on this site with descriptive anchor text (never "click here"); link to the hub/pillar and sibling pages.',
  'Add 1–2 links to authoritative external sources where a claim needs backing.',
  'Be genuinely useful and specific — real steps, examples, numbers — and include at least one insight the top results lack (E-E-A-T).',
  "Never invent facts, statistics, or testimonials; if you don't have a number, leave the claim out.",
  'Write evergreen: avoid phrasing that dates quickly ("this year"); prefer absolute references.',
  'Every image needs descriptive, keyword-aware alt text.',
  'End with a short FAQ (3–5 real questions) so it can earn an FAQ rich result.',
  'Semantic HTML only in the body: p, h2, h3, ul, ol, li, table, thead, tbody, tr, th, td, strong, em, a — no inline styles or scripts.',
]

export default function ArticleRulesPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [t, setT] = useState<Tokens | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(''); const [err, setErr] = useState('')

  useEffect(() => {
    api<{ tokens: Tokens }>(`/workspaces/${slug}/branding`).then((d) => {
      const tk = d.tokens || {}
      if (!Array.isArray(tk.article_rules) || !tk.article_rules.length) tk.article_rules = [...DEFAULT_RULES]
      setT(tk)
    }).catch(() => router.push(`/w/${slug}`))
  }, [slug])

  const rules = t?.article_rules || []
  const setRules = (r: string[]) => setT((c) => c ? { ...c, article_rules: r } : c)

  async function save() {
    if (!t) return
    setErr(''); setSaving(true)
    try { await api(`/workspaces/${slug}/branding`, { method: 'PUT', body: JSON.stringify({ tokens: t }) }); setSavedAt(new Date().toLocaleTimeString()) }
    catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (!t) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Article Rules" currentSlug={slug} active="Article Rules">
      <div className="dash-sub" style={{ marginBottom: 18 }}>
        The rules the AI follows every time it writes a new article (from <a href={`/w/${slug}/article-plan`}>Article Plan</a> or "Draft"). Edit them to match how <em>you</em> want articles written — combined with your <a href={`/w/${slug}/brand-voice`}>Brand Voice</a>.
      </div>

      <div className="ctl-group card">
        {rules.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 13, paddingTop: 9, width: 20, textAlign: 'right', flex: '0 0 auto' }}>{i + 1}.</span>
            <textarea className="inp" rows={2} style={{ flex: 1 }} value={r} onChange={(e) => setRules(rules.map((x, k) => k === i ? e.target.value : x))} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="btn-mini" title="Move up" disabled={i === 0} onClick={() => { const n = [...rules];[n[i - 1], n[i]] = [n[i], n[i - 1]]; setRules(n) }}>▲</button>
              <button className="btn-mini danger" title="Remove" onClick={() => setRules(rules.filter((_, k) => k !== i))}>✕</button>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button className="btn-mini" onClick={() => setRules([...rules, ''])}>＋ Add rule</button>
          <button className="btn-mini" onClick={() => setRules([...DEFAULT_RULES])} title="Reset to the recommended default rules">↺ Reset to defaults</button>
        </div>
      </div>

      {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
      <div className="save-row" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save rules'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>Applied to every new article the AI writes.</span>
      </div>
    </AppShell>
  )
}
