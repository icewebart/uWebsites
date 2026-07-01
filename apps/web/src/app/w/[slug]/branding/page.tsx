'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { GOOGLE_FONTS, GOOGLE_FONT_NAMES } from '@uwebsites/shared'

type NavNode = { text: string; href: string; children?: NavNode[] }
type LogoRich =
  | { kind: 'svg'; svg: string; alt?: string }
  | { kind: 'img'; url: string; alt?: string; naturalWidth?: number; naturalHeight?: number }
  | null
type BrandAssets = {
  logo?: { url: string; alt?: string } | null
  logo_rich?: LogoRich
  nav?: Array<{ text: string; href: string }>
  nav_tree?: NavNode[]
  has_mega_menu?: boolean
  cta?: { label: string; href: string } | null
  snapshot_url?: string | null
}
type Tokens = {
  color: { primary: string; accent: string; surface: string; text: string; footerBg?: string; footerFg?: string }
  font: { heading: string; body: string; scale: number; lineHeight: number }
  shape: { buttonRadius: string; cardRadius: string; borderWidth: string }
  space: { sectionGap: string; sectionPaddingY: string; container: string }
  brand_assets?: BrandAssets
}

// Client-side 50/200/400/600/800 tint→shade ramp (mirrors the API colorScale).
function toRgb(h: string): [number, number, number] | null {
  let s = (h || '').trim().toLowerCase()
  const rgb = s.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]]
  if (s[0] === '#') s = s.slice(1)
  if (s.length === 3) s = s.split('').map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/.test(s)) return null
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}
function toHex(r: number, g: number, b: number) {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return '#' + h(r) + h(g) + h(b)
}
function mix(hex: string, target: [number, number, number], amt: number) {
  const c = toRgb(hex); if (!c) return hex
  return toHex(c[0] + (target[0] - c[0]) * amt, c[1] + (target[1] - c[1]) * amt, c[2] + (target[2] - c[2]) * amt)
}
function scale(primary: string): Array<{ step: string; hex: string }> {
  const W: [number, number, number] = [255, 255, 255], K: [number, number, number] = [20, 8, 30]
  return [
    { step: '50', hex: mix(primary, W, 0.9) }, { step: '200', hex: mix(primary, W, 0.6) },
    { step: '400', hex: mix(primary, W, 0.26) }, { step: '600', hex: primary }, { step: '800', hex: mix(primary, K, 0.42) },
  ]
}
// Pick readable text color (black/white) for a given background hex.
function fgOn(hex: string): string {
  const c = toRgb(hex); if (!c) return '#000'
  const lum = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255
  return lum > 0.6 ? '#1a1a1a' : '#fff'
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

// Renders the imported logo — inline SVG markup or an <img>.
function LogoMark({ a, dark }: { a: BrandAssets; dark?: boolean }) {
  const rich = a.logo_rich
  if (rich && rich.kind === 'svg') {
    return <span className="bb-logo-svg" style={{ filter: dark ? 'brightness(0) invert(1)' : undefined }} dangerouslySetInnerHTML={{ __html: rich.svg }} />
  }
  const url = (rich && rich.kind === 'img' && rich.url) || a.logo?.url
  if (url) return <img className="bb-logo-img" src={url} alt={a.logo?.alt || ''} style={{ filter: dark ? 'brightness(0) invert(1)' : undefined }} />
  return null
}

// Decor — Kids.ro-style playful decorations, tinted with brand colors.
function Decor({ kind, color, accent }: { kind: 'star-fill' | 'star-outline' | 'star-group' | 'dots' | 'dotline' | 'cloud' | 'blob'; color: string; accent?: string }) {
  const starPath = 'M24 4l5 11 12 1.4-9 8 2.5 12L24 40l-11 6.4L15.5 34.4l-9-8L18.5 16.4z'
  switch (kind) {
    case 'star-fill':
      return <svg viewBox="0 0 48 48" width="40" height="40"><path d={starPath} fill={color} strokeLinejoin="round" strokeWidth="3" stroke={color} /></svg>
    case 'star-outline':
      return <svg viewBox="0 0 48 48" width="40" height="40"><path d={starPath} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" /></svg>
    case 'star-group':
      return <svg viewBox="0 0 72 48" width="60" height="40"><path d={starPath} fill={color} transform="scale(.72) translate(2 6)" strokeLinejoin="round" strokeWidth="4" stroke={color} /><path d={starPath} fill={accent || color} transform="scale(.42) translate(78 30)" strokeLinejoin="round" strokeWidth="5" stroke={accent || color} /></svg>
    case 'dots':
      return <svg viewBox="0 0 72 24" width="60" height="22"><circle cx="12" cy="12" r="10" fill={color} /><circle cx="38" cy="12" r="7" fill={accent || color} /><circle cx="60" cy="12" r="5" fill={color} opacity=".7" /></svg>
    case 'dotline':
      return <svg viewBox="0 0 100 12" width="70" height="12">{Array.from({ length: 9 }).map((_, i) => <circle key={i} cx={6 + i * 11} cy="6" r="2.4" fill={color} />)}</svg>
    case 'cloud':
      return <svg viewBox="0 0 64 40" width="56" height="36"><path d="M18 34a10 10 0 0 1-1-19.9A13 13 0 0 1 42 12a9 9 0 0 1 4 17.4V34z" fill={color} stroke="rgba(0,0,0,.05)" /></svg>
    case 'blob':
      return <svg viewBox="0 0 64 64" width="52" height="52"><path d="M52 30c4 12-6 26-20 27S6 46 8 33 20 6 34 6s14 12 18 24z" fill={color} /></svg>
    default:
      return null
  }
}

// BrandBook — a full design-system document for the workspace: hero, palette
// (with tint/shade scales), typography specimens, buttons/controls, and a live
// preview of the header (floating pill) + footer + captured mega-menu. Driven
// entirely by the workspace tokens + imported brand_assets.
function BrandBook({ t }: { t: Tokens }) {
  const a = t.brand_assets || {}
  const primScale = scale(t.color.primary)
  const accScale = scale(t.color.accent)
  const specimen = [
    { label: 'Display / 64', size: 56, weight: 700, text: 'Învață jucându-te' },
    { label: 'H1 / 40', size: 36, weight: 700, text: 'Cursuri de germană' },
    { label: 'H2 / 30', size: 26, weight: 600, text: 'Ateliere conversaționale' },
    { label: 'H3 / 22', size: 20, weight: 600, text: 'Pentru copii de 8–14 ani' },
    { label: 'Lead / 20', size: 18, weight: 500, text: 'Tabere, ateliere și cursuri de limbi pentru cei mici.' },
    { label: 'Body / 16', size: 15, weight: 400, text: 'Grupe mici, profesori dedicați și lecții care chiar plac.' },
  ]

  return (
    <div className="brandbook">
      {/* Hero — playful overview with floating decor, like a real landing page */}
      <section className="bb-hero" style={{ background: `linear-gradient(160deg, ${mix(t.color.primary, [255, 255, 255], 0.92)}, ${mix(t.color.accent, [255, 255, 255], 0.93)})` }}>
        {/* floating decorative circles + stars */}
        <span className="bb-orb" style={{ background: mix(t.color.accent, [255, 255, 255], 0.55), top: '12%', left: '8%', width: 90, height: 90 }} />
        <span className="bb-orb" style={{ background: mix(t.color.primary, [255, 255, 255], 0.6), top: '58%', left: '15%', width: 54, height: 54 }} />
        <span className="bb-orb" style={{ background: mix(t.color.accent, [255, 255, 255], 0.4), top: '22%', right: '10%', width: 76, height: 76 }} />
        <span className="bb-orb" style={{ background: mix(t.color.primary, [255, 255, 255], 0.72), top: '68%', right: '16%', width: 40, height: 40 }} />
        <span className="bb-hero-star s1"><Decor kind="star-fill" color={t.color.accent} /></span>
        <span className="bb-hero-star s2"><Decor kind="star-fill" color={t.color.primary} /></span>
        <div className="bb-hero-inner">
          {a.logo_rich || a.logo?.url ? <div className="bb-hero-logo"><LogoMark a={a} /></div> : null}
          <span className="bb-hero-kicker" style={{ color: t.color.primary }}>SISTEM DE DESIGN</span>
          <h1 style={{ fontFamily: t.font.heading, color: t.color.text }}>Așa arată site-ul tău.</h1>
          <p style={{ fontFamily: t.font.body, color: t.color.text }}>Fundația vizuală a site-ului — culori, tipografie, butoane, decor și navigație, generate din brandul importat. Fiecare pagină folosește exact aceste elemente.</p>
          <div className="bb-chips">
            <span className="bb-chip"><i style={{ background: t.color.primary }} />{t.color.primary}</span>
            <span className="bb-chip">Aa · {t.font.heading}{t.font.body !== t.font.heading ? ` + ${t.font.body}` : ''}</span>
            {a.has_mega_menu && <span className="bb-chip">Mega-menu detectat</span>}
          </div>
        </div>
      </section>

      {/* Colors */}
      <section className="bb-sec">
        <div className="bb-sec-head"><span className="bb-num">01</span><h2 style={{ fontFamily: t.font.heading }}>Culori</h2></div>
        <div className="bb-scale-label">Primar</div>
        <div className="bb-scale">
          {primScale.map((s) => (
            <div key={s.step} className="bb-swatch" style={{ background: s.hex, color: fgOn(s.hex) }}>
              {s.step === '600' && <span className="bb-swatch-tag">PRIMARY</span>}
              <div className="bb-swatch-meta"><b>{s.step}</b><span>{s.hex.toUpperCase()}</span></div>
            </div>
          ))}
        </div>
        <div className="bb-scale-label">Accent</div>
        <div className="bb-scale">
          {accScale.map((s) => (
            <div key={s.step} className="bb-swatch" style={{ background: s.hex, color: fgOn(s.hex) }}>
              {s.step === '600' && <span className="bb-swatch-tag">ACCENT</span>}
              <div className="bb-swatch-meta"><b>{s.step}</b><span>{s.hex.toUpperCase()}</span></div>
            </div>
          ))}
        </div>
        <div className="bb-cols-2">
          <div>
            <div className="bb-scale-label">Neutre &amp; suprafețe</div>
            <div className="bb-neutrals">
              {[{ l: 'Surface', v: t.color.surface }, { l: 'Text', v: t.color.text }, { l: 'Footer', v: t.color.footerBg || t.color.text }].map((n) => (
                <div key={n.l} className="bb-neutral" style={{ background: n.v, color: fgOn(n.v) }}><b>{n.l}</b><span>{n.v.toUpperCase()}</span></div>
              ))}
            </div>
          </div>
          <div className="bb-rules">
            <h4 style={{ fontFamily: t.font.heading }}>Reguli de folosire</h4>
            <ul>
              <li>Culoarea primară conduce brandul — navigație și CTA principal.</li>
              <li>Un singur accent pe secțiune / context.</li>
              <li>Paleta se generează automat (50 → 800) din primar &amp; accent.</li>
              <li>Contrast text minim AA pe orice fundal colorat.</li>
              <li>Pasteluri pentru bloburi &amp; fundaluri, saturate pentru acțiuni.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Typography */}
      <section className="bb-sec">
        <div className="bb-sec-head"><span className="bb-num">02</span><h2 style={{ fontFamily: t.font.heading }}>Tipografie</h2></div>
        <div className="bb-type-cards">
          <div className="bb-type-card" style={{ background: t.color.primary, color: fgOn(t.color.primary) }}>
            <div className="bb-type-tag">DISPLAY</div>
            <div className="bb-type-aa" style={{ fontFamily: t.font.heading }}>Aa</div>
            <div className="bb-type-name" style={{ fontFamily: t.font.heading }}>{t.font.heading}</div>
            <div className="bb-type-sub">Titluri, numere mari, accente</div>
          </div>
          <div className="bb-type-card ghost">
            <div className="bb-type-tag">TEXT</div>
            <div className="bb-type-aa" style={{ fontFamily: t.font.body, color: t.color.text }}>Aa</div>
            <div className="bb-type-name" style={{ fontFamily: t.font.body, color: t.color.text }}>{t.font.body}</div>
            <div className="bb-type-sub">Regular · Medium · SemiBold · Bold</div>
          </div>
        </div>
        <div className="bb-specimen">
          {specimen.map((s) => (
            <div key={s.label} className="bb-spec-row">
              <div className="bb-spec-label">{s.label}</div>
              <div className="bb-spec-text" style={{ fontFamily: s.size >= 26 ? t.font.heading : t.font.body, fontSize: s.size, fontWeight: s.weight, color: t.color.text }}>{s.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Icons & decor (Kids.ro 03) */}
      <section className="bb-sec">
        <div className="bb-sec-head"><span className="bb-num">03</span><h2 style={{ fontFamily: t.font.heading }}>Iconițe &amp; decor</h2></div>
        <p className="bb-sec-lead">Stele cu colțuri rotunjite, bule, bloburi și nori — accente jucăușe folosite ca fundaluri pentru poze și highlight-uri.</p>
        <div className="bb-decor-stage" style={{ background: `linear-gradient(120deg, ${mix(t.color.primary, [255,255,255], 0.88)}, ${mix(t.color.accent, [255,255,255], 0.9)})` }}>
          <Decor kind="star-fill" color={t.color.accent} />
          <Decor kind="star-fill" color={t.color.primary} />
          <Decor kind="star-outline" color={t.color.primary} />
          <Decor kind="dots" color={t.color.primary} accent={t.color.accent} />
          <Decor kind="cloud" color="#fff" />
          <Decor kind="blob" color={mix(t.color.accent, [255,255,255], 0.35)} />
          <Decor kind="dotline" color={t.color.primary} />
        </div>
        <div className="bb-decor-grid">
          {[
            { kind: 'star-fill', label: 'Stea plină', color: t.color.primary },
            { kind: 'star-outline', label: 'Stea contur', color: t.color.primary },
            { kind: 'star-group', label: 'Grup de steluțe', color: t.color.accent, accent: t.color.primary },
            { kind: 'blob', label: 'Blob rotund', color: mix(t.color.accent, [255,255,255], 0.4) },
            { kind: 'cloud', label: 'Nor', color: mix(t.color.primary, [255,255,255], 0.7) },
            { kind: 'dots', label: 'Cercuri', color: t.color.primary, accent: t.color.accent },
          ].map((d) => (
            <div key={d.label} className="bb-decor-card">
              <div className="bb-decor-ico"><Decor kind={d.kind as any} color={d.color} accent={(d as any).accent} /></div>
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Buttons & controls */}
      <section className="bb-sec">
        <div className="bb-sec-head"><span className="bb-num">04</span><h2 style={{ fontFamily: t.font.heading }}>Butoane &amp; controale</h2></div>
        <div className="bb-buttons">
          <button style={{ background: t.color.primary, color: fgOn(t.color.primary), borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Primar</button>
          <button style={{ background: t.color.accent, color: fgOn(t.color.accent), borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Accent</button>
          <button className="ghost" style={{ color: t.color.primary, border: `2px solid ${t.color.primary}`, borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Secundar</button>
          <button style={{ background: mix(t.color.primary, [255, 255, 255], 0.82), color: t.color.primary, borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Soft</button>
        </div>
        {/* form controls */}
        <div className="bb-form-demo">
          <label className="bb-fld"><span>Numele copilului</span><input placeholder="ex: Maria" style={{ borderRadius: t.shape.buttonRadius }} /></label>
          <label className="bb-fld"><span>Limba dorită</span><select style={{ borderRadius: t.shape.buttonRadius }}><option>Germană</option><option>Franceză</option><option>Engleză</option></select></label>
        </div>
        <div className="bb-card-demo" style={{ background: t.color.surface, borderRadius: t.shape.cardRadius, border: `${t.shape.borderWidth} solid ${t.color.text}18` }}>
          <div style={{ fontFamily: t.font.heading, fontWeight: 700, color: t.color.text, fontSize: 16, marginBottom: 4 }}>Exemplu de card</div>
          <div style={{ fontSize: 13, color: t.color.text, opacity: .65 }}>Rază card {t.shape.cardRadius}, buton {t.shape.buttonRadius}.</div>
        </div>
      </section>

      {/* Navigation preview */}
      {(a.logo || a.logo_rich || (a.nav_tree && a.nav_tree.length)) && (
        <section className="bb-sec">
          <div className="bb-sec-head"><span className="bb-num">05</span><h2 style={{ fontFamily: t.font.heading }}>Navigație</h2></div>
          {/* Floating pill header */}
          <div className="bb-nav-stage" style={{ background: mix(t.color.primary, [255, 255, 255], 0.9) }}>
            <div className="bb-header-pill">
              <div className="bb-header-brand"><LogoMark a={a} /></div>
              <div className="bb-header-nav" style={{ fontFamily: t.font.heading }}>
                {(a.nav_tree || []).slice(0, 5).map((n, i) => (
                  <span key={i} className={n.children?.length ? 'has-sub' : ''}>{n.text}{n.children?.length ? ' ▾' : ''}</span>
                ))}
              </div>
            </div>
          </div>
          {/* Mega-menu / dropdown structure */}
          {a.nav_tree && a.nav_tree.some((n) => n.children?.length) && (
            <>
              <div className="bb-scale-label" style={{ marginTop: 20 }}>Structura meniului {a.has_mega_menu ? '(mega-menu)' : ''}</div>
              <div className="bb-megamenu">
                {a.nav_tree.filter((n) => n.children?.length).map((n, i) => (
                  <div key={i} className="bb-mm-col">
                    <div className="bb-mm-head" style={{ color: t.color.primary, fontFamily: t.font.heading }}>{n.text}</div>
                    {n.children!.map((c, j) => <a key={j} className="bb-mm-link" href={c.href} target="_blank" rel="noreferrer">{c.text}</a>)}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function BrandImport({ onImported }: { onImported: (t: Tokens) => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<{ logoKind?: string; navCount: number; mega: boolean } | null>(null)
  async function run(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true); setDone(null)
    try {
      const r = await api<any>('/import/branding', { method: 'POST', body: JSON.stringify({ url }) })
      onImported(r.tokens)
      setDone({ logoKind: r.logo?.kind, navCount: (r.nav_tree || []).length, mega: !!r.has_mega_menu })
    } catch (e: any) { setErr(e.message || 'Could not read branding') } finally { setBusy(false) }
  }
  return (
    <div className="ctl-group" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--bg-subtle)' }}>
      <h3 style={{ marginTop: 0 }}>① Import branding from a website</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: -6, marginBottom: 12 }}>Renders the site in a real browser and captures the <strong>logo, palette, fonts and full menu structure</strong> (including dropdowns). Review below, then <strong>Save</strong>. Content import comes after.</p>
      <form onSubmit={run} style={{ display: 'flex', gap: 8 }}>
        <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-brand.com" style={{ flex: 1 }} />
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Reading… (~15s)' : 'Import branding'}</button>
      </form>
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {done && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--forest)', fontWeight: 500 }}>
          ✓ Imported{done.logoKind ? ` · logo (${done.logoKind})` : ' · no logo found'} · {done.navCount} menu items{done.mega ? ' · mega-menu' : ''}. Review the brand book above, then Save.
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
      <BrandBook t={t} />

      <BrandImport onImported={(tk) => setT(tk)} />

      {/* Token editor — constrained cards so controls never stretch/clip. The
          brand book above is the live preview, so no separate preview column. */}
      <div className="brand-editor">
        <div className="dash-h" style={{ marginTop: 4 }}>Edit tokens</div>
        <div className="brand-editor-grid">
          <div className="ctl-group card">
            <h3>Colors</h3>
            <div className="ctl-row"><label>Primary</label><Swatch k="primary" /></div>
            <div className="ctl-row"><label>Accent</label><Swatch k="accent" /></div>
            <div className="ctl-row"><label>Surface</label><Swatch k="surface" /></div>
            <div className="ctl-row"><label>Text</label><Swatch k="text" /></div>
          </div>

          <div className="ctl-group card">
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

          <div className="ctl-group card">
            <h3>Shape</h3>
            <PxRow label="Button radius" group="shape" k="buttonRadius" max={40} />
            <PxRow label="Card radius" group="shape" k="cardRadius" max={40} />
            <PxRow label="Border width" group="shape" k="borderWidth" max={6} />
          </div>

          <div className="ctl-group card">
            <h3>Spacing</h3>
            <PxRow label="Gap between sections" group="space" k="sectionGap" max={200} />
            <PxRow label="Section padding (Y)" group="space" k="sectionPaddingY" max={200} />
            <PxRow label="Container width" group="space" k="container" max={1600} />
          </div>
        </div>

        <div className="err">{err}</div>
        <div className="save-row">
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save branding'}</button>
          {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
        </div>
      </div>
    </AppShell>
  )
}
