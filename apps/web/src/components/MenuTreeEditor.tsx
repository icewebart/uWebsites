'use client'

export type Item = { label: string; href: string; children?: Item[] }
export type Tree = { items: Item[]; cta?: { label: string; href: string } | null }

export function MenuTreeEditor({ tree, onChange, maxItems, showCta }: { tree: Tree; onChange: (t: Tree) => void; maxItems: number; showCta?: boolean }) {
  const setItems = (items: Item[]) => onChange({ ...tree, items })
  const patchItem = (i: number, next: Partial<Item>) => setItems(tree.items.map((x, k) => k === i ? { ...x, ...next } : x))
  const setChildren = (i: number, children: Item[]) => patchItem(i, { children: children.length ? children : undefined })

  return (
    <div className="ev-card">
      {tree.items.length === 0 && <div className="ev-empty">No items yet.</div>}
      {tree.items.map((it, i) => {
        const kids = it.children || []
        return (
          <div key={i} className="menu-item-group">
            <div className="menu-row">
              <div className="menu-row-grip" title="Drag to reorder (coming soon)">⋮⋮</div>
              <input className="inp" placeholder="Label" value={it.label} onChange={(e) => patchItem(i, { label: e.target.value })} />
              <input className="inp" placeholder={kids.length ? 'Link (optional for dropdowns)' : 'https://…'} value={it.href} onChange={(e) => patchItem(i, { href: e.target.value })} />
              <div className="ev-actions" style={{ width: 'auto', flex: '0 0 auto' }}>
                <button onClick={() => { if (i > 0) { const a = [...tree.items];[a[i - 1], a[i]] = [a[i], a[i - 1]]; setItems(a) } }} disabled={i === 0} title="Up">↑</button>
                <button onClick={() => { if (i < tree.items.length - 1) { const a = [...tree.items];[a[i + 1], a[i]] = [a[i], a[i + 1]]; setItems(a) } }} disabled={i === tree.items.length - 1} title="Down">↓</button>
                <button className="danger" onClick={() => setItems(tree.items.filter((_, k) => k !== i))} title="Remove">✕</button>
              </div>
            </div>

            {kids.length > 0 && (
              <div className="menu-children">
                {kids.map((c, ci) => (
                  <div key={ci} className="menu-row menu-row-child">
                    <div className="menu-row-grip" title="Sub-item">↳</div>
                    <input className="inp" placeholder="Label" value={c.label} onChange={(e) => setChildren(i, kids.map((x, k) => k === ci ? { ...x, label: e.target.value } : x))} />
                    <input className="inp" placeholder="https://…" value={c.href} onChange={(e) => setChildren(i, kids.map((x, k) => k === ci ? { ...x, href: e.target.value } : x))} />
                    <div className="ev-actions" style={{ width: 'auto', flex: '0 0 auto' }}>
                      <button onClick={() => { if (ci > 0) { const a = [...kids];[a[ci - 1], a[ci]] = [a[ci], a[ci - 1]]; setChildren(i, a) } }} disabled={ci === 0} title="Up">↑</button>
                      <button onClick={() => { if (ci < kids.length - 1) { const a = [...kids];[a[ci + 1], a[ci]] = [a[ci], a[ci + 1]]; setChildren(i, a) } }} disabled={ci === kids.length - 1} title="Down">↓</button>
                      <button className="danger" onClick={() => setChildren(i, kids.filter((_, k) => k !== ci))} title="Remove">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="menu-item-add">
              <button className="btn-mini" onClick={() => setChildren(i, [...kids, { label: '', href: '' }])} disabled={kids.length >= 16}>
                ＋ Add dropdown item{kids.length ? ` (${kids.length})` : ''}
              </button>
            </div>
          </div>
        )
      })}
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
