'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

// The business grounding the writer was missing. For a content-only (WordPress)
// workspace there's no site to infer context from, so every article was written
// blind. This is the one place to say what the business actually is; the writer
// reads tokens.business_brief on every article.

type Brief = { about?: string; audience?: string; offers?: string; avoid?: string }
type Tokens = { business_brief?: Brief } & Record<string, any>

export default function BusinessBriefPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [t, setT] = useState<Tokens | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ tokens: Tokens }>(`/workspaces/${slug}/branding`).then((d) => setT(d.tokens || {})).catch(() => router.push(`/w/${slug}`))
  }, [slug])

  const b = t?.business_brief || {}
  const setB = (patch: Partial<Brief>) => setT((c) => c ? { ...c, business_brief: { ...(c.business_brief || {}), ...patch } } : c)

  async function save() {
    if (!t) return
    setErr(''); setSaving(true)
    try { await api(`/workspaces/${slug}/branding`, { method: 'PUT', body: JSON.stringify({ tokens: t }) }); setSavedAt(new Date().toLocaleTimeString()) }
    catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (!t) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Business Brief" currentSlug={slug} active="Business Brief">
      <div className="dash-sub" style={{ marginBottom: 18 }}>
        What your business actually is. The AI reads this on <b>every article</b> so it writes about <em>your</em> offer and audience — not a generic version of the topic. Especially important when you only publish content (no site is built here to infer it from).
      </div>

      <div className="ctl-group card">
        <div className="field">
          <label>What you do</label>
          <textarea className="inp" rows={3} value={b.about || ''} placeholder='e.g. "Sprachzentrum — German-language courses in Satu Mare for kids and adults: group classes, private tutoring, exam prep (Goethe/ÖSD). In-person and online."' onChange={(e) => setB({ about: e.target.value })} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>The elevator pitch — what you sell, where, and what makes you different.</p>
        </div>
        <div className="field">
          <label>Who it&apos;s for</label>
          <textarea className="inp" rows={2} value={b.audience || ''} placeholder='e.g. "Parents choosing after-school programs; adults preparing for a Goethe exam or a move to Germany/Austria."' onChange={(e) => setB({ audience: e.target.value })} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Your ideal reader/customer — so the AI writes to them, at their level.</p>
        </div>
        <div className="field">
          <label>Products / services to mention</label>
          <textarea className="inp" rows={2} value={b.offers || ''} placeholder='e.g. "Kids group courses (A1–B1), private tutoring, Goethe exam prep, summer intensive." Link these where relevant.' onChange={(e) => setB({ offers: e.target.value })} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Concrete offers the AI can reference and (softly) point readers toward.</p>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Avoid / careful with</label>
          <textarea className="inp" rows={2} value={b.avoid || ''} placeholder='e.g. "Don&apos;t promise exam pass rates or guaranteed results. Don&apos;t compare competitors by name."' onChange={(e) => setB({ avoid: e.target.value })} />
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Claims, topics or phrasing to stay away from.</p>
        </div>
      </div>

      {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
      <div className="save-row" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save brief'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
      </div>
    </AppShell>
  )
}
