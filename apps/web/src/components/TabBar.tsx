'use client'

// Horizontal tab bar for pages that got grouped under one non-collapsible
// sidebar button (Brand & Rules / Connect to / Performance & Integrations) —
// each tab is a real route, this is just the way between them.
export function TabBar({ tabs }: { tabs: { label: string; href: string; active: boolean }[] }) {
  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <a key={t.href} href={t.href} className={`tab-bar-item${t.active ? ' active' : ''}`}>{t.label}</a>
      ))}
    </div>
  )
}
