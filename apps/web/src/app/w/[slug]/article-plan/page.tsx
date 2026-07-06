'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Item = { id: string; keyword: string; status: 'idea' | 'queued' | 'drafted' | 'published'; priority: number; source: string; impressions?: number; position?: number; pageId?: string; createdAt: string }
type Plan = { items: Item[]; auto: boolean; scLinked: boolean }
type Opp = { query: string; impressions: number; position: number; clicks: number }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()))

export default function ArticlePlanPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [auto, setAuto] = useState(false)
  const [scLinked, setScLinked] = useState(false)
  const [kw, setKw] = useState('')
  const [bulk, setBulk] = useState('')
  const [opps, setOpps] = useState<Opp[] | null>(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState(''); const [err, setErr] = useState('')

  useEffect(() => {
    api<Plan>(`/account/workspaces/${slug}/article-plan`).then((d) => { setItems(d.items); setAuto(d.auto); setScLinked(d.scLinked) }).catch(() => router.push(`/w/${slug}`))
  }, [slug])

  // Autosave whenever the list/auto changes (debounced-ish via a stable save).
  async function persist(next: Item[], nextAuto = auto) {
    setItems(next); setAuto(nextAuto)
    try { await api(`/account/workspaces/${slug}/article-plan`, { method: 'PUT', body: JSON.stringify({ items: next, auto: nextAuto }) }) }
    catch (e: any) { setErr(e.message || 'Save failed') }
  }
  const has = (k: string) => items.some((i) => i.keyword.toLowerCase().trim() === k.toLowerCase().trim())
  const mk = (keyword: string, source: string, extra: Partial<Item> = {}): Item => ({ id: uid(), keyword: keyword.trim(), status: 'idea', priority: 0, source, createdAt: new Date().toISOString(), ...extra })

  function addOne() { const k = kw.trim(); if (!k || has(k)) { setKw(''); return } persist([mk(k, 'manual'), ...items]); setKw('') }
  function addBulk() {
    const rows = bulk.split('\n').map((s) => s.trim()).filter(Boolean).filter((k) => !has(k))
    if (rows.length) persist([...rows.map((k) => mk(k, 'manual')), ...items])
    setBulk('')
  }
  async function pullSC() {
    setBusy('sc'); setErr(''); setOpps(null)
    try { const rows = await api<Opp[]>(`/account/workspaces/${slug}/article-plan/pull-search-console`, { method: 'POST', body: JSON.stringify({}) }); setOpps(rows) }
    catch (e: any) { setErr(e.message || 'Could not pull from Search Console') } finally { setBusy('') }
  }
  function addOpp(o: Opp) { if (has(o.query)) return; persist([mk(o.query, 'search-console', { impressions: o.impressions, position: Math.round(o.position * 10) / 10 }), ...items]) }
  function remove(id: string) { persist(items.filter((i) => i.id !== id)) }
  function bump(id: string, d: number) { persist(items.map((i) => i.id === id ? { ...i, priority: (i.priority || 0) + d } : i)) }

  async function draftNow(it: Item) {
    setBusy(it.id); setErr('')
    try {
      const r = await api<{ id?: string }>('/ai/generate-article', { method: 'POST', body: JSON.stringify({ slug, keyword: it.keyword }) })
      persist(items.map((i) => i.id === it.id ? { ...i, status: 'drafted', pageId: r?.id } : i))
      setNote(`Drafted "${it.keyword}" ✓ — it's now a draft in Articles (open it to review, then Publish).`)
    } catch (e: any) { setErr(e.message || 'Draft failed') } finally { setBusy('') }
  }

  const sorted = [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0) || (b.impressions || 0) - (a.impressions || 0))

  return (
    <AppShell title="Article Plan" currentSlug={slug} active="Article Plan">
      <div className="dash-sub" style={{ marginBottom: 16 }}>
        Your keyword pipeline. Add targets manually, paste a list, or pull ideas from Search Console — the content engine writes an optimised article per keyword. {scLinked ? '' : <span>Link a Search Console property on <a href={`/w/${slug}/tracking`}>Tracking</a> to pull ideas.</span>}
      </div>

      <div className="ctl-group card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}><label className="muted" style={{ fontSize: 12 }}>Add a keyword</label><input className="inp" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOne()} placeholder="e.g. tabere de vara pentru copii" /></div>
          <button className="btn btn-primary" onClick={addOne} disabled={!kw.trim()}>＋ Add</button>
          <button className="btn btn-secondary" onClick={pullSC} disabled={!scLinked || busy === 'sc'} title={scLinked ? 'Pull near-ranking queries from Search Console' : 'Link a Search Console property first (Tracking)'}>{busy === 'sc' ? 'Pulling…' : '↧ Pull from Search Console'}</button>
          <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', marginLeft: 'auto' }}>
            <input type="checkbox" checked={auto} onChange={(e) => persist(items, e.target.checked)} style={{ width: 'auto' }} /> Weekly auto-write
          </label>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>Paste a list (one keyword per line)</summary>
          <textarea className="inp" rows={4} style={{ marginTop: 8 }} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'keyword one\nkeyword two\nkeyword three'} />
          <button className="btn-mini" style={{ marginTop: 6 }} onClick={addBulk} disabled={!bulk.trim()}>Add all</button>
        </details>
      </div>

      {opps && (
        <div className="ctl-group card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b style={{ fontSize: 14 }}>Ideas from Search Console <span className="muted" style={{ fontWeight: 400 }}>(near-ranking queries — position 4–20)</span></b>
            <button className="btn-mini" onClick={() => setOpps(null)}>Close</button>
          </div>
          {!opps.length ? <p className="muted" style={{ fontSize: 13 }}>No strong opportunities right now.</p> : (
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Query</th><th style={{ width: 90 }}>Impr.</th><th style={{ width: 70 }}>Pos.</th><th style={{ width: 80 }}></th></tr></thead>
              <tbody>{opps.map((o) => (
                <tr key={o.query}><td>{o.query}</td><td>{o.impressions}</td><td>{o.position.toFixed(1)}</td><td>{has(o.query) ? <span className="muted" style={{ fontSize: 12 }}>added</span> : <button className="btn-mini" onClick={() => addOpp(o)}>＋ Add</button>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

      {note && <div className="banner-ok" style={{ marginBottom: 12 }}>{note}</div>}
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {items.length === 0 ? (
        <div className="aside-block" style={{ textAlign: 'center', padding: 34 }}><p className="muted">No keywords yet. Add one above or pull ideas from Search Console.</p></div>
      ) : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Keyword</th><th style={{ width: 110 }}>Source</th><th style={{ width: 90 }}>Status</th><th style={{ width: 90 }}>SC</th><th style={{ width: 190 }}>Actions</th></tr></thead>
          <tbody>
            {sorted.map((it) => (
              <tr key={it.id}>
                <td><b>{it.keyword}</b></td>
                <td className="muted" style={{ fontSize: 12 }}>{it.source === 'search-console' ? 'Search Console' : it.source}</td>
                <td><span className={`status-pill ${it.status === 'published' ? 'live' : it.status === 'drafted' ? 'live' : 'draft'}`}>{it.status}</span></td>
                <td className="muted" style={{ fontSize: 12 }}>{it.impressions != null ? `${it.impressions} impr · #${it.position}` : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="btn-mini" onClick={() => draftNow(it)} disabled={busy === it.id || it.status === 'drafted'}>{busy === it.id ? 'Writing…' : it.status === 'drafted' ? 'Drafted' : '✍ Draft now'}</button>
                    <button className="btn-mini" title="Raise priority" onClick={() => bump(it.id, 1)}>▲</button>
                    <button className="btn-mini danger" onClick={() => remove(it.id)}>✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
        <b>Weekly auto-write</b> (when enabled) will draft the highest-priority queued keyword each week. Drafts land in <a href={`/w/${slug}/articles`}>Articles</a> for review before publishing.
      </p>
    </AppShell>
  )
}
