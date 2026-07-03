'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Cta = {
  id: string; name: string; heading: string; sub: string; cta_label: string; cta_href: string
  variant: 'gradient' | 'solid'; isDefault: boolean; pageTypes: string[]; slugContains: string
}

const PAGE_TYPES = ['home', 'article', 'service', 'about', 'contact', 'faq', 'blog_index', 'category', 'collection_item', 'legal']

function newCta(): Cta {
  return { id: `cta-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, name: '', heading: '', sub: '', cta_label: '', cta_href: '', variant: 'gradient', isDefault: false, pageTypes: [], slugContains: '' }
}

export default function CtasPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [ctas, setCtas] = useState<Cta[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ ctas: Cta[] }>(`/workspaces/${slug}/ctas`)
      .then((d) => setCtas((d.ctas || []).map((c) => ({ ...newCta(), ...c }))))
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
  }, [slug])

  function patch(i: number, p: Partial<Cta>) { setCtas((cs) => cs.map((c, k) => k === i ? { ...c, ...p } : c)) }
  function setDefault(i: number) { setCtas((cs) => cs.map((c, k) => ({ ...c, isDefault: k === i }))) }
  function remove(i: number) { setCtas((cs) => cs.filter((_, k) => k !== i)) }
  function togglePageType(i: number, t: string) {
    setCtas((cs) => cs.map((c, k) => k === i ? { ...c, pageTypes: c.pageTypes.includes(t) ? c.pageTypes.filter((x) => x !== t) : [...c.pageTypes, t] } : c))
  }

  async function save() {
    setErr(''); setSaving(true)
    try {
      const r = await api<{ ctas: Cta[] }>(`/workspaces/${slug}/ctas`, { method: 'PUT', body: JSON.stringify({ ctas }) })
      setCtas((r.ctas || []).map((c) => ({ ...newCta(), ...c })))
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="CTAs" currentSlug={slug} active="CTAs">
      <div className="dash-sub" style={{ marginBottom: 8 }}>
        Reusable call-to-action banners. Add a <b>Smart CTA</b> section to any page and it shows the right CTA by these rules — edit once here, it updates everywhere.
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 20, lineHeight: 1.6 }}>
        <b>How the rules resolve</b> (most specific wins): 1) a Smart CTA section can pin a specific CTA → 2) <b>Slug/title keyword</b> match → 3) <b>Page type</b> match → 4) the <b>Global default</b>.
      </div>

      {ctas.map((c, i) => (
        <div className="ctl-group card" key={c.id} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <input className="inp" style={{ maxWidth: 240, fontWeight: 600 }} placeholder="Internal name (e.g. Free trial)" value={c.name} onChange={(e) => patch(i, { name: e.target.value })} />
            <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="def" checked={c.isDefault} onChange={() => setDefault(i)} style={{ width: 'auto' }} /> Global default
            </label>
            <button className="btn-mini danger" style={{ marginLeft: 'auto' }} onClick={() => remove(i)}>Delete</button>
          </div>
          <div className="brand-editor-grid">
            <div>
              <div className="field"><label>Heading</label><input className="inp" value={c.heading} onChange={(e) => patch(i, { heading: e.target.value })} placeholder="Ready to start?" /></div>
              <div className="field"><label>Subtext</label><input className="inp" value={c.sub} onChange={(e) => patch(i, { sub: e.target.value })} /></div>
              <div className="field" style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><label>Button label</label><input className="inp" value={c.cta_label} onChange={(e) => patch(i, { cta_label: e.target.value })} placeholder="Get started" /></div>
                <div style={{ flex: 1 }}><label>Button link</label><input className="inp" value={c.cta_href} onChange={(e) => patch(i, { cta_href: e.target.value })} placeholder="/contact/" /></div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}><label>Style</label>
                <select className="inp" value={c.variant} onChange={(e) => patch(i, { variant: e.target.value as any })}>
                  <option value="gradient">Gradient</option><option value="solid">Solid</option>
                </select>
              </div>
            </div>
            <div>
              <div className="field"><label>Rule — slug / title contains</label><input className="inp" value={c.slugContains} onChange={(e) => patch(i, { slugContains: e.target.value })} placeholder="e.g. germana" />
                <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Show this CTA on pages whose slug or title contains this word.</p>
              </div>
              <div className="field" style={{ marginBottom: 0 }}><label>Rule — page types</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {PAGE_TYPES.map((t) => (
                    <button key={t} className={`btn-mini${c.pageTypes.includes(t) ? ' on' : ''}`} style={c.pageTypes.includes(t) ? { borderStyle: 'solid', borderColor: 'var(--forest)', color: 'var(--forest)' } : {}} onClick={() => togglePageType(i, t)}>{t}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      <button className="btn btn-secondary" onClick={() => setCtas((cs) => [...cs, newCta()])}>＋ Add CTA</button>

      <div className="err" style={{ marginTop: 14 }}>{err}</div>
      <div className="save-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save CTAs'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
      </div>
    </AppShell>
  )
}
