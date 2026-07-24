'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

// Merged "how the AI writes" page — brand voice + few-shot examples + the
// per-article SEO rules. All three live on branding tokens and save together.

type Example = { label: string; text: string }
type Tokens = { voice?: string; tagline?: string; voice_examples?: Example[]; article_rules?: string[] } & Record<string, any>

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

export default function VoiceRulesPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [t, setT] = useState<Tokens | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    api<{ tokens: Tokens }>(`/workspaces/${slug}/branding`).then((d) => {
      const tk = d.tokens || {}
      if (!Array.isArray(tk.article_rules) || !tk.article_rules.length) tk.article_rules = [...DEFAULT_RULES]
      setT(tk)
    }).catch(() => router.push(`/w/${slug}`))
  }, [slug])

  const set = (patch: Partial<Tokens>) => setT((c) => c ? { ...c, ...patch } : c)

  // Infer voice + tagline + two example passages from the business, then leave
  // everything editable — the AI fills the blank page, the owner tweaks & saves.
  async function suggestVoice() {
    setErr(''); setNote(''); setSuggesting(true)
    try {
      const d = await api<{ voice: string; tagline: string; examples: Example[] }>('/ai/suggest-voice', { method: 'POST', body: JSON.stringify({ slug }) })
      // Don't clobber a tagline the owner already wrote; merge in the examples.
      const merged = [...(t?.voice_examples || []).filter((e) => e.text.trim()), ...(d.examples || [])].slice(0, 5)
      set({ voice: d.voice || t?.voice, tagline: t?.tagline?.trim() ? t.tagline : (d.tagline || t?.tagline), voice_examples: merged })
      setNote('Filled from your site — edit anything, then Save.')
    } catch (e: any) { setErr(e.message || 'Could not suggest a voice') } finally { setSuggesting(false) }
  }
  const setEx = (i: number, patch: Partial<Example>) => set({ voice_examples: (t?.voice_examples || []).map((e, k) => k === i ? { ...e, ...patch } : e) })
  const setRules = (r: string[]) => set({ article_rules: r })

  async function save() {
    if (!t) return
    setErr(''); setSaving(true)
    try { await api(`/workspaces/${slug}/branding`, { method: 'PUT', body: JSON.stringify({ tokens: t }) }); setSavedAt(new Date().toLocaleTimeString()) }
    catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (!t) return <div className="empty">Loading…</div>
  const examples = t.voice_examples || []
  const rules = t.article_rules || []

  return (
    <AppShell title="Voice & Rules" currentSlug={slug} active="Voice & Rules">
      <div className="dash-sub" style={{ marginBottom: 18 }}>
        How the AI writes for you. Your <b>voice</b> shapes tone; the <b>rules</b> below are applied to every article. Together they make content read like <em>you</em>, not a template.
      </div>

      <div className="dash-h" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span>Voice &amp; tagline</span>
        <button className="btn-mini" style={{ marginLeft: 'auto' }} onClick={suggestVoice} disabled={suggesting}
          title="Let the AI infer your voice, tagline and two example passages from your Business Brief and site — then edit anything.">
          {suggesting ? 'Thinking…' : '✦ Suggest from my site'}
        </button>
      </div>
      {note && <div className="banner-ok" style={{ marginBottom: 10 }}>{note}</div>}
      <div className="ctl-group card">
        <div className="field">
          <label>Tagline</label>
          <input className="inp" value={t.tagline || ''} placeholder='e.g. "German for kids, through play"' onChange={(e) => set({ tagline: e.target.value })} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Brand voice / personality</label>
          <textarea className="inp" rows={4} value={t.voice || ''} placeholder='e.g. "Warm and encouraging, speaks directly to parents, concrete outcomes over hype, one light joke is fine, never corporate. Short sentences. Romanian, informal (tu)."' onChange={(e) => set({ voice: e.target.value })} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Cover: tone, who you speak to, what to avoid, sentence length, language &amp; formality. Leave blank to use the auto-detected voice for your industry.</p>
        </div>
      </div>

      <div className="dash-h" style={{ marginTop: 22 }}>Writing examples <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(few-shot — the AI mimics these)</span></div>
      <div className="ctl-group card">
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Paste 1–3 short passages that sound exactly right (an intro paragraph, an "about" blurb, a real email). Concrete examples steer the AI far better than adjectives.</p>
        {examples.map((ex, i) => (
          <div className="field" key={i} style={{ paddingBottom: 8, borderBottom: '1px dashed var(--border)' }}>
            <label>Example {i + 1}</label>
            <input className="inp" placeholder="Label (e.g. Homepage intro, Newsletter)" value={ex.label} onChange={(e) => setEx(i, { label: e.target.value })} />
            <textarea className="inp" style={{ marginTop: 6 }} rows={3} placeholder="Paste a passage that sounds like your brand…" value={ex.text} onChange={(e) => setEx(i, { text: e.target.value })} />
            <button className="btn-mini danger" style={{ marginTop: 6 }} onClick={() => set({ voice_examples: examples.filter((_, k) => k !== i) })}>Remove</button>
          </div>
        ))}
        {examples.length < 5 && <button className="btn-mini" onClick={() => set({ voice_examples: [...examples, { label: '', text: '' }] })}>＋ Add example</button>}
      </div>

      <div className="dash-h" style={{ marginTop: 22 }}>Article rules <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(applied to every article the AI writes)</span></div>
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
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
      </div>
    </AppShell>
  )
}
