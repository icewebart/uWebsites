'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Example = { label: string; text: string }
type Tokens = { voice?: string; tagline?: string; voice_examples?: Example[] } & Record<string, any>

export default function BrandVoicePage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [t, setT] = useState<Tokens | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ tokens: Tokens }>(`/workspaces/${slug}/branding`).then((d) => setT(d.tokens || {})).catch(() => router.push(`/w/${slug}`))
  }, [slug])

  const set = (patch: Partial<Tokens>) => setT((c) => c ? { ...c, ...patch } : c)
  const setEx = (i: number, patch: Partial<Example>) => set({ voice_examples: (t?.voice_examples || []).map((e, k) => k === i ? { ...e, ...patch } : e) })

  async function save() {
    if (!t) return
    setErr(''); setSaving(true)
    try { await api(`/workspaces/${slug}/branding`, { method: 'PUT', body: JSON.stringify({ tokens: t }) }); setSavedAt(new Date().toLocaleTimeString()) }
    catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (!t) return <div className="empty">Loading…</div>
  const examples = t.voice_examples || []

  return (
    <AppShell title="Brand Voice" currentSlug={slug} active="Brand Voice">
      <div className="dash-sub" style={{ marginBottom: 18 }}>
        How your brand sounds in words. The AI uses this whenever it writes or rewrites a page — and especially when it drafts <b>articles</b> — so everything reads like <em>you</em>, not a template.
      </div>

      <div className="dash-h" style={{ marginTop: 0 }}>Voice &amp; tagline</div>
      <div className="ctl-group card">
        <div className="field">
          <label>Tagline</label>
          <input className="inp" value={t.tagline || ''} placeholder='e.g. "German for kids, through play"' onChange={(e) => set({ tagline: e.target.value })} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Brand voice / personality</label>
          <textarea className="inp" rows={4} value={t.voice || ''} placeholder='Describe how your brand should sound. e.g. "Warm and encouraging, speaks directly to parents, concrete outcomes over hype, one light joke is fine, never corporate. Short sentences. Romanian, informal (tu)."' onChange={(e) => set({ voice: e.target.value })} />
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

      {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
      <div className="save-row" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
      </div>
    </AppShell>
  )
}
