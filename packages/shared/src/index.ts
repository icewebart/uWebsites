// Shared types used across api + web + website. Built first (uReferrals pattern).

export type WorkspaceRole = 'owner' | 'editor' | 'writer' | 'viewer'

export const PAGE_TYPES = [
  'home', 'service', 'location', 'hub', 'blog_index', 'article', 'category',
  'collection_item', 'about', 'contact', 'faq', 'lead_magnet', 'legal', 'thank_you',
] as const
export type PageType = (typeof PAGE_TYPES)[number]

export type AIJobKind = 'article' | 'edit' | 'image' | 'import'

export interface BrandingTokens {
  color: { primary: string; accent: string; surface: string; text: string; [k: string]: string }
  font: { heading: string; body: string; scale: number; lineHeight: number }
  shape: { buttonRadius: string; cardRadius: string; borderWidth: string }
  space: { sectionGap: string; sectionPaddingY: string; container: string }
}

export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr { ok: false; error: string }
export type ApiResponse<T> = ApiOk<T> | ApiErr

// ---- Billing / subscription plans ----
// The single source of truth for pricing, shared by the API (Stripe checkout),
// the app (Upgrade UI + entitlement checks), and the marketing pricing page.
// `stripePriceEnv` names the env var on the API that holds each plan's Stripe
// Price ID (set after creating the products — see scripts/stripe-setup.ts), so
// no price IDs are hard-coded and test/live keys can differ per environment.
export type PlanId = 'starter' | 'growth' | 'studio'

export interface Plan {
  id: PlanId
  name: string
  priceUsd: number                 // monthly, USD
  blurb: string
  features: string[]               // display bullets, in order
  limits: { websites: number; articlesPerWeek: number; seats: number }
  stripePriceEnv: string           // env var on the API holding the Stripe Price ID
  highlighted?: boolean            // visually featured tier on the pricing page
}

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'Starter',
    priceUsd: 5,
    blurb: 'Get one site live and growing on autopilot.',
    features: [
      '1 website',
      '1 AI article every week',
      'AI website builder + design import',
      'Published on a uwebsites.net address',
    ],
    limits: { websites: 1, articlesPerWeek: 1, seats: 1 },
    stripePriceEnv: 'STRIPE_PRICE_STARTER',
  },
  {
    id: 'growth',
    name: 'Growth',
    priceUsd: 19,
    blurb: 'For a small brand that wants to rank and look pro.',
    features: [
      '3 websites',
      '3 AI articles every week',
      'Custom domain + free SSL',
      'SEO + Google Analytics & Search Console',
      'Remove the “made with uWebsites” badge',
    ],
    limits: { websites: 3, articlesPerWeek: 3, seats: 1 },
    stripePriceEnv: 'STRIPE_PRICE_GROWTH',
    highlighted: true,
  },
  {
    id: 'studio',
    name: 'Studio',
    priceUsd: 49,
    blurb: 'Run a portfolio of sites with fresh content daily.',
    features: [
      '10 websites',
      'A fresh AI article every day',
      'Everything in Growth',
      'Priority builds + AI image generation',
      '2 team seats',
    ],
    limits: { websites: 10, articlesPerWeek: 7, seats: 2 },
    stripePriceEnv: 'STRIPE_PRICE_STUDIO',
  },
]

export const planById = (id: string): Plan | undefined => PLANS.find((p) => p.id === id)

// Curated Google Fonts list — covers ~95% of the fonts our importer is likely
// to find on a real site, organized by family character so the picker makes
// sense to a non-designer. Edit this one list to add/remove fonts; the
// branding picker AND the publisher's <head> font loader both read it.
export const GOOGLE_FONTS = {
  sans: [
    'Inter', 'Space Grotesk', 'Poppins', 'Roboto', 'Open Sans', 'Lato',
    'Montserrat', 'Nunito', 'Nunito Sans', 'Source Sans 3', 'Work Sans',
    'Plus Jakarta Sans', 'DM Sans', 'Manrope', 'Outfit', 'Figtree', 'Karla',
    'Mulish', 'Rubik', 'Quicksand',
  ],
  serif: [
    'Lora', 'Merriweather', 'Playfair Display', 'Source Serif 4', 'EB Garamond',
    'Cormorant Garamond', 'Crimson Pro', 'PT Serif', 'DM Serif Display',
    'Libre Baskerville',
  ],
  display: [
    'Bebas Neue', 'Anton', 'Archivo Black', 'Oswald', 'Caveat', 'Pacifico',
    'Dancing Script', 'Permanent Marker',
  ],
  mono: ['JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Source Code Pro', 'Roboto Mono'],
  // System defaults — always available, no Google Fonts call.
  system: ['system-ui', 'Georgia', 'Arial', 'Helvetica', 'Times New Roman'],
} as const

// Shadow elevation presets → CSS box-shadow. Driven by the workspace's
// shape.shadow token (a keyword), exposed as --shadow so sections share one
// consistent elevation that the vibe controls.
export const SHADOW_MAP: Record<string, string> = {
  none: 'none',
  subtle: '0 2px 10px -4px rgba(30,10,50,.12)',
  soft: '0 12px 34px -16px rgba(30,10,50,.22)',
  crisp: '0 4px 0 0 rgba(20,10,40,.10)',
}

// Vibe presets — a one-click bundle of coherent design decisions (font pairing,
// corner radius, border weight, type scale, shadow elevation). Applied to the
// workspace tokens; because sections are all token-driven, picking a vibe
// retunes every page at once.
export type Vibe = {
  slug: string
  name: string
  blurb: string
  font: { heading: string; body: string; scale: number }
  shape: { buttonRadius: string; cardRadius: string; borderWidth: string; shadow: string }
}
export const VIBES: Vibe[] = [
  { slug: 'playful', name: 'Playful', blurb: 'Rounded, warm, friendly — kids, lifestyle, community.',
    font: { heading: 'Quicksand', body: 'Nunito', scale: 1.35 },
    shape: { buttonRadius: '999px', cardRadius: '24px', borderWidth: '2px', shadow: 'soft' } },
  { slug: 'modern', name: 'Modern', blurb: 'Clean geometric sans, medium radius — SaaS, startups, tech.',
    font: { heading: 'Space Grotesk', body: 'Inter', scale: 1.28 },
    shape: { buttonRadius: '10px', cardRadius: '14px', borderWidth: '1px', shadow: 'soft' } },
  { slug: 'editorial', name: 'Editorial', blurb: 'Serif headlines, airy — publishers, studios, food.',
    font: { heading: 'Playfair Display', body: 'Source Sans 3', scale: 1.42 },
    shape: { buttonRadius: '6px', cardRadius: '8px', borderWidth: '1px', shadow: 'subtle' } },
  { slug: 'luxe', name: 'Luxe', blurb: 'Refined serif, sharp corners, minimal — premium, beauty, hospitality.',
    font: { heading: 'Cormorant Garamond', body: 'Manrope', scale: 1.5 },
    shape: { buttonRadius: '2px', cardRadius: '4px', borderWidth: '1px', shadow: 'subtle' } },
  { slug: 'minimal', name: 'Minimal', blurb: 'One neutral sans, flat, restrained — agencies, portfolios.',
    font: { heading: 'Inter', body: 'Inter', scale: 1.22 },
    shape: { buttonRadius: '8px', cardRadius: '12px', borderWidth: '1px', shadow: 'none' } },
  { slug: 'bold', name: 'Bold', blurb: 'Heavy display headline, high contrast — fitness, events, bold DTC.',
    font: { heading: 'Archivo Black', body: 'DM Sans', scale: 1.3 },
    shape: { buttonRadius: '6px', cardRadius: '10px', borderWidth: '2px', shadow: 'crisp' } },
]

// Flat list, deduped — used by the picker dropdown.
export const ALL_FONTS: string[] = [
  ...GOOGLE_FONTS.sans,
  ...GOOGLE_FONTS.serif,
  ...GOOGLE_FONTS.display,
  ...GOOGLE_FONTS.mono,
  ...GOOGLE_FONTS.system,
]

// Set of family names that resolve via fonts.googleapis.com — used by the
// publisher to decide whether to emit a <link> tag.
export const GOOGLE_FONT_NAMES: Set<string> = new Set([
  ...GOOGLE_FONTS.sans,
  ...GOOGLE_FONTS.serif,
  ...GOOGLE_FONTS.display,
  ...GOOGLE_FONTS.mono,
])
