'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { GOOGLE_FONTS, GOOGLE_FONT_NAMES } from '@uwebsites/shared'

type BrandAssets = {
  logo?: { url: string; alt?: string } | null
  nav?: Array<{ text: string; href: string }>
  cta?: { label: string; href: string } | null
  snapshot_url?: string | null
}
type Tokens = {
  color: { primary: string; accent: string; surface: string; text: string }
  font: { heading: string; body: string; scale: number; lineHeight: number }
  shape: { buttonRadius: string; cardRadius: string; borderWidth: string }
  space: { sectionGap: string; sectionPaddingY: string; container: string }
  brand_assets?: BrandAssets
}

// Loads the chosen Google Fonts so the preview cards on this page actually
// render in the font the user picked. Inert for system fonts.
function useGoogleFontPreview(...names: string[]) {
  useEffect(() => {
    const gfonts = [...new Set(names)].filter((n) => GOOGLE_FONT_NAMES.has(n))
    if (!gfonts.length) return
    const id = 'uw-gfont-' + gfonts.join('|').replace(/\W/g, '_')
    if (document.getElementById(id)) return
    const q = gfonts.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;600;700`).join('&')
    const link = document.createElement('link')
    link.id = id; link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?${q}&display=swap`
    document.head.appendChild(link)
  }, [names.join('|')])
}
const px = (v: string) => parseInt(String(v)) || 0

// BrandShowcase — at-a-glance cards showing the active palette, fonts in use,
// the logo/nav/CTA pulled from the original site (when imported). Useful as
// the "did we get this right?" view right after an import.
function BrandShowcase({ t }: { t: Tokens }) {
  const a = t.brand_assets || {}
  const swatches: Array<{ key: keyof Tokens['color']; label: string }> = [
    { key: 'primary', label: 'Primary' }, { key: 'accent', label: 'Accent' },
    { key: 'surface', label: 'Surface' }, { key: 'text', label: 'Text' },
  ]
  return (
    <div className="brand-show">
      <div className="brand-show-grid">
        <div className="bs-card">
          <div className="bs-label">Palette</div>
          <div className="bs-swatches">
            {swatches.map((s) => (
              <div className="bs-sw" key={s.key}>
                <div className="bs-sw-chip" style={{ background: t.color[s.key] }} />
                <div className="bs-sw-text"><b>{s.label}</b><span>{t.color[s.key]}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="bs-card">
          <div className="bs-label">Typography</div>
          <div style={{ fontFamily: t.font.heading, fontWeight: 700, fontSize: 26, lineHeight: 1.1, color: t.color.text, marginBottom: 4 }}>The quick brown fox</div>
          <div style={{ fontFamily: t.font.heading, fontWeight: 600, fontSize: 16, color: t.color.text, marginBottom: 8, opacity: .85 }}>Headings · {t.font.heading}</div>
          <div style={{ fontFamily: t.font.body, fontSize: 14, color: t.color.text, opacity: .8, lineHeight: 1.5 }}>jumps over the lazy dog — body text uses <strong>{t.font.body}</strong> at {Math.round(t.font.scale * 100)}% scale.</div>
        </div>
        <div className="bs-card">
          <div className="bs-label">Buttons &amp; shape</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button style={{ background: t.color.primary, color: '#fff', border: 0, borderRadius: t.shape.buttonRadius, padding: '10px 16px', fontFamily: t.font.heading, fontWeight: 600, fontSize: 13 }}>Primary</button>
            <button style={{ background: t.color.accent, color: t.color.text, border: 0, borderRadius: t.shape.buttonRadius, padding: '10px 16px', fontFamily: t.font.heading, fontWeight: 600, fontSize: 13 }}>Accent</button>
            <button style={{ background: 'transparent', color: t.color.text, border: `${t.shape.borderWidth} solid ${t.color.text}30`, borderRadius: t.shape.buttonRadius, padding: '10px 16px', fontFamily: t.font.heading, fontWeight: 600, fontSize: 13 }}>Outline</button>
          </div>
          <div style={{ background: t.color.surface, border: `${t.shape.borderWidth} solid ${t.color.text}20`, borderRadius: t.shape.cardRadius, padding: 14 }}>
            <div style={{ fontFamily: t.font.heading, fontWeight: 600, fontSize: 14, color: t.color.text, marginBottom: 4 }}>Card example</div>
            <div style={{ fontSize: 12, color: t.color.text, opacity: .65 }}>Card radius {t.shape.cardRadius}, border {t.shape.borderWidth}.</div>
          </div>
        </div>
        {(a.logo || (a.nav && a.nav.length) || a.cta) && (
          <div className="bs-card">
            <div className="bs-label">From your site</div>
            {a.logo?.url && (
              <div style={{ marginBottom: 12 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Logo</div>
                <img src={a.logo.url} alt={a.logo.alt || ''} style={{ maxHeight: 44, maxWidth: '100%' }} />
              </div>
            )}
            {a.nav && a.nav.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Navigation</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {a.nav.slice(0, 8).map((it, i) => (
                    <span key={i} style={{ fontSize: 12, padding: '4px 9px', borderRadius: 6, background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>{it.text}</span>
                  ))}
                </div>
              </div>
            )}
            {a.cta?.label && (
              <div>
                <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Main CTA</div>
                <a href={a.cta.href} target="_blank" rel="noreferrer" style={{ background: t.color.primary, color: '#fff', borderRadius: t.shape.buttonRadius, padding: '8px 14px', fontFamily: t.font.heading, fontWeight: 600, fontSize: 12, textDecoration: 'none' }}>{a.cta.label}</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

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

  // Load the currently-selected Google Fonts so BrandShowcase + previews render correctly.
  useGoogleFontPreview(t?.font?.heading || '', t?.font?.body || '')

  if (loading || !t) return <div className="empty">Loading…</div>

  // Build the dropdown options: curated list grouped + ALWAYS include the
  // current value (it may have come from import — e.g. Quicksand) even if not
  // in the curated list, so the picker shows it as selected.
  const renderFontOptions = (current: string) => {
    const inList = [...GOOGLE_FONTS.sans, ...GOOGLE_FONTS.serif, ...GOOGLE_FONTS.display, ...GOOGLE_FONTS.mono, ...GOOGLE_FONTS.system].includes(current as any)
    return (<>
      {!inList && current && <optgroup label="Imported"><option value={current}>{current}</option></optgroup>}
      <optgroup label="Sans">{GOOGLE_FONTS.sans.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
      <optgroup label="Serif">{GOOGLE_FONTS.serif.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
      <optgroup label="Display">{GOOGLE_FONTS.display.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
      <optgroup label="Mono">{GOOGLE_FONTS.mono.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
      <optgroup label="System">{GOOGLE_FONTS.system.map((f) => <option key={f} value={f}>{f}</option>)}</optgroup>
    </>)
  }

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
      <BrandShowcase t={t} />
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
              <select value={t.font.heading} onChange={(e) => patch('font', 'heading', e.target.value)}>{renderFontOptions(t.font.heading)}</select>
            </div>
            <div className="ctl-row"><label>Body font</label>
              <select value={t.font.body} onChange={(e) => patch('font', 'body', e.target.value)}>{renderFontOptions(t.font.body)}</select>
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
