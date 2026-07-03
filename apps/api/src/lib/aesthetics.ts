// Named-aesthetic library — gives Claude an opinionated frame to fill instead
// of a blank prompt. Each entry bundles a palette + typography + copy voice +
// preferred section roster + motion vocabulary. The AI generation routes pick
// one (auto from imported brand, or manually) and inject it into the prompt.
//
// Inspired by lovable.dev's templates library — their secret sauce isn't a
// smarter model, it's that templates are stylistically opinionated. Single
// generic "build me a website" prompts default to safe-middle mush. Naming
// the aesthetic up front forces specificity.

export type Aesthetic = {
  slug: string
  name: string
  tagline: string
  industries: string[]               // keyword hints for auto-pick (lowercased nav text matches)
  industriesRegex?: RegExp           // optional richer match
  vibe: string                       // prose for the system prompt
  copyVoice: string                  // how copy should READ
  forbid: string                     // explicit don'ts for this aesthetic
  preferredSections: string[]        // section kinds the AI should reach for first
  paletteHints: { primary: string; accent: string; surface?: string; text?: string }
  // If the imported brand has bland defaults (WP red/blue, undefined), we can
  // suggest swapping to these. We DO NOT overwrite when real brand colors exist.
  motion: string                     // motion vocabulary string for the prompt (info only — renderer doesn't animate yet)
}

export const AESTHETICS: Aesthetic[] = [
  {
    slug: 'lyric',
    name: 'Lyric',
    tagline: 'Warm, playful, family-friendly',
    industries: ['kids', 'children', 'family', 'school', 'kindergarten', 'preschool', 'learning', 'education', 'camp', 'tabara', 'cursuri', 'jucarii', 'pediatric', 'parent'],
    vibe: 'Warm, optimistic, slightly playful — like a friendly neighborhood brand. Rounded shapes, soft pastels accented by a stronger primary, generous whitespace. Heroes feel inviting, not corporate. Photography over abstract imagery; show real people doing the thing.',
    copyVoice: 'Conversational and concrete. Talks TO a parent / a learner, not ABOUT the company. Short sentences. Specific outcomes ("Your child reads German fairy tales by month three"), not abstractions ("World-class language education"). One exclamation max per page; everything else is calm confidence.',
    forbid: 'No corporate-speak. No "world-class", "premier", "leading provider". No buzzword soup.',
    preferredSections: ['hero-image', 'features-3', 'testimonials-3', 'stats-row', 'image-text', 'faq', 'cta-banner'],
    paletteHints: { primary: '#F9B716', accent: '#702F8F' },
    motion: 'Gentle entrance fades. No marquees, no count-ups, no glitch effects.',
  },
  {
    slug: 'apex',
    name: 'Apex',
    tagline: 'Professional, navy + serif, authority',
    industries: ['law', 'attorney', 'firm', 'legal', 'lawyer', 'consultancy', 'consulting', 'accountant', 'cpa', 'tax', 'audit', 'financial advisor', 'wealth', 'insurance'],
    vibe: 'Serious and authoritative. Navy or deep forest with restrained accent. Serif headlines, clean sans body. Sparse imagery — when present, full-bleed gradient-overlaid portraits of the team. Lots of whitespace; nothing decorative. Credentials, case results, and named partners win over slogans.',
    copyVoice: 'Measured, precise, never glib. Claims are concrete and verifiable ("Recovered $4.2M for clients in 2024" not "Top-rated firm"). Subheads name the audience\'s problem ("For founders facing investor disputes"). No exclamation marks. Buttons are verbs: "Request a consultation", "Read our 2024 results".',
    forbid: 'No emoji. No "passionate about". No casual contractions in headlines. No pricing tiers (this isn\'t SaaS).',
    preferredSections: ['hero', 'features-3', 'stats-row', 'testimonials-3', 'image-text', 'faq', 'cta-banner'],
    paletteHints: { primary: '#16324A', accent: '#A47C3F' },
    motion: 'No motion above the fold. Optional scroll-fade for body sections.',
  },
  {
    slug: 'paymark',
    name: 'Paymark',
    tagline: 'Dark fintech / B2B SaaS',
    industries: ['saas', 'platform', 'api', 'fintech', 'banking', 'payment', 'crypto', 'analytics', 'dashboard', 'ai', 'agent', 'devtool', 'developer', 'database', 'infrastructure'],
    vibe: 'Dark mode by default — deep charcoal background, white text, a single coral / lime / sky accent. Sans-serif everything; consider a mono accent for numbers or code. Hero shows a real product UI mockup or screenshot, not an abstract. Stat rows with CountUp-style numbers ($M raised, ms latency, % uptime).',
    copyVoice: 'Confident, numbers-first. Every claim has a metric or a benchmark. "47ms p99 latency. Across 12 regions. Zero ops." Subheads talk to the engineer / founder, not the CMO. CTAs: "Read the docs", "See the benchmarks", "Open a sandbox".',
    forbid: 'No "innovate", "transform", "unleash". No stock photos of smiling business people. No vague benefit statements.',
    preferredSections: ['hero-image', 'logo-cloud', 'stats-row', 'features-3', 'pricing-3', 'faq', 'cta-banner'],
    paletteHints: { primary: '#0D0D10', accent: '#F26C53', surface: '#0D0D10', text: '#F4F4F5' },
    motion: 'Subtle scroll-fade. CountUp on stat numbers when in view. Optional logo-cloud marquee.',
  },
  {
    slug: 'maison',
    name: 'Maison',
    tagline: 'Editorial warm, premium home / hospitality',
    industries: ['restaurant', 'hotel', 'boutique', 'home', 'interior', 'design', 'studio', 'gallery', 'artisan', 'maison', 'patisserie', 'cafe', 'wine', 'florist'],
    vibe: 'Editorial — feels like an Apartamento spread. Cream / off-white background, terracotta or sage accent. Serif display headlines, clean sans for body. Asymmetric layouts with deliberate whitespace; full-bleed photography on alternating sides. The product or space is the hero, not the logo.',
    copyVoice: 'Quietly confident. Specific sensory nouns ("hand-glazed porcelain", "stone-baked focaccia"), not generic adjectives ("premium quality"). Short, declarative sentences. Lower-case in headlines is fine.',
    forbid: 'No corporate stock photos. No bold-italic-underline shouting. No buy-now urgency tactics.',
    preferredSections: ['hero-image', 'image-text', 'testimonials-3', 'features-3', 'logo-cloud', 'faq'],
    paletteHints: { primary: '#2B2A26', accent: '#C26F4D' },
    motion: 'Slow fades on image entrance. Nothing fast.',
  },
  {
    slug: 'aquafix',
    name: 'Aquafix',
    tagline: 'Trades & local services with transparent pricing',
    industries: ['plumb', 'electric', 'hvac', 'roof', 'clean', 'service', 'repair', 'mechanic', 'landscaping', 'tradesman', 'contractor', 'handyman', 'install', 'maintenance'],
    vibe: 'Bold, trustworthy, no-nonsense. Strong primary color block in the hero with the offer + phone number. Real photos of crews and trucks, not stock. Click-to-call as the primary CTA. Transparent pricing band ("flat rate $129 callout") is non-negotiable.',
    copyVoice: 'Direct and reassuring. Speaks to "you" not "our clients". Quantifies response time ("24/7 — usually on site within 90 min"). Money words upfront, no hidden surprises. Buttons: "Call (number) now", "Get a fixed quote".',
    forbid: 'No abstract "solutions" language. No animations that delay the phone number appearing.',
    preferredSections: ['hero', 'stats-row', 'features-3', 'testimonials-3', 'pricing-3', 'cta-banner', 'faq'],
    paletteHints: { primary: '#1664C0', accent: '#F5A623' },
    motion: 'Almost none — speed of access wins over polish.',
  },
  {
    slug: 'launchpad',
    name: 'Launchpad',
    tagline: 'Waitlist / pre-launch / single-page energy',
    industries: ['waitlist', 'beta', 'coming soon', 'pre-launch', 'early access', 'invite', 'preorder'],
    vibe: 'Single-screen first impression. Dark hero with a punchy gradient accent. Email capture above the fold, live signup counter beneath it ("3,247 founders waiting"). One sharp claim, one button, nothing else fighting for attention. Sections below the fold expand on the promise.',
    copyVoice: 'Conspiratorial — like an inside tip. Specific scarcity ("100 invites/week"). Future-tense ambition ("This is what you\'ll build"). CTAs: "Join the waitlist", "Get my invite".',
    forbid: 'No FAQ trying to sell. No pricing tiers — there\'s nothing to buy yet.',
    preferredSections: ['hero', 'features-3', 'stats-row', 'testimonials-3', 'cta-banner'],
    paletteHints: { primary: '#0D0D10', accent: '#B8FF5A' },
    motion: 'Subtle gradient drift in hero. Number CountUp on signup counter.',
  },
  {
    slug: 'stark',
    name: 'Stark',
    tagline: 'Brutalist mono — agency / portfolio',
    industries: ['agency', 'studio', 'portfolio', 'creative', 'designer', 'developer', 'freelance', 'consultant'],
    vibe: 'Mostly black and white. Oversized display type (often 8-12rem). Tight grid with deliberate left-alignment. Color, when used, is a single high-saturation accent. Photography is documentary or product-shot — never lifestyle stock. The work is the hero.',
    copyVoice: 'Terse to the point of bluntness. Fragments OK. "We build apps. That ship. Without drama." No fluff transitions. Project counts and client logos do the talking.',
    forbid: 'No gradients. No glassmorphism. No "passionate team" copy. No emoji.',
    preferredSections: ['hero', 'logo-cloud', 'image-text', 'features-3', 'stats-row', 'testimonials-3', 'cta-banner'],
    paletteHints: { primary: '#0A0A0A', accent: '#FF4D2E' },
    motion: 'Cursor-driven only. No scroll animation.',
  },
  {
    slug: 'obsidian',
    name: 'Obsidian',
    tagline: 'Dark cinematic luxury',
    industries: ['luxury', 'jewelry', 'watch', 'concierge', 'private', 'club', 'yacht', 'aviation', 'spirits', 'champagne'],
    vibe: 'Black background, gold or champagne accent. Serif display, generous tracking. Full-bleed cinema-grade imagery — often video loops. Negative space is a feature, not absence. One claim per screen.',
    copyVoice: 'Minimal. Lowercase optional. References places, makers, materials by name. "From the Haute-Vienne workshop, 1923." Never explains itself.',
    forbid: 'No pricing. No urgency tactics. No bullet lists in the hero.',
    preferredSections: ['hero-image', 'image-text', 'testimonials-3', 'features-3', 'cta-banner'],
    paletteHints: { primary: '#0A0A0A', accent: '#C9A56A', surface: '#0A0A0A', text: '#F1ECE2' },
    motion: 'Slow fades. Parallax on hero image. Nothing rapid.',
  },
]

// Auto-pick an aesthetic for a workspace based on its brand_assets (the
// extracted nav labels are the strongest industry signal) and the
// imported colors (darker palette → dark aesthetics, etc.). Returns
// the first match; falls back to Lyric (warm, broadly safe).
export function pickAesthetic(opts: { navLabels?: string[]; primary?: string | null; accent?: string | null; industryHint?: string | null }): Aesthetic {
  const text = ((opts.navLabels || []).join(' ') + ' ' + (opts.industryHint || '')).toLowerCase()
  if (text.trim()) {
    for (const a of AESTHETICS) {
      for (const kw of a.industries) {
        if (text.includes(kw)) return a
      }
    }
  }
  // Fallback by color signal — very dark primary → Paymark (B2B/saas default
  // for dark brands); otherwise Lyric (warm/broadly safe).
  if (opts.primary) {
    const m = opts.primary.match(/#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i)
    if (m) {
      const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16)
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      if (lum < 0.18) return AESTHETICS.find((a) => a.slug === 'paymark')!
    }
  }
  return AESTHETICS.find((a) => a.slug === 'lyric')!
}

export function aestheticPrompt(a: Aesthetic): string {
  return `AESTHETIC: ${a.name} — ${a.tagline}.
Vibe: ${a.vibe}
Copy voice: ${a.copyVoice}
Forbid in this aesthetic: ${a.forbid}
Preferred section roster (use these kinds first, in roughly this order): ${a.preferredSections.join(' → ')}.
Motion vocabulary (for context only, renderer is static): ${a.motion}`
}

// The BRAND is the visual authority. This prompt states the workspace's real
// colors/fonts/shape/voice, and reframes the named aesthetic as COMPOSITION +
// COPY guidance only — so the aesthetic never fights the brand. Use this in the
// generation/rebuild flows instead of aestheticPrompt() alone.
export function brandVoicePrompt(a: Aesthetic, brand: {
  colors?: { primary?: string; accent?: string; accent2?: string; surface?: string; text?: string }
  fonts?: { heading?: string; body?: string }
  shape?: { buttonRadius?: string; cardRadius?: string; shadow?: string }
  vibe?: string | null
  tagline?: string | null
  voice?: string | null
}): string {
  const c = brand.colors || {}, f = brand.fonts || {}, s = brand.shape || {}
  const shapeWord = ((): string => {
    const r = parseInt(String(s.cardRadius || '').replace(/[^0-9]/g, '') || '0', 10)
    if (r >= 20) return 'soft, very rounded corners'
    if (r >= 10) return 'gently rounded corners'
    if (r <= 3) return 'sharp, square corners'
    return 'lightly rounded corners'
  })()
  const brandLines = [
    `BRAND — THIS IS THE VISUAL AUTHORITY. Everything you design must sit inside this identity; never invent a different palette or typeface.`,
    (c.primary || c.accent) ? `• Colors: primary ${c.primary || '?'}, accent ${c.accent || '?'}${c.accent2 ? `, accent-2 ${c.accent2}` : ''}, surface ${c.surface || '#fff'}, text ${c.text || '#111'}. Use the primary for emphasis + CTAs, the accent for highlights.` : '',
    (f.heading || f.body) ? `• Type: headings in "${f.heading || '?'}", body in "${f.body || '?'}".` : '',
    `• Shape language: ${shapeWord}${s.shadow && s.shadow !== 'none' ? `, ${s.shadow} shadows` : ', minimal shadows'}.`,
    brand.vibe ? `• Overall vibe token: ${brand.vibe}.` : '',
    brand.tagline ? `• Tagline (weave the spirit of this in, don't repeat it verbatim everywhere): "${brand.tagline}".` : '',
  ].filter(Boolean).join('\n')
  const voice = (brand.voice && brand.voice.trim())
    ? `BRAND VOICE (overrides the aesthetic's default voice): ${brand.voice.trim()}`
    : `COPY VOICE: ${a.copyVoice}`
  return `${brandLines}

COMPOSITION & COPY GUIDANCE (frame: ${a.name} — ${a.tagline}). Take LAYOUT, SPACING, IMAGERY and RHYTHM cues from this; IGNORE any specific colors or fonts it names — the BRAND block above wins on all visuals.
Layout & imagery cues: ${a.vibe}
${voice}
Avoid: ${a.forbid}
Preferred section roster (reach for these first, roughly in order): ${a.preferredSections.join(' → ')}.`
}

// The mandatory copy quality rules — appended to every generation prompt.
// Concrete examples beat abstract rules; we provide both.
export const COPY_RULES = `COPY RULES (mandatory — output will be rejected if violated):
1. NEVER open a heading with: "Welcome to", "Our company", "We provide", "We are", "Helping you", "Empowering", "Discover".
2. Every <h1> contains ONE of: a specific NUMBER, a specific OUTCOME, or a specific PAIN. Examples:
     GOOD: "Stop losing 30% of leads to slow follow-up."
     GOOD: "47 SaaS founders bootstrapped past $1M with this playbook."
     GOOD: "Your child reads German fairy tales by week 12."
     BAD:  "Welcome to our marketing platform."
     BAD:  "Helping companies grow."
     BAD:  "Quality solutions for modern business."
3. Sub-headings name the AUDIENCE and the FRICTION they feel.
     GOOD: "For B2B sales teams tired of CRM theater."
     BAD:  "Our solutions for modern businesses."
4. Body copy uses concrete nouns and verbs. Banned vocabulary: leverage, utilize, unlock, empower, streamline, robust, seamless, cutting-edge, world-class, premier, best-in-class, synergy.
5. CTAs are SPECIFIC verbs that tell me what happens next.
     GOOD: "Show me the pricing"  "Generate my first page"  "Book a 20-min call"  "Read the docs"
     BAD:  "Get started"  "Learn more"  "Click here"  "Submit"
6. Numbers are concrete or omitted. "Used by 200+ teams" is fine. "Trusted by many" is not. If you don't have the number, leave the claim out entirely.
7. If you cannot fill a section with specific, vertical-appropriate content, OMIT the section. 3 strong sections > 6 thin ones.
8. richtext html: use <p>, <h2>, <h3>, <ul>, <li>, <strong>, <em>, <a> only. No inline styles, no <div>, no <script>. Keep paragraphs under 80 words.`
