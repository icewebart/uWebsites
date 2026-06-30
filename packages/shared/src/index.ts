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
