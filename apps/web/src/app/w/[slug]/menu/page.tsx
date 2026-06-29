'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Item = { label: string; href: string }
type Tree = { items: Item[]; cta?: { label: string; href: string } | null }

export default function MenusPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [header, setHeader] = useState<Tree>({ items: [], cta: null })
  const [footer, setFooter] = useState<Tree>({ items: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState('')

  useEffect(() => {
    api<{ header: Tree; footer: Tree }>(`/workspaces/${slug}/menus`)
      .then((d) => { setHeader({ items: d.header.items || [], cta: d.header.cta || null }); setFooter({ items: d.footer.items || [] }) })
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
  }, [slug])

  async function refreshFromSource() {
    if (!window.confirm('Re-fetch the menu from your imported source URL? This will overwrite the current header menu items + CTA.')) return
    setErr(''); setRefreshNote(''); setRefreshing(true)
    try {
      const r = await api<{ header: Tree; footer: Tree; refreshed?: boolean; reason?: string; source?: string }>(
        `/workspaces/${slug}/menus/refresh`, { method: 'POST', body: JSON.stringify({}) },
      )
      setHeader({ items: r.header.items || [], cta: r.header.cta || null })
      setFooter({ items: r.footer.items || [] })
      setRefreshNote(r.refreshed ? `Refreshed from ${r.source}` : (r.reason || 'No changes'))
    } catch (e: any) { setErr(e.message || 'Refresh failed') } finally { setRefreshing(false) }
  }

  async function save() {
    setErr(''); setSaving(true)
    try {
      await api(`/workspaces/${slug}/menus`, { method: 'PUT', body: JSON.stringify({ header, footer }) })
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Menu" currentSlug={slug} active="Menu">
      <div className="dash-sub" style={{ marginBottom: 22 }}>
        Edit the header navigation and footer links. They appear on every published page. On import, we seed these from your old site's nav and main CTA.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="dash-h" style={{ margin: 0 }}>Header menu</div>
        <button className="btn btn-ghost" onClick={refreshFromSource} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : '↻ Refresh from source'}
        </button>
      </div>
      {refreshNote && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{refreshNote}</div>}
      <MenuEditor tree={header} onChange={setHeader} maxItems={10} showCta />
      <div className="dash-h" style={{ marginTop: 24 }}>Footer menu</div>
      <MenuEditor tree={footer} onChange={(t) => setFooter({ items: t.items })} maxItems={20} />

      <div className="err" style={{ marginTop: 14 }}>{err}</div>
      <div className="save-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save menus'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
      </div>
    </AppShell>
  )
}

function MenuEditor({ tree, onChange, maxItems, showCta }: { tree: Tree; onChange: (t: Tree) => void; maxItems: number; showCta?: boolean }) {
  const setItems = (items: Item[]) => onChange({ ...tree, items })
  return (
    <div className="ev-card">
      {tree.items.length === 0 && <div className="ev-empty">No items yet.</div>}
      {tree.items.map((it, i) => (
        <div key={i} className="menu-row">
          <div className="menu-row-grip" title="Drag to reorder (coming soon)">⋮⋮</div>
          <input className="inp" placeholder="Label" value={it.label} onChange={(e) => setItems(tree.items.map((x, k) => k === i ? { ...x, label: e.target.value } : x))} />
          <input className="inp" placeholder="https://…" value={it.href} onChange={(e) => setItems(tree.items.map((x, k) => k === i ? { ...x, href: e.target.value } : x))} />
          <div className="ev-actions" style={{ width: 'auto', flex: '0 0 auto' }}>
            <button onClick={() => { if (i > 0) { const a = [...tree.items];[a[i - 1], a[i]] = [a[i], a[i - 1]]; setItems(a) } }} disabled={i === 0} title="Up">↑</button>
            <button onClick={() => { if (i < tree.items.length - 1) { const a = [...tree.items];[a[i + 1], a[i]] = [a[i], a[i + 1]]; setItems(a) } }} disabled={i === tree.items.length - 1} title="Down">↓</button>
            <button className="danger" onClick={() => setItems(tree.items.filter((_, k) => k !== i))} title="Remove">✕</button>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-secondary" onClick={() => setItems([...tree.items, { label: '', href: '' }])} disabled={tree.items.length >= maxItems}>＋ Add item</button>
      </div>
      {showCta && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div className="dash-h" style={{ margin: '0 0 10px' }}>Header CTA (optional)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input className="inp" placeholder="Button label (e.g. Sign up)" value={tree.cta?.label || ''} onChange={(e) => onChange({ ...tree, cta: e.target.value ? { label: e.target.value, href: tree.cta?.href || '' } : null })} />
            <input className="inp" placeholder="Button link" value={tree.cta?.href || ''} onChange={(e) => onChange({ ...tree, cta: { label: tree.cta?.label || '', href: e.target.value } })} />
          </div>
        </div>
      )}
    </div>
  )
}
