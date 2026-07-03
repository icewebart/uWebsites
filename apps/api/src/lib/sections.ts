// Section catalog — the single source of truth for what sections exist, how
// they render in the published static output, and what defaults the editor /
// AI use when creating new instances. The web app fetches this list via
// GET /sections to populate the section-gallery picker and to ground the chat.
//
// Rule: every section MUST render correctly with ANY branding token set. Use
// CSS variables only (--primary, --accent, --text, --btn-r, --card-r, --gap,
// --pad, --container). No hardcoded colors or fonts.

export type SectionKind =
  | 'hero' | 'hero-image' | 'hero-blob' | 'richtext' | 'image'
  | 'features-3' | 'program-cards' | 'cta-banner' | 'steps'
  | 'testimonials-3' | 'pricing-3' | 'faq' | 'logo-cloud' | 'image-text' | 'stats-row' | 'stats-band'
  | 'raw-html'

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
    description: 'Eyebrow + headline + subhead + up to two buttons on the left, a strong image (framed, with a soft decorative accent) on the right. variant: "split" (default) or "gradient" (soft primary→accent wash background). Side-by-side on desktop.',
    category: 'hero',
    defaults: { eyebrow: '', heading: 'Tell the story, see the proof', sub: 'Pair words with a single strong image.', image_url: '', image_alt: '', cta_label: '', cta_href: '', cta2_label: '', cta2_href: '', variant: 'split' },
  },
  {
    kind: 'hero-blob',
    name: 'Hero — playful blob',
    description: 'Text on the left (eyebrow, big headline, two buttons), image inside a soft rounded blob on the right, with a decorative star. Warm & friendly — great for kids / lifestyle / community brands.',
    category: 'hero',
    defaults: {
      eyebrow: 'Welcome',
      heading: 'A warm, playful headline for people, not robots.',
      sub: 'One friendly sentence that says who it is for and why it matters.',
      cta_label: 'Get started', cta_href: '#',
      cta2_label: 'Contact', cta2_href: '#contact',
      image_url: '', image_alt: '',
    },
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
    description: 'Three short value props side-by-side, each with an icon/emoji. Optional eyebrow. variant: "cards" (default, elevated cards with an accent icon chip) or "minimal" (clean, borderless). Perfect under a hero.',
    category: 'features',
    defaults: {
      eyebrow: '',
      heading: 'Why it works',
      sub: '',
      variant: 'cards',
      items: [
        { icon: '⚡', title: 'Fast', desc: 'Compiled to static — fast on mobile by default.' },
        { icon: '🔒', title: 'Safe', desc: 'No runtime to attack, mandatory 2FA for owners.' },
        { icon: '🎨', title: 'On-brand', desc: 'One token set restyles every page.' },
      ],
    },
  },
  {
    kind: 'steps',
    name: 'How it works — steps',
    description: 'A numbered "how it works" flow: eyebrow + heading, then 3–4 numbered steps each with a title and one line of copy. Great for onboarding, process, or "what to expect".',
    category: 'features',
    defaults: {
      eyebrow: 'How it works',
      heading: 'Three simple steps',
      items: [
        { title: 'Tell us about you', desc: 'A short brief so we understand your goal.' },
        { title: 'We build it', desc: 'A designed draft, ready in minutes.' },
        { title: 'Go live', desc: 'Publish and share — edit anytime.' },
      ],
    },
  },
  {
    kind: 'program-cards',
    name: 'Program cards — 3',
    description: 'A centered eyebrow + heading, then three rich cards. Each card has a colored category badge, a photo (or colored striped top), a title, a short description and its own colored "Discover" button. Ideal for choosing between programs / plans / services.',
    category: 'features',
    defaults: {
      eyebrow: 'Our programs',
      heading: 'Choose how you want to start',
      items: [
        { badge: 'Courses', title: 'Weekly, in a group', desc: 'Steady progress, structured by level.', cta_label: 'Discover', cta_href: '#', image_url: '' },
        { badge: 'Workshops', title: 'Weekend conversation', desc: 'Free speaking, games and fun themes.', cta_label: 'Discover', cta_href: '#', image_url: '' },
        { badge: 'Camps', title: 'Holiday immersion', desc: 'A week full of language and play.', cta_label: 'Discover', cta_href: '#', image_url: '' },
      ],
    },
  },
  {
    kind: 'cta-banner',
    name: 'CTA banner',
    description: 'A full-width call-to-action band — heading, subhead, button. variant: "gradient" (default, primary→accent gradient with decorative shapes) or "solid".',
    category: 'cta',
    defaults: { heading: 'Ready to begin?', sub: 'Start free. Upgrade when you grow.', cta_label: 'Get started', cta_href: '#', variant: 'gradient' },
  },
  {
    kind: 'testimonials-3',
    name: 'Testimonials — 3 cards',
    description: 'Three customer quotes side-by-side, each with a star rating, an avatar (auto from initials), author and role. Optional eyebrow + heading.',
    category: 'social-proof',
    defaults: {
      eyebrow: '',
      heading: 'What people say',
      sub: '',
      items: [
        { quote: 'This changed how we ship.', author: 'Alex P.', role: 'Head of Product', rating: 5 },
        { quote: 'Our team loves it.', author: 'Sam R.', role: 'Engineering Lead', rating: 5 },
        { quote: 'Fast, reliable, simple.', author: 'Jordan M.', role: 'CTO', rating: 5 },
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
    // The 'raw-html' kind preserves a chunk of the original site's HTML as-is
    // (with colors/fonts rewritten to brand tokens, images mirrored locally,
    // scripts stripped). Produced by the HTML sectionizer (/import/sectionize-page)
    // when the user wants pixel-faithful import rather than a typed rebuild.
    // Editable in two ways: (a) raw HTML textarea, (b) future 'typify' AI flow
    // that converts it back to a typed section.
    kind: 'raw-html',
    name: 'Original section',
    description: 'A section copied verbatim from the imported site. Colors and fonts swap to brand tokens; can be replaced or AI-rewritten later.',
    category: 'content',
    defaults: { html: '', sourceLabel: '' },
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
  {
    kind: 'stats-band',
    name: 'Stats band — colored',
    description: 'A bold full-width band in the brand color with 3–4 big numbers and labels. High-impact social proof — put it right under a hero.',
    category: 'social-proof',
    defaults: {
      items: [
        { value: '1.200+', label: 'Happy customers' },
        { value: '3', label: 'Languages taught' },
        { value: '8', label: 'Kids per group' },
        { value: '4.9★', label: 'Parent score' },
      ],
    },
  },
]

export const SECTION_META: Record<string, SectionMeta> = Object.fromEntries(SECTIONS.map((s) => [s.kind, s]))

// True when the section will render something visible. Used in edit mode to
// flag empty sections so the editor can highlight them ("you added it but it
// has no content yet"). Mirrors the renderer's emptiness conditions.
export function sectionHasContent(b: any): boolean {
  if (!b || typeof b !== 'object') return false
  const p = b.props || {}
  const has = (s: any) => typeof s === 'string' && s.trim().length > 0
  const arrOk = (a: any, min = 1) => Array.isArray(a) && a.length >= min
  switch (b.type as SectionKind) {
    case 'hero': return has(p.heading) || has(p.sub) || has(p.cta_label)
    case 'hero-image': return has(p.heading) || has(p.image_url)
    case 'hero-blob': return has(p.heading) || has(p.image_url)
    case 'richtext': return has(p.html)
    case 'image': return has(p.url)
    case 'features-3': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.desc))
    case 'program-cards': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.badge))
    case 'stats-band': return arrOk(p.items) && p.items.some((i: any) => has(i?.value) || has(i?.label))
    case 'cta-banner': return has(p.heading) || has(p.cta_label)
    case 'testimonials-3': return arrOk(p.items) && p.items.some((i: any) => has(i?.quote))
    case 'pricing-3': return arrOk(p.tiers) && p.tiers.some((t: any) => has(t?.name) || has(t?.price))
    case 'faq': return arrOk(p.items) && p.items.some((i: any) => has(i?.q) || has(i?.a))
    case 'logo-cloud': return arrOk(p.logos) && p.logos.some((l: any) => has(l?.url))
    case 'image-text': return has(p.heading) || has(p.html) || has(p.image_url)
    case 'stats-row': return arrOk(p.items) && p.items.some((i: any) => has(i?.value) || has(i?.label))
    case 'raw-html': return has(p.html)
    default: return false
  }
}

// ---- shared escapers used by both renderer and chat tools ----
export function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Rounded-corner star decoration (Kids.ro-style playful accent), tinted with
// the brand accent via currentColor. Positioned by the section CSS.
const STAR_SVG = `<svg class="deco-star" viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M11.1 2.3a1 1 0 0 1 1.8 0l2.2 4.6a1 1 0 0 0 .8.6l5 .6a1 1 0 0 1 .6 1.7l-3.7 3.4a1 1 0 0 0-.3.9l1 5a1 1 0 0 1-1.5 1.1l-4.4-2.5a1 1 0 0 0-1 0l-4.4 2.5A1 1 0 0 1 6.5 19l1-5a1 1 0 0 0-.3-.9L3.5 9.8a1 1 0 0 1 .6-1.7l5-.6a1 1 0 0 0 .8-.6z" fill="currentColor"/></svg>`

// CSS additions for the new section kinds. The base CSS in publish.ts already
// covers .container, .hero, .rt, .img — we just add the new ones here so
// publish.ts stays focused on the page chrome.
export const SECTION_CSS = `
.hero-image{padding:var(--pad) 0;position:relative;overflow:hidden}
.hero-image.v-gradient{background:radial-gradient(120% 130% at 88% 0%, color-mix(in srgb, var(--accent) 16%, var(--surface)), var(--surface) 62%)}
.hero-image .grid{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center}
.hero-image .eyebrow{font-weight:700;font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--accent);margin-bottom:14px}
.hero-image h1{font-size:calc(2.3rem * var(--scale, 1.2));margin-bottom:16px;letter-spacing:-.02em;line-height:1.06}
.hero-image .sub{font-size:1.08rem;opacity:.76;margin-bottom:26px;max-width:46ch;line-height:1.55}
.hero-image .actions{display:flex;gap:12px;flex-wrap:wrap}
.hero-image .btn-ghost{background:transparent;color:var(--primary);border:2px solid var(--primary)}
.hero-image .media{position:relative}
.hero-image .media-accent{position:absolute;inset:auto -14px -14px auto;width:62%;height:70%;border-radius:calc(var(--card-r) * 1.4);background:color-mix(in srgb, var(--accent) 30%, var(--surface));z-index:0}
.hero-image .media img{position:relative;z-index:1;display:block;width:100%;height:auto;border-radius:var(--card-r);box-shadow:0 24px 60px -24px color-mix(in srgb, var(--primary) 42%, transparent)}
.hero-image .media-empty{aspect-ratio:4/3;border-radius:var(--card-r);background:color-mix(in srgb, var(--primary) 8%, var(--surface))}
@media(max-width:760px){.hero-image .grid{grid-template-columns:1fr;gap:28px}.hero-image .media-accent{display:none}.hero-image .actions{flex-direction:column;align-items:stretch}.hero-image .actions .btn{width:100%;text-align:center}}

.features-3{padding:var(--pad) 0}
.features-3 .head{text-align:center;margin-bottom:38px}
.features-3 .head .eyebrow{font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
.features-3 .head h2{font-size:calc(1.7rem * var(--scale, 1.2));letter-spacing:-.01em;margin-bottom:8px}
.features-3 .head .sub{opacity:.7;font-size:1.02rem;max-width:56ch;margin:0 auto;line-height:1.55}
.features-3 .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.features-3 .item{background:var(--surface);border:var(--bw) solid color-mix(in srgb, var(--primary) 12%, transparent);border-radius:var(--card-r);padding:28px 26px;box-shadow:var(--shadow, 0 6px 24px -14px rgba(30,10,50,.18));transition:transform .18s ease, box-shadow .18s ease}
.features-3 .item:hover{transform:translateY(-4px);box-shadow:0 18px 40px -20px color-mix(in srgb, var(--primary) 40%, transparent)}
.features-3 .item .icon{width:46px;height:46px;border-radius:calc(var(--card-r) * .6);display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:16px;background:color-mix(in srgb, var(--accent) 20%, var(--surface))}
.features-3 .item h3{font-size:1.12rem;font-weight:700;margin-bottom:7px}
.features-3 .item p{font-size:.96rem;opacity:.74;line-height:1.55}
.features-3.v-minimal .item{background:transparent;border:0;box-shadow:none;padding:8px 6px}
.features-3.v-minimal .item:hover{transform:none;box-shadow:none}
.features-3.v-minimal .item .icon{background:transparent;color:var(--primary);width:auto;height:auto;font-size:26px;margin-bottom:10px}
@media(max-width:760px){.features-3 .grid{grid-template-columns:1fr}}

/* steps — numbered how-it-works */
.steps{padding:var(--pad) 0}
.steps .head{text-align:center;margin-bottom:38px}
.steps .head .eyebrow{font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
.steps .head h2{font-size:calc(1.7rem * var(--scale, 1.2));letter-spacing:-.01em}
.steps .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:26px}
.steps .step{position:relative;display:flex;gap:16px;align-items:flex-start}
.steps .step-n{flex:0 0 auto;width:44px;height:44px;border-radius:50%;background:var(--primary);color:#fff;font-weight:800;font-size:1.1rem;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px -8px color-mix(in srgb, var(--primary) 55%, transparent)}
.steps .step-txt h3{font-size:1.08rem;font-weight:700;margin-bottom:5px}
.steps .step-txt p{font-size:.95rem;opacity:.72;line-height:1.5}

.cta-banner{padding:var(--pad) 0}
.cta-banner .box{position:relative;background:linear-gradient(120deg, var(--primary), color-mix(in srgb, var(--accent) 70%, var(--primary)));color:#fff;border-radius:calc(var(--card-r) * 1.3);padding:56px 28px;text-align:center;overflow:hidden}
.cta-banner.v-solid .box{background:var(--primary)}
.cta-banner .cta-inner{position:relative;z-index:2}
.cta-banner .cta-orb{position:absolute;border-radius:50%;background:rgba(255,255,255,.12);z-index:1;pointer-events:none}
.cta-banner .cta-orb-1{width:240px;height:240px;top:-90px;right:-60px}
.cta-banner .cta-orb-2{width:150px;height:150px;bottom:-70px;left:-30px;background:rgba(255,255,255,.09)}
.cta-banner h2{font-size:calc(1.75rem * var(--scale, 1.2));color:#fff;margin-bottom:12px;letter-spacing:-.01em}
.cta-banner .sub{font-size:1.05rem;color:rgba(255,255,255,.9);margin-bottom:24px;max-width:48ch;margin-left:auto;margin-right:auto;line-height:1.55}
.cta-banner .btn{background:#fff;color:var(--primary);box-shadow:0 10px 30px -10px rgba(0,0,0,.35)}
.cta-banner .btn:hover{transform:translateY(-1px)}

.testimonials-3{padding:var(--pad) 0}
.testimonials-3 .head{text-align:center;margin-bottom:38px}
.testimonials-3 .head .eyebrow{font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
.testimonials-3 .head h2{font-size:calc(1.7rem * var(--scale, 1.2));margin-bottom:8px}
/* horizontal slider — cards scroll/swipe in a row with snap; scrollbar hidden */
.testimonials-3 .grid{display:flex;gap:20px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 4px 14px;scrollbar-width:none;-webkit-overflow-scrolling:touch;scroll-padding-left:4px}
.testimonials-3 .grid::-webkit-scrollbar{display:none}
.testimonials-3 .card{flex:0 0 clamp(280px, 33%, 380px);scroll-snap-align:start;background:var(--surface);border:var(--bw) solid color-mix(in srgb, var(--primary) 12%, transparent);border-radius:var(--card-r);padding:26px;box-shadow:var(--shadow, 0 6px 24px -14px rgba(30,10,50,.18))}
.testimonials-3 .stars{color:#f5b301;font-size:.9rem;letter-spacing:2px;margin-bottom:12px}
.testimonials-3 .quote{font-size:1.02rem;line-height:1.6;margin-bottom:18px;color:var(--text)}
.testimonials-3 .who{display:flex;align-items:center;gap:11px;font-size:.85rem}
.testimonials-3 .av{flex:0 0 auto;width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;background:color-mix(in srgb, var(--primary) 78%, var(--accent))}
.testimonials-3 .who b{display:block;font-weight:700;color:var(--text)}
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

/* raw-html — imported sections rendered verbatim. Contain runaway widths and
   set sensible image defaults; brand colors/fonts come from the wrapping
   CSS variables which the sectionizer already swapped in. */
.uw-raw{padding:0;overflow:hidden}
.uw-raw > *:first-child{margin-top:0}
/* imported photos get the brand's card radius (unless they're already round,
   e.g. avatars, or explicitly styled) so they match the boxes on the page */
.uw-raw img{max-width:100%;height:auto;display:block;border-radius:var(--card-r)}
.uw-raw img[style*="border-radius"]{border-radius:revert}
/* Hide images that fail to load so we don't show a broken-icon box. The site
   renders them with onerror; the CSS rule below is the SSR-time fallback. */
.uw-raw img[data-broken="1"]{display:none}

/* hero-blob — playful text-left / image-in-blob-right hero (Kids.ro pattern) */
.hero-blob{padding:var(--pad) 0}
.hero-blob .grid{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center}
.hero-blob .eyebrow{font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:14px}
.hero-blob h1{font-size:calc(2.4rem * var(--scale, 1.2));line-height:1.06;letter-spacing:-.02em;margin-bottom:16px}
.hero-blob .sub{font-size:1.1rem;opacity:.75;max-width:44ch;margin-bottom:26px}
.hero-blob .actions{display:flex;gap:12px;flex-wrap:wrap}
.hero-blob .btn-ghost{background:transparent;color:var(--primary);border:2px solid var(--primary)}
.hero-blob .blob{position:relative;aspect-ratio:1;border-radius:46% 54% 52% 48% / 50% 46% 54% 50%;overflow:hidden;background:color-mix(in srgb, var(--accent) 26%, #fff);max-width:460px;margin-left:auto}
.hero-blob .blob img{width:100%;height:100%;object-fit:cover;display:block}
.hero-blob .blob-empty{display:flex;align-items:center;justify-content:center}
.hero-blob .deco-star{position:absolute;top:8%;right:8%;color:var(--accent);filter:drop-shadow(0 2px 4px rgba(0,0,0,.12));z-index:2}
@media(max-width:760px){.hero-blob .grid{grid-template-columns:1fr;gap:28px}.hero-blob .blob{max-width:320px;margin:0 auto}.hero-blob .actions{flex-direction:column;align-items:stretch}.hero-blob .actions .btn{width:100%;text-align:center}.hero-blob h1{font-size:clamp(1.7rem, 8.5vw, 2.3rem)}}

/* program-cards — 3 rich cards with colored badges + per-card accent CTA */
.program-cards{padding:var(--pad) 0}
.program-cards .head{text-align:center;margin-bottom:34px}
.program-cards .head .eyebrow{font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
.program-cards .head h2{font-size:calc(1.9rem * var(--scale, 1.2));letter-spacing:-.01em}
.program-cards .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.program-cards .pc-card{background:var(--surface);border:var(--bw) solid rgba(0,0,0,.07);border-radius:var(--card-r);overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow, 0 4px 20px rgba(30,10,50,.05))}
.program-cards .pc-top{aspect-ratio:16/10;background-size:cover;background-position:center}
.program-cards .pc-striped{background-image:repeating-linear-gradient(45deg, color-mix(in srgb, var(--pc-accent) 16%, #fff) 0 14px, color-mix(in srgb, var(--pc-accent) 26%, #fff) 14px 28px)}
.program-cards .pc-body{padding:22px 22px 24px}
.program-cards .pc-badge{font-weight:800;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px}
.program-cards .pc-body h3{font-size:1.2rem;font-weight:700;margin-bottom:6px;color:var(--text)}
.program-cards .pc-body p{font-size:.96rem;opacity:.72;margin-bottom:16px}
.program-cards .pc-cta{display:inline-block;color:#fff;border-radius:999px;padding:9px 20px;font-weight:700;font-size:14px;text-decoration:none}
.program-cards .pc-cta:hover{filter:brightness(1.08)}
@media(max-width:760px){.program-cards .grid{grid-template-columns:1fr}}

/* stats-band — bold full-width colored band with big numbers */
.stats-band{padding:calc(var(--pad) / 1.5) 0}
.stats-band .sb-box{background:var(--primary);color:#fff;border-radius:calc(var(--card-r) * 1.4);padding:36px 28px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:22px;text-align:center}
.stats-band .sb-val{font-size:2.6rem;font-weight:800;line-height:1;letter-spacing:-.02em;color:#fff}
.stats-band .sb-lbl{font-size:.85rem;opacity:.82;margin-top:8px}
@media(max-width:640px){
  .stats-band .sb-box{padding:24px 18px;gap:16px}
  .stats-band .sb-val{font-size:1.9rem}
  .stats-row .stat .val{font-size:1.9rem}
  .testimonials-3 .card{flex:0 0 82%}
}
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
      // accept flat cta_label/cta_href (new) or nested cta.{label,href} (legacy)
      const ctaLabel = p.cta_label || p.cta?.label
      const ctaHref = p.cta_href || p.cta?.href
      const cta = ctaLabel ? `<p><a class="btn" href="${esc(ctaHref || '#')}">${esc(ctaLabel)}</a></p>` : ''
      return `<section class="hero"><div class="container"><h1${f('heading')}>${esc(p.heading)}</h1>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}${cta}</div></section>`
    }
    case 'hero-image': {
      const variant = p.variant === 'gradient' ? ' v-gradient' : ''
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const cta1 = p.cta_label ? `<a class="btn" href="${esc(p.cta_href || '#')}">${esc(p.cta_label)}</a>` : ''
      const cta2 = p.cta2_label ? `<a class="btn btn-ghost" href="${esc(p.cta2_href || '#')}">${esc(p.cta2_label)}</a>` : ''
      const ctas = (cta1 || cta2) ? `<div class="actions">${cta1}${cta2}</div>` : ''
      const img = p.image_url
        ? `<div class="media"><span class="media-accent"></span><img src="${esc(p.image_url)}" alt="${esc(p.image_alt || '')}" loading="lazy"></div>`
        : '<div class="media media-empty"><span class="media-accent"></span></div>'
      return `<section class="hero-image${variant}"><div class="container"><div class="grid"><div class="txt">${eyebrow}<h1${f('heading')}>${esc(p.heading)}</h1>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}${ctas}</div>${img}</div></div></section>`
    }
    case 'hero-blob': {
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const cta1 = p.cta_label ? `<a class="btn" href="${esc(p.cta_href || '#')}">${esc(p.cta_label)}</a>` : ''
      const cta2 = p.cta2_label ? `<a class="btn btn-ghost" href="${esc(p.cta2_href || '#')}">${esc(p.cta2_label)}</a>` : ''
      const ctas = (cta1 || cta2) ? `<div class="actions">${cta1}${cta2}</div>` : ''
      const blob = p.image_url
        ? `<div class="blob"><img src="${esc(p.image_url)}" alt="${esc(p.image_alt || '')}" loading="lazy">${STAR_SVG}</div>`
        : `<div class="blob blob-empty">${STAR_SVG}</div>`
      return `<section class="hero-blob"><div class="container"><div class="grid"><div class="txt">${eyebrow}<h1${f('heading')}>${esc(p.heading)}</h1>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}${ctas}</div>${blob}</div></div></section>`
    }
    case 'richtext':
      return `<section class="rt"><div class="container">${p.html || ''}</div></section>`
    case 'image':
      return p.url ? `<section class="img"><div class="container"><img src="${esc(p.url)}" alt="${esc(p.alt || '')}" loading="lazy"></div></section>` : ''
    case 'features-3': {
      const variant = p.variant === 'minimal' ? ' v-minimal' : ''
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 6)
      const grid = items.map((it: any) => {
        const icon = it.icon ? `<div class="icon">${esc(it.icon)}</div>` : ''
        return `<div class="item">${icon}<h3>${esc(it.title)}</h3><p>${esc(it.desc)}</p></div>`
      }).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow">${esc(p.eyebrow)}</div>` : ''
      return `<section class="features-3${variant}"><div class="container"><div class="head">${eyebrow}<h2${f('heading')}>${esc(p.heading)}</h2>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div><div class="grid">${grid}</div></div></section>`
    }
    case 'steps': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 4)
      const cells = items.map((it: any, i: number) => `<div class="step"><div class="step-n">${i + 1}</div><div class="step-txt"><h3>${esc(it.title)}</h3>${it.desc ? `<p>${esc(it.desc)}</p>` : ''}</div></div>`).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow">${esc(p.eyebrow)}</div>` : ''
      return `<section class="steps"><div class="container"><div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}</div><div class="grid">${cells}</div></div></section>`
    }
    case 'program-cards': {
      // Three rich cards; each cycles through an accent (primary → accent →
      // primary) unless the item names its own. Colored badge, striped/photo
      // top, title, desc, colored pill CTA. Mirrors the Kids.ro program grid.
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 3)
      const accents = ['var(--primary)', 'var(--accent)', 'var(--primary)']
      const cards = items.map((it: any, i: number) => {
        const ac = it.accent || accents[i % 3]
        const top = it.image_url
          ? `<div class="pc-top" style="background-image:url('${esc(it.image_url)}')"></div>`
          : `<div class="pc-top pc-striped" style="--pc-accent:${ac}"></div>`
        const badge = it.badge ? `<div class="pc-badge" style="color:${ac}">${esc(it.badge)}</div>` : ''
        const cta = it.cta_label ? `<a class="pc-cta" href="${esc(it.cta_href || '#')}" style="background:${ac}">${esc(it.cta_label)} →</a>` : ''
        return `<div class="pc-card">${top}<div class="pc-body">${badge}<h3>${esc(it.title)}</h3>${it.desc ? `<p>${esc(it.desc)}</p>` : ''}${cta}</div></div>`
      }).join('')
      const head = (p.eyebrow || p.heading)
        ? `<div class="head">${p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}</div>`
        : ''
      return `<section class="program-cards"><div class="container">${head}<div class="grid">${cards}</div></div></section>`
    }
    case 'stats-band': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 4)
      const cells = items.map((it: any) => `<div class="sb-stat"><div class="sb-val">${esc(it.value)}</div><div class="sb-lbl">${esc(it.label)}</div></div>`).join('')
      return `<section class="stats-band"><div class="container"><div class="sb-box">${cells}</div></div></section>`
    }
    case 'cta-banner': {
      const solid = p.variant === 'solid' ? ' v-solid' : ''
      return `<section class="cta-banner${solid}"><div class="container"><div class="box"><span class="cta-orb cta-orb-1"></span><span class="cta-orb cta-orb-2"></span><div class="cta-inner"><h2${f('heading')}>${esc(p.heading)}</h2>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}${p.cta_label ? `<p><a class="btn" href="${esc(p.cta_href || '#')}">${esc(p.cta_label)}</a></p>` : ''}</div></div></div></section>`
    }
    case 'testimonials-3': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 6)
      const cards = items.map((it: any) => {
        const n = Math.max(0, Math.min(5, Number(it.rating) || 0))
        const stars = n ? `<div class="stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</div>` : ''
        const initial = esc(String(it.author || '?').trim().charAt(0).toUpperCase())
        const av = `<span class="av" aria-hidden="true">${initial}</span>`
        return `<div class="card">${stars}<p class="quote">${esc(it.quote)}</p><div class="who">${av}<div><b>${esc(it.author)}</b>${it.role ? `<span>${esc(it.role)}</span>` : ''}</div></div></div>`
      }).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow">${esc(p.eyebrow)}</div>` : ''
      return `<section class="testimonials-3"><div class="container">${(p.heading || eyebrow) ? `<div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div>` : ''}<div class="grid">${cards}</div></div></section>`
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
    case 'raw-html': {
      // Source HTML passes through with no extra escaping — the sectionizer
      // is responsible for already having sanitised + brand-themed it. The
      // wrapper applies our base CSS variables so child elements that USE
      // var(--primary) etc. inherit the workspace's tokens. Empty raw-html
      // doesn't render anything except (in edit mode) the placeholder.
      const html = typeof p.html === 'string' ? p.html : ''
      if (!html) return ''
      const label = p.sourceLabel ? `<!-- source: ${esc(p.sourceLabel)} -->` : ''
      return `${label}<section class="uw-raw">${html}</section>`
    }
    default:
      return `<!-- unknown section: ${esc(String(b.type))} -->`
  }
}
