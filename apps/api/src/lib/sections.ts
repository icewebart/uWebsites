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
  | 'testimonials-3' | 'pricing-3' | 'faq' | 'logo-cloud' | 'image-text' | 'stats-row'

export type SectionMeta = {
  kind: SectionKind
  name: string
  description: string
  category: 'hero' | 'content' | 'media' | 'features' | 'cta' | 'social-proof' | 'pricing'
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
  {
    kind: 'testimonials-3',
    name: 'Testimonials — 3 cards',
    description: 'Three customer quotes side-by-side with author and role.',
    category: 'social-proof',
    defaults: {
      heading: 'What people say',
      sub: '',
      items: [
        { quote: 'This changed how we ship.', author: 'Alex P.', role: 'Head of Product' },
        { quote: 'Our team loves it.', author: 'Sam R.', role: 'Engineering Lead' },
        { quote: 'Fast, reliable, simple.', author: 'Jordan M.', role: 'CTO' },
      ],
    },
  },
  {
    kind: 'pricing-3',
    name: 'Pricing — 3 tiers',
    description: 'Three pricing tiers in a row; the middle tier is highlighted as the most popular.',
    category: 'pricing',
    defaults: {
      heading: 'Simple pricing that scales',
      sub: '',
      tiers: [
        { name: 'Starter', price: '€19', period: '/mo', items: ['1 workspace', '500 AI credits', 'Custom domain'], cta_label: 'Start free', cta_href: '#' },
        { name: 'Studio', price: '€59', period: '/mo', items: ['5 workspaces', '3,000 AI credits', 'Programmatic SEO', '3 team seats'], cta_label: 'Get started', cta_href: '#', featured: true },
        { name: 'Agency', price: '€149', period: '/mo', items: ['25 workspaces', '12,000 AI credits', 'Migration service'], cta_label: 'Talk to us', cta_href: '#' },
      ],
    },
  },
  {
    kind: 'faq',
    name: 'FAQ',
    description: 'A list of question/answer pairs.',
    category: 'content',
    defaults: {
      heading: 'Frequently asked',
      items: [
        { q: 'How do I get started?', a: 'Click "Import a site" or start from a template.' },
        { q: 'Can I use my own domain?', a: 'Yes — connect any domain from your workspace settings.' },
        { q: 'Is there a free plan?', a: 'Yes, Solo starts free with 1 workspace and a starter credit grant.' },
      ],
    },
  },
  {
    kind: 'logo-cloud',
    name: 'Logo cloud',
    description: 'A row of partner / client logos, muted by default.',
    category: 'social-proof',
    defaults: {
      heading: 'Trusted by teams at',
      logos: [],
    },
  },
  {
    kind: 'image-text',
    name: 'Image + text',
    description: 'Two-column row: image on one side, heading + paragraph on the other.',
    category: 'content',
    defaults: {
      heading: 'A clear point, supported by an image',
      html: '<p>Use this section to explain one idea in depth, paired with a visual.</p>',
      image_url: '', image_alt: '', image_side: 'right',
    },
  },
  {
    kind: 'stats-row',
    name: 'Stats row',
    description: 'A row of big numbers with short labels — proof, scale, results.',
    category: 'social-proof',
    defaults: {
      heading: '',
      items: [
        { value: '80+', label: 'Pages migrated' },
        { value: '3 days', label: 'Time to launch' },
        { value: '100%', label: 'On-brand' },
      ],
    },
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

.testimonials-3{padding:var(--pad) 0}
.testimonials-3 .head{text-align:center;margin-bottom:34px}
.testimonials-3 .head h2{font-size:calc(1.6rem * var(--scale, 1.2));margin-bottom:8px}
.testimonials-3 .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.testimonials-3 .card{background:var(--surface);border:var(--bw) solid rgba(0,0,0,.08);border-radius:var(--card-r);padding:24px}
.testimonials-3 .quote{font-size:1rem;line-height:1.6;margin-bottom:14px;color:var(--text)}
.testimonials-3 .quote:before{content:"\\201C";font-size:1.6rem;line-height:0;vertical-align:-0.4em;color:var(--primary);margin-right:4px;opacity:.65}
.testimonials-3 .who{font-size:.85rem}
.testimonials-3 .who b{font-weight:600;color:var(--text)}
.testimonials-3 .who span{opacity:.6}
@media(max-width:760px){.testimonials-3 .grid{grid-template-columns:1fr}}

.pricing-3{padding:var(--pad) 0}
.pricing-3 .head{text-align:center;margin-bottom:34px}
.pricing-3 .head h2{font-size:calc(1.6rem * var(--scale, 1.2));margin-bottom:8px}
.pricing-3 .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;align-items:stretch}
.pricing-3 .tier{background:var(--surface);border:var(--bw) solid rgba(0,0,0,.08);border-radius:var(--card-r);padding:26px;display:flex;flex-direction:column}
.pricing-3 .tier.featured{border-color:var(--primary);box-shadow:0 14px 44px -20px color-mix(in srgb, var(--primary) 35%, transparent);position:relative}
.pricing-3 .tier.featured:before{content:"Most popular";position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--primary);color:#fff;font-size:.7rem;font-weight:600;padding:3px 10px;border-radius:var(--btn-r);letter-spacing:.04em}
.pricing-3 .tier h3{font-size:1.1rem;margin-bottom:8px}
.pricing-3 .price{font-size:2rem;font-weight:700;line-height:1;margin:6px 0 18px}
.pricing-3 .price span{font-size:.9rem;font-weight:500;opacity:.6}
.pricing-3 ul{list-style:none;padding:0;margin:0 0 22px}
.pricing-3 ul li{padding:7px 0 7px 22px;position:relative;font-size:.9rem;border-top:var(--bw) solid rgba(0,0,0,.08)}
.pricing-3 ul li:first-child{border-top:0}
.pricing-3 ul li:before{content:"\\2713";position:absolute;left:0;color:var(--primary);font-weight:700}
.pricing-3 .tier .btn{margin-top:auto}
@media(max-width:760px){.pricing-3 .grid{grid-template-columns:1fr}}

.faq{padding:var(--pad) 0}
.faq .container{max-width:760px}
.faq .head{margin-bottom:28px}
.faq .head h2{font-size:calc(1.6rem * var(--scale, 1.2))}
.faq .item{padding:18px 0;border-top:var(--bw) solid rgba(0,0,0,.08)}
.faq .item:last-child{border-bottom:var(--bw) solid rgba(0,0,0,.08)}
.faq .q{font-weight:600;font-size:1.05rem;margin-bottom:8px}
.faq .a{opacity:.78;line-height:1.6}

.logo-cloud{padding:var(--pad) 0}
.logo-cloud .head{text-align:center;margin-bottom:22px}
.logo-cloud .head h2{font-size:.85rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;opacity:.55}
.logo-cloud .row{display:flex;flex-wrap:wrap;gap:36px;justify-content:center;align-items:center;opacity:.7}
.logo-cloud .row img{height:32px;width:auto;max-width:140px;filter:grayscale(1)}

.image-text{padding:var(--pad) 0}
.image-text .grid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.image-text.left .grid{direction:rtl}
.image-text.left .grid > *{direction:ltr}
.image-text h2{font-size:calc(1.4rem * var(--scale, 1.2));margin-bottom:14px;line-height:1.2}
.image-text .copy{font-size:1rem;opacity:.78;line-height:1.65}
.image-text .copy :where(p,ul,ol){margin-bottom:1em}
.image-text img{display:block;width:100%;height:auto;border-radius:var(--card-r)}
@media(max-width:760px){.image-text .grid{grid-template-columns:1fr;gap:24px}.image-text.left .grid{direction:ltr}}

.stats-row{padding:var(--pad) 0}
.stats-row .head{text-align:center;margin-bottom:28px}
.stats-row .head h2{font-size:calc(1.6rem * var(--scale, 1.2))}
.stats-row .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:24px;text-align:center}
.stats-row .stat .val{font-size:2.6rem;font-weight:700;letter-spacing:-.02em;line-height:1;color:var(--primary);margin-bottom:6px}
.stats-row .stat .lbl{font-size:.85rem;opacity:.7;text-transform:uppercase;letter-spacing:.06em}
`

// ---- per-kind static HTML renderer (used by publish.ts) ----
// opts.edit adds data-field="…" markers to inline-editable text nodes so the
// editor iframe can wire contentEditable + postMessage updates.
export function renderSection(b: any, opts?: { edit?: boolean }): string {
  if (!b || typeof b !== 'object') return ''
  const p = b.props || {}
  const ed = !!opts?.edit
  const f = (name: string) => ed ? ` data-field="${name}"` : ''
  switch (b.type as SectionKind) {
    case 'hero': {
      const cta = p.cta?.label ? `<p><a class="btn" href="${esc(p.cta.href || '#')}">${esc(p.cta.label)}</a></p>` : ''
      return `<section class="hero"><div class="container"><h1${f('heading')}>${esc(p.heading)}</h1>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}${cta}</div></section>`
    }
    case 'hero-image': {
      const cta = p.cta_label ? `<p><a class="btn" href="${esc(p.cta_href || '#')}">${esc(p.cta_label)}</a></p>` : ''
      const img = p.image_url ? `<div><img src="${esc(p.image_url)}" alt="${esc(p.image_alt || '')}" loading="lazy"></div>` : '<div></div>'
      return `<section class="hero-image"><div class="container"><div class="grid"><div><h1${f('heading')}>${esc(p.heading)}</h1>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}${cta}</div>${img}</div></div></section>`
    }
    case 'richtext':
      return `<section class="rt"><div class="container">${p.html || ''}</div></section>`
    case 'image':
      return p.url ? `<section class="img"><div class="container"><img src="${esc(p.url)}" alt="${esc(p.alt || '')}" loading="lazy"></div></section>` : ''
    case 'features-3': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 6)
      const grid = items.map((it: any) => `<div class="item"><h3>${esc(it.title)}</h3><p>${esc(it.desc)}</p></div>`).join('')
      return `<section class="features-3"><div class="container"><div class="head"><h2${f('heading')}>${esc(p.heading)}</h2>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div><div class="grid">${grid}</div></div></section>`
    }
    case 'cta-banner':
      return `<section class="cta-banner"><div class="container"><div class="box"><h2${f('heading')}>${esc(p.heading)}</h2>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}${p.cta_label ? `<p><a class="btn" href="${esc(p.cta_href || '#')}">${esc(p.cta_label)}</a></p>` : ''}</div></div></section>`
    case 'testimonials-3': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 6)
      const cards = items.map((it: any) => `<div class="card"><p class="quote">${esc(it.quote)}</p><div class="who"><b>${esc(it.author)}</b>${it.role ? ` · <span>${esc(it.role)}</span>` : ''}</div></div>`).join('')
      return `<section class="testimonials-3"><div class="container">${p.heading ? `<div class="head"><h2${f('heading')}>${esc(p.heading)}</h2>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div>` : ''}<div class="grid">${cards}</div></div></section>`
    }
    case 'pricing-3': {
      const tiers = (Array.isArray(p.tiers) ? p.tiers : []).slice(0, 4)
      const cards = tiers.map((t: any) => {
        const items = (Array.isArray(t.items) ? t.items : []).map((x: any) => `<li>${esc(x)}</li>`).join('')
        const cta = t.cta_label ? `<a class="btn" href="${esc(t.cta_href || '#')}">${esc(t.cta_label)}</a>` : ''
        return `<div class="tier${t.featured ? ' featured' : ''}"><h3>${esc(t.name)}</h3><div class="price">${esc(t.price)}${t.period ? `<span>${esc(t.period)}</span>` : ''}</div><ul>${items}</ul>${cta}</div>`
      }).join('')
      return `<section class="pricing-3"><div class="container">${p.heading ? `<div class="head"><h2${f('heading')}>${esc(p.heading)}</h2>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div>` : ''}<div class="grid">${cards}</div></div></section>`
    }
    case 'faq': {
      const items = (Array.isArray(p.items) ? p.items : []).map((it: any) => `<div class="item"><div class="q">${esc(it.q)}</div><div class="a">${esc(it.a)}</div></div>`).join('')
      return `<section class="faq"><div class="container">${p.heading ? `<div class="head"><h2${f('heading')}>${esc(p.heading)}</h2></div>` : ''}${items}</div></section>`
    }
    case 'logo-cloud': {
      const logos = (Array.isArray(p.logos) ? p.logos : []).map((l: any) => l?.url ? `<img src="${esc(l.url)}" alt="${esc(l.alt || '')}" loading="lazy">` : '').join('')
      return `<section class="logo-cloud"><div class="container">${p.heading ? `<div class="head"><h2${f('heading')}>${esc(p.heading)}</h2></div>` : ''}<div class="row">${logos}</div></div></section>`
    }
    case 'image-text': {
      const side = p.image_side === 'left' ? ' left' : ''
      const img = p.image_url ? `<div><img src="${esc(p.image_url)}" alt="${esc(p.image_alt || '')}" loading="lazy"></div>` : '<div></div>'
      return `<section class="image-text${side}"><div class="container"><div class="grid"><div><h2${f('heading')}>${esc(p.heading)}</h2><div class="copy">${p.html || ''}</div></div>${img}</div></div></section>`
    }
    case 'stats-row': {
      const items = (Array.isArray(p.items) ? p.items : []).map((it: any) => `<div class="stat"><div class="val">${esc(it.value)}</div><div class="lbl">${esc(it.label)}</div></div>`).join('')
      return `<section class="stats-row"><div class="container">${p.heading ? `<div class="head"><h2${f('heading')}>${esc(p.heading)}</h2></div>` : ''}<div class="row">${items}</div></div></section>`
    }
    default:
      return `<!-- unknown section: ${esc(String(b.type))} -->`
  }
}
