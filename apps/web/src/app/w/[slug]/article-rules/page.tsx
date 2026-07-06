'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Tokens = { article_rules?: string[] } & Record<string, any>

// Kept in sync with DEFAULT_ARTICLE_RULES on the server.
const DEFAULT_RULES = [
  "Write in the site's own language and brand voice; never sound like a generic template.",
  'Put the target keyword in the title/H1, the first paragraph, the meta description, and 1–2 H2 headings — naturally, never stuffed.',
  'Open with a specific hook (a number, outcome, or pain), not "Welcome" / "In this article".',
  'Structure with clear H2/H3 sections; one idea per paragraph; paragraphs under 80 words.',
  'Be genuinely useful and concrete — real steps, examples, and specifics over fluff.',
  'Cover related/semantic terms and the questions a reader would ask (search intent).',
  'End with a short FAQ (3–5 real questions) so it can earn an FAQ rich result.',
  'Add internal links to relevant pages on this site where it helps the reader.',
  'Target ~700–1200 words unless the topic clearly needs more; quality over length.',
  'Semantic HTML only in the body: p, h2, h3, ul, li, strong, em, a — no inline styles or scripts.',
  'Never invent facts, fake statistics, or fake testimonials.',
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
