// Line icons — single-stroke, currentColor, sized via wrapper. Matches the
// uReferrals-ish reference: small, calm, no fill.
type P = { size?: number }
const wrap = (size = 18) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })

export const IconDashboard = ({ size }: P) => (
  <svg {...wrap(size)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
)
export const IconWebsite = ({ size }: P) => (
  <svg {...wrap(size)}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><circle cx="6.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="9" cy="6.5" r=".5" fill="currentColor" /></svg>
)
export const IconArticles = ({ size }: P) => (
  <svg {...wrap(size)}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h8M8 17h6" /></svg>
)
export const IconBranding = ({ size }: P) => (
  <svg {...wrap(size)}><circle cx="12" cy="12" r="9" /><circle cx="8" cy="9" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="8.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="17.5" cy="13" r="1.2" fill="currentColor" stroke="none" /><path d="M12 12c2 2 4 4 3 6s-4 1-5-1-1-4 2-5z" /></svg>
)
export const IconMenu = ({ size }: P) => (
  <svg {...wrap(size)}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h12" /></svg>
)
export const IconStats = ({ size }: P) => (
  <svg {...wrap(size)}><path d="M3 21h18" /><rect x="5" y="13" width="3.5" height="6" /><rect x="10.25" y="9" width="3.5" height="10" /><rect x="15.5" y="5" width="3.5" height="14" /></svg>
)
export const IconAi = ({ size }: P) => (
  <svg {...wrap(size)}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" /></svg>
)
export const IconSettings = ({ size }: P) => (
  <svg {...wrap(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
)
