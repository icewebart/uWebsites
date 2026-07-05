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
  | 'features-3' | 'features-4' | 'program-cards' | 'cta-banner' | 'steps'
  | 'testimonials-3' | 'testimonials-slider' | 'pricing-3' | 'faq' | 'logo-cloud' | 'image-text' | 'stats-row' | 'stats-band'
  | 'article-hero' | 'article-body' | 'timeline' | 'gallery'
  | 'features-2col' | 'feature-alt' | 'split-hero' | 'bento-grid' | 'carousel-cards' | 'faq-accordion' | 'big-quote'
  | 'cta-ref' | 'post-list'
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
    kind: 'features-4',
    name: 'Features — 4 columns',
    description: 'Four short value props in a row, each with an icon/emoji. Collapses to 2 columns on tablet, 1 on mobile. Great for a compact feature grid.',
    category: 'features',
    defaults: {
      eyebrow: '',
      heading: 'What you get',
      sub: '',
      items: [
        { icon: '⚡', title: 'Fast', desc: 'Static output, quick on mobile.' },
        { icon: '🔒', title: 'Safe', desc: 'No runtime to attack.' },
        { icon: '🎨', title: 'On-brand', desc: 'One token set styles it all.' },
        { icon: '📈', title: 'SEO-ready', desc: 'Clean markup + sitemaps.' },
      ],
    },
  },
  {
    kind: 'testimonials-slider',
    name: 'Testimonials — 3-up slider',
    description: 'A horizontal carousel that shows exactly 3 testimonials at a time and glides to the next set (GSAP-animated), with prev/next arrows and autoplay. Ideal for lots of reviews.',
    category: 'social-proof',
    defaults: {
      eyebrow: 'Loved by parents',
      heading: 'What families say',
      autoplay: true,
      items: [
        { quote: 'The kids adored every session — they ask when the next one is!', author: 'Andreea M.', role: 'Parent', rating: 5 },
        { quote: 'Professional, warm and genuinely fun. Highly recommend.', author: 'Radu P.', role: 'Parent', rating: 5 },
        { quote: 'My daughter went from shy to confident in German in weeks.', author: 'Ioana T.', role: 'Parent', rating: 5 },
        { quote: 'Great structure and lovely teachers. Worth every leu.', author: 'Mihai D.', role: 'Parent', rating: 5 },
        { quote: 'Booked again for the summer without hesitation.', author: 'Elena V.', role: 'Parent', rating: 5 },
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
    kind: 'article-hero',
    name: 'Article hero',
    description: 'A designed masthead for an article: a category kicker, the big headline, a one-line deck, and a meta row (author · date · read time). Optional wide banner image. Generous top spacing so the fixed menu never overlaps it. Use at the very top of articles.',
    category: 'content',
    defaults: { variant: 'classic', eyebrow: '', heading: 'Article headline', sub: '', author: '', date: '', readMins: 5, image_url: '', image_alt: '', grad_from: 'primary', grad_to: 'accent' },
  },
  {
    kind: 'article-body',
    name: 'Article body (with sidebar)',
    description: 'The main body of an article: rich text on the left; a sticky sidebar on the right with an auto Table of Contents (from h2/h3), author bio, a CTA and related links. Ships an <article> element + Schema.org markup for SEO.',
    category: 'content',
    defaults: {
      html: '<p>Write the article here…</p>',
      author: '', publishedAt: '', readMins: 5, toc: true,
      sidebar: [
        { kind: 'toc', title: 'On this page' },
        { kind: 'cta', title: 'Get in touch', text: 'Short line about what happens next.', cta_label: 'Contact us', cta_href: '/contact/' },
      ],
    },
  },
  {
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
  {
    kind: 'timeline',
    name: 'Timeline',
    description: 'A vertical timeline down the page — each step has an optional date/label, a title and a line of copy, joined by a connecting spine. Perfect for a process, roadmap, company history, or "what to expect" journey.',
    category: 'features',
    defaults: {
      eyebrow: '',
      heading: 'How the journey works',
      items: [
        { marker: 'Week 1', title: 'We get to know each other', desc: 'A relaxed first session to place your child at the right level.' },
        { marker: 'Week 2–6', title: 'Playful foundations', desc: 'Songs, games and short stories build real vocabulary fast.' },
        { marker: 'Week 8', title: 'First full conversation', desc: 'Your child holds a simple conversation — in German.' },
      ],
    },
  },
  {
    kind: 'gallery',
    name: 'Gallery',
    description: 'A responsive image grid. layout: "grid" (uniform tiles) or "bento" (mixed sizes for a more editorial feel). Optional eyebrow + heading. Great for photos, spaces, work, or a product showcase.',
    category: 'content',
    defaults: {
      eyebrow: '',
      heading: 'A look inside',
      layout: 'bento',
      items: [
        { image_url: '', caption: '' },
        { image_url: '', caption: '' },
        { image_url: '', caption: '' },
        { image_url: '', caption: '' },
        { image_url: '', caption: '' },
      ],
    },
  },
  {
    kind: 'features-2col',
    name: 'Features — 2 columns',
    description: 'A centered heading, then two wide feature columns side-by-side, each with an icon (emoji), a title and a paragraph. Roomier than the 3-up grid — good for two big differentiators.',
    category: 'features',
    defaults: {
      eyebrow: '', heading: 'Two reasons it works',
      items: [
        { icon: '✳️', title: 'First big benefit', desc: 'A full sentence or two explaining the concrete value the reader gets.' },
        { icon: '◆', title: 'Second big benefit', desc: 'Another specific, benefit-led explanation — no filler.' },
      ],
    },
  },
  {
    kind: 'feature-alt',
    name: 'Feature rows — alternating',
    description: 'A stack of image+text rows that alternate sides (zig-zag). Each row has a title, a paragraph and an image. Ideal for walking through 2–4 features/benefits with a screenshot or photo each.',
    category: 'features',
    defaults: {
      eyebrow: '', heading: '',
      items: [
        { title: 'A clear benefit', desc: 'Explain it in a couple of concrete sentences.', image_url: '' },
        { title: 'Another benefit', desc: 'Pair each point with a supporting visual.', image_url: '' },
      ],
    },
  },
  {
    kind: 'split-hero',
    name: 'Split hero',
    description: 'A bold hero split in two: a colored text panel (eyebrow, big heading, sub, buttons) beside a full-bleed image panel. High-impact top-of-page.',
    category: 'hero',
    defaults: { eyebrow: '', heading: 'A headline that earns attention', sub: 'One supporting line that names the audience and the outcome.', cta_label: 'Get started', cta_href: '#', cta2_label: '', cta2_href: '', image_url: '', image_alt: '' },
  },
  {
    kind: 'bento-grid',
    name: 'Bento grid',
    description: 'An editorial grid of mixed-size tiles — each tile can be a stat, a short text card, or an image. Modern, magazine-like way to summarise highlights.',
    category: 'features',
    defaults: {
      eyebrow: '', heading: 'The highlights',
      items: [
        { kind: 'stat', value: '1.200+', label: 'Happy families' },
        { kind: 'text', title: 'Why parents choose us', desc: 'A concrete, specific reason in one line.' },
        { kind: 'image', image_url: '', caption: '' },
        { kind: 'stat', value: '4.9★', label: 'Average rating' },
        { kind: 'text', title: 'What you get', desc: 'Another crisp, specific promise.' },
      ],
    },
  },
  {
    kind: 'carousel-cards',
    name: 'Carousel — horizontal slider',
    description: 'A horizontal slider showing a few cards at once (set how many are visible), with more that scroll into view via arrows / swipe. Each card has an image, title, description and optional button. Great for programs, testimonials, products.',
    category: 'features',
    defaults: {
      eyebrow: '', heading: 'Browse our programs', visible: 3,
      items: [
        { title: 'Card one', desc: 'A short description of this item.', image_url: '', cta_label: '', cta_href: '' },
        { title: 'Card two', desc: 'A short description of this item.', image_url: '', cta_label: '', cta_href: '' },
        { title: 'Card three', desc: 'A short description of this item.', image_url: '', cta_label: '', cta_href: '' },
        { title: 'Card four', desc: 'A short description of this item.', image_url: '', cta_label: '', cta_href: '' },
        { title: 'Card five', desc: 'A short description of this item.', image_url: '', cta_label: '', cta_href: '' },
      ],
    },
  },
  {
    kind: 'faq-accordion',
    name: 'FAQ — accordion',
    description: 'A list of question/answer pairs that expand on click (native <details>). Emits FAQ Schema.org markup for rich results. Better than the flat FAQ for long lists.',
    category: 'content',
    defaults: {
      eyebrow: '', heading: 'Frequently asked questions',
      items: [
        { q: 'How do I get started?', a: 'A clear, complete answer in 1–2 sentences.' },
        { q: 'What does it cost?', a: 'Be specific and transparent.' },
        { q: 'Can I change later?', a: 'Reassure with a concrete answer.' },
      ],
    },
  },
  {
    kind: 'big-quote',
    name: 'Big quote',
    description: 'One oversized testimonial or pull-quote with an author, role and optional portrait. Far more persuasive than a row of small cards for your best quote.',
    category: 'social-proof',
    defaults: { quote: 'This is the single most persuasive thing a real customer said about you.', author: 'Full Name', role: 'Role, Company', image_url: '' },
  },
  {
    kind: 'post-list',
    name: 'Article list (blog index)',
    description: 'Automatically lists the articles on this site as a card grid (image, title, excerpt, date). Populated at publish time — you do not fill it in. Put it on your blog / articles index page.',
    category: 'content',
    defaults: { eyebrow: '', heading: 'Latest articles', layout: 'grid', items: [] },
  },
  {
    kind: 'cta-ref',
    name: 'Smart CTA (from CTA library)',
    description: 'A call-to-action banner whose text + link come from the workspace CTA library (Website → CTAs). Set cta_id to pin a specific CTA, or leave it "auto" to use the best CTA for this page by the rules. Editing the CTA once updates it everywhere.',
    category: 'cta',
    defaults: { cta_id: '', variant: 'gradient', heading: '', sub: '', cta_label: '', cta_href: '' },
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
    case 'article-hero': return has(p.heading)
    case 'article-body': return has(p.html)
    case 'image': return has(p.url)
    case 'features-3': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.desc))
    case 'features-4': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.desc))
    case 'testimonials-slider': return arrOk(p.items) && p.items.some((i: any) => has(i?.quote))
    case 'program-cards': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.badge))
    case 'stats-band': return arrOk(p.items) && p.items.some((i: any) => has(i?.value) || has(i?.label))
    case 'cta-banner': return has(p.heading) || has(p.cta_label)
    case 'testimonials-3': return arrOk(p.items) && p.items.some((i: any) => has(i?.quote))
    case 'pricing-3': return arrOk(p.tiers) && p.tiers.some((t: any) => has(t?.name) || has(t?.price))
    case 'faq': return arrOk(p.items) && p.items.some((i: any) => has(i?.q) || has(i?.a))
    case 'logo-cloud': return arrOk(p.logos) && p.logos.some((l: any) => has(l?.url))
    case 'image-text': return has(p.heading) || has(p.html) || has(p.image_url)
    case 'timeline': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.desc))
    case 'gallery': return arrOk(p.items) && p.items.some((i: any) => has(i?.image_url))
    case 'features-2col': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.desc))
    case 'feature-alt': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.desc))
    case 'split-hero': return has(p.heading)
    case 'bento-grid': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.value) || has(i?.image_url))
    case 'carousel-cards': return arrOk(p.items) && p.items.some((i: any) => has(i?.title) || has(i?.image_url))
    case 'faq-accordion': return arrOk(p.items) && p.items.some((i: any) => has(i?.q) || has(i?.a))
    case 'big-quote': return has(p.quote)
    case 'cta-ref': return true  // resolved from the CTA library at render time
    case 'post-list': return true  // populated with the site's articles at render time
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
.features-4{padding:var(--pad) 0}
.features-4 .head{text-align:center;margin-bottom:34px}
.features-4 .head .eyebrow{font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
.features-4 .head h2{font-size:calc(1.7rem * var(--scale, 1.2));letter-spacing:-.01em;margin-bottom:8px}
.features-4 .head .sub{opacity:.7;font-size:1.02rem;max-width:56ch;margin:0 auto;line-height:1.55}
.features-4 .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.features-4 .item{background:var(--surface);border:var(--bw) solid color-mix(in srgb, var(--primary) 12%, transparent);border-radius:var(--card-r);padding:24px 22px;box-shadow:var(--shadow, 0 6px 24px -14px rgba(30,10,50,.18));transition:transform .18s ease, box-shadow .18s ease}
.features-4 .item:hover{transform:translateY(-4px);box-shadow:0 18px 40px -20px color-mix(in srgb, var(--primary) 40%, transparent)}
.features-4 .item .icon{width:42px;height:42px;border-radius:calc(var(--card-r) * .6);display:flex;align-items:center;justify-content:center;font-size:20px;margin-bottom:14px;background:color-mix(in srgb, var(--accent) 20%, var(--surface))}
.features-4 .item h3{font-size:1.06rem;font-weight:700;margin-bottom:6px}
.features-4 .item p{font-size:.92rem;opacity:.74;line-height:1.5}
/* image variant: square photo on top, title + text below (no crop worries) */
.features-4.v-images .item{padding:0;overflow:hidden}
.features-4.v-images .f4-img{aspect-ratio:1/1;background-size:cover;background-position:center;background-color:color-mix(in srgb,var(--primary) 8%,var(--surface))}
.features-4.v-images .f4-img-empty{background-image:repeating-linear-gradient(45deg,color-mix(in srgb,var(--accent) 16%,var(--surface)) 0 14px,var(--surface) 14px 28px)}
.features-4.v-images .f4-txt{padding:16px 18px 20px}
@media(max-width:900px){.features-4 .grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.features-4 .grid{grid-template-columns:1fr}}
/* Testimonials 3-up slider (GSAP-animated track; shows exactly 3) */
.testimonials-slider{padding:var(--pad) 0;overflow:hidden}
.testimonials-slider .tss-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:26px}
.testimonials-slider .head{text-align:left;margin:0}
.testimonials-slider .head .eyebrow{font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
.testimonials-slider .head h2{font-size:calc(1.7rem * var(--scale, 1.2));margin-bottom:6px}
.testimonials-slider .head .sub{opacity:.7;line-height:1.55}
.tss-ctrls{display:flex;gap:8px;flex:0 0 auto}
.tss-arrow{width:42px;height:42px;border-radius:999px;border:1px solid color-mix(in srgb,var(--text) 14%,transparent);background:var(--surface);color:var(--text);font-size:22px;line-height:1;cursor:pointer;transition:background .15s ease,border-color .15s ease}
.tss-arrow:hover{background:color-mix(in srgb,var(--primary) 10%,var(--surface));border-color:var(--primary)}
.tss-viewport{overflow:hidden}
.tss-track{display:flex;gap:24px;will-change:transform}
.tss-card{flex:0 0 calc((100% - 48px) / 3);box-sizing:border-box;background:var(--surface);border:var(--bw) solid color-mix(in srgb,var(--primary) 12%,transparent);border-radius:var(--card-r);padding:26px 24px;box-shadow:var(--shadow, 0 6px 24px -14px rgba(30,10,50,.18))}
.tss-card .stars{color:#f6b73c;letter-spacing:2px;margin-bottom:10px}
.tss-card .quote{font-size:1rem;line-height:1.6;margin-bottom:16px}
.tss-card .who{display:flex;align-items:center;gap:10px}
.tss-card .who .av{width:38px;height:38px;border-radius:999px;background:color-mix(in srgb,var(--primary) 18%,var(--surface));color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700}
.tss-card .who b{display:block;font-size:.94rem}
.tss-card .who span{font-size:.82rem;opacity:.65}
@media(max-width:900px){.tss-card{flex-basis:calc((100% - 24px) / 2)}}
@media(max-width:600px){.tss-card{flex-basis:100%}.testimonials-slider .tss-top{flex-direction:column;align-items:flex-start}}

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

/* article-hero — designed masthead. First hero clears the fixed menu with a
   FIXED top gap (independent of --pad); bottom sits close to the article body. */
.article-hero{padding:44px 0 32px}
main > section.article-hero:first-child{padding-top:120px}
.article-hero .ah-inner{max-width:820px}
.article-hero .ah-kicker{display:inline-block;font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--primary);background:color-mix(in srgb,var(--primary) 10%,transparent);padding:4px 12px;border-radius:999px;margin-bottom:18px}
.article-hero h1{font-size:clamp(1.9rem, 5vw, calc(2.6rem * var(--scale, 1.2)));line-height:1.08;letter-spacing:-.02em;margin:0 0 16px;max-width:22ch}
.article-hero .ah-deck{font-size:clamp(1.05rem,2.4vw,1.25rem);line-height:1.55;color:color-mix(in srgb,var(--text) 72%,transparent);max-width:60ch;margin:0 0 20px}
.article-hero .ah-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:.9rem;color:color-mix(in srgb,var(--text) 58%,transparent)}
.article-hero .ah-meta i{opacity:.5;font-style:normal}
.article-hero .ah-banner{margin-top:32px}
.article-hero .ah-banner img{width:100%;height:auto;max-height:460px;object-fit:cover;border-radius:calc(var(--card-r) + 4px)}
@media(max-width:640px){main > section.article-hero:first-child{padding-top:96px}.article-hero{padding-bottom:24px}.article-hero .ah-banner{margin-top:22px}}
/* --- variants --- */
/* Centered + Boxed: content is centered AND spans the full width of its column
   (headline/deck no longer capped, so the box fills). */
.article-hero.ah-centered .ah-inner{max-width:760px;margin:0 auto;text-align:center}
.article-hero.ah-centered .ah-meta,.article-hero.ah-boxed .ah-meta{justify-content:center}
.article-hero.ah-centered h1,.article-hero.ah-centered .ah-deck{max-width:none;margin-left:auto;margin-right:auto}
.article-hero.ah-boxed{background:color-mix(in srgb,var(--primary) 6%,var(--surface))}
.article-hero.ah-boxed .ah-inner{max-width:840px;margin:0 auto;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:calc(var(--card-r) + 4px);padding:48px 56px;box-shadow:var(--shadow);text-align:center}
.article-hero.ah-boxed h1,.article-hero.ah-boxed .ah-deck{max-width:none}
.article-hero.ah-minimal{padding-bottom:20px}
.article-hero.ah-minimal h1{font-size:clamp(1.6rem,4vw,calc(2.1rem * var(--scale,1.2)));max-width:26ch}
/* Cover (image) + Gradient share the full-bleed overlay layout */
.article-hero.ah-cover{color:#fff;background-size:cover;background-position:center;display:flex;align-items:flex-end;min-height:min(72vh,620px);padding:0}
main > section.article-hero.ah-cover:first-child{padding-top:0}
/* container must fill the page width (else it shrinks to its text inside the
   flex and centres — that's why the title wasn't left-aligned) */
.article-hero.ah-cover .container{width:100%;padding-top:140px;padding-bottom:52px}
.article-hero.ah-cover .ah-inner{max-width:760px;margin:0;text-align:left}
.article-hero.ah-cover .ah-meta{justify-content:flex-start}
.article-hero.ah-cover h1,.article-hero.ah-cover .ah-deck,.article-hero.ah-cover .ah-kicker{text-align:left}
.article-hero.ah-cover h1{color:#fff;max-width:none}
.article-hero.ah-cover .ah-deck{color:rgba(255,255,255,.9);max-width:60ch}
.article-hero.ah-cover .ah-meta{color:rgba(255,255,255,.82)}
.article-hero.ah-cover .ah-kicker{background:rgba(255,255,255,.2);color:#fff}
.article-hero.ah-cover-noimg{background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--accent) 60%,var(--primary)))}
@media(max-width:640px){.article-hero.ah-boxed .ah-inner{padding:28px 22px}.article-hero.ah-cover{min-height:auto}.article-hero.ah-cover .container{padding-top:104px;padding-bottom:34px}}

/* article-body — main text + sticky sidebar, tuned for reading + SEO */
.article-body{padding:var(--pad) 0}
/* inline (top-of-article) collapsible Table of Contents */
.article-body .ab-toc-inline{background:color-mix(in srgb,var(--text) 3.5%,transparent);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--card-r);padding:14px 18px;margin:0 0 28px;max-width:none}
.article-body .ab-toc-inline summary{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:color-mix(in srgb,var(--text) 60%,transparent);cursor:pointer;list-style:none}
.article-body .ab-toc-inline summary::-webkit-details-marker{display:none}
.article-body .ab-toc-inline summary::after{content:"▾";float:right;font-size:11px;transition:transform .2s}
.article-body .ab-toc-inline:not([open]) summary::after{transform:rotate(-90deg)}
.article-body .ab-toc-inline nav{margin-top:12px}
.article-body .ab-toc-inline ul{list-style:none;margin:0;padding:0;columns:2;column-gap:28px}
.article-body .ab-toc-inline li{margin:5px 0;break-inside:avoid}
.article-body .ab-toc-inline li.lv-3{padding-left:14px}
.article-body .ab-toc-inline a{color:color-mix(in srgb,var(--text) 78%,transparent);text-decoration:none;font-size:.92rem}
.article-body .ab-toc-inline a:hover{color:var(--primary)}
/* sidebar CTA card — stands out */
.article-body .ab-card-cta{background:linear-gradient(160deg,color-mix(in srgb,var(--primary) 12%,var(--surface)),var(--surface));border-color:color-mix(in srgb,var(--primary) 22%,transparent)}
.article-body .ab-card-cta .btn{width:100%;text-align:center}
/* sidebar newsletter form */
.article-body .ab-card-news .ab-news-form{display:flex;flex-direction:column;gap:8px}
.article-body .ab-card-news input{width:100%;padding:10px 12px;border:1px solid color-mix(in srgb,var(--text) 14%,transparent);border-radius:var(--btn-r);font:inherit;font-size:.92rem;background:var(--surface);color:var(--text)}
.article-body .ab-card-news input:focus{outline:2px solid color-mix(in srgb,var(--primary) 40%,transparent);outline-offset:1px;border-color:var(--primary)}
.article-body .ab-card-news .btn{width:100%;text-align:center}
@media(max-width:640px){.article-body .ab-toc-inline ul{columns:1}}
.article-body .grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:36px;align-items:start}
.article-body .ab-main{min-width:0}
.article-body .ab-meta{font-size:.85rem;color:color-mix(in srgb, var(--text) 55%, transparent);text-transform:uppercase;letter-spacing:.05em;margin-bottom:16px}
.article-body .ab-content{font-size:1.05rem;line-height:1.75;color:var(--text);max-width:none}
.article-body .ab-content h2{font-size:calc(1.55rem * var(--scale, 1.2));margin:36px 0 12px;letter-spacing:-.01em;scroll-margin-top:120px}
.article-body .ab-content h3{font-size:calc(1.2rem * var(--scale, 1.2));margin:26px 0 10px;scroll-margin-top:120px}
.article-body .ab-content :where(p,ul,ol){margin-bottom:1.1em}
.article-body .ab-content :where(ul,ol){padding-left:1.4em}
.article-body .ab-content a{color:var(--primary);text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1.5px}
.article-body .ab-content img{display:block;width:100%;height:auto!important;border-radius:var(--card-r);margin:18px 0;object-fit:cover}
.article-body .ab-content :where(figure,p) img{margin:0}
.article-body .ab-content figure{margin:18px 0}
.article-body .ab-content figure img{width:100%}
.article-body .ab-content .ab-fig{margin:24px 0 6px}
.article-body .ab-content .ab-fig img{width:100%;height:auto;border-radius:var(--card-r);aspect-ratio:16/9;object-fit:cover}
.article-body .ab-content blockquote{border-left:3px solid var(--primary);padding:2px 0 2px 18px;margin:20px 0;font-style:italic;color:color-mix(in srgb, var(--text) 82%, transparent)}
.article-body .ab-side{position:sticky;top:96px;display:flex;flex-direction:column;gap:14px}
.article-body .ab-card{background:var(--surface);border:1px solid color-mix(in srgb, var(--text) 8%, transparent);border-radius:var(--card-r);padding:18px}
.article-body .ab-card h4{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:color-mix(in srgb, var(--text) 60%, transparent);margin-bottom:12px}
.article-body .ab-card p{font-size:.94rem;line-height:1.5;color:color-mix(in srgb, var(--text) 82%, transparent);margin-bottom:12px}
.article-body .ab-card .btn{padding:9px 16px;font-size:.9rem}
.article-body .ab-toc ul{list-style:none;margin:0;padding:0}
.article-body .ab-toc li{margin:6px 0}
.article-body .ab-toc li.lv-3{padding-left:14px}
.article-body .ab-toc a{color:color-mix(in srgb, var(--text) 75%, transparent);text-decoration:none;font-size:.92rem;line-height:1.4}
.article-body .ab-toc a:hover{color:var(--primary)}
.article-body .ab-card-related ul{list-style:none;margin:0;padding:0}
.article-body .ab-card-related li{margin:6px 0}
.article-body .ab-card-related a{color:var(--text);font-size:.94rem;text-decoration:none}
.article-body .ab-card-related a:hover{color:var(--primary)}
@media(max-width:900px){.article-body .grid{grid-template-columns:1fr;gap:32px}.article-body .ab-side{position:static;top:auto}}

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
.program-cards.pc-square .pc-top{aspect-ratio:1/1}
.program-cards.pc-portrait .pc-top{aspect-ratio:3/4}
.program-cards.pc-contain .pc-top{background-size:contain;background-repeat:no-repeat;background-color:color-mix(in srgb,var(--primary) 6%,var(--surface))}
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

/* timeline — vertical spine with dotted markers */
.timeline .head{text-align:center;max-width:640px;margin:0 auto 40px}
.timeline .tl-list{list-style:none;margin:0 auto;padding:0;max-width:760px;position:relative}
.timeline .tl-list::before{content:"";position:absolute;left:11px;top:6px;bottom:6px;width:2px;background:color-mix(in srgb, var(--primary) 22%, transparent)}
.timeline .tl-item{position:relative;padding:0 0 30px 44px}
.timeline .tl-item:last-child{padding-bottom:0}
.timeline .tl-dot{position:absolute;left:3px;top:4px;width:18px;height:18px;border-radius:50%;background:var(--surface);border:3px solid var(--primary);box-shadow:0 0 0 4px color-mix(in srgb, var(--primary) 12%, transparent)}
.timeline .tl-marker{display:inline-block;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--primary);background:color-mix(in srgb, var(--primary) 10%, transparent);padding:3px 9px;border-radius:999px;margin-bottom:8px}
.timeline .tl-content h3{font-size:calc(1.15rem * var(--scale, 1.2));margin:0 0 4px;letter-spacing:-.01em}
.timeline .tl-content p{margin:0;color:color-mix(in srgb, var(--text) 78%, transparent);line-height:1.6}

/* gallery — uniform grid or editorial bento */
.gallery .head{text-align:center;max-width:640px;margin:0 auto 34px}
.gallery .g-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.gallery .g-tile{margin:0;position:relative;overflow:hidden;border-radius:var(--card-r);background:color-mix(in srgb, var(--text) 5%, transparent);aspect-ratio:4/3}
.gallery .g-tile img{width:100%;height:100%;object-fit:cover;display:block}
.gallery .g-tile .g-ph{width:100%;height:100%;background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--primary) 8%,transparent) 0 12px,transparent 12px 24px)}
.gallery .g-tile figcaption{position:absolute;left:0;right:0;bottom:0;padding:18px 14px 10px;font-size:.82rem;color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.6))}
.gallery.is-bento .g-grid{grid-auto-rows:180px;grid-auto-flow:dense}
.gallery.is-bento .g-tile{aspect-ratio:auto}
.gallery.is-bento .g-b1{grid-column:span 2;grid-row:span 2}
.gallery.is-bento .g-b4{grid-row:span 2}
@media(max-width:760px){
  .gallery .g-grid,.gallery.is-bento .g-grid{grid-template-columns:repeat(2,1fr);grid-auto-rows:140px}
  .gallery.is-bento .g-b1{grid-column:span 2}
}
@media(max-width:460px){
  .gallery .g-grid,.gallery.is-bento .g-grid{grid-template-columns:1fr;grid-auto-rows:auto}
  .gallery.is-bento .g-tile{grid-column:auto!important;grid-row:auto!important;aspect-ratio:4/3}
  .timeline .tl-item{padding-left:38px}
}

/* features-2col */
.features-2col .head{text-align:center;max-width:640px;margin:0 auto 40px}
.features-2col .f2-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}
.features-2col .f2-col{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--card-r);padding:32px;box-shadow:var(--shadow)}
.features-2col .f2-icon{font-size:2rem;margin-bottom:14px}
.features-2col .f2-col h3{font-size:calc(1.35rem * var(--scale,1.2));margin:0 0 10px;letter-spacing:-.01em}
.features-2col .f2-col p{margin:0;color:color-mix(in srgb,var(--text) 78%,transparent);line-height:1.65}
@media(max-width:720px){.features-2col .f2-grid{grid-template-columns:1fr}.features-2col .f2-col{padding:24px}}

/* feature-alt — alternating image/text rows */
.feature-alt .head{text-align:center;max-width:640px;margin:0 auto 44px}
.feature-alt .fa-rows{display:flex;flex-direction:column;gap:64px}
.feature-alt .fa-row{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.feature-alt .fa-row.rev .fa-txt{order:2}
.feature-alt .fa-txt h3{font-size:calc(1.7rem * var(--scale,1.2));margin:0 0 12px;letter-spacing:-.015em}
.feature-alt .fa-txt p{margin:0 0 16px;color:color-mix(in srgb,var(--text) 78%,transparent);line-height:1.7;font-size:1.05rem}
.feature-alt .fa-media img{width:100%;height:auto;border-radius:calc(var(--card-r) + 2px);box-shadow:var(--shadow)}
.feature-alt .fa-media.fa-ph{aspect-ratio:4/3;border-radius:calc(var(--card-r) + 2px);background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--primary) 8%,transparent) 0 14px,transparent 14px 28px)}
.btn-ghost-link{display:inline-block;color:var(--primary);font-weight:600;text-decoration:none}
.btn-ghost-link:hover{text-decoration:underline}
@media(max-width:760px){.feature-alt .fa-row,.feature-alt .fa-row.rev{grid-template-columns:1fr;gap:24px}.feature-alt .fa-row.rev .fa-txt{order:0}.feature-alt .fa-rows{gap:44px}}

/* split-hero */
.split-hero{padding:0}
.split-hero .sh-grid{display:grid;grid-template-columns:1fr 1fr;min-height:min(78vh,640px)}
.split-hero .sh-txt{background:var(--primary);color:#fff;display:flex;align-items:center;padding:64px}
.split-hero .sh-txt-inner{max-width:520px;margin-left:auto}
.split-hero .sh-txt .eyebrow{color:#fff;opacity:.85}
.split-hero .sh-txt h1{font-size:clamp(2rem,4.5vw,calc(3rem * var(--scale,1.2)));line-height:1.05;letter-spacing:-.02em;margin:0 0 18px;color:#fff}
.split-hero .sh-txt .sub{font-size:1.15rem;line-height:1.55;opacity:.92;margin:0 0 26px}
.split-hero .sh-txt .actions{display:flex;gap:12px;flex-wrap:wrap}
.split-hero .sh-txt .btn{background:#fff;color:var(--primary)}
.split-hero .sh-txt .btn-outline{background:transparent;color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.6)}
.split-hero .sh-media img,.split-hero .sh-media.sh-ph{width:100%;height:100%;object-fit:cover;min-height:320px}
.split-hero .sh-media.sh-ph{background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--accent) 20%,var(--primary)) 0 20px,color-mix(in srgb,var(--primary) 80%,#000) 20px 40px)}
@media(max-width:820px){.split-hero .sh-grid{grid-template-columns:1fr}.split-hero .sh-txt{padding:48px 24px;order:2}.split-hero .sh-txt-inner{margin:0}.split-hero .sh-media{min-height:260px}}

/* bento-grid */
.bento-grid .head{text-align:center;max-width:640px;margin:0 auto 34px}
.bento-grid .bento{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(150px,auto);gap:16px}
.bento-grid .bento-tile{border-radius:var(--card-r);padding:24px;display:flex;flex-direction:column;justify-content:center;border:1px solid color-mix(in srgb,var(--text) 8%,transparent);overflow:hidden}
.bento-grid .bento-lg{grid-column:span 2;grid-row:span 2}
.bento-grid .bento-stat{background:var(--primary);color:#fff;align-items:flex-start}
.bento-grid .bento-val{font-size:2.4rem;font-weight:800;line-height:1;letter-spacing:-.02em}
.bento-grid .bento-lbl{margin-top:8px;opacity:.9;font-size:.9rem}
.bento-grid .bento-text{background:var(--surface)}
.bento-grid .bento-text h3{margin:0 0 6px;font-size:1.15rem;letter-spacing:-.01em}
.bento-grid .bento-text p{margin:0;color:color-mix(in srgb,var(--text) 76%,transparent);line-height:1.5;font-size:.95rem}
.bento-grid .bento-img{background-size:cover;background-position:center;background-color:color-mix(in srgb,var(--text) 6%,transparent);position:relative;justify-content:flex-end}
.bento-grid .bento-cap{color:#fff;font-size:.85rem;text-shadow:0 1px 6px rgba(0,0,0,.5)}
@media(max-width:760px){.bento-grid .bento{grid-template-columns:repeat(2,1fr)}.bento-grid .bento-lg{grid-column:span 2;grid-row:auto}}
@media(max-width:460px){.bento-grid .bento{grid-template-columns:1fr}.bento-grid .bento-lg{grid-column:auto}}

/* carousel-cards — horizontal scroll-snap slider */
.carousel-cards .car-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:24px}
.carousel-cards .car-controls{display:flex;gap:8px;flex:0 0 auto}
.carousel-cards .car-arrow{width:40px;height:40px;border-radius:50%;border:1px solid color-mix(in srgb,var(--text) 14%,transparent);background:var(--surface);color:var(--text);font-size:20px;line-height:1;cursor:pointer;transition:.15s}
.carousel-cards .car-arrow:hover{background:var(--primary);color:#fff;border-color:var(--primary)}
.carousel-cards .car-track{display:flex;gap:20px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 4px 16px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.carousel-cards .car-track::-webkit-scrollbar{display:none}
.carousel-cards .car-card{flex:0 0 calc((100% - (var(--car-visible) - 1) * 20px) / var(--car-visible));scroll-snap-align:start;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--card-r);overflow:hidden;box-shadow:var(--shadow)}
.carousel-cards .car-media img,.carousel-cards .car-media.car-ph{width:100%;aspect-ratio:16/10;object-fit:cover;display:block}
.carousel-cards .car-media.car-ph{background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--primary) 8%,transparent) 0 12px,transparent 12px 24px)}
.carousel-cards .car-body{padding:20px}
.carousel-cards .car-body h3{margin:0 0 8px;font-size:1.2rem;letter-spacing:-.01em}
.carousel-cards .car-body p{margin:0 0 12px;color:color-mix(in srgb,var(--text) 76%,transparent);line-height:1.55;font-size:.95rem}
@media(max-width:900px){.carousel-cards .car-card{flex-basis:calc((100% - 20px) / 2)}}
@media(max-width:560px){.carousel-cards .car-card{flex-basis:84%}.carousel-cards .car-controls{display:none}}

/* faq-accordion */
.faq-accordion .container{max-width:820px}
.faq-accordion .head{text-align:center;margin-bottom:32px}
.faq-accordion .faq-item{border:1px solid color-mix(in srgb,var(--text) 10%,transparent);border-radius:var(--card-r);margin-bottom:10px;background:var(--surface);overflow:hidden}
.faq-accordion .faq-item summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;cursor:pointer;font-weight:600;font-size:1.05rem;list-style:none}
.faq-accordion .faq-item summary::-webkit-details-marker{display:none}
.faq-accordion .faq-ico{flex:0 0 auto;font-size:1.2rem;color:var(--primary);transition:transform .2s}
.faq-accordion .faq-item[open] .faq-ico{transform:rotate(45deg)}
.faq-accordion .faq-a{padding:0 20px 20px;color:color-mix(in srgb,var(--text) 80%,transparent);line-height:1.65}
.faq-accordion .faq-a p{margin:0}

/* big-quote */
.big-quote figure{max-width:900px;margin:0 auto;text-align:center}
.big-quote blockquote{font-size:clamp(1.4rem,3.2vw,2.1rem);line-height:1.4;letter-spacing:-.01em;font-weight:500;margin:0 0 28px;color:var(--text);position:relative}
.big-quote blockquote::before{content:"\\201C";display:block;font-size:4rem;line-height:.6;color:var(--primary);opacity:.4;margin-bottom:8px}
.big-quote .bq-who{display:inline-flex;align-items:center;gap:14px;text-align:left}
.big-quote .bq-portrait{width:52px;height:52px;border-radius:50%;object-fit:cover}
.big-quote .bq-who b{display:block;font-size:1rem}
.big-quote .bq-who span{display:block;font-size:.9rem;color:color-mix(in srgb,var(--text) 60%,transparent)}

/* post-list — auto blog index */
.post-list .head{max-width:640px;margin:0 auto 34px;text-align:center}
.post-list .pl-empty{text-align:center;color:color-mix(in srgb,var(--text) 55%,transparent);padding:40px;border:1px dashed color-mix(in srgb,var(--text) 18%,transparent);border-radius:var(--card-r)}
.post-list .pl-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.post-list .pl-card{display:flex;flex-direction:column;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--card-r);overflow:hidden;text-decoration:none;color:var(--text);box-shadow:var(--shadow);transition:transform .18s ease, box-shadow .18s ease}
.post-list .pl-card:hover{transform:translateY(-4px);box-shadow:0 16px 40px -18px rgba(20,10,40,.28)}
.post-list .pl-media img,.post-list .pl-media.pl-ph{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.post-list .pl-media.pl-ph{background:repeating-linear-gradient(45deg,color-mix(in srgb,var(--primary) 8%,transparent) 0 14px,transparent 14px 28px)}
.post-list .pl-body{padding:20px;display:flex;flex-direction:column;gap:8px;flex:1}
.post-list .pl-kicker{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--primary)}
.post-list .pl-body h3{margin:0;font-size:1.2rem;line-height:1.25;letter-spacing:-.01em}
.post-list .pl-body p{margin:0;color:color-mix(in srgb,var(--text) 74%,transparent);font-size:.95rem;line-height:1.55}
.post-list .pl-meta{margin-top:auto;font-size:.82rem;color:color-mix(in srgb,var(--text) 55%,transparent)}
@media(max-width:900px){.post-list .pl-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.post-list .pl-grid{grid-template-columns:1fr}}
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
    case 'article-hero': {
      const variant = ['classic', 'centered', 'boxed', 'cover', 'gradient', 'minimal'].includes(p.variant) ? p.variant : 'classic'
      const eyebrow = p.eyebrow ? `<div class="ah-kicker"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const meta = [p.author ? `By ${esc(p.author)}` : '', p.date ? esc(p.date) : '', p.readMins ? `${esc(String(p.readMins))} min read` : ''].filter(Boolean)
      const metaRow = meta.length ? `<div class="ah-meta">${meta.map((m) => `<span>${m}</span>`).join('<i>·</i>')}</div>` : ''
      const inner = `${eyebrow}<h1${f('heading')}>${esc(p.heading)}</h1>${p.sub ? `<p class="ah-deck"${f('sub')}>${esc(p.sub)}</p>` : ''}${metaRow}`
      // 'cover' = full-bleed banner image with the title overlaid;
      // 'gradient' = same overlay layout but a brand-color gradient background.
      if (variant === 'cover' || variant === 'gradient') {
        const brandVar = (k: string) => ['primary', 'accent', 'accent2', 'text'].includes(k) ? `var(--${k})` : 'var(--primary)'
        let bg = ''
        if (variant === 'gradient') {
          bg = ` style="background-image:linear-gradient(135deg, ${brandVar(p.grad_from || 'primary')}, ${brandVar(p.grad_to || 'accent')})"`
        } else if (p.image_url) {
          // Layered overlay: light wash at the TOP (contrast for the logo/menu),
          // and a stronger dark gradient toward the BOTTOM-LEFT (where the title
          // sits) — ~20% darker than before for legible left-aligned text.
          bg = ` style="background-image:linear-gradient(to bottom, rgba(255,255,255,.6), rgba(255,255,255,0) 16%),linear-gradient(to top right, rgba(0,0,0,.82), rgba(0,0,0,.38) 46%, rgba(0,0,0,.06) 74%),url('${esc(p.image_url)}')"`
        }
        const noimg = variant === 'cover' && !p.image_url ? ' ah-cover-noimg' : ''
        return `<section class="article-hero ah-cover${noimg}"${bg}><div class="container"><div class="ah-inner">${inner}</div></div></section>`
      }
      const banner = (variant !== 'minimal' && p.image_url) ? `<div class="ah-banner"><img src="${esc(p.image_url)}" alt="${esc(p.image_alt || '')}" loading="eager"></div>` : ''
      return `<section class="article-hero ah-${variant}"><div class="container"><div class="ah-inner">${inner}</div>${banner}</div></section>`
    }
    case 'article-body': {
      // Build a Table of Contents from the h2/h3 in the body HTML. Also
      // guarantees each heading has an id (for anchor jump + SEO deep-links).
      let body = String(p.html || '')
      const toc: Array<{ level: 2 | 3; id: string; text: string }> = []
      const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      body = body.replace(/<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi, (_m, lv, attrs, inner) => {
        const text = String(inner).replace(/<[^>]*>/g, '').trim()
        const idAttr = /id=["']([^"']+)["']/i.exec(attrs || '')
        const id = idAttr?.[1] || slugify(text) || `h-${toc.length + 1}`
        toc.push({ level: Number(lv) as 2 | 3, id, text })
        const cleanedAttrs = (attrs || '').replace(/\sid=["'][^"']+["']/i, '')
        return `<h${lv}${cleanedAttrs} id="${id}">${inner}</h${lv}>`
      })
      const wantToc = p.toc !== false && toc.length > 1
      // TOC is now INLINE at the top of the article (collapsible), not in the
      // sidebar. The sidebar is reserved for a CTA + newsletter signup.
      const tocInline = wantToc ? `<details class="ab-toc-inline" open><summary>On this page</summary><nav aria-label="Table of contents"><ul>${toc.map((t) => `<li class="lv-${t.level}"><a href="#${esc(t.id)}">${esc(t.text)}</a></li>`).join('')}</ul></nav></details>` : ''
      // Sidebar cards. Reserved kinds: cta, newsletter, author, related.
      const sidebar = (Array.isArray(p.sidebar) ? p.sidebar : []).map((c: any) => {
        if (c?.kind === 'toc') return ''  // TOC moved inline — ignore legacy toc cards
        if (c?.kind === 'newsletter') {
          return `<aside class="ab-card ab-card-news"><h4>${esc(c.title || 'Newsletter')}</h4>${c.text ? `<p>${esc(c.text)}</p>` : ''}<form class="ab-news-form uw-newsletter"><input type="email" name="email" placeholder="${esc(c.placeholder || 'you@email.com')}" required aria-label="Email"><button type="submit" class="btn">${esc(c.cta_label || 'Subscribe')}</button></form><p class="nl-msg" hidden></p></aside>`
        }
        if (c?.kind === 'related') return `<aside class="ab-card ab-card-related"><h4>${esc(c.title || 'Related')}</h4><ul>${(Array.isArray(c.items) ? c.items : []).map((it: any) => `<li><a href="${esc(it.href || '#')}">${esc(it.label || '')}</a></li>`).join('')}</ul></aside>`
        // generic / cta / author card
        const cta = c?.cta_label ? `<a class="btn" href="${esc(c.cta_href || '#')}">${esc(c.cta_label)}</a>` : ''
        const cls = c?.kind === 'cta' ? ' ab-card-cta' : ''
        return `<aside class="ab-card${cls}"><h4>${esc(c?.title || '')}</h4>${c?.text ? `<p>${esc(c.text)}</p>` : ''}${cta}</aside>`
      }).join('')
      // Schema.org JSON-LD (Article) — headline is filled in publish.ts head too.
      const jsonLd = `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': 'Article', headline: p.headline || undefined, author: p.author ? { '@type': 'Person', name: p.author } : undefined, datePublished: p.publishedAt || undefined,
      }).replace(/</g, '\\u003c')}</script>`
      return `<section class="article-body"><div class="container"><div class="grid"><article class="ab-main">${tocInline}<div class="ab-content rt">${body}</div>${jsonLd}</article><div class="ab-side">${sidebar}</div></div></div></section>`
    }
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
    case 'features-4': {
      const isImg = p.variant === 'images'
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 4)
      const grid = items.map((it: any) => {
        const top = isImg
          ? (it.image_url ? `<div class="f4-img" style="background-image:url('${esc(it.image_url)}')"></div>` : `<div class="f4-img f4-img-empty"></div>`)
          : (it.icon ? `<div class="icon">${esc(it.icon)}</div>` : '')
        return `<div class="item">${top}<div class="f4-txt"><h3>${esc(it.title)}</h3><p>${esc(it.desc)}</p></div></div>`
      }).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow">${esc(p.eyebrow)}</div>` : ''
      return `<section class="features-4${isImg ? ' v-images' : ''}"><div class="container"><div class="head">${eyebrow}<h2${f('heading')}>${esc(p.heading)}</h2>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div><div class="grid">${grid}</div></div></section>`
    }
    case 'testimonials-slider': {
      const items = (Array.isArray(p.items) ? p.items : []).filter((it: any) => it && it.quote).slice(0, 16)
      const cards = items.map((it: any) => {
        const n = Math.max(0, Math.min(5, Number(it.rating) || 0))
        const stars = n ? `<div class="stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</div>` : ''
        const initial = esc(String(it.author || '?').trim().charAt(0).toUpperCase())
        return `<div class="tss-card">${stars}<p class="quote">${esc(it.quote)}</p><div class="who"><span class="av" aria-hidden="true">${initial}</span><div><b>${esc(it.author)}</b>${it.role ? `<span>${esc(it.role)}</span>` : ''}</div></div></div>`
      }).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const head = (p.heading || eyebrow) ? `<div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div>` : ''
      const ctrls = items.length > 3 ? `<div class="tss-ctrls"><button type="button" class="tss-arrow" data-dir="-1" aria-label="Previous">‹</button><button type="button" class="tss-arrow" data-dir="1" aria-label="Next">›</button></div>` : ''
      // data-uw-gsap makes publish.ts load GSAP + the slider init once per page.
      return `<section class="testimonials-slider" data-uw-gsap${p.autoplay === false ? '' : ' data-autoplay="1"'}><div class="container"><div class="tss-top">${head}${ctrls}</div><div class="tss-viewport"><div class="tss-track">${cards}</div></div></div></section>`
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
      // image_shape: landscape (default 16:10 crop) · square (1:1) · portrait
      // (3:4) · contain (whole image, no crop). Lets the author avoid cropping.
      const shapeCls = p.image_shape === 'square' ? ' pc-square' : p.image_shape === 'portrait' ? ' pc-portrait' : p.image_shape === 'contain' ? ' pc-contain' : ''
      return `<section class="program-cards${shapeCls}"><div class="container">${head}<div class="grid">${cards}</div></div></section>`
    }
    case 'stats-band': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 4)
      const cells = items.map((it: any) => `<div class="sb-stat"><div class="sb-val">${esc(it.value)}</div><div class="sb-lbl">${esc(it.label)}</div></div>`).join('')
      return `<section class="stats-band"><div class="container"><div class="sb-box">${cells}</div></div></section>`
    }
    case 'timeline': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 8)
      const rows = items.map((it: any) => `<li class="tl-item"><div class="tl-dot"></div><div class="tl-content">${it.marker ? `<div class="tl-marker">${esc(it.marker)}</div>` : ''}${it.title ? `<h3>${esc(it.title)}</h3>` : ''}${it.desc ? `<p>${esc(it.desc)}</p>` : ''}</div></li>`).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const head = (p.heading || eyebrow) ? `<div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div>` : ''
      return `<section class="timeline"><div class="container">${head}<ul class="tl-list">${rows}</ul></div></section>`
    }
    case 'gallery': {
      const bento = p.layout === 'bento'
      const items = (Array.isArray(p.items) ? p.items : []).filter((it: any) => it && (it.image_url || it.caption)).slice(0, bento ? 7 : 12)
      const tiles = items.map((it: any, i: number) => {
        const cls = bento ? ` g-b${(i % 6) + 1}` : ''
        const img = it.image_url
          ? `<img src="${esc(it.image_url)}" alt="${esc(it.caption || '')}" loading="lazy">`
          : `<div class="g-ph" aria-hidden="true"></div>`
        const cap = it.caption ? `<figcaption>${esc(it.caption)}</figcaption>` : ''
        return `<figure class="g-tile${cls}">${img}${cap}</figure>`
      }).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const head = (p.heading || eyebrow) ? `<div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div>` : ''
      return `<section class="gallery${bento ? ' is-bento' : ''}"><div class="container">${head}<div class="g-grid">${tiles}</div></div></section>`
    }
    case 'features-2col': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 2)
      const cols = items.map((it: any) => `<div class="f2-col">${it.icon ? `<div class="f2-icon">${esc(it.icon)}</div>` : ''}<h3>${esc(it.title)}</h3>${it.desc ? `<p>${esc(it.desc)}</p>` : ''}</div>`).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const head = (p.heading || eyebrow) ? `<div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}</div>` : ''
      return `<section class="features-2col" data-anim="stagger"><div class="container">${head}<div class="f2-grid">${cols}</div></div></section>`
    }
    case 'feature-alt': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 5)
      const rows = items.map((it: any, i: number) => {
        const media = it.image_url ? `<div class="fa-media"><img src="${esc(it.image_url)}" alt="${esc(it.image_alt || it.title || '')}" loading="lazy"></div>` : `<div class="fa-media fa-ph"></div>`
        const txt = `<div class="fa-txt">${it.eyebrow ? `<div class="eyebrow">${esc(it.eyebrow)}</div>` : ''}<h3>${esc(it.title)}</h3>${it.desc ? `<p>${esc(it.desc)}</p>` : ''}${it.cta_label ? `<a class="btn btn-ghost-link" href="${esc(it.cta_href || '#')}">${esc(it.cta_label)} →</a>` : ''}</div>`
        return `<div class="fa-row${i % 2 ? ' rev' : ''}" data-anim="fade-up">${txt}${media}</div>`
      }).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const head = (p.heading || eyebrow) ? `<div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}</div>` : ''
      return `<section class="feature-alt"><div class="container">${head}<div class="fa-rows">${rows}</div></div></section>`
    }
    case 'split-hero': {
      const ctas = [
        p.cta_label ? `<a class="btn" href="${esc(p.cta_href || '#')}">${esc(p.cta_label)}</a>` : '',
        p.cta2_label ? `<a class="btn btn-outline" href="${esc(p.cta2_href || '#')}">${esc(p.cta2_label)}</a>` : '',
      ].filter(Boolean).join('')
      // Colour of the TEXT panel (the big solid colour block) from the BRAND
      // palette. primary (default) / accent / accent2 → solid; gradient →
      // primary→accent. Text stays white, so keep to saturated brand colours.
      const bgKey = p.bg
      const txtStyle = bgKey === 'gradient'
        ? ` style="background-image:linear-gradient(135deg,var(--primary),var(--accent))"`
        : (['primary', 'accent', 'accent2'].includes(bgKey) ? ` style="background:var(--${bgKey})"` : '')
      const media = p.image_url
        ? `<div class="sh-media"><img src="${esc(p.image_url)}" alt="${esc(p.image_alt || '')}" loading="eager"></div>`
        : `<div class="sh-media sh-ph"></div>`
      return `<section class="split-hero"><div class="sh-grid"><div class="sh-txt"${txtStyle}><div class="sh-txt-inner">${p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''}<h1${f('heading')}>${esc(p.heading)}</h1>${p.sub ? `<p class="sub"${f('sub')}>${esc(p.sub)}</p>` : ''}${ctas ? `<div class="actions">${ctas}</div>` : ''}</div></div>${media}</div></section>`
    }
    case 'bento-grid': {
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 7)
      const tiles = items.map((it: any, i: number) => {
        const span = i === 0 ? ' bento-lg' : ''
        if (it.kind === 'stat') return `<div class="bento-tile bento-stat${span}"><div class="bento-val">${esc(it.value)}</div><div class="bento-lbl">${esc(it.label)}</div></div>`
        if (it.kind === 'image') return `<div class="bento-tile bento-img${span}"${it.image_url ? ` style="background-image:url('${esc(it.image_url)}')"` : ''}>${it.caption ? `<span class="bento-cap">${esc(it.caption)}</span>` : ''}</div>`
        return `<div class="bento-tile bento-text${span}">${it.title ? `<h3>${esc(it.title)}</h3>` : ''}${it.desc ? `<p>${esc(it.desc)}</p>` : ''}</div>`
      }).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const head = (p.heading || eyebrow) ? `<div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}</div>` : ''
      return `<section class="bento-grid" data-anim="stagger"><div class="container">${head}<div class="bento">${tiles}</div></div></section>`
    }
    case 'carousel-cards': {
      const visible = Math.max(1, Math.min(4, Number(p.visible) || 3))
      const items = (Array.isArray(p.items) ? p.items : []).slice(0, 20)
      const cards = items.map((it: any) => {
        const media = it.image_url ? `<div class="car-media"><img src="${esc(it.image_url)}" alt="${esc(it.title || '')}" loading="lazy"></div>` : `<div class="car-media car-ph"></div>`
        const cta = it.cta_label ? `<a class="btn btn-ghost-link" href="${esc(it.cta_href || '#')}">${esc(it.cta_label)} →</a>` : ''
        return `<div class="car-card">${media}<div class="car-body">${it.title ? `<h3>${esc(it.title)}</h3>` : ''}${it.desc ? `<p>${esc(it.desc)}</p>` : ''}${cta}</div></div>`
      }).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const controls = `<div class="car-controls"><button type="button" class="car-arrow" aria-label="Previous" onclick="this.closest('.carousel-cards').querySelector('.car-track').scrollBy({left:-360,behavior:'smooth'})">‹</button><button type="button" class="car-arrow" aria-label="Next" onclick="this.closest('.carousel-cards').querySelector('.car-track').scrollBy({left:360,behavior:'smooth'})">›</button></div>`
      const head = `<div class="head car-head">${(eyebrow || p.heading) ? `<div>${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}</div>` : '<div></div>'}${items.length > visible ? controls : ''}</div>`
      return `<section class="carousel-cards" style="--car-visible:${visible}"><div class="container">${head}<div class="car-track">${cards}</div></div></section>`
    }
    case 'faq-accordion': {
      const items = (Array.isArray(p.items) ? p.items : []).filter((it: any) => it && (it.q || it.a)).slice(0, 20)
      const rows = items.map((it: any) => `<details class="faq-item"><summary>${esc(it.q)}<span class="faq-ico" aria-hidden="true">＋</span></summary><div class="faq-a"><p>${esc(it.a)}</p></div></details>`).join('')
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const head = (p.heading || eyebrow) ? `<div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}</div>` : ''
      const jsonLd = items.length ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map((it: any) => ({ '@type': 'Question', name: String(it.q || ''), acceptedAnswer: { '@type': 'Answer', text: String(it.a || '') } })) }).replace(/</g, '\\u003c')}</script>` : ''
      return `<section class="faq-accordion"><div class="container">${head}<div class="faq-list">${rows}</div>${jsonLd}</div></section>`
    }
    case 'big-quote': {
      const portrait = p.image_url ? `<img class="bq-portrait" src="${esc(p.image_url)}" alt="${esc(p.author || '')}" loading="lazy">` : ''
      const who = (p.author || p.role) ? `<div class="bq-who">${portrait}<div>${p.author ? `<b${f('author')}>${esc(p.author)}</b>` : ''}${p.role ? `<span${f('role')}>${esc(p.role)}</span>` : ''}</div></div>` : ''
      return `<section class="big-quote" data-anim="fade-up"><div class="container"><figure><blockquote${f('quote')}>${esc(p.quote)}</blockquote>${who ? `<figcaption>${who}</figcaption>` : ''}</figure></div></section>`
    }
    case 'cta-ref': {
      // Resolution (publish.ts) fills heading/sub/cta_label/cta_href from the CTA
      // library. Renders identically to a cta-banner. If unresolved + empty, show
      // a subtle placeholder in edit mode so the author knows a CTA will appear.
      if (!p.cta_label && !p.heading) {
        return ed ? `<section class="cta-banner"><div class="container"><div class="box"><div class="cta-inner"><h2>Smart CTA</h2><p class="sub">Pulls from your CTA library (Website → CTAs) when published.</p></div></div></div></section>` : ''
      }
      const solid = p.variant === 'solid' ? ' v-solid' : ''
      return `<section class="cta-banner${solid}"><div class="container"><div class="box"><span class="cta-orb cta-orb-1"></span><span class="cta-orb cta-orb-2"></span><div class="cta-inner">${p.heading ? `<h2>${esc(p.heading)}</h2>` : ''}${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ''}${p.cta_label ? `<p><a class="btn" href="${esc(p.cta_href || '#')}">${esc(p.cta_label)}</a></p>` : ''}</div></div></div></section>`
    }
    case 'post-list': {
      // items are injected at render time (publish.ts) from the site's articles.
      const items = (Array.isArray(p.items) ? p.items : [])
      const eyebrow = p.eyebrow ? `<div class="eyebrow"${f('eyebrow')}>${esc(p.eyebrow)}</div>` : ''
      const head = (p.heading || eyebrow) ? `<div class="head">${eyebrow}${p.heading ? `<h2${f('heading')}>${esc(p.heading)}</h2>` : ''}</div>` : ''
      if (!items.length) {
        return ed ? `<section class="post-list"><div class="container">${head}<div class="pl-empty">Your articles will appear here automatically once published.</div></div></section>` : `<section class="post-list"><div class="container">${head}</div></section>`
      }
      const cards = items.map((it: any) => {
        const media = it.image ? `<div class="pl-media"><img src="${esc(it.image)}" alt="${esc(it.title || '')}" loading="lazy"></div>` : `<div class="pl-media pl-ph"></div>`
        const meta = [it.date, it.readMins ? `${esc(String(it.readMins))} min` : ''].filter(Boolean).map((m: string) => esc(m)).join(' · ')
        return `<a class="pl-card" href="${esc(it.url || '#')}">${media}<div class="pl-body">${it.eyebrow ? `<div class="pl-kicker">${esc(it.eyebrow)}</div>` : ''}<h3>${esc(it.title)}</h3>${it.excerpt ? `<p>${esc(it.excerpt)}</p>` : ''}${meta ? `<div class="pl-meta">${meta}</div>` : ''}</div></a>`
      }).join('')
      return `<section class="post-list" data-anim="stagger"><div class="container">${head}<div class="pl-grid">${cards}</div></div></section>`
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
