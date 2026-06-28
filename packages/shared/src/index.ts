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
