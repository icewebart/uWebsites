'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Tokens = {
  color: { primary: string; accent: string; surface: string; text: string }
  font: { heading: string; body: string; scale: number; lineHeight: number }
  shape: { buttonRadius: string; cardRadius: string; borderWidth: string }
  space: { sectionGap: string; sectionPaddingY: string; container: string }
}

const FONTS = ['Space Grotesk', 'Inter', 'Poppins', 'Georgia', 'system-ui']
const px = (v: string) => parseInt(String(v)) || 0

function BrandImport({ onImported }: { onImported: (t: Tokens) => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState<{ tokens: Tokens; suggestions: { colors: string[]; fonts: string[] } } | null>(null)
  async function run(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true); setPicked(null)
    try {
      const r = await api<{ tokens: Tokens; suggestions: { colors: string[]; fonts: string[] } }>('/import/branding', { method: 'POST', body: JSON.stringify({ url }) })
      setPicked(r); onImported(r.tokens)
    } catch (e: any) { setErr(e.message || 'Could not read branding') } finally { setBusy(false) }
  }
  return (
    <div className="ctl-group" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
      <h3 style={{ marginTop: 0 }}>Import from a website</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: -6, marginBottom: 12 }}>Fetches a site's CSS to suggest brand colors, fonts and button radius. Review and tweak below.</p>
      <form onSubmit={run} style={{ display: 'flex', gap: 8 }}>
        <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-brand.com" style={{ flex: 1 }} />
        <button className="btn btn-secondary" disabled={busy}>{busy ? 'Reading…' : 'Import'}</button>
      </form>
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {picked && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-faint)' }}>
          Suggested colors: {picked.suggestions.colors.slice(0, 6).map((c) => (<span key={c} style={{ display: 'inline-block', width: 14, height: 14, background: c, border: '1px solid var(--border)', borderRadius: 3, marginRight: 4, verticalAlign: 'middle' }} />))}
          {picked.suggestions.fonts.length > 0 && <> · fonts: {picked.suggestions.fonts.join(', ')}</>}
        </div>
      )}
    </div>
  )
}

export default function Branding() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [t, setT] = useState<Tokens | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ tokens: Tokens }>(`/workspaces/${slug}/branding`)
      .then((d) => setT(d.tokens))
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
  }, [slug])

  function patch(group: keyof Tokens, key: string, value: any) {
    setT((cur) => cur ? { ...cur, [group]: { ...(cur as any)[group], [key]: value } } : cur)
  }

  async function save() {
    if (!t) return
    setErr(''); setSaving(true)
    try {
      await api(`/workspaces/${slug}/branding`, { method: 'PUT', body: JSON.stringify({ tokens: t }) })
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading || !t) return <div className="empty">Loading…</div>

  const Swatch = ({ k }: { k: keyof Tokens['color'] }) => (
    <div className="swatch">
      <input type="color" value={t.color[k]} onChange={(e) => patch('color', k, e.target.value)} />
      <input type="text" value={t.color[k]} onChange={(e) => patch('color', k, e.target.value)} />
    </div>
  )
  const PxRow = ({ label, group, k, max = 200 }: { label: string; group: keyof Tokens; k: string; max?: number }) => (
    <div className="ctl-row"><label>{label}</label>
      <input className="num" type="number" min={0} max={max} value={px((t as any)[group][k])} onChange={(e) => patch(group, k, `${e.target.value}px`)} />
    </div>
  )

  return (
    <AppShell title="Branding" currentSlug={slug} active="Branding">
      <div className="brand-wrap">
        {/* controls */}
        <div>
          <BrandImport onImported={(tk) => setT(tk)} />

          <div className="ctl-group">
            <h3>Colors</h3>
            <div className="ctl-row"><label>Primary</label><Swatch k="primary" /></div>
            <div className="ctl-row"><label>Accent</label><Swatch k="accent" /></div>
            <div className="ctl-row"><label>Surface</label><Swatch k="surface" /></div>
            <div className="ctl-row"><label>Text</label><Swatch k="text" /></div>
          </div>

          <div className="ctl-group">
            <h3>Typography</h3>
            <div className="ctl-row"><label>Heading font</label>
              <select value={t.font.heading} onChange={(e) => patch('font', 'heading', e.target.value)}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
            </div>
            <div className="ctl-row"><label>Body font</label>
              <select value={t.font.body} onChange={(e) => patch('font', 'body', e.target.value)}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select>
            </div>
            <div className="ctl-row"><label>Type scale</label>
              <input className="num" type="number" step={0.05} min={1} max={2} value={t.font.scale} onChange={(e) => patch('font', 'scale', parseFloat(e.target.value))} />
            </div>
            <div className="ctl-row"><label>Line height</label>
              <input className="num" type="number" step={0.05} min={1} max={2.2} value={t.font.lineHeight} onChange={(e) => patch('font', 'lineHeight', parseFloat(e.target.value))} />
            </div>
          </div>

          <div className="ctl-group">
            <h3>Shape</h3>
            <PxRow label="Button radius" group="shape" k="buttonRadius" max={40} />
            <PxRow label="Card radius" group="shape" k="cardRadius" max={40} />
            <PxRow label="Border width" group="shape" k="borderWidth" max={6} />
          </div>

          <div className="ctl-group">
            <h3>Spacing</h3>
            <PxRow label="Gap between sections" group="space" k="sectionGap" max={200} />
            <PxRow label="Section padding (Y)" group="space" k="sectionPaddingY" max={200} />
            <PxRow label="Container width" group="space" k="container" max={1600} />
          </div>

          <div className="err">{err}</div>
          <div className="save-row">
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save branding'}</button>
            {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
          </div>
        </div>

        {/* live preview */}
        <div className="brand-preview">
          <div className="pv-label">Live preview</div>
          <div style={{ background: t.color.surface, padding: `${t.space.sectionPaddingY} 28px`, fontFamily: t.font.body, lineHeight: t.font.lineHeight }}>
            <div style={{ maxWidth: t.space.container, margin: '0 auto' }}>
              <div style={{ fontFamily: t.font.heading, color: t.color.text, fontSize: `${Math.round(30 * t.font.scale)}px`, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 10 }}>
                Build something on-brand
              </div>
              <p style={{ color: t.color.text, opacity: 0.75, fontSize: 14, marginBottom: 18 }}>
                This preview updates as you change the tokens — colors, fonts, roundedness and spacing.
              </p>
              <div style={{ display: 'flex', gap: 10, marginBottom: t.space.sectionGap }}>
                <button style={{ background: t.color.primary, color: '#fff', border: 'none', borderRadius: t.shape.buttonRadius, padding: '11px 18px', fontWeight: 600, fontSize: 14, fontFamily: t.font.heading }}>Primary</button>
                <button style={{ background: t.color.accent, color: t.color.text, border: 'none', borderRadius: t.shape.buttonRadius, padding: '11px 18px', fontWeight: 600, fontSize: 14, fontFamily: t.font.heading }}>Accent</button>
              </div>
              <div style={{ background: t.color.surface, border: `${t.shape.borderWidth} solid ${t.color.text}22`, borderRadius: t.shape.cardRadius, padding: 20 }}>
                <div style={{ fontFamily: t.font.heading, color: t.color.text, fontWeight: 600, fontSize: 16, marginBottom: 6 }}>A card</div>
                <p style={{ color: t.color.text, opacity: 0.7, fontSize: 13, margin: 0 }}>Cards use the card radius and border width tokens.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
