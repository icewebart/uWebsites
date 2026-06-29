// Section catalog — the single source of truth for what sections exist, how
// they render in the published static output, and what defaults the editor /
// AI use when creating new instances. The web app fetches this list via
// GET /sections to populate the section-gallery picker and to ground the chat.
//
// Rule: every section MUST render correctly with ANY branding token set. Use
// CSS variables only (--primary, --accent, --text, --btn-r, --card-r, --gap,
// --pad, --container). No hardcoded colors or fonts.

export type SectionKind =
  | 'hero' | 'hero-image' | 'richtext' | 'image'
  | 'features-3' | 'cta-banner'

export type SectionMeta = {
  kind: SectionKind
  name: string
  description: string
  category: 'hero' | 'content' | 'media' | 'features' | 'cta'
  defaults: Record<string, any>
}

export const SECTIONS: SectionMeta[] = [
  {
    kind: 'hero',
    name: 'Hero — centered',
    description: 'A simple centered headline + subhead. Best for a clean opening.',
    category: 'hero',
    defaults: { heading: 'A clear, confident headline', sub: 'One sentence that earns the next scroll.' },
  },
  {
    kind: 'hero-image',
    name: 'Hero — image right',
    description: 'Headline + subhead on the left, supporting image on the right. Side-by-side on desktop.',
    category: 'hero',
    defaults: { heading: 'Tell the story, see the proof', sub: 'Pair words with a single strong image.', image_url: '', image_alt: '', cta_label: '', cta_href: '' },
  },
  {
    kind: 'richtext',
    name: 'Text',
    description: 'Free-form body content: paragraphs, headings, lists, links.',
    category: 'content',
    defaults: { html: '<p>Write something here…</p>' },
  },
  {
    kind: 'image',
    name: 'Image',
    description: 'A single full-width image with alt text.',
    category: 'media',
    defaults: { url: '', alt: '' },
  },
  {
    kind: 'features-3',
    name: 'Features — 3 columns',
    description: 'Three short value props side-by-side. Perfect under a hero.',
    category: 'features',
    defaults: {
      heading: 'Why it works',
      sub: '',
      items: [
        { title: 'Fast', desc: 'Compiled to static — fast on mobile by default.' },
        { title: 'Safe', desc: 'No runtime to attack, mandatory 2FA for owners.' },
        { title: 'On-brand', desc: 'One token set restyles every page.' },
      ],
    },
  },
  {
    kind: 'cta-banner',
    name: 'CTA banner',
    description: 'A full-width call-to-action band — heading, subhead, button.',
    category: 'cta',
    defaults: { heading: 'Ready to begin?', sub: 'Start free. Upgrade when you grow.', cta_label: 'Get started', cta_href: '#' },
  },
]

export const SECTION_META: Record<string, SectionMeta> = Object.fromEntries(SECTIONS.map((s) => [s.kind, s]))

// ---- shared escapers used by both renderer and chat tools ----
export function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// CSS additions for the new section kinds. The base CSS in publish.ts already
// covers .container, .hero, .rt, .img — we just add the new ones here so
// publish.ts stays focused on the page chrome.
export const SECTION_CSS = `
.hero-image{padding:var(--pad) 0}
.hero-image .grid{display:grid;grid-template-columns:1.1fr 1fr;gap:48px;align-items:center}
.hero-image h1{font-size:calc(2.1rem * var(--scale, 1.2));margin-bottom:14px;letter-spacing:-.02em;line-height:1.1}
.hero-image .sub{font-size:1.05rem;opacity:.78;margin-bottom:22px;max-width:48ch}
.hero-image img{display:block;width:100%;height:auto;border-radius:var(--card-r)}
@media(max-width:760px){.hero-image .grid{grid-template-columns:1fr;gap:28px}}

.features-3{padding:var(--pad) 0}
.features-3 .head{text-align:center;margin-bottom:34px}
.features-3 .head h2{font-size:calc(1.6rem * var(--scale, 1.2));letter-spacing:-.01em;margin-bottom:8px}
.features-3 .head .sub{opacity:.7;font-size:1rem;max-width:56ch;margin:0 auto}
.features-3 .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.features-3 .item{background:var(--surface);border:var(--bw) solid rgba(0,0,0,.08);border-radius:var(--card-r);padding:24px}
.features-3 .item h3{font-size:1.05rem;font-weight:600;margin-bottom:6px}
.features-3 .item p{font-size:.95rem;opacity:.75}
@media(max-width:760px){.features-3 .grid{grid-template-columns:1fr}}

.cta-banner{padding:var(--pad) 0}
.cta-banner .box{background:var(--primary);color:#fff;border-radius:var(--card-r);padding:48px 28px;text-align:center}
.cta-banner h2{font-size:calc(1.6rem * var(--scale, 1.2));color:#fff;margin-bottom:10px;letter-spacing:-.01em}
.cta-banner .sub{font-size:1rem;color:rgba(255,255,255,.86);margin-bottom:22px;max-width:48ch;margin-left:auto;margin-right:auto}
.cta-banner .btn{background:#fff;color:var(--primary)}
.cta-banner .btn:hover{opacity:.92}
`

// ---- per-kind static HTML renderer (used by publish.ts) ----
export function renderSection(b: any): string {
  if (!b || typeof b !== 'object') return ''
  const p = b.props || {}
  switch (b.type as SectionKind) {
    case 'hero': {
      const cta = p.cta?.label ? `<p><a class="btn" href="${esc(p.cta.href || '#')}">${esc(p.cta.label)}</a></p>` : ''
      return `<section class="hero"><div class="container"><h1>${esc(p.heading)}</h1>${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ''}${cta}</div></section>`
    }
    case 'hero-image': {
      const cta = p.cta_label ? `<p><a class="btn" href="${esc(p.cta_href || '#')}">${esc(p.cta_label)}</a></p>` : ''
      const img = p.image_url ? `<div><img src="${esc(p.image_url)}" alt="${esc(p.image_alt || '')}" loading="lazy"></div>` : '<div></div>'
      return `<section class="hero-image"><div class="container"><div class="grid"><div><h1>${esc(p.heading)}</h1>${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ''}${cta}</div>${img}</div></div></section>`
    }
    case 'richtext':
      return `<section class="rt"><div class="container">${p.html || ''}</div></section>`
    case 'image':
      return p.url ? `<section class="img"><div class="container"><img src="${esc(p.url)}" alt="${esc(p.alt || '')}" loading="lazy"></div></section>` : ''
    case 'features-3': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 6)
      const grid = items.map((it: any) => `<div class="item"><h3>${esc(it.title)}</h3><p>${esc(it.desc)}</p></div>`).join('')
      return `<section class="features-3"><div class="container"><div class="head"><h2>${esc(p.heading)}</h2>${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ''}</div><div class="grid">${grid}</div></div></section>`
    }
    case 'cta-banner':
      return `<section class="cta-banner"><div class="container"><div class="box"><h2>${esc(p.heading)}</h2>${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ''}${p.cta_label ? `<p><a class="btn" href="${esc(p.cta_href || '#')}">${esc(p.cta_label)}</a></p>` : ''}</div></div></section>`
    default:
      return `<!-- unknown section: ${esc(String(b.type))} -->`
  }
}
