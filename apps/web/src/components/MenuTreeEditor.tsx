'use client'

export type Item = { label: string; href: string }
export type Tree = { items: Item[]; cta?: { label: string; href: string } | null }

export function MenuTreeEditor({ tree, onChange, maxItems, showCta }: { tree: Tree; onChange: (t: Tree) => void; maxItems: number; showCta?: boolean }) {
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
