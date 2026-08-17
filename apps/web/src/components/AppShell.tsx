'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { IconDashboard, IconWebsite, IconArticles, IconBranding, IconStats, IconTracking, IconAi, IconMenu, IconFooter, IconLayers } from './icons'
import { ChatPanel } from './ChatPanel'

type Workspace = { id: string; name: string; slug: string; product?: 'content' | 'site' | 'both' }
type Me = { user: { id: string; name?: string; email: string } }

// `group` = a collapsible header (toggles, never navigates). `parent` = a child
// shown only while its group is open. The group's own destination lives as a
// normal child ("Website overview" / "All articles") so the header is purely a
// toggle and the general page is still one click away.
// 'both' exists for the same-site hybrid: a uWebsites-built site whose own
// content pipeline writes articles onto it (no external WordPress/Custom API
// delivery) — that customer needs both halves of the nav at once, not a
// binary either/or.
type ProductMode = 'site' | 'content' | 'both'
// `product` on a group tags which side of the Website Builder / SEO & Content
// switcher it belongs to; its children inherit that tag (see productOf below).
// Entries with no tag at all (Dashboard) are account-level and always show.
type NavEntry = { label: string; Icon: (p: { size?: number }) => React.JSX.Element; sub?: boolean; group?: boolean; parent?: string; divider?: boolean; product?: ProductMode }
const NAV: NavEntry[] = [
  { label: 'Dashboard', Icon: IconDashboard },
  { label: 'Website', Icon: IconWebsite, group: true, product: 'site' },
  { label: 'Website overview', Icon: IconWebsite, parent: 'Website' },
  { label: 'Menu', Icon: IconMenu, parent: 'Website' },
  { label: 'Footer', Icon: IconFooter, parent: 'Website' },
  { label: 'CTAs', Icon: IconFooter, parent: 'Website' },
  { label: 'Branding', Icon: IconBranding, parent: 'Website' },
  // Article layout/typography is a design decision, not a content one.
  { label: 'Format', Icon: IconArticles, parent: 'Website' },
  // The content product — everything about planning, writing and delivering
  // articles, in one place (was scattered across Website / Articles / Branding).
  // Flat like the three below it — Overview / Plan / Library live as tabs on
  // the page, not as an expandable sidebar tree.
  { label: 'Plan & Content', Icon: IconArticles, product: 'content' },
  // These three are flat, non-collapsible buttons — each routes straight to
  // its first tab; the tab bar (inside the page) is how you move between the
  // rest. Not a tree to expand, just fewer top-level buttons to scan.
  { label: 'Brand & Rules', Icon: IconAi, product: 'content' },
  { label: 'Publish to', Icon: IconArticles, product: 'content' },
  // Traffic/search data matters to a Website-Builder-only customer just as
  // much as a content-only one (indexing, visits) — always visible, like
  // Dashboard, not locked behind either side of the switcher.
  { label: 'Performance & Integrations', Icon: IconTracking },
]
// A child's product tag is whichever group it's nested under.
function productOf(entry: NavEntry): ProductMode | undefined {
  if (entry.product) return entry.product
  if (entry.parent) return NAV.find((n) => n.label === entry.parent)?.product
  return undefined
}
const PRODUCT_INFO: Record<ProductMode, { label: string; desc: string; Icon: (p: { size?: number }) => React.JSX.Element }> = {
  site: { label: 'Website Builder', desc: 'Pages, menu, footer & CTAs', Icon: IconWebsite },
  content: { label: 'SEO & Content', desc: 'Plan, write & publish articles', Icon: IconArticles },
  both: { label: 'Both', desc: 'Everything, nothing hidden', Icon: IconLayers },
}
// Pages still pass their old active= labels — map those onto the new nav labels
// so nothing had to be edited page by page.
const ACTIVE_ALIAS: Record<string, string> = {
  Website: 'Website overview',
  Overview: 'Plan & Content', Articles: 'Plan & Content', 'Article Plan': 'Plan & Content',
  'Article Template': 'Format',
  'Business Brief': 'Brand & Rules', 'Brand Voice': 'Brand & Rules', 'SEO Rules': 'Brand & Rules', Authors: 'Brand & Rules',
  WordPress: 'Publish to', 'Custom API': 'Publish to',
  Tracking: 'Performance & Integrations', Insights: 'Performance & Integrations', Integrations: 'Performance & Integrations',
}
// Integrations moved under the "Performance & Integrations" nav button (its
// own tab there now) — no longer needs a second entry point in this menu.
const PROFILE_ITEMS = ['Settings', 'Domains', 'Email Setup', 'Billing']

export function AppShell({ title, currentSlug, active = 'Dashboard', children, chatPageId, chatPageContext, onChatMutate, hideWorkspaceSwitch }: {
  title: string; currentSlug?: string; active?: string; children: React.ReactNode
  chatPageId?: string
  chatPageContext?: { type: string; title: string; blocks?: { type: string }[] }
  onChatMutate?: (blocks: { type: string; props: Record<string, any> }[]) => void
  hideWorkspaceSwitch?: boolean
}) {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsOpen, setWsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)

  const [lastSlug, setLastSlug] = useState<string | null>(null)
  useEffect(() => {
    api<Me>('/auth/me').then(setMe).catch(() => {})
    api<Workspace[]>('/workspaces').then(setWorkspaces).catch(() => {})
    try { setLastSlug(localStorage.getItem('uw-last-ws')) } catch {}
  }, [])
  // Remember the workspace you're in, so account-level pages (Insights,
  // Domains, Integrations — which have no slug in the URL) keep showing it
  // instead of snapping back to the first workspace in the list.
  useEffect(() => {
    if (currentSlug) { try { localStorage.setItem('uw-last-ws', currentSlug) } catch {}; setLastSlug(currentSlug) }
  }, [currentSlug])

  const current = workspaces.find((w) => w.slug === currentSlug)
    || workspaces.find((w) => w.slug === lastSlug)
    || workspaces[0] || null
  const others = workspaces.filter((w) => w.id !== current?.id)
  // Website Builder and SEO & Content are two different products sharing one
  // nav — the switcher (topbar, right after search) decides which half shows.
  // Unlabelled entries (Dashboard) are account-level and always visible.
  const productMode: ProductMode = current?.product === 'content' ? 'content' : current?.product === 'both' ? 'both' : 'site'
  const visibleNav = NAV.filter((n) => {
    const p = productOf(n)
    return !p || productMode === 'both' || p === productMode
  })
  const displayName = me?.user?.name?.trim() || (me?.user?.email ? me.user.email.split('@')[0] : 'You')

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    router.push('/login')
  }

  // Optimistic: flip the chip and navigate immediately, persist in the
  // background. It's a per-workspace preference, not a destructive action —
  // worst case a slow save just re-syncs on the next page load. "Both" is a
  // superset of wherever you already are, so it never needs to redirect you.
  function switchProduct(next: ProductMode) {
    if (!current) return
    setModeOpen(false)
    if (current.product === next) return
    const slug = current.slug
    setWorkspaces((ws) => ws.map((w) => (w.id === current.id ? { ...w, product: next } : w)))
    api(`/workspaces/${slug}/product-mode`, { method: 'PUT', body: JSON.stringify({ product: next }) }).catch(() => {})
    if (next === 'content') router.push(`/w/${slug}/content`)
    else if (next === 'site') router.push(`/w/${slug}`)
  }

  // Collapsible nav groups. Remembered across pages, and the group holding the
  // current page is always forced open so you never land somewhere "hidden".
  const activeLabel = ACTIVE_ALIAS[active] || active
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let saved: Record<string, boolean> = {}
    try { saved = JSON.parse(localStorage.getItem('uw-nav-open') || '{}') } catch {}
    const g = NAV.find((n) => n.label === activeLabel)?.parent
    if (g) saved[g] = true
    setOpenGroups(saved)
  }, [activeLabel])
  function toggleGroup(label: string) {
    setOpenGroups((cur) => {
      const next = { ...cur, [label]: !cur[label] }
      try { localStorage.setItem('uw-nav-open', JSON.stringify(next)) } catch {}
      return next
    })
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand"><img className="logo-full" src="/uwebsites.svg" alt="uWebsites" /></div>
        <nav className="sidebar-nav">
          {visibleNav.map(({ label, Icon, sub, group, parent, divider }) => {
            // A group header toggles; it never navigates.
            if (group) {
              const isOpen = !!openGroups[label]
              return (
                <button key={label} type="button" className={`sidebar-link sidebar-group${isOpen ? ' open' : ''}`}
                  aria-expanded={isOpen} onClick={() => toggleGroup(label)}>
                  <Icon size={18} />{label}
                  <span className="sidebar-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                </button>
              )
            }
            if (parent && !openGroups[parent]) return null // collapsed away
            // A non-interactive sub-header inside an open group (e.g. "Settings").
            if (divider) return <div key={label} className="sidebar-divider">{label}</div>
            const href = label === 'Dashboard' ? '/'
              : label === 'Insights' ? '/insights'
              : !current ? undefined
              : label === 'Website overview' ? `/w/${current.slug}`
              : label === 'Menu' ? `/w/${current.slug}/menu`
              : label === 'Footer' ? `/w/${current.slug}/footer`
              : label === 'CTAs' ? `/w/${current.slug}/cta`
              : label === 'Format' ? `/w/${current.slug}/article-template`
              : label === 'Branding' ? `/w/${current.slug}/branding`
              // Flat tabbed buttons — each lands on its first tab.
              : label === 'Plan & Content' ? `/w/${current.slug}/content`
              : label === 'Brand & Rules' ? `/w/${current.slug}/business-brief`
              : label === 'Publish to' ? `/w/${current.slug}/wordpress`
              : label === 'Performance & Integrations' ? `/w/${current.slug}/tracking`
              : undefined
            const cls = `sidebar-link${label === activeLabel ? ' active' : ''}${(sub || parent) ? ' sidebar-sub' : ''}`
            const inner = <><Icon size={18} />{label}</>
            return href
              ? <a key={label} href={href} className={cls}>{inner}</a>
              : <div key={label} className={cls}>{inner}</div>
          })}
        </nav>
        <div className="sidebar-foot">
          <a className="sidebar-link sidebar-upgrade" href="/checkout">✦ Plans &amp; upgrade</a>
          <a
            className="sidebar-link sidebar-ai"
            href={current ? `/w/${current.slug}?chat=1` : '#'}
            onClick={(e) => {
              // If we're already on a page that mounts the ChatPanel, just open it.
              const onChattyRoute = typeof window !== 'undefined' && /^\/w\//.test(window.location.pathname)
              if (current && onChattyRoute) { e.preventDefault(); window.dispatchEvent(new CustomEvent('uw-open-chat')) }
            }}
          >
            <IconAi size={18} />AI assistant
          </a>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <h2 title={title}>{active}</h2>
          <div className="topbar-right">
            {current && (
            <div className="mode-switch">
              <button className="mode-chip" onClick={() => setModeOpen((o) => !o)} onBlur={() => setTimeout(() => setModeOpen(false), 150)}>
                <span className={`mode-chip-ico ${productMode}`}>{PRODUCT_INFO[productMode].label[0]}</span>
                <span className="mode-chip-name">{PRODUCT_INFO[productMode].label}</span> <span className="chev">▾</span>
              </button>
              {modeOpen && (
                <div className="mode-menu">
                  {(Object.keys(PRODUCT_INFO) as ProductMode[]).map((key) => {
                    const info = PRODUCT_INFO[key]
                    return (
                      <button key={key} type="button" className={`mode-item${key === productMode ? ' active' : ''}`} onClick={() => switchProduct(key)}>
                        <span className={`mode-item-ico ${key}`}>{info.label[0]}</span>
                        <span className="mode-item-text"><b>{info.label}</b><span>{info.desc}</span></span>
                        {key === productMode && <span className="check">✓</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            )}

            <input className="topbar-search" placeholder="Search…" />

            {!hideWorkspaceSwitch && (
            <div className="ws-switch">
              <button className="ws-chip" onClick={() => setWsOpen((o) => !o)} onBlur={() => setTimeout(() => setWsOpen(false), 150)}>
                <span className="ws-ava">{(current?.name || '·').slice(0, 1).toUpperCase()}</span>
                <span className="ws-chip-name">{current?.name || 'Workspace'}</span> <span className="chev">▾</span>
              </button>
              {wsOpen && (
                <div className="ws-menu">
                  {current && (<>
                    <div className="ws-menu-label">Current workspace</div>
                    <div className="ws-item"><span className="ws-ava">{current.name.slice(0, 1).toUpperCase()}</span><span>{current.name}</span><span className="check">✓</span></div>
                  </>)}
                  {others.length > 0 && <div className="ws-menu-label">Switch to</div>}
                  {others.map((w) => (
                    <a key={w.id} className="ws-item" href={`/w/${w.slug}`}>
                      <span className="ws-ava">{w.name.slice(0, 1).toUpperCase()}</span><span>{w.name}</span>
                    </a>
                  ))}
                  <a className="ws-item add" href="/onboarding?new=1">＋ Create new workspace</a>
                </div>
              )}
            </div>
            )}

            <span className="plan-badge">FREE</span>
            <button className="bell" aria-label="Notifications">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              <span className="dot" />
            </button>

            <div className="profile-switch">
              <button className="user" onClick={() => setProfileOpen((o) => !o)} onBlur={() => setTimeout(() => setProfileOpen(false), 150)}>
                <div className="user-meta"><b>{displayName}</b></div>
                <span className="user-ava">{displayName.slice(0, 1).toUpperCase()}</span>
              </button>
              {profileOpen && (
                <div className="profile-menu">
                  <div className="profile-head"><b>{displayName}</b><span>{current?.name || ''}</span></div>
                  {PROFILE_ITEMS.map((label) => {
                    const href = label === 'Settings' && current ? `/w/${current.slug}/settings`
                      : label === 'Integrations' ? '/integrations'
                      : label === 'Domains' ? '/domains'
                      : null
                    return href
                      ? <a key={label} className="profile-item" href={href}>{label}</a>
                      : <button key={label} className="profile-item" onClick={() => { /* TODO: route */ }}>{label}</button>
                  })}
                  <button className="profile-item danger" onClick={logout}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="content">{children}</div>
      </main>
      {current && <ChatPanel slug={current.slug} pageId={chatPageId} pageContext={chatPageContext} onMutate={onChatMutate} />}
    </div>
  )
}
