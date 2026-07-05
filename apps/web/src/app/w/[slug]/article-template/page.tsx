'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { ImageField } from '@/components/ImageField'

type Card = { kind: string; title?: string; text?: string; cta_label?: string; cta_href?: string; placeholder?: string; image?: string }
type Tpl = { heroVariant: string; grad_from?: string; grad_to?: string; sidebar: Card[] }

const HEROES: { id: string; name: string; blurb: string }[] = [
  { id: 'classic', name: 'Classic', blurb: 'Left-aligned kicker, headline, deck + meta.' },
  { id: 'centered', name: 'Centered', blurb: 'Everything centered — clean and editorial.' },
  { id: 'boxed', name: 'Boxed card', blurb: 'Title in a card on a tinted band.' },
  { id: 'cover', name: 'Cover image', blurb: 'Full-bleed banner image with the title over it. Upload per article.' },
  { id: 'gradient', name: 'Gradient', blurb: 'Title over a brand-color gradient — no image needed.' },
  { id: 'minimal', name: 'Minimal', blurb: 'Compact — small kicker + tight headline.' },
]

// Tiny CSS mock of each hero variant for the chooser.
function HeroMock({ v }: { v: string }) {
  const bar = (w: string, h = 6, c = '#c9cfd6') => <div style={{ width: w, height: h, background: c, borderRadius: 3 }} />
  if (v === 'cover' || v === 'gradient') return (
    <div style={{ height: 74, borderRadius: 8, background: v === 'gradient' ? 'linear-gradient(135deg,var(--forest),var(--lime))' : 'linear-gradient(135deg,#3a4a55,#6aa9c9)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 5, padding: 10 }}>
      {bar('30%', 5, 'rgba(255,255,255,.7)')}{bar('72%', 8, '#fff')}{bar('50%', 5, 'rgba(255,255,255,.6)')}
    </div>)
  const align = v === 'centered' || v === 'boxed' ? 'center' : 'flex-start'
  const inner = <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: align, width: '100%' }}>
    {bar('26%', 5, 'var(--lime)')}{bar(v === 'minimal' ? '55%' : '78%', v === 'minimal' ? 8 : 10)}{v !== 'minimal' && bar('50%', 5)}
  </div>
  if (v === 'boxed') return <div style={{ height: 74, borderRadius: 8, background: '#eef4f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8 }}><div style={{ background: '#fff', border: '1px solid #e2e6ea', borderRadius: 6, padding: 10, width: '85%' }}>{inner}</div></div>
  return <div style={{ height: 74, borderRadius: 8, background: '#f6f8f9', display: 'flex', alignItems: 'center', padding: 12 }}>{inner}</div>
}

export default function ArticleTemplatePage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [tpl, setTpl] = useState<Tpl>({ heroVariant: 'classic', sidebar: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [applyAll, setApplyAll] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    api<Tpl>(`/workspaces/${slug}/article-template`).then(setTpl).catch(() => router.push(`/w/${slug}`)).finally(() => setLoading(false))
  }, [slug])

  function setCard(i: number, p: Partial<Card>) { setTpl((t) => ({ ...t, sidebar: t.sidebar.map((c, k) => k === i ? { ...c, ...p } : c) })) }
  function addCard(kind: string) {
    const base: Card = kind === 'newsletter'
      ? { kind, title: 'Get our newsletter', text: 'Tips in your inbox, no spam.', cta_label: 'Subscribe', placeholder: 'you@email.com' }
      : { kind: 'cta', title: 'Ready to start?', text: 'A short line about the next step.', cta_label: 'Get in touch', cta_href: '/contact/' }
    setTpl((t) => ({ ...t, sidebar: [...t.sidebar, base] }))
  }
  function removeCard(i: number) { setTpl((t) => ({ ...t, sidebar: t.sidebar.filter((_, k) => k !== i) })) }

  async function save() {
    setErr(''); setNote(''); setSaving(true)
    try {
      const r = await api<{ applied: number }>(`/workspaces/${slug}/article-template`, { method: 'PUT', body: JSON.stringify({ ...tpl, applyToAll: applyAll }) })
      setNote(applyAll ? `Saved — applied to ${r.applied} existing article(s). New articles use it automatically.` : 'Saved. New articles will use this template.')
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Article Template" currentSlug={slug} active="Article Template">
      <div className="dash-sub" style={{ marginBottom: 20 }}>
        The default layout for every article. New articles use it automatically; tick <b>Apply to all</b> to also update existing ones.
      </div>

      <div className="dash-h">Hero design</div>
      <div className="vibe-grid" style={{ marginBottom: 26 }}>
        {HEROES.map((h) => (
          <button key={h.id} className={`vibe-card${tpl.heroVariant === h.id ? ' on' : ''}`} style={{ textAlign: 'left' }} onClick={() => setTpl((t) => ({ ...t, heroVariant: h.id }))}>
            <HeroMock v={h.id} />
            <div className="vibe-name" style={{ marginTop: 10 }}>{h.name}</div>
            <div className="vibe-blurb">{h.blurb}</div>
          </button>
        ))}
      </div>

      {tpl.heroVariant === 'gradient' && (
        <div className="ctl-group card" style={{ marginBottom: 22 }}>
          <h3>Gradient colors</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>Picked from your brand — edit the colors themselves in <a href={`/w/${slug}/branding`}>Branding</a>. Applies to every article.</p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select className="inp" style={{ maxWidth: 160 }} value={tpl.grad_from || 'primary'} onChange={(e) => setTpl((t) => ({ ...t, grad_from: e.target.value }))}>
              <option value="primary">Primary</option><option value="accent">Accent</option><option value="accent2">Accent 2</option><option value="text">Text</option>
            </select>
            <span style={{ color: 'var(--text-faint)' }}>→</span>
            <select className="inp" style={{ maxWidth: 160 }} value={tpl.grad_to || 'accent'} onChange={(e) => setTpl((t) => ({ ...t, grad_to: e.target.value }))}>
              <option value="primary">Primary</option><option value="accent">Accent</option><option value="accent2">Accent 2</option><option value="text">Text</option>
            </select>
          </div>
        </div>
      )}

      <div className="dash-h">Sidebar (CTA + newsletter)</div>
      <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>The Table of Contents shows inline at the top of articles; the sidebar is for conversion.</p>
      {tpl.sidebar.map((c, i) => (
        <div className="ctl-group card" key={i} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span className="status-pill draft" style={{ textTransform: 'capitalize' }}>{c.kind}</span>
            <button className="btn-mini danger" style={{ marginLeft: 'auto' }} onClick={() => removeCard(i)}>Remove</button>
          </div>
          <div className="field"><label>Title</label><input className="inp" value={c.title || ''} onChange={(e) => setCard(i, { title: e.target.value })} /></div>
          <div className="field"><label>Text</label><input className="inp" value={c.text || ''} onChange={(e) => setCard(i, { text: e.target.value })} /></div>
          {c.kind === 'cta' && <div className="field"><label>Image <span className="muted" style={{ fontWeight: 400 }}>(optional — shown above the text &amp; button)</span></label><ImageField slug={slug} value={c.image || ''} onChange={(url) => setCard(i, { image: url })} caption={c.title || ''} height={96} /></div>}
          <div className="field" style={{ display: 'flex', gap: 8, marginBottom: 0 }}>
            <div style={{ flex: 1 }}><label>Button label</label><input className="inp" value={c.cta_label || ''} onChange={(e) => setCard(i, { cta_label: e.target.value })} /></div>
            {c.kind === 'cta' && <div style={{ flex: 1 }}><label>Button link</label><input className="inp" value={c.cta_href || ''} onChange={(e) => setCard(i, { cta_href: e.target.value })} /></div>}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-mini" onClick={() => addCard('cta')}>＋ CTA card</button>
        <button className="btn-mini" onClick={() => addCard('newsletter')}>＋ Newsletter card</button>
      </div>

      {note && <div className="banner-ok" style={{ marginTop: 16 }}>{note}</div>}
      <div className="err" style={{ marginTop: 14 }}>{err}</div>
      <div className="save-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save template'}</button>
        <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} style={{ width: 'auto' }} /> Apply to all existing articles
        </label>
      </div>
    </AppShell>
  )
}
