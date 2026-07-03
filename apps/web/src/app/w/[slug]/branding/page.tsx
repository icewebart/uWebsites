'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { GOOGLE_FONTS, GOOGLE_FONT_NAMES, VIBES } from '@uwebsites/shared'
import { ImageUpload } from '@/components/ImageUpload'

type NavNode = { text: string; href: string; children?: NavNode[] }
type LogoRich =
  | { kind: 'svg'; svg: string; alt?: string }
  | { kind: 'img'; url: string; alt?: string; naturalWidth?: number; naturalHeight?: number }
  | null
type DecorSvg = { id: string; name: string; svg: string }
type BrandAssets = {
  logo?: { url: string; alt?: string } | null
  logo_white?: { url: string; alt?: string } | null   // light/white version for dark footers
  logo_rich?: LogoRich
  nav?: Array<{ text: string; href: string }>
  nav_tree?: NavNode[]
  has_mega_menu?: boolean
  cta?: { label: string; href: string } | null
  snapshot_url?: string | null
  decor_svgs?: DecorSvg[]  // user-uploaded SVG decor for the AI to reuse
}
type Tokens = {
  color: { primary: string; accent: string; accent2?: string; surface: string; text: string; surfaceSoft?: string; surfaceMuted?: string; footerBg?: string; footerFg?: string }
  font: { heading: string; body: string; scale: number; lineHeight: number }
  shape: { buttonRadius: string; cardRadius: string; borderWidth: string; shadow?: string }
  vibe?: string
  tagline?: string
  voice?: string
  motion?: string   // 'on' (default) | 'off' — scroll-reveal animations on published pages
  seo?: { gscVerification?: string; bingVerification?: string; description?: string }
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
// Loads self-hosted @font-face fonts captured on import (e.g. a custom display
// font) so the brand book + mockup render in the real brand font, never a
// fallback. Mirrors the fontsHead() logic on the publish side.
function useCustomFontFaces(faces?: Array<{ family: string; srcUrl: string; format?: string }>) {
  useEffect(() => {
    const list = (faces || []).filter((f) => f?.family && f?.srcUrl)
    if (!list.length) return
    const id = 'uw-facecss'
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el) }
    el.textContent = list.map((f) => `@font-face{font-family:'${f.family}';src:url('${f.srcUrl}')${f.format ? ` format('${f.format}')` : ''};font-display:swap;}`).join('')
  }, [JSON.stringify(faces || [])])
}
const px = (v: string) => parseInt(String(v)) || 0

// Renders the logo — inline SVG markup or an <img>. On dark backgrounds (footer
// mockup), prefer the uploaded white logo; else invert the main one.
function LogoMark({ a, dark }: { a: BrandAssets; dark?: boolean }) {
  if (dark && a.logo_white?.url) return <img className="bb-logo-img" src={a.logo_white.url} alt={a.logo_white.alt || ''} />
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

// Wraps a swatch/tile so clicking it opens a native color picker. When no
// onChange is given it renders inert (read-only brand book, e.g. print/share).
function ColorEdit({ value, onChange, className, style, children }: { value: string; onChange?: (v: string) => void; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  if (!onChange) return <div className={className} style={style}>{children}</div>
  return (
    <label className={`${className || ''} bb-editable`} style={{ ...style, position: 'relative', cursor: 'pointer' }} title="Editează culoarea">
      {children}
      <span className="bb-edit-dot" aria-hidden>✎</span>
      <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 0, padding: 0 }} />
    </label>
  )
}

// Minimal sanitiser for user-uploaded SVGs: strip <script>, on* handlers and
// external references so decor can be inlined safely.
function sanitizeSvg(raw: string): string | null {
  const m = raw.match(/<svg[\s\S]*<\/svg>/i)
  if (!m) return null
  let s = m[0]
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  s = s.replace(/(href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '')
  if (s.length > 40000) return null
  return s
}

// BrandBook — a full design-system document for the workspace: hero, palette
// (with tint/shade scales), typography specimens, buttons/controls, and a live
// preview of the header (floating pill) + footer + captured mega-menu. Driven
// entirely by the workspace tokens + imported brand_assets.
function BrandBook({ t, onColor, onAssets }: { t: Tokens; onColor?: (key: keyof Tokens['color'], v: string) => void; onAssets?: (next: BrandAssets) => void }) {
  const a = t.brand_assets || {}
  const decor = a.decor_svgs || []
  function addSvgFiles(files: FileList | null) {
    if (!files || !onAssets) return
    const readers = Array.from(files).slice(0, 12).map((f) => new Promise<DecorSvg | null>((res) => {
      const r = new FileReader()
      r.onload = () => { const svg = sanitizeSvg(String(r.result || '')); res(svg ? { id: `d${Date.now()}${Math.round(Math.random() * 1e4)}`, name: f.name.replace(/\.svg$/i, ''), svg } : null) }
      r.onerror = () => res(null)
      r.readAsText(f)
    }))
    Promise.all(readers).then((got) => {
      const add = got.filter(Boolean) as DecorSvg[]
      if (add.length) onAssets({ ...a, decor_svgs: [...decor, ...add] })
    })
  }
  function removeSvg(id: string) { if (onAssets) onAssets({ ...a, decor_svgs: decor.filter((d) => d.id !== id) }) }
  const primScale = scale(t.color.primary)
  const accScale = scale(t.color.accent)
  const accent2 = t.color.accent2 || mix(t.color.accent, toRgb(t.color.primary) || [0, 0, 0], 0.5)
  const acc2Scale = scale(accent2)
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
        <div className="bb-scale-label">Primar {onColor && <span className="bb-edit-hint">— click pe 600 ca să editezi</span>}</div>
        <div className="bb-scale">
          {primScale.map((s) => (
            <ColorEdit key={s.step} className="bb-swatch" style={{ background: s.hex, color: fgOn(s.hex) }}
              value={t.color.primary} onChange={s.step === '600' ? (onColor ? (v) => onColor('primary', v) : undefined) : undefined}>
              {s.step === '600' && <span className="bb-swatch-tag">PRIMARY</span>}
              <div className="bb-swatch-meta"><b>{s.step}</b><span>{s.hex.toUpperCase()}</span></div>
            </ColorEdit>
          ))}
        </div>
        <div className="bb-scale-label">Accent</div>
        <div className="bb-scale">
          {accScale.map((s) => (
            <ColorEdit key={s.step} className="bb-swatch" style={{ background: s.hex, color: fgOn(s.hex) }}
              value={t.color.accent} onChange={s.step === '600' ? (onColor ? (v) => onColor('accent', v) : undefined) : undefined}>
              {s.step === '600' && <span className="bb-swatch-tag">ACCENT</span>}
              <div className="bb-swatch-meta"><b>{s.step}</b><span>{s.hex.toUpperCase()}</span></div>
            </ColorEdit>
          ))}
        </div>
        <div className="bb-scale-label">Accent secundar {onColor && <span className="bb-edit-hint">— click pe 600 ca să editezi</span>}</div>
        <div className="bb-scale">
          {acc2Scale.map((s) => (
            <ColorEdit key={s.step} className="bb-swatch" style={{ background: s.hex, color: fgOn(s.hex) }}
              value={accent2} onChange={s.step === '600' ? (onColor ? (v) => onColor('accent2', v) : undefined) : undefined}>
              {s.step === '600' && <span className="bb-swatch-tag">ACCENT 2</span>}
              <div className="bb-swatch-meta"><b>{s.step}</b><span>{s.hex.toUpperCase()}</span></div>
            </ColorEdit>
          ))}
        </div>
        <div className="bb-scale-label">Neutre &amp; suprafețe</div>
        <div className="bb-cols-2">
          <div className="bb-neutrals">
            {[
              { l: 'Surface', v: t.color.surface, key: 'surface' as const },
              { l: 'Surface soft', v: t.color.surfaceSoft || mix(t.color.primary, [255, 255, 255], 0.94), key: 'surfaceSoft' as const },
              { l: 'Surface muted', v: t.color.surfaceMuted || mix(t.color.primary, [255, 255, 255], 0.88), key: 'surfaceMuted' as const },
              { l: 'Text', v: t.color.text, key: 'text' as const },
              { l: 'Footer', v: t.color.footerBg || t.color.text, key: 'footerBg' as const },
            ].map((n) => (
              <ColorEdit key={n.l} className="bb-neutral" style={{ background: n.v, color: fgOn(n.v) }}
                value={n.v} onChange={n.key && onColor ? (v) => onColor(n.key, v) : undefined}><b>{n.l}</b><span>{n.v.toUpperCase()}</span></ColorEdit>
            ))}
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
        <p className="bb-sec-lead">Încarcă propriile SVG-uri — iconițe, forme, bloburi sau decor. Sunt salvate cu brandul și pot fi refolosite automat de AI ca decor pe paginile generate.</p>
        <div className="bb-decor-grid">
          {/* user-uploaded SVGs — the AI reuses these as decor on generated pages */}
          {decor.map((d) => (
            <div key={d.id} className="bb-decor-card bb-decor-custom">
              {onAssets && <button className="bb-decor-del" onClick={() => removeSvg(d.id)} title="Șterge" aria-label="Șterge">×</button>}
              <div className="bb-decor-ico" dangerouslySetInnerHTML={{ __html: d.svg }} />
              <span>{d.name}</span>
            </div>
          ))}
          {onAssets && (
            <label className="bb-decor-card bb-decor-upload" title="Încarcă SVG-uri">
              <input type="file" accept=".svg,image/svg+xml" multiple style={{ display: 'none' }}
                onChange={(e) => { addSvgFiles(e.target.files); e.currentTarget.value = '' }} />
              <div className="bb-decor-upload-plus">＋</div>
              <span>Încarcă SVG</span>
            </label>
          )}
        </div>
        {onAssets && !decor.length && <p className="bb-decor-note">Niciun SVG încărcat încă — apasă „＋ Încarcă SVG” ca să adaugi decorul tău.</p>}
      </section>

      {/* Buttons & controls — 2 columns: buttons+card | forms */}
      <section className="bb-sec">
        <div className="bb-sec-head"><span className="bb-num">04</span><h2 style={{ fontFamily: t.font.heading }}>Butoane &amp; controale</h2></div>
        <div className="bb-ctl-cols">
          <div className="bb-ctl-panel">
            <div className="bb-panel-label">Butoane</div>
            <div className="bb-buttons">
              <button style={{ background: t.color.primary, color: fgOn(t.color.primary), borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Primar</button>
              <button style={{ background: t.color.accent, color: fgOn(t.color.accent), borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Accent</button>
              <button className="ghost" style={{ color: t.color.primary, border: `2px solid ${t.color.primary}`, borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Secundar</button>
              <button style={{ background: mix(t.color.primary, [255, 255, 255], 0.82), color: t.color.primary, borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Soft</button>
            </div>
            <div className="bb-card-demo" style={{ background: t.color.surface, borderRadius: t.shape.cardRadius, border: `${t.shape.borderWidth} solid ${t.color.text}18` }}>
              <div style={{ fontFamily: t.font.heading, fontWeight: 700, color: t.color.text, fontSize: 16, marginBottom: 4 }}>Exemplu de card</div>
              <div style={{ fontSize: 13, color: t.color.text, opacity: .65 }}>Rază card {t.shape.cardRadius}, buton {t.shape.buttonRadius}.</div>
            </div>
          </div>
          <div className="bb-ctl-panel">
            <div className="bb-panel-label">Formulare</div>
            <label className="bb-fld"><span>Numele copilului</span><input placeholder="ex: Maria" style={{ borderRadius: t.shape.buttonRadius }} /></label>
            <label className="bb-fld"><span>Limba dorită</span><select style={{ borderRadius: t.shape.buttonRadius }}><option>Germană</option><option>Franceză</option><option>Engleză</option></select></label>
            <label className="bb-fld bb-check"><input type="checkbox" defaultChecked /><span>Vreau și newsletter-ul</span></label>
          </div>
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
              {a.cta?.label && (
                <span className="bb-header-cta" style={{ background: t.color.primary, color: fgOn(t.color.primary), borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>{a.cta.label}</span>
              )}
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

      {/* Website mockup — a full page composed from the tokens */}
      <section className="bb-sec">
        <div className="bb-sec-head"><span className="bb-num">06</span><h2 style={{ fontFamily: t.font.heading }}>Website mockup</h2></div>
        <p className="bb-sec-lead">Așa arată un site complet construit din aceste elemente — header, hero, carduri și footer, toate din tokenii brandului.</p>
        <WebsiteMockup t={t} a={a} />
      </section>
    </div>
  )
}

// A miniature full-page website preview composed entirely from the brand
// tokens — header + hero (with blob + decor) + program cards + stats + footer.
// Shows "how the website could look" without needing a real page.
function WebsiteMockup({ t, a }: { t: Tokens; a: BrandAssets }) {
  const soft = (amt: number, c = t.color.primary) => mix(c, [255, 255, 255], amt)
  // Auto hero image — a real photo, deterministic per brand so it stays stable.
  const heroImg = `https://picsum.photos/seed/${(t.color.primary || 'brand').replace('#', '')}/760/620`
  return (
    <div className="bb-mock" style={{ background: t.color.surface, fontFamily: t.font.body, color: t.color.text }}>
      {/* header */}
      <div className="bb-mock-header">
        <div className="bb-mock-brand"><LogoMark a={a} /></div>
        <div className="bb-mock-nav" style={{ fontFamily: t.font.heading }}>
          {(a.nav_tree?.length ? a.nav_tree.slice(0, 4).map((n) => n.text) : ['Cursuri', 'Ateliere', 'Tabere', 'Contact']).map((x, i) => <span key={i}>{x}</span>)}
        </div>
        <button className="bb-mock-cta" style={{ background: t.color.primary, color: fgOn(t.color.primary), borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Înscrie-te</button>
      </div>
      {/* hero */}
      <div className="bb-mock-hero" style={{ background: `radial-gradient(120% 120% at 85% 5%, ${soft(0.9)}, ${t.color.surface} 60%)` }}>
        <span className="bb-mock-orb" style={{ background: soft(0.5, t.color.accent), top: 20, left: '6%', width: 60, height: 60 }} />
        <span className="bb-mock-star" style={{ top: 30, right: '30%' }}><Decor kind="star-fill" color={t.color.accent} /></span>
        <div className="bb-mock-hero-txt">
          <div className="bb-mock-eyebrow" style={{ color: t.color.accent }}>ÎNSCRIERI DESCHISE</div>
          <div className="bb-mock-h1" style={{ fontFamily: t.font.heading, color: t.color.text }}>Cursuri și tabere <span style={{ color: t.color.primary }}>pentru copii</span></div>
          <div className="bb-mock-sub">Învățare prin joc, grupe mici și profesori dedicați.</div>
          <div className="bb-mock-btns">
            <button style={{ background: t.color.primary, color: fgOn(t.color.primary), borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Vezi cursurile →</button>
            <button style={{ background: 'transparent', color: t.color.primary, border: `2px solid ${t.color.primary}`, borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Contact</button>
          </div>
        </div>
        <div className="bb-mock-hero-media" style={{ borderRadius: t.shape.cardRadius }}>
          <span className="bb-mock-hero-blob" style={{ background: soft(0.55, t.color.accent) }} />
          <img src={heroImg} alt="" loading="lazy" style={{ borderRadius: t.shape.cardRadius }} />
          <span className="bb-mock-hero-badge" style={{ background: t.color.surface, color: t.color.text, borderRadius: t.shape.cardRadius, fontFamily: t.font.heading }}>
            <b style={{ color: t.color.primary }}>4.9★</b> 200+ familii
          </span>
        </div>
      </div>
      {/* programs — titled section */}
      <div className="bb-mock-sechead">
        <div className="bb-mock-eyebrow" style={{ color: t.color.accent }}>PROGRAMELE NOASTRE</div>
        <div className="bb-mock-h2" style={{ fontFamily: t.font.heading, color: t.color.text }}>Cursuri, ateliere și tabere</div>
      </div>
      <div className="bb-mock-cards">
        {[{ badge: 'Cursuri', c: t.color.primary }, { badge: 'Ateliere', c: t.color.accent }, { badge: 'Tabere', c: mix(t.color.primary, [255, 255, 255], 0.15) }].map((card, i) => (
          <div key={i} className="bb-mock-card" style={{ borderRadius: t.shape.cardRadius }}>
            <div className="bb-mock-card-top" style={{ background: `repeating-linear-gradient(45deg, ${soft(0.85, card.c)} 0 10px, ${soft(0.72, card.c)} 10px 20px)` }} />
            <div className="bb-mock-card-body">
              <div className="bb-mock-badge" style={{ color: card.c }}>{card.badge.toUpperCase()}</div>
              <div className="bb-mock-card-h" style={{ fontFamily: t.font.heading }}>Titlul programului</div>
              <div className="bb-mock-card-p">O scurtă descriere a programului.</div>
            </div>
          </div>
        ))}
      </div>

      {/* community — image-left feature card with inline stats + star */}
      <div className="bb-mock-community" style={{ background: soft(0.95) }}>
        <div className="bb-mock-sechead">
          <div className="bb-mock-eyebrow" style={{ color: t.color.accent }}>COMUNITATE SPRIJINITĂ DE ASOCIAȚII</div>
          <div className="bb-mock-h2" style={{ fontFamily: t.font.heading, color: t.color.text }}>O comunitate a vorbitorilor de limba germană</div>
          <div className="bb-mock-sub" style={{ margin: '8px auto 0', textAlign: 'center' }}>Activități interactive care încurajează inițiativa proprie și socializarea, într-un cadru informal.</div>
        </div>
        <div className="bb-mock-feature" style={{ borderRadius: t.shape.cardRadius }}>
          <div className="bb-mock-feat-img" style={{ background: `linear-gradient(135deg, ${soft(0.45, t.color.accent)}, ${soft(0.4, t.color.primary)})` }} />
          <div className="bb-mock-feat-body">
            <span className="bb-mock-feat-star"><Decor kind="star-fill" color={t.color.accent} /></span>
            <div className="bb-mock-card-h" style={{ fontFamily: t.font.heading, fontSize: 18 }}>Învățare prin joc și metode nonformale</div>
            <div className="bb-mock-card-p" style={{ fontSize: 13, marginBottom: 16, maxWidth: '38ch' }}>Tabere tematice de zi și tabere cu cazare, pentru copii curioși și entuziaști.</div>
            <div className="bb-mock-feat-stats">
              {[['166+', 'participanți unici', t.color.primary], ['11', 'tabere organizate', t.color.accent], ['0–8', 'clase primite', mix(t.color.primary, toRgb(t.color.accent) || [0, 0, 0], 0.5)]].map(([v, l, c], i) => (
                <div key={i}><b style={{ fontFamily: t.font.heading, color: c as string }}>{v}</b><span>{l}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* testimonials */}
      <div className="bb-mock-testi" style={{ background: soft(0.9, t.color.accent) }}>
        <span className="bb-mock-testi-blob" style={{ background: soft(0.5, t.color.primary) }} />
        <span className="bb-mock-testi-star"><Decor kind="star-fill" color={t.color.accent} /></span>
        <div className="bb-mock-sechead">
          <div className="bb-mock-eyebrow" style={{ color: t.color.accent }}>PESTE 2000 DE PARTICIPANȚI</div>
          <div className="bb-mock-h2" style={{ fontFamily: t.font.heading, color: t.color.text }}>Ce spun participanții la proiecte</div>
        </div>
        <div className="bb-mock-testi-cards">
          {[
            { q: 'Atelierul a avut structură și atmosfera a fost relaxată. Am apreciat metoda interactivă prin jocuri.', n: 'Georgiana Guler', r: 'părinte', av: soft(0.4, t.color.primary) },
            { q: 'Deși eram cea mai începătoare, nu m-am simțit jenată. Toți au fost deschiși și au avut răbdare cu mine.', n: 'Cristina Bujoreanu', r: 'participant', av: soft(0.45, t.color.accent) },
            { q: 'Trainerul a antrenat copiii cu joculețe, roluri și cântece. Recomandăm cu drag!', n: 'Alina Beaupain', r: 'părinte', av: soft(0.35, mix(t.color.primary, toRgb(t.color.accent) || [0, 0, 0], 0.5)) },
          ].map((tm, i) => (
            <div key={i} className="bb-mock-testi-card" style={{ borderRadius: t.shape.cardRadius }}>
              <div className="bb-mock-testi-stars">★★★★★</div>
              <div className="bb-mock-testi-q">„{tm.q}”</div>
              <div className="bb-mock-testi-author">
                <span className="bb-mock-testi-av" style={{ background: tm.av }} />
                <div><div className="bb-mock-testi-name" style={{ fontFamily: t.font.heading }}>{tm.n}</div><div className="bb-mock-testi-role">{tm.r} · Ateliere conversaționale</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* newsletter CTA band */}
      <div className="bb-mock-nl-wrap" style={{ background: t.color.surface }}>
        <div className="bb-mock-newsletter" style={{ background: t.color.footerBg || t.color.text, color: t.color.footerFg || '#fff', borderRadius: t.shape.cardRadius }}>
          <span className="bb-mock-nl-blob" style={{ background: soft(0.45, t.color.primary) }} />
          <div className="bb-mock-nl-txt">
            <div className="bb-mock-nl-h" style={{ fontFamily: t.font.heading }}>
              <span className="bb-mock-nl-star"><Decor kind="star-fill" color={t.color.accent} /></span>
              Abonează-te la newsletter
            </div>
            <div className="bb-mock-nl-sub">Fii la curent cu toate taberele, cursurile și atelierele pe care le organizăm.</div>
          </div>
          <div className="bb-mock-nl-form">
            <input placeholder="Adresa ta de e-mail" readOnly />
            <button style={{ background: t.color.accent, color: fgOn(t.color.accent), borderRadius: t.shape.buttonRadius, fontFamily: t.font.heading }}>Înscrie-mă</button>
          </div>
        </div>
      </div>
      {/* real footer — brand + columns + bottom bar */}
      <div className="bb-mock-footer2" style={{ background: t.color.footerBg || t.color.text, color: t.color.footerFg || '#fff', fontFamily: t.font.body }}>
        <div className="bb-mock-foot-grid">
          <div className="bb-mock-foot-brand">
            <div className="bb-mock-foot-logo">{a.logo_rich || a.logo?.url ? <LogoMark a={a} dark /> : <b style={{ fontFamily: t.font.heading, fontSize: 20 }}>Brand</b>}</div>
            <p>Platformă care promovează tabere, școli de vară și cursuri pentru cei mici.</p>
          </div>
          {[
            { h: 'Contact', items: ['+40 752 822 373', 'contact@brand.ro', 'str. Brătianu 39', 'Facebook · Instagram'] },
            { h: 'Programe', items: (a.nav_tree?.length ? a.nav_tree.slice(0, 4).map((n) => n.text) : ['Cursuri & ateliere', 'Tabere de vară', 'Lecție gratuită', 'Despre noi']) },
            { h: 'Pagini utile', items: ['Blog', 'Contact', 'Termeni și condiții', 'Parteneri'] },
          ].map((col, i) => (
            <div key={i} className="bb-mock-foot-col">
              <h5 style={{ fontFamily: t.font.heading }}>{col.h}</h5>
              {col.items.map((it, j) => <span key={j}>{it}</span>)}
            </div>
          ))}
        </div>
        <div className="bb-mock-foot-bottom">
          <span>© {new Date().getFullYear()} Brand · Toate drepturile rezervate</span>
          <span>Realizat cu ♥ pentru copii curioși</span>
        </div>
      </div>
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
    <div className="ctl-group" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--bg-subtle)', marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>Import branding from a website</h3>
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

// Loads every vibe's fonts so the vibe cards render their name in-font.
function VibeFontLoader() {
  useGoogleFontPreview(...VIBES.flatMap((v) => [v.font.heading, v.font.body]))
  return null
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

  // Set/clear a logo. Uploading a header logo also clears any imported inline
  // SVG so the uploaded one is the single source of truth.
  function setLogo(key: 'logo' | 'logo_white', url: string) {
    setT((cur) => {
      if (!cur) return cur
      const ba: any = { ...(cur.brand_assets || {}) }
      ba[key] = url ? { url } : null
      if (key === 'logo') ba.logo_rich = null
      return { ...cur, brand_assets: ba }
    })
  }
  const headerLogoVal = t?.brand_assets?.logo?.url || (t?.brand_assets?.logo_rich?.kind === 'img' ? t.brand_assets.logo_rich.url : '') || ''

  // Apply a vibe preset — bundles font pairing + shape (radius/border/shadow) +
  // type scale in one click. Colors are preserved (they're the brand identity).
  function applyVibe(slug: string) {
    const v = VIBES.find((x) => x.slug === slug)
    if (!v) return
    setT((cur) => cur ? {
      ...cur, vibe: slug,
      font: { ...cur.font, heading: v.font.heading, body: v.font.body, scale: v.font.scale },
      shape: { ...cur.shape, ...v.shape },
    } : cur)
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
  // Load any self-hosted brand fonts (custom @font-face) so they never fall back.
  useCustomFontFaces((t as any)?.brand_assets?.font_faces)

  if (loading || !t) return <div className="empty">Loading…</div>
  const accent2Fallback = (/^#[0-9a-fA-F]{6}$/.test(t.color.accent2 || '') ? t.color.accent2 : mix(t.color.accent, toRgb(t.color.primary) || [0, 0, 0], 0.5)) as string

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
      <BrandImport onImported={(tk) => setT(tk)} />

      <BrandBook t={t}
        onColor={(key, v) => patch('color', key, v)}
        onAssets={(next) => setT((cur) => cur ? { ...cur, brand_assets: next } : cur)} />

      {/* Token editor — constrained cards so controls never stretch/clip. The
          brand book above is the live preview, so no separate preview column. */}
      <div className="brand-editor">
        <div className="dash-h" style={{ marginTop: 4 }}>Logos</div>
        <div className="brand-editor-grid" style={{ marginBottom: 6 }}>
          <div className="ctl-group card">
            <h3>Logo — header</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>Shown in the menu / header. Use a version that reads on a light background.</p>
            <ImageUpload slug={slug} value={headerLogoVal} onChange={(url) => setLogo('logo', url)} />
          </div>
          <div className="ctl-group card">
            <h3>Logo — white (footer)</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>A white / light version for the dark footer. If left empty, the header logo is auto-inverted to white.</p>
            <ImageUpload slug={slug} dark value={t?.brand_assets?.logo_white?.url || ''} onChange={(url) => setLogo('logo_white', url)} />
          </div>
        </div>

        <div className="dash-h" style={{ marginTop: 22 }}>Vibe — one-click design system</div>
        <div className="vibe-grid">
          {VIBES.map((v) => (
            <button key={v.slug} className={`vibe-card ${t.vibe === v.slug ? 'on' : ''}`} onClick={() => applyVibe(v.slug)}>
              <div className="vibe-name" style={{ fontFamily: GOOGLE_FONT_NAMES.has(v.font.heading) ? v.font.heading : undefined }}>{v.name}</div>
              <div className="vibe-blurb">{v.blurb}</div>
              <div className="vibe-meta">{v.font.heading} + {v.font.body}</div>
            </button>
          ))}
        </div>
        <VibeFontLoader />

        <div className="dash-h" style={{ marginTop: 22 }}>Brand voice &amp; tagline</div>
        <div className="ctl-group card" style={{ marginBottom: 4 }}>
          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
            The AI uses these whenever it writes or rebuilds a page — so every page sounds like <em>you</em>, not a template. Visual identity (colors, fonts, shape) is already set above; this is about words &amp; tone.
          </p>
          <div className="field">
            <label>Tagline</label>
            <input value={t.tagline || ''} placeholder='e.g. "German for kids, through play"' onChange={(e) => setT((c) => c ? { ...c, tagline: e.target.value } : c)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Brand voice / personality</label>
            <textarea className="inp" rows={3} value={t.voice || ''} placeholder='Describe how your brand should sound. e.g. "Warm and encouraging, speaks directly to parents, concrete outcomes over hype, one light joke is fine, never corporate."' onChange={(e) => setT((c) => c ? { ...c, voice: e.target.value } : c)} />
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Leave blank to use the auto-detected voice for your industry.</p>
          </div>
        </div>

        <div className="dash-h" style={{ marginTop: 22 }}>SEO &amp; Search Console</div>
        <div className="ctl-group card" style={{ marginBottom: 4 }}>
          <div className="field">
            <label>Default meta description</label>
            <textarea className="inp" rows={2} value={t.seo?.description || ''} placeholder="One or two sentences describing the site — used when a page has no description of its own." onChange={(e) => setT((c) => c ? { ...c, seo: { ...c.seo, description: e.target.value } } : c)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Google Search Console verification</label>
            <input value={t.seo?.gscVerification || ''} placeholder="paste the content value of the google-site-verification meta tag" onChange={(e) => setT((c) => c ? { ...c, seo: { ...c.seo, gscVerification: e.target.value.replace(/.*content=["']?([^"'>]+).*/i, '$1').trim() } } : c)} />
            <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>In Search Console pick <b>HTML tag</b> verification and paste the tag (or just its code) here → Publish → click Verify. We also emit robots.txt + your sitemap automatically.</p>
          </div>
        </div>

        <div className="dash-h" style={{ marginTop: 22 }}>Motion</div>
        <div className="ctl-group card" style={{ marginBottom: 4 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={t.motion !== 'off'} onChange={(e) => setT((c) => c ? { ...c, motion: e.target.checked ? 'on' : 'off' } : c)} style={{ width: 'auto' }} />
            <span><b>Scroll animations</b> — sections gently fade/rise into view as visitors scroll.</span>
          </label>
          <p className="muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>Automatically disabled for visitors who prefer reduced motion. Lightweight — no effect on page speed.</p>
        </div>

        <div className="dash-h" style={{ marginTop: 22 }}>Edit tokens</div>
        <div className="brand-editor-grid">
          <div className="ctl-group card">
            <h3>Colors</h3>
            <div className="ctl-row"><label>Primary</label><Swatch k="primary" /></div>
            <div className="ctl-row"><label>Accent</label><Swatch k="accent" /></div>
            <div className="ctl-row"><label>Accent 2</label>
              <div className="swatch">
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(t.color.accent2 || '') ? (t.color.accent2 as string) : accent2Fallback} onChange={(e) => patch('color', 'accent2', e.target.value)} />
                <input type="text" value={t.color.accent2 || ''} placeholder="(auto)" onChange={(e) => patch('color', 'accent2', e.target.value)} />
              </div>
            </div>
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
            <p className="muted" style={{ fontSize: 11, marginTop: -4, marginBottom: 10 }}>Section spacing applies to every page, including articles. Try 72–96px for a roomy feel.</p>
            <PxRow label="Space around sections" group="space" k="sectionPaddingY" max={200} />
            <PxRow label="Gap between sections" group="space" k="sectionGap" max={200} />
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
