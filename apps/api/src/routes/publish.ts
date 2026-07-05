import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { db, workspaces, pages, brandingTokens, builds } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { renderSection, SECTION_CSS, SECTIONS, sectionHasContent, esc as escSh } from '../lib/sections.js'
import { getMenusFor } from './menus.js'
import { GOOGLE_FONT_NAMES, SHADOW_MAP } from '@uwebsites/shared'

// Publisher — compiles a workspace's pages (+ branding tokens) to static
// HTML/CSS on disk, served by nginx. One box (ADR-012), so we write locally;
// a DeployAdapter (ADR-004) would rsync to a CDN/other host later.
export const publishRouter = Router()

const SITES_DIR = process.env.SITES_DIR || '/www/wwwroot/_sites'
const SITES_URL = process.env.PUBLIC_SITES_URL || 'https://app.uwebsites.net/p'

const DEFAULT_TOKENS: any = {
  color: { primary: '#16324A', accent: '#8FD7F1', surface: '#FFFFFF', text: '#16242E' },
  font: { heading: 'Space Grotesk', body: 'Inter', scale: 1.2, lineHeight: 1.6 },
  shape: { buttonRadius: '12px', cardRadius: '16px', borderWidth: '1px' },
  space: { sectionGap: '64px', sectionPaddingY: '72px', container: '1200px' },
}
const esc = escSh

function fontsHead(t: any) {
  // Google-hosted families → stylesheet link.
  const fams = [...new Set([t.font.heading, t.font.body])].filter((f) => GOOGLE_FONT_NAMES.has(f))
  const gLink = fams.length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;600;700`).join('&')}&display=swap" rel="stylesheet">`
    : ''
  // Self-hosted @font-face captured on import (e.g. a custom display font) —
  // always emit these so a brand's signature font never falls back silently.
  const faces = (t.brand_assets?.font_faces || []) as Array<{ family: string; srcUrl: string; format?: string }>
  const faceCss = faces
    .filter((f) => f?.family && f?.srcUrl)
    .map((f) => `@font-face{font-family:'${f.family}';src:url('${f.srcUrl}')${f.format ? ` format('${f.format}')` : ''};font-display:swap;}`)
    .join('')
  return gLink + (faceCss ? `<style>${faceCss}</style>` : '')
}

function siteCss(t: any) {
  // Extra design-system tokens the workspace can override:
  //   footerBg   = dark tint under the footer (default = --text)
  //   footerFg   = footer text color (default = --surface)
  // Falls back so existing sites without these keys keep working.
  const footerBg = t.color?.footerBg || t.color.text
  const footerFg = t.color?.footerFg || t.color.surface
  const shadow = SHADOW_MAP[t.shape?.shadow as string] || SHADOW_MAP.soft
  // Secondary accent — a third brand color for variety (gradients, alt cards).
  // Defaults to a blend of accent + primary when not explicitly set.
  const accent2 = t.color?.accent2 || `color-mix(in srgb, ${t.color.accent}, ${t.color.primary})`
  return `:root{--primary:${t.color.primary};--accent:${t.color.accent};--accent2:${accent2};--surface:${t.color.surface};--text:${t.color.text};--footer-bg:${footerBg};--footer-fg:${footerFg};--btn-r:${t.shape.buttonRadius};--card-r:${t.shape.cardRadius};--bw:${t.shape.borderWidth};--shadow:${shadow};--gap:${t.space.sectionGap};--pad:${t.space.sectionPaddingY};--container:${t.space.container}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'${t.font.body}',system-ui,-apple-system,sans-serif;color:var(--text);background:var(--surface);line-height:${t.font.lineHeight};-webkit-font-smoothing:antialiased}
a{color:var(--primary)}
.container{max-width:var(--container);margin:0 auto;padding:0 24px;position:relative;z-index:1}
h1,h2,h3{font-family:'${t.font.heading}',system-ui,sans-serif;line-height:1.12;letter-spacing:-.02em}
img{max-width:100%}
/* Section rhythm — each section owns symmetric vertical padding (no collapse),
   so there's consistent, generous breathing room between every section. The
   spacing is driven by --pad (Branding → "Space between sections"). */
section{padding:var(--pad) 0;position:relative}
/* Neighbouring same-tone sections would otherwise double up — halve the seam so
   it stays generous but not cavernous; alternating tones keep full padding. */
section.tone-surface:not(.uw-raw) + section.tone-surface:not(.uw-raw){padding-top:calc(var(--pad) * .4)}
/* imported sections carry their own spacing — never add a seam between them */
.uw-raw + .uw-raw{padding-top:0}

/* Section tones — alternating landing-page rhythm. Tinted bands get their own
   top+bottom padding (override the collapse) plus soft decorative circles in
   the corners so the page never reads as flat white. */
.tone-tint{background:color-mix(in srgb, var(--primary) 5%, var(--surface));padding-top:var(--pad)!important;overflow:hidden}
.tone-hero-wash{background:linear-gradient(160deg, color-mix(in srgb, var(--primary) 8%, var(--surface)), color-mix(in srgb, var(--accent) 7%, var(--surface)));overflow:hidden}
.tone-tint::before,.tone-hero-wash::before{content:"";position:absolute;width:220px;height:220px;border-radius:50%;background:color-mix(in srgb, var(--accent) 16%, transparent);top:-70px;right:-60px;z-index:0;pointer-events:none}
.tone-tint::after,.tone-hero-wash::after{content:"";position:absolute;width:150px;height:150px;border-radius:50%;background:color-mix(in srgb, var(--primary) 12%, transparent);bottom:-50px;left:-40px;z-index:0;pointer-events:none}
/* Uploaded decor SVGs replace the plain circles when present */
.has-decor::before,.has-decor::after{display:none}
.uw-decor{position:absolute;z-index:0;pointer-events:none;opacity:.5}
.uw-decor svg{width:100%;height:100%;display:block}
.uw-decor-a{width:180px;height:180px;top:-38px;right:-30px}
.uw-decor-b{width:120px;height:120px;bottom:-34px;left:-30px}
@media(max-width:640px){.uw-decor-a{width:120px;height:120px}.uw-decor-b{width:84px;height:84px}}
.hero{padding-bottom:calc(var(--pad))}
.hero h1{font-size:calc(2.1rem * ${t.font.scale});margin-bottom:14px;max-width:18ch}
.hero .sub{font-size:1.1rem;opacity:.78;max-width:60ch;margin-bottom:24px}
.btn{display:inline-block;background:var(--primary);color:#fff;border-radius:var(--btn-r);padding:12px 22px;text-decoration:none;font-weight:600;font-family:'${t.font.heading}',sans-serif;transition:filter .15s ease, transform .15s ease, box-shadow .15s ease}
.btn:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 8px 20px -8px color-mix(in srgb, var(--primary) 50%, transparent)}
/* every button/link-button gets a hover, including imported (raw-html) ones */
.uw-raw a[class*="btn"],.uw-raw a[class*="button"],.uw-raw button,.uw-raw [role="button"]{transition:filter .15s ease, transform .15s ease}
.uw-raw a[class*="btn"]:hover,.uw-raw a[class*="button"]:hover,.uw-raw button:hover,.uw-raw [role="button"]:hover{filter:brightness(1.06);transform:translateY(-1px)}
.rt{font-size:1rem}
.rt :where(p,ul,ol){margin-bottom:1em}
.rt img{max-width:100%;height:auto;border-radius:var(--card-r)}
.img img{display:block;width:100%;height:auto;border-radius:var(--card-r)}

/* Header is FIXED and overlays the hero — the hero background flows behind it so
   the two read as one block (like the ATA site), and it stays put on scroll
   (sticky). Three styles: glass (frosted bar, default), solid (opaque bar),
   minimal (no bar — logo/nav sit straight on the hero). The first section
   reserves top space so nothing hides behind the fixed bar. */
.site-header{position:fixed;top:0;left:0;right:0;z-index:100;background:transparent;padding:16px 0;transition:padding .2s ease}
.site-header .container{display:flex;align-items:center;gap:24px;min-height:56px;padding:8px 22px;border-radius:16px;transition:background .2s ease, box-shadow .2s ease}
.site-header .brand,.site-header .nav .nav-link,.site-header .caret{color:var(--text)}
main > section:first-child{padding-top:calc(var(--pad) + 76px)}
/* Imported heroes carry their background on a NESTED element, so our headroom
   would just be a white band above it. Drop the headroom for raw-html first
   sections — the imported hero has its own top padding, and the transparent
   header overlays its (colored) top so the menu sits ON the hero. */
main > section.uw-raw:first-child{padding-top:0}

/* glass — scroll-aware: at the top it's fully TRANSPARENT so the menu is part
   of the hero (no white bar); once scrolled it becomes a frosted bar so the nav
   stays legible over page content. Toggled by HEADER_SCRIPT (.scrolled). */
.site-header.style-glass .container{background:transparent;border:1px solid transparent;box-shadow:none}
.site-header.style-glass.scrolled .container{background:color-mix(in srgb, var(--surface) 80%, transparent);backdrop-filter:saturate(1.3) blur(14px);-webkit-backdrop-filter:saturate(1.3) blur(14px);border-color:color-mix(in srgb, var(--text) 8%, transparent);box-shadow:0 8px 30px -14px rgba(20,10,40,.16)}
/* solid gets a shadow only once scrolled too */
.site-header.style-solid .container{box-shadow:none}
.site-header.style-solid.scrolled .container{box-shadow:0 8px 30px -14px rgba(20,10,40,.16)}
/* solid — opaque surface bar */
.site-header.style-solid .container{background:var(--surface);border:1px solid color-mix(in srgb, var(--text) 8%, transparent);box-shadow:0 8px 30px -14px rgba(20,10,40,.16)}
/* minimal — no bar, brand + nav sit directly on the hero */
.site-header.style-minimal .container{background:transparent;border:0;box-shadow:none;padding:8px 4px}
.site-header .brand{font-family:'${t.font.heading}',sans-serif;font-weight:700;font-size:18px;color:var(--primary);text-decoration:none;display:flex;align-items:center;gap:10px;flex:0 0 auto}
.site-header .brand img{height:42px;width:auto;display:block}
.site-header .nav{flex:1;display:flex;justify-content:center;gap:26px;align-items:center;flex-wrap:wrap;font-family:'${t.font.heading}',sans-serif}
.site-header .nav a{color:var(--text);opacity:.85;font-size:15px;font-weight:600;text-decoration:none;padding:6px 4px;font-family:'${t.font.heading}',sans-serif}
.site-header .nav a:hover{opacity:1;color:var(--primary)}
.site-header .header-cta{background:var(--primary);color:#fff;border-radius:999px;padding:10px 22px;font-weight:700;font-size:14px;text-decoration:none;flex:0 0 auto;font-family:'${t.font.heading}',sans-serif}
.site-header .header-cta:hover{filter:brightness(1.08)}

/* Dropdown / mega-menu — desktop opens on hover + keyboard focus; a small hover
   bridge keeps it open while the cursor travels down to the panel. */
.site-header .nav-item{position:relative;display:flex;align-items:center}
.site-header .nav-trigger{display:inline-flex!important;align-items:center;gap:5px;cursor:pointer}
.site-header .caret{font-size:9px;opacity:.55;transition:transform .16s}
.site-header .nav-item:hover .caret,.site-header .nav-item:focus-within .caret,.site-header .nav-item.open .caret{transform:rotate(180deg);opacity:.9}
.site-header .nav-item.has-children::after{content:"";position:absolute;top:100%;left:0;right:0;height:12px}
.site-header .dropdown{position:absolute;top:100%;left:50%;transform:translateX(-50%) translateY(8px);background:#fff;border-radius:16px;box-shadow:0 14px 44px rgba(60,20,90,.16);padding:10px;min-width:210px;display:flex;flex-direction:column;gap:2px;opacity:0;visibility:hidden;transition:opacity .16s ease,transform .16s ease;z-index:200}
.site-header .nav-item:hover .dropdown,.site-header .nav-item:focus-within .dropdown,.site-header .nav-item.open .dropdown{opacity:1;visibility:visible;transform:translateX(-50%) translateY(6px)}
.site-header .dropdown a{color:var(--text);opacity:.82;font-size:14px;font-weight:600;text-decoration:none;padding:9px 14px;border-radius:10px;white-space:nowrap;transition:background .12s,color .12s}
.site-header .dropdown a:hover{opacity:1;color:var(--primary);background:color-mix(in srgb, var(--primary) 8%, #fff)}
.site-header .dropdown.mega{display:grid;grid-template-columns:repeat(2,minmax(190px,1fr));gap:2px 8px;min-width:440px}

/* Kids.ro-style dark footer — rounded top, three-column info + brand block,
   cream text on the workspace's footer-bg (defaults to --text). */
.site-footer{background:var(--footer-bg);color:var(--footer-fg);margin-top:0;padding:64px 0 32px;position:relative}
.site-footer.ft-columns .container,.site-footer.ft-mega .container{display:grid;grid-template-columns:1.4fr 1fr 1fr 1.4fr;gap:40px;align-items:start}
.site-footer.ft-mega .container{grid-template-columns:1.6fr repeat(4,1fr) 1.4fr;gap:36px}
.site-footer .brand-col{display:flex;flex-direction:column;gap:16px}
/* --- simple: centered stack --- */
.site-footer.ft-simple .container{text-align:center}
.site-footer.ft-simple .ft-center{display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:22px}
.site-footer.ft-simple .ft-tag{opacity:.72;font-size:14px;max-width:46ch;margin:0 auto}
.site-footer .ft-links{display:flex;flex-wrap:wrap;gap:8px 26px;justify-content:center}
.site-footer .ft-links a{color:var(--footer-fg);opacity:.8;font-size:14px;text-decoration:none;padding:4px 0}
.site-footer .ft-links a:hover{opacity:1;text-decoration:underline}
/* --- minimal: one row --- */
.site-footer.ft-minimal{padding:36px 0 24px}
.site-footer.ft-minimal .ft-row{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.site-footer.ft-minimal .ft-links{justify-content:flex-end}
/* --- cta: band on top --- */
.site-footer.ft-cta .ft-cta-band{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:0 0 28px;margin-bottom:28px;border-bottom:1px solid rgba(255,255,255,.14)}
.site-footer.ft-cta .ft-cta-band h3{font-size:clamp(1.4rem,3vw,1.9rem);margin:0;color:var(--footer-fg)}
.site-footer.ft-cta .ft-row{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}
.site-footer.ft-cta .ft-links{justify-content:flex-end}
.site-footer .nl-msg{font-size:13px;margin-top:8px;opacity:.85}
@media(max-width:760px){.site-footer.ft-minimal .ft-row,.site-footer.ft-cta .ft-row{flex-direction:column;align-items:flex-start}.site-footer .ft-links{justify-content:flex-start!important}}
.site-footer .brand-col .brand{font-family:'${t.font.heading}',sans-serif;font-weight:800;font-size:22px;color:var(--footer-fg);display:flex;align-items:center;gap:10px}
.site-footer .brand-col .brand img{height:44px;width:auto}
.site-footer .brand-col .brand img.foot-logo-invert{filter:brightness(0) invert(1)}
.site-footer .brand-col p{font-size:14px;opacity:.72;max-width:32ch;line-height:1.5}
.site-footer h4{font-family:'${t.font.heading}',sans-serif;font-weight:700;font-size:15px;margin-bottom:14px;color:var(--footer-fg)}
.site-footer .col a{display:block;color:var(--footer-fg);opacity:.72;padding:6px 0;font-size:14px;text-decoration:none;transition:opacity .15s}
.site-footer .col a:hover{opacity:1;text-decoration:underline}
.site-footer .newsletter form{display:flex;background:rgba(255,255,255,.08);border-radius:999px;padding:4px;gap:4px;margin-top:2px}
.site-footer .newsletter input{flex:1;background:transparent;border:0;color:var(--footer-fg);padding:10px 14px;font-family:inherit;font-size:14px;outline:none}
.site-footer .newsletter input::placeholder{color:var(--footer-fg);opacity:.5}
.site-footer .newsletter button{background:var(--accent);color:#2a1a3a;border:0;border-radius:999px;padding:10px 18px;font-weight:800;cursor:pointer;font-family:inherit;font-size:13px}
.site-footer .bottom{grid-column:1/-1;border-top:1px solid rgba(255,255,255,.12);margin-top:20px;padding-top:20px;display:flex;justify-content:space-between;align-items:center;font-size:12px;opacity:.72;flex-wrap:wrap;gap:12px}
.site-footer .bottom a{color:var(--footer-fg);opacity:.85;text-decoration:none}
.site-footer .bottom a:hover{opacity:1;text-decoration:underline}

/* ---------- Mobile hamburger ---------- */
.site-header .burger{display:none;flex:0 0 auto;width:40px;height:40px;background:transparent;border:0;padding:0;cursor:pointer;position:relative;z-index:2}
.site-header .burger span{display:block;width:22px;height:2px;background:var(--text);border-radius:2px;margin:5px auto;transition:transform .2s ease, opacity .2s ease}
.site-header.nav-open .burger span:nth-child(1){transform:translateY(7px) rotate(45deg)}
.site-header.nav-open .burger span:nth-child(2){opacity:0}
.site-header.nav-open .burger span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}

@media(max-width:900px){
  /* Fluid, phone-friendly heading & container sizes for EVERY generated site */
  :root{--pad:36px}
  .container{padding:0 18px}
  section{padding:var(--pad) 0}
  .hero h1{font-size:clamp(1.65rem, 8vw, 2.1rem)}
  .site-header .container{flex-wrap:nowrap;border-radius:0;padding:10px 14px;gap:12px}
  .site-header .brand{flex:1 1 auto;font-size:15px;min-width:0}
  .site-header .brand img{max-width:70%}
  .site-header .header-cta{padding:8px 14px;font-size:13px}
  /* When nav-open, the CTA also lives INSIDE the panel visually — keep it
     tappable but move it below the nav list via order (panel is flex-column). */
  .site-header.nav-open .header-cta{position:relative;z-index:2;order:2;margin-top:20px;align-self:flex-start}
  .site-header .burger{display:block}
  .site-header .nav{position:fixed;top:0;left:0;right:0;bottom:0;background:var(--surface);padding:80px 24px 32px;flex-direction:column;justify-content:flex-start;align-items:stretch;gap:6px;overflow-y:auto;opacity:0;visibility:hidden;transform:translateY(-8px);transition:opacity .2s ease, transform .2s ease, visibility .2s ease;z-index:1}
  .site-header.nav-open .nav{opacity:1;visibility:visible;transform:none}
  .site-header .nav .nav-link{font-size:18px;padding:12px 4px;border-bottom:1px solid color-mix(in srgb,var(--text) 8%,transparent);width:100%}
  .site-header .nav-item{display:block;width:100%}
  .site-header .nav-item.has-children::after{display:none}
  /* Dropdowns expand inline in the mobile panel (tap-to-open via HEADER_SCRIPT) */
  .site-header .dropdown{position:static;transform:none!important;box-shadow:none;opacity:1;visibility:visible;display:none;padding:0 0 8px 12px;min-width:0;background:transparent;flex-direction:column}
  .site-header .dropdown.mega{grid-template-columns:1fr;min-width:0}
  .site-header .nav-item.open .dropdown{display:flex}
  .site-header .dropdown a{padding:10px 4px;font-size:15px}
  /* overlay header stays overlaid on the hero — a bit more headroom */
  main > section:first-child{padding-top:calc(var(--pad) + 90px)}
  main > section.uw-raw:first-child{padding-top:0}
  /* Footer stacks nicely */
  .site-footer.ft-columns .container,.site-footer.ft-mega .container{grid-template-columns:1fr 1fr;gap:24px;padding:0 18px}
  .site-footer{padding:48px 0 24px}
}
@media(max-width:560px){
  :root{--pad:28px}
  .hero h1{font-size:clamp(1.5rem, 9vw, 1.95rem);max-width:24ch}
  .hero .sub,.hero-image .sub,.hero-blob .sub{font-size:.98rem}
  .btn{padding:11px 20px;font-size:.95rem}
  .site-footer.ft-columns .container,.site-footer.ft-mega .container{grid-template-columns:1fr}
  .cta-banner .box{padding:36px 20px;border-radius:24px}
}
${SECTION_CSS}`
}

// Per-section render lives in lib/sections.ts so the catalog drives both the
// renderer and the editor's gallery. publish.ts just composes the page.
const renderBlock = renderSection

// Section "tone" — gives a page landing-page rhythm: content sections
// alternate between the plain surface and a soft brand-tinted band, while
// heroes and already-colored sections (stats-band, cta-banner) stay neutral.
// Tinted bands also get scattered decorative circles (see .tone-tint CSS).
const HERO_KINDS = new Set(['hero', 'hero-image', 'hero-blob', 'split-hero'])
const NEUTRAL_KINDS = new Set(['stats-band', 'cta-banner', 'raw-html'])
// Uploaded decor SVG markup from the workspace brand assets (Branding →
// Iconițe & decor). Used as scattered section-background decoration.
function decorSvgs(t: any): string[] {
  const arr = (t as any)?.brand_assets?.decor_svgs
  return Array.isArray(arr) ? arr.map((d: any) => String(d?.svg || '')).filter((s: string) => s.includes('<svg')) : []
}

function composeBody(blocks: any[], renderOne: (b: any, i: number) => string, decor?: string[]): string {
  let toggle = false
  let decorIdx = 0
  const decorList = Array.isArray(decor) ? decor.filter(Boolean) : []
  return blocks.map((b, i) => {
    let html = renderOne(b, i)
    const type = b?.type
    let tone = 'surface'
    if (!HERO_KINDS.has(type) && !NEUTRAL_KINDS.has(type)) {
      toggle = !toggle
      if (toggle) tone = 'tint'
    }
    // hero-blob gets a very soft wash so the opening doesn't read as flat white
    if (type === 'hero-blob') tone = 'hero-wash'
    // Tinted bands get decoration: the workspace's uploaded decor SVGs, cycled
    // + rotated so no two sections look the same. Falls back to the CSS circles
    // when no decor has been uploaded (Branding → Iconițe & decor).
    let decorMarkup = ''
    const hasDecor = (tone === 'tint' || tone === 'hero-wash') && decorList.length > 0
    if (hasDecor) {
      const a = decorList[decorIdx % decorList.length]
      const b2 = decorList.length > 1 ? decorList[(decorIdx + 1) % decorList.length] : ''
      const rA = ((decorIdx * 37) % 30) - 15, rB = ((decorIdx * 53) % 26) - 13
      decorMarkup = `<span class="uw-decor uw-decor-a" aria-hidden="true" style="transform:rotate(${rA}deg)">${a}</span>${b2 ? `<span class="uw-decor uw-decor-b" aria-hidden="true" style="transform:rotate(${rB}deg)">${b2}</span>` : ''}`
      decorIdx += 2
    }
    // Scroll-reveal: opt MOST content sections into the fade-up motion so the
    // effect is actually visible (previously only bento/big-quote/post-list had
    // it). Skip heroes (must show instantly), raw-html/article bodies, and any
    // section that already declares its own data-anim (e.g. bento's stagger).
    // The attribute is inert unless the brand's motion is on (MOTION_CSS/SCRIPT).
    const skipAnim = HERO_KINDS.has(type) || type === 'raw-html' || type === 'article-hero' || type === 'article-body' || /\sdata-anim=/.test(html)
    const animAttr = skipAnim ? '' : ' data-anim="fade-up"'
    // Always stamp the tone class (incl. tone-surface) so the section-rhythm CSS
    // can tighten same-tone seams. All section renderers start with <section class=".
    html = html.replace(/<section class="/, `<section${animAttr} data-tone="${tone}" class="tone-${tone}${hasDecor ? ' has-decor' : ''} `)
    if (decorMarkup) html = html.replace(/(<section[^>]*>)/, `$1${decorMarkup}`)
    return html
  }).join('\n')
}

// ---- CTA library resolution ----
// A workspace can define reusable CTAs (Website → CTAs). A 'cta-ref' section
// resolves to one — either a pinned cta_id or the best situational match for
// the page (slug/title keyword > page type > global default). Editing the CTA
// once updates every page that references it.
type Cta = { id: string; name?: string; heading?: string; sub?: string; cta_label?: string; cta_href?: string; variant?: string; isDefault?: boolean; pageTypes?: string[]; slugContains?: string }
function resolveCta(ctas: Cta[], page: { slug?: string; title?: string; type?: string }, ctaId?: string): Cta | null {
  if (!Array.isArray(ctas) || !ctas.length) return null
  if (ctaId) { const found = ctas.find((c) => c.id === ctaId); if (found) return found }
  const slug = String(page.slug || '').toLowerCase(), title = String(page.title || '').toLowerCase(), type = page.type
  const bySlug = ctas.find((c) => c.slugContains && (slug.includes(c.slugContains.toLowerCase()) || title.includes(c.slugContains.toLowerCase())))
  if (bySlug) return bySlug
  const byType = ctas.find((c) => Array.isArray(c.pageTypes) && type && c.pageTypes.includes(type))
  if (byType) return byType
  return ctas.find((c) => c.isDefault) || ctas[0] || null
}
// Replace each cta-ref block's props with the resolved CTA's content so the
// renderer (which mirrors cta-banner) shows real text.
function resolveCtaRefs(blocks: any[], ctas: Cta[], page: { slug?: string; title?: string; type?: string }): any[] {
  return blocks.map((b) => {
    if (b?.type !== 'cta-ref') return b
    const c = resolveCta(ctas, page, b.props?.cta_id)
    if (!c) return b
    return { ...b, props: { ...b.props, heading: c.heading || '', sub: c.sub || '', cta_label: c.cta_label || '', cta_href: c.cta_href || '#', variant: b.props?.variant || c.variant || 'gradient' } }
  })
}

// ---- Blog index (post-list) resolution ----
const ARTICLE_LIST_TYPES = new Set(['article', 'collection_item'])
function articleCard(pg: { slug?: string; title?: string; blocks?: any }) {
  const blocks = Array.isArray(pg.blocks) ? pg.blocks : []
  const hero = blocks.find((b: any) => b?.type === 'article-hero')
  const body = blocks.find((b: any) => b?.type === 'article-body')
  let excerpt = hero?.props?.sub || blocks.find((b: any) => /hero/.test(b?.type))?.props?.sub || ''
  if (!excerpt && typeof body?.props?.html === 'string') excerpt = body.props.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
  let image = hero?.props?.image_url || ''
  if (!image) for (const b of blocks) {
    if (b?.props?.image_url) { image = b.props.image_url; break }
    const m = typeof b?.props?.html === 'string' && b.props.html.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (m) { image = m[1]; break }
  }
  return { title: pg.title || '', url: pg.slug === 'home' ? '/' : `/${pg.slug}/`, excerpt: String(excerpt).slice(0, 160), image, date: hero?.props?.date || body?.props?.publishedAt || '', readMins: hero?.props?.readMins || body?.props?.readMins || 0, eyebrow: hero?.props?.eyebrow || '' }
}
// Fill post-list sections with the site's articles; auto-add one to a blog_index
// page that doesn't have any yet (so an "empty" blog index just works).
function resolvePostLists(blocks: any[], cards: any[], pageType?: string): any[] {
  // Respect a per-block `limit` (how many recent articles to show; 0/undefined = all).
  const take = (b: any) => { const n = Number(b?.props?.limit); return n > 0 ? cards.slice(0, n) : cards }
  let out = blocks.map((b) => b?.type === 'post-list' ? { ...b, props: { ...b.props, items: take(b) } } : b)
  if (pageType === 'blog_index' && !out.some((b) => b?.type === 'post-list')) {
    out = [...out, { type: 'post-list', props: { heading: out.length ? '' : 'Articles', style: 'grid', columns: 3, items: cards } }]
  }
  return out
}

type MenuItem = { label: string; href: string; children?: MenuItem[] }
type MenuTree = { items: MenuItem[]; cta?: { label: string; href: string } | null }

// Exposed so menus.ts can use the same render for the visual preview tab.
export { fontsHead, siteCss, DEFAULT_TOKENS }

// Render one top-level nav entry. Items with children become a hover/focus
// dropdown; a wide child list (>6) renders as a 2-column mega-menu panel.
function renderNavItem(i: MenuItem): string {
  const kids = (i.children || []).filter((c) => c.label)
  if (!kids.length) return `<a class="nav-link" href="${esc(i.href)}">${esc(i.label)}</a>`
  const mega = kids.length > 6
  const links = kids.map((c) => `<a href="${esc(c.href || '#')}" role="menuitem">${esc(c.label)}</a>`).join('')
  return `<div class="nav-item has-children">`
    + `<a class="nav-link nav-trigger" href="${esc(i.href)}" aria-haspopup="true" aria-expanded="false">${esc(i.label)}<span class="caret" aria-hidden="true">▾</span></a>`
    + `<div class="dropdown${mega ? ' mega' : ''}" role="menu">${links}</div>`
    + `</div>`
}

export function renderHeader(ws: any, base: string, header: MenuTree | undefined, logoUrl?: string | null): string {
  const brand = logoUrl
    ? `<a class="brand" href="${base}/"><img src="${esc(logoUrl)}" alt="${esc(ws.name)}"></a>`
    : `<a class="brand" href="${base}/">${esc(ws.name)}</a>`
  const navItems = (header?.items || []).map(renderNavItem).join('')
  const nav = navItems ? `<nav class="nav">${navItems}</nav>` : ''
  const cta = header?.cta?.label ? `<a class="header-cta" href="${esc(header.cta.href || '#')}">${esc(header.cta.label)}</a>` : ''
  const style = (header as any)?.style || 'glass'
  const burger = navItems ? `<button class="burger" type="button" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>` : ''
  return `<header class="site-header style-${esc(style)}"><div class="container">${brand}${nav}${cta}${burger}</div></header>`
}

// Injected once per page (published output + nav preview). On touch/narrow
// screens the first tap on a dropdown trigger opens the panel instead of
// navigating; desktop uses pure CSS :hover / :focus-within (no JS needed).
export const HEADER_SCRIPT = `<script>(function(){
  // Scroll state — transparent header at the top, frosted bar once scrolled.
  var hdr=document.querySelector('.site-header');
  if(hdr){var onScroll=function(){hdr.classList.toggle('scrolled', window.scrollY>16);};onScroll();window.addEventListener('scroll',onScroll,{passive:true});}
  // Mobile hamburger — toggles the fullscreen nav panel; also closes on link tap
  // and locks scroll while the panel is open.
  var burger=hdr && hdr.querySelector('.burger');
  if(burger){
    var setOpen=function(v){hdr.classList.toggle('nav-open', v); burger.setAttribute('aria-expanded', v?'true':'false'); document.body.style.overflow=v?'hidden':'';};
    burger.addEventListener('click',function(){setOpen(!hdr.classList.contains('nav-open'));});
    hdr.querySelectorAll('.nav a').forEach(function(a){a.addEventListener('click',function(){setOpen(false);});});
  }
  var mq=window.matchMedia('(max-width:900px)');
  var triggers=document.querySelectorAll('.site-header .nav-item.has-children > .nav-trigger');
  triggers.forEach(function(t){
    t.addEventListener('click',function(e){
      if(!mq.matches)return;
      var li=t.parentNode;
      if(!li.classList.contains('open')){
        e.preventDefault();
        document.querySelectorAll('.site-header .nav-item.open').forEach(function(o){if(o!==li)o.classList.remove('open');});
        li.classList.add('open');
      }
    });
  });
  document.addEventListener('click',function(e){
    if(e.target.closest('.site-header .nav-item.has-children'))return;
    document.querySelectorAll('.site-header .nav-item.open').forEach(function(o){o.classList.remove('open');});
  });
})();</script>`

// Split the flat footer.items list into 2 balanced column groups. First half
// becomes the 'Programe' column (or 'Site' if items are non-vertical), second
// half 'Companie'. Legal-looking items (Termeni / Privacy / GDPR / Confidențialitate)
// get hoisted to the bottom bar. This keeps the flat items[] data shape while
// giving the render the multi-column structure the Kids.ro system uses.
export const FOOTER_STYLES = ['columns', 'mega', 'simple', 'minimal', 'cta'] as const
export function renderFooter(ws: any, footer: any, tagline?: string | null, logoUrl?: string | null, opts?: { invert?: boolean }): string {
  const style = (FOOTER_STYLES as readonly string[]).includes(footer?.style) ? footer.style : 'columns'
  const wantNl = footer?.newsletter !== false && (style === 'columns' || style === 'mega')
  const linkFor = (i: MenuItem) => `<a href="${esc(i.href)}">${esc(i.label)}</a>`
  const logoImg = logoUrl ? `<img${opts?.invert ? ' class="foot-logo-invert"' : ''} src="${esc(logoUrl)}" alt="${esc(ws.name)}">` : esc(ws.name)
  const brandLogo = `<div class="brand">${logoImg}</div>`
  const brand = `<div class="brand-col">${brandLogo}${tagline ? `<p>${esc(tagline)}</p>` : ''}</div>`
  const nl = wantNl ? `<div class="col newsletter"><h4>Newsletter</h4><form class="uw-newsletter" data-ws="${esc(ws.slug || '')}"><input type="email" name="email" placeholder="your@email.com" aria-label="Email" required><button type="submit">Subscribe</button></form><p class="nl-msg" hidden></p></div>` : ''
  const year = new Date().getFullYear()

  const all: MenuItem[] = footer?.items || []
  const legalRe = /(termen|privacy|gdpr|confiden|politica|cookie|legal)/i
  const bottomItems = all.filter((i) => legalRe.test(i.label))
  const mainItems = all.filter((i) => !legalRe.test(i.label))
  const bottomBar = (extra: string) => `<div class="bottom"><div>© ${year} ${esc(ws.name)}</div><div>${extra || ''}</div></div>`

  // Columns: either explicit groups (item w/ children) or a flat list split in two.
  const groups = all.filter((i) => i.children && i.children.length)
  const columnsHtml = (max: number) => {
    if (groups.length) return groups.slice(0, max).map((g) => `<div class="col"><h4>${esc(g.label)}</h4>${g.children!.slice(0, 8).map((c) => `<a href="${esc(c.href || '#')}">${esc(c.label)}</a>`).join('')}</div>`).join('')
    const mid = Math.ceil(mainItems.length / 2)
    const col = (title: string, items: MenuItem[]) => items.length ? `<div class="col"><h4>${esc(title)}</h4>${items.map(linkFor).join('')}</div>` : ''
    return col('Site', mainItems.slice(0, mid)) + col('More', mainItems.slice(mid))
  }
  // Flat links (top-level + children) for the compact layouts.
  const flat: MenuItem[] = []; for (const i of all) { flat.push(i); if (i.children) for (const c of i.children) flat.push(c) }
  const flatLinks = flat.slice(0, 12).map(linkFor).join('')

  switch (style) {
    case 'simple':
      return `<footer class="site-footer ft-simple"><div class="container"><div class="ft-center">${brandLogo}${tagline ? `<p class="ft-tag">${esc(tagline)}</p>` : ''}</div><nav class="ft-links">${flatLinks}</nav>${bottomBar(bottomItems.map(linkFor).join(' · '))}</div></footer>`
    case 'minimal':
      return `<footer class="site-footer ft-minimal"><div class="container"><div class="ft-row">${brandLogo}<nav class="ft-links">${flatLinks}</nav></div><div class="bottom"><div>© ${year} ${esc(ws.name)}</div><div>${bottomItems.map(linkFor).join(' · ')}</div></div></div></footer>`
    case 'cta': {
      const ctaLabel = footer?.cta?.label, ctaHref = footer?.cta?.href || '#'
      const band = ctaLabel ? `<div class="ft-cta-band"><h3>${esc(tagline || 'Ready to get started?')}</h3><a class="btn" href="${esc(ctaHref)}">${esc(ctaLabel)}</a></div>` : ''
      return `<footer class="site-footer ft-cta"><div class="container">${band}<div class="ft-row">${brandLogo}<nav class="ft-links">${flatLinks}</nav></div>${bottomBar(bottomItems.map(linkFor).join(' · '))}</div></footer>`
    }
    case 'mega':
      return `<footer class="site-footer ft-mega"><div class="container">${brand}${columnsHtml(4)}${nl}${bottomBar(bottomItems.map(linkFor).join(' · '))}</div></footer>`
    default: // columns
      return `<footer class="site-footer ft-columns"><div class="container">${brand}${columnsHtml(3)}${nl}${bottomBar(bottomItems.map(linkFor).join(' · '))}</div></footer>`
  }
}

// Lightweight scroll-reveal motion (no library — an IntersectionObserver + CSS
// transitions). Sections opt in via data-anim="fade-up|stagger". Fully disabled
// for users with prefers-reduced-motion, and only emitted when the brand's
// motion setting is on. Kept dependency-free so published pages stay fast.
const MOTION_CSS = `@media (prefers-reduced-motion:no-preference){
[data-anim]{opacity:0;transform:translateY(20px);transition:opacity .7s cubic-bezier(.22,1,.36,1),transform .7s cubic-bezier(.22,1,.36,1)}
[data-anim].uw-in{opacity:1;transform:none}
[data-anim="stagger"]{opacity:1;transform:none}
[data-anim="stagger"] .f2-col,[data-anim="stagger"] .bento-tile{opacity:0;transform:translateY(18px);transition:opacity .6s cubic-bezier(.22,1,.36,1),transform .6s cubic-bezier(.22,1,.36,1)}
[data-anim="stagger"].uw-in .f2-col,[data-anim="stagger"].uw-in .bento-tile{opacity:1;transform:none}
[data-anim="stagger"].uw-in .f2-col:nth-child(2),[data-anim="stagger"].uw-in .bento-tile:nth-child(2){transition-delay:.08s}
[data-anim="stagger"].uw-in .bento-tile:nth-child(3){transition-delay:.16s}
[data-anim="stagger"].uw-in .bento-tile:nth-child(4){transition-delay:.24s}
[data-anim="stagger"].uw-in .bento-tile:nth-child(n+5){transition-delay:.32s}
}`
// GSAP-powered 3-up testimonials slider. Loaded only when a page actually uses
// one (body contains data-uw-gsap). GSAP comes from a CDN; the inline init runs
// after it (the loader script is synchronous + earlier in the DOM).
const GSAP_SLIDER = `<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script>(function(){function init(){if(!window.gsap)return;document.querySelectorAll('.testimonials-slider').forEach(function(sec){var track=sec.querySelector('.tss-track');if(!track)return;var cards=track.children;if(cards.length<=1){sec.querySelectorAll('.tss-arrow').forEach(function(b){b.style.display='none'});return;}var idx=0;var vp=sec.querySelector('.tss-viewport')||track;function step(){var c=cards[0];var gap=parseFloat(getComputedStyle(track).gap)||24;return c.getBoundingClientRect().width+gap;}function per(){return Math.max(1,Math.round(vp.getBoundingClientRect().width/step()));}function maxIdx(){return Math.max(0,cards.length-per());}function go(n){idx=Math.max(0,Math.min(maxIdx(),n));window.gsap.to(track,{x:-idx*step(),duration:.6,ease:'power2.out'});}sec.querySelectorAll('.tss-arrow').forEach(function(btn){btn.addEventListener('click',function(){var d=parseInt(btn.getAttribute('data-dir'))||1;var next=idx+d*per();if(next>maxIdx())next=0;if(next<0)next=maxIdx();go(next);});});var auto=sec.getAttribute('data-autoplay')==='1';var timer;function play(){if(auto)timer=setInterval(function(){var n=idx+per();if(n>maxIdx())n=0;go(n);},5000);}function stop(){clearInterval(timer);}sec.addEventListener('mouseenter',stop);sec.addEventListener('mouseleave',play);var rz;window.addEventListener('resize',function(){clearTimeout(rz);rz=setTimeout(function(){idx=Math.min(idx,maxIdx());window.gsap.set(track,{x:-idx*step()});},150);});play();});}if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);})();</script>`

const MOTION_SCRIPT = `<script>(function(){if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;var els=[].slice.call(document.querySelectorAll('[data-anim]'));if(!('IntersectionObserver'in window)){els.forEach(function(e){e.classList.add('uw-in')});return;}var io=new IntersectionObserver(function(x){x.forEach(function(en){if(en.isIntersecting){en.target.classList.add('uw-in');io.unobserve(en.target)}})},{rootMargin:'0px 0px -8% 0px',threshold:.08});els.forEach(function(e){io.observe(e)})})();</script>`

function renderPage(page: any, body: string, t: any, ws: any, base: string, opts?: { header?: MenuTree; footer?: MenuTree }) {
  const ba = (t as any)?.brand_assets || {}
  const logo = ba.logo?.url || null
  const whiteLogo = ba.logo_white?.url || null
  const footerLogo = whiteLogo || logo
  const motionOn = (t as any)?.motion !== 'off'
  // SEO head — meta description, Open Graph / Twitter card, and the Search
  // Console verification tag. Page-level values win over workspace defaults.
  const seo = page.seo || {}
  const tSeo = (t as any)?.seo || {}
  const desc = String(seo.description || tSeo.description || ba.tagline || '').slice(0, 320)
  const ogImg = seo.ogImage || logo || ''
  const gsc = tSeo.gscVerification ? `<meta name="google-site-verification" content="${esc(tSeo.gscVerification)}">` : ''
  const bing = tSeo.bingVerification ? `<meta name="msvalidate.01" content="${esc(tSeo.bingVerification)}">` : ''
  // Google Analytics 4: emit gtag.js when a Measurement ID (G-XXXXXXXXXX) is set.
  const gaId = String(tSeo.ga4Id || '').trim()
  const ga = /^G-[A-Z0-9]+$/i.test(gaId)
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(gaId)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(gaId)}');</script>`
    : ''
  // Google Tag Manager (GTM-XXXXXXX): head loader + a <noscript> body fallback.
  const gtmId = String(tSeo.gtmId || '').trim()
  const gtmValid = /^GTM-[A-Z0-9]+$/i.test(gtmId)
  const gtm = gtmValid ? `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${esc(gtmId)}');</script>` : ''
  const gtmBody = gtmValid ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${esc(gtmId)}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>` : ''
  const metaHead = [
    desc ? `<meta name="description" content="${esc(desc)}">` : '',
    gsc, bing, gtm, ga,
    `<meta property="og:title" content="${esc(page.title)}">`,
    desc ? `<meta property="og:description" content="${esc(desc)}">` : '',
    ogImg ? `<meta property="og:image" content="${esc(ogImg)}">` : '',
    `<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(ws.name)}">`,
    `<meta name="twitter:card" content="${ogImg ? 'summary_large_image' : 'summary'}">`,
  ].filter(Boolean).join('')
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(page.title)} — ${esc(ws.name)}</title>${metaHead}<link rel="icon" href="/favicon.svg" type="image/svg+xml">${fontsHead(t)}<style>${siteCss(t)}${motionOn ? MOTION_CSS : ''}</style></head><body>
${gtmBody}
${renderHeader(ws, base, opts?.header, logo)}
<main>${body || ''}</main>
${renderFooter(ws, opts?.footer, ba.tagline, footerLogo, { invert: !whiteLogo && !!logo })}
<script>window.__UW_WS=${JSON.stringify(String(ws.slug || ''))};</script>
${PREVIEW_LINK_SCRIPT}
${HEADER_SCRIPT}
${NEWSLETTER_SCRIPT}
${motionOn ? MOTION_SCRIPT : ''}
${(body || '').includes('data-uw-gsap') ? GSAP_SLIDER : ''}
</body></html>`
}

// Newsletter forms (footer + article sidebar) POST to the public subscribe
// endpoint, which routes to the account's Mailjet integration.
// On the preview host the site is served under /p/<slug>/, so root-relative
// internal links (/about/) would resolve to the domain root and 404. This
// rewrites them to include the /p/<slug>/ base AT RUNTIME. On a real custom
// domain (no /p/ prefix) it does nothing, so links stay correct there.
const PREVIEW_LINK_SCRIPT = `<script>(function(){var m=location.pathname.match(/^(\\/p\\/[^\\/]+)/);if(!m)return;var base=m[1];[].forEach.call(document.querySelectorAll('a[href^="/"]'),function(a){var h=a.getAttribute('href');if(h&&h.charAt(1)!=='/'&&h.indexOf('/p/')!==0){a.setAttribute('href',base+h);}});})();</script>`
const PUBLIC_API_URL = process.env.PUBLIC_API_URL || 'https://api.uwebsites.net'
const NEWSLETTER_SCRIPT = `<script>(function(){var api='${PUBLIC_API_URL}',ws=window.__UW_WS||'';document.querySelectorAll('.uw-newsletter').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var input=f.querySelector('input[type=email]'),email=input&&input.value.trim();var msg=f.parentNode.querySelector('.nl-msg');function show(t){if(msg){msg.hidden=false;msg.textContent=t;}}if(!email){show('Please enter your email.');return;}if(!ws){show('Thanks!');f.reset();return;}var btn=f.querySelector('button');if(btn)btn.disabled=true;fetch(api+'/newsletter/'+encodeURIComponent(ws),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})}).then(function(r){return r.json()}).then(function(){f.reset();show('Thanks — you are subscribed!');}).catch(function(){show('Something went wrong. Try again.');}).finally(function(){if(btn)btn.disabled=false;});});});})();</script>`

// Tiny script injected into the editor preview: announces clicks + handles
// inline text edits via contentEditable. NOT included in published output.
const EDIT_SCRIPT = `<style>
[data-field]{ outline-offset:2px; }
[data-field]:hover{ outline:1px dashed rgba(143,215,241,.9); cursor:text; }
[data-field][contenteditable=true]{ outline:2px solid #1D9E75; background:rgba(143,215,241,.08); cursor:text; }
[data-section-index][data-empty="true"]{ position:relative; min-height:90px; border:2px dashed #f5a623; background:rgba(245,166,35,.06); margin:8px 0; border-radius:10px; }
[data-section-index][data-empty="true"]::before{ content:"Empty " attr(data-section-kind) " section — click to edit, or remove it"; position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#a76300; font-family:system-ui,sans-serif; font-size:13px; font-weight:600; pointer-events:none; }
</style>
<script>(function(){
  function send(o){ try{ parent.postMessage(Object.assign({source:'uw-preview'}, o), '*'); }catch(e){} }
  var hov=null;
  // Scroll the selected section into view so the user SEES it in the design.
  try{ var selEl=document.querySelector('[data-selected]'); if(selEl){ setTimeout(function(){ selEl.scrollIntoView({block:'center',behavior:'smooth'}); }, 60); } }catch(e){}
  // Section selection — click on the section background (not text fields)
  document.addEventListener('click', function(e){
    if(e.target.closest('[data-field]')) return;        // text edit handles its own clicks
    if(e.target.closest('a,button,input,textarea,select')) return;  // don't hijack interactive
    var el=e.target.closest('[data-section-index]'); if(!el) return;
    e.preventDefault(); send({type:'select', index: parseInt(el.getAttribute('data-section-index'),10)});
  }, true);
  document.addEventListener('mouseover', function(e){
    var el=e.target.closest('[data-section-index]'); if(!el) return;
    if(hov && hov!==el){ hov.style.outline=''; hov.style.outlineOffset=''; }
    hov=el; el.style.outline='2px solid rgba(143,215,241,.7)'; el.style.outlineOffset='-2px'; el.style.cursor='pointer';
  });
  document.addEventListener('mouseout', function(){
    if(hov){ hov.style.outline=''; hov.style.outlineOffset=''; hov=null; }
  });
  // Inline text edit — click any [data-field] to edit; blur or Enter commits.
  document.addEventListener('click', function(e){
    var el=e.target.closest('[data-field]'); if(!el) return;
    e.stopPropagation();
    if(el.getAttribute('contenteditable')==='true') return;
    el.setAttribute('contenteditable','true');
    el.focus();
    // place caret at end
    try{ var r=document.createRange(); r.selectNodeContents(el); r.collapse(false); var s=getSelection(); s.removeAllRanges(); s.addRange(r); }catch(e){}
    function commit(){
      el.removeEventListener('blur', commit); el.removeEventListener('keydown', onKey);
      var sec=el.closest('[data-section-index]');
      var idx = sec ? parseInt(sec.getAttribute('data-section-index'),10) : null;
      var field = el.getAttribute('data-field');
      var value = el.innerText.replace(/\\s+$/,'');
      el.removeAttribute('contenteditable');
      if(idx!=null && field) send({type:'text', index: idx, field: field, value: value});
    }
    function onKey(ev){
      if(ev.key==='Enter' && !ev.shiftKey){ ev.preventDefault(); el.blur(); }
      if(ev.key==='Escape'){ ev.preventDefault(); el.blur(); }
    }
    el.addEventListener('blur', commit);
    el.addEventListener('keydown', onKey);
  }, true);
})();</script>`

// Renderer is exported so the pages router can serve a single-page preview.
// opts.edit wraps each section in a data-section-index div + injects the
// click/hover script so the editor can detect selection.
export const renderPreview = async (id: string, accountId: string, opts?: { edit?: boolean; selectedIndex?: number | null }) => {
  const [row] = await db.select({
    title: pages.title, slug: pages.slug, type: pages.type, blocks: pages.blocks, wsId: pages.workspaceId,
    wsName: workspaces.name, accId: workspaces.accountId,
  }).from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(eq(pages.id, id)).limit(1)
  if (!row || row.accId !== accountId) return null
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, row.wsId)).limit(1)
  const t = (tok?.tokens as any) ?? DEFAULT_TOKENS
  const rawBlocks = Array.isArray(row.blocks) ? (row.blocks as any[]) : []
  let blocks = resolveCtaRefs(rawBlocks, (t as any).ctas || [], { slug: row.slug, title: row.title, type: row.type })
  // Blog index preview: pull sibling articles.
  const needsPosts = row.type === 'blog_index' || rawBlocks.some((b: any) => b?.type === 'post-list')
  if (needsPosts) {
    const siblings = await db.select({ slug: pages.slug, title: pages.title, type: pages.type, blocks: pages.blocks }).from(pages).where(eq(pages.workspaceId, row.wsId))
    const cards = siblings.filter((x) => ARTICLE_LIST_TYPES.has(x.type as string) && x.slug !== row.slug).map(articleCard)
    blocks = resolvePostLists(blocks, cards, row.type)
  }
  const body = opts?.edit
    ? blocks.map((b, i) => {
        const empty = !sectionHasContent(b)
        const isSel = i === opts.selectedIndex
        const sel = isSel ? 'outline:3px solid #1D9E75;outline-offset:-3px;' : ''
        const emptyAttr = empty ? ' data-empty="true"' : ''
        return `<div data-section-index="${i}" data-section-kind="${esc(b.type)}"${emptyAttr}${isSel ? ' data-selected="1"' : ''} style="${sel}">${empty ? '' : renderSection(b, { edit: true })}</div>`
      }).join('\n') + EDIT_SCRIPT
    : composeBody(blocks, (b) => renderBlock(b), decorSvgs(t))
  const menus = await getMenusFor(row.wsId)
  // Internal links are stored root-relative (/slug/) so they work on the
  // published custom domain. In the PREVIEW host (api.uwebsites.net/pages/<id>
  // /preview) those dead-end at /slug/. Inject a slug→page-id map + a rewrite
  // script so clicking an internal link opens that page's preview instead.
  const navPages = await db.select({ id: pages.id, slug: pages.slug }).from(pages).where(eq(pages.workspaceId, row.wsId))
  const slugMap: Record<string, string> = {}
  for (const p of navPages) slugMap[String(p.slug || '').replace(/^\/+|\/+$/g, '')] = p.id
  const previewNav = `<script>(function(){var M=${JSON.stringify(slugMap).replace(/</g, '\\u003c')};if(!/^\\/pages\\/[^\\/]+\\/preview/.test(location.pathname))return;[].forEach.call(document.querySelectorAll('a[href^="/"]'),function(a){var h=a.getAttribute('href');if(!h||h.charAt(1)==='/'||h.indexOf('/pages/')===0||h.indexOf('/p/')===0)return;var s=h.replace(/^\\/+/,'').replace(/[?#].*$/,'').replace(/\\/+$/,'');var id=M[s];if(id){a.setAttribute('href','/pages/'+id+'/preview');}else{a.setAttribute('href','#');a.setAttribute('title','Not a page in this workspace');a.style.cursor='not-allowed';}});})();</script>`
  return renderPage({ title: row.title }, body + previewNav, t, { name: row.wsName }, '#', menus)
}

// POST /workspaces/:slug/publish
publishRouter.post('/:slug/publish', requireAuth, async (req: AuthRequest, res) => {
  const [ws] = await db.select().from(workspaces)
    .where(eq(workspaces.slug, String(req.params.slug))).limit(1)
  if (!ws || ws.accountId !== req.user!.accountId) return res.status(404).json({ ok: false, error: 'workspace not found' })

  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const t = (tok?.tokens as any) ?? DEFAULT_TOKENS
  const pageRows = await db.select().from(pages).where(eq(pages.workspaceId, ws.id))
  const publishable = pageRows.filter((p) => p.status === 'published' || true) // v1: publish all
  if (!publishable.length) return res.status(400).json({ ok: false, error: 'no pages to publish' })

  const outDir = path.join(SITES_DIR, ws.slug)
  const base = `${SITES_URL}/${ws.slug}`
  try {
    // Rebuild the output but PRESERVE the img/ folder — mirrored images live
    // there and a full rm would wipe them on every publish (the recurring
    // "images broke again" bug).
    await mkdir(outDir, { recursive: true })
    const { readdir } = await import('node:fs/promises')
    const existing = await readdir(outDir).catch(() => [] as string[])
    for (const entry of existing) if (entry !== 'img') await rm(path.join(outDir, entry), { recursive: true, force: true })
    const siteMenus = await getMenusFor(ws.id)
    // Article cards for any blog index / post-list on the site.
    const articleCards = pageRows.filter((x) => ARTICLE_LIST_TYPES.has(x.type as string)).map(articleCard)
    let count = 0
    for (const p of publishable) {
      const rawBlocks = Array.isArray(p.blocks) ? (p.blocks as any[]) : []
      let blocks = resolveCtaRefs(rawBlocks, (t as any).ctas || [], { slug: p.slug, title: p.title, type: p.type })
      blocks = resolvePostLists(blocks, articleCards.filter((c) => c.url !== (p.slug === 'home' ? '/' : `/${p.slug}/`)), p.type)
      const html = renderPage(p, composeBody(blocks, (b) => renderBlock(b), decorSvgs(t)), t, ws, base, siteMenus)
      const rel = p.slug === 'home' ? 'index.html' : path.join(p.slug, 'index.html')
      const file = path.join(outDir, rel)
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, html, 'utf8')
      count++
    }
    const urls = publishable.map((p) => (p.slug === 'home' ? `${base}/` : `${base}/${p.slug}/`))
    const sitemapUrl = `${base}/sitemap.xml`
    await writeFile(path.join(outDir, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join('')}</urlset>`)
    // robots.txt with the Sitemap directive so Google/Bing auto-discover it.
    await writeFile(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${sitemapUrl}\n`)
    // Ping Bing to (re)crawl the sitemap. (Google deprecated its ping endpoint —
    // it discovers via robots.txt / Search Console instead.)
    fetch(`https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`).catch(() => {})
    // Default favicon — a small SVG in the brand's primary color. Workspaces
    // can override by setting branding tokens.color.primary; later we'll
    // accept a custom-uploaded icon via Branding.
    const primary = ((tok?.tokens as any)?.color?.primary) || '#16324A'
    const accent = ((tok?.tokens as any)?.color?.accent) || '#8FD7F1'
    const initial = (ws.name || 'u').slice(0, 1).toUpperCase()
    await writeFile(path.join(outDir, 'favicon.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${primary}"/><text x="32" y="42" font-family="system-ui,sans-serif" font-size="32" font-weight="700" text-anchor="middle" fill="${accent}">${esc(initial)}</text></svg>`)

    await db.insert(builds).values({ workspaceId: ws.id, status: 'deployed', artifactRef: outDir, deployedAt: new Date() })
    res.json({ ok: true, data: { url: `${base}/`, pages: count } })
  } catch (e: any) {
    await db.insert(builds).values({ workspaceId: ws.id, status: 'failed', artifactRef: outDir })
    res.status(500).json({ ok: false, error: 'publish failed: ' + (e?.message || 'unknown') })
  }
})
