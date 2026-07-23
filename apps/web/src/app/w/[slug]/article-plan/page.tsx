'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { ClusterGraph, type GraphPillar } from '@/components/ClusterGraph'

type Item = { id: string; keyword: string; status: 'idea' | 'queued' | 'drafted' | 'published'; priority: number; source: string; impressions?: number; position?: number; pageId?: string; createdAt: string; coveredBy?: { pageId: string; title: string } | null; cluster?: string; role?: string; intent?: string; funnel?: string; contentType?: string }
type Pillar = { name: string; description?: string; businessValue?: string }
type Plan = { items: Item[]; auto: boolean; scLinked: boolean; pillars?: Pillar[] }
// A proposed map from /ai/plan/cluster — reviewed before anything is saved.
type Proposed = { pillars: { name: string; description: string; businessValue: string; keywords: { keyword: string; role: string; intent: string; funnel: string; contentType: string; alreadyCovered: boolean }[] }[]; unassigned: string[] }
type Opp = { query: string; impressions: number; position: number; clicks: number }
// Gap analysis for one pillar — proposed, never auto-added.
type Gap = { keyword: string; intent: string; funnel: string; contentType: string; reason: string }
type Expansion = { pillar: string; hub: string; missing: Gap[]; serpUsed: boolean }

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
  const [pillars, setPillars] = useState<Pillar[]>([])
  const [proposal, setProposal] = useState<Proposed | null>(null)
  const [clustering, setClustering] = useState(false)
  const [expansion, setExpansion] = useState<Expansion | null>(null)
  const [expanding, setExpanding] = useState('')

  useEffect(() => {
    api<Plan>(`/account/workspaces/${slug}/article-plan`).then((d) => { setItems(d.items); setAuto(d.auto); setScLinked(d.scLinked); setPillars(d.pillars || []) }).catch(() => router.push(`/w/${slug}`))
  }, [slug])

  // Autosave whenever the list/auto changes (debounced-ish via a stable save).
  async function persist(next: Item[], nextAuto = auto) {
    setItems(next); setAuto(nextAuto)
    try { await api(`/account/workspaces/${slug}/article-plan`, { method: 'PUT', body: JSON.stringify({ items: next, auto: nextAuto, pillars }) }) }
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
  // Topic cluster: articles sharing one interlink as a group, which is how a
  // topic ranks as a unit rather than as scattered posts.
  function setCluster(id: string, cluster: string) { persist(items.map((i) => i.id === id ? { ...i, cluster: cluster.trim() || undefined } : i)) }
  function bump(id: string, d: number) { persist(items.map((i) => i.id === id ? { ...i, priority: (i.priority || 0) + d } : i)) }

  async function draftNow(it: Item) {
    setBusy(it.id); setErr('')
    try {
      const r = await api<{ id?: string }>('/ai/generate-article', { method: 'POST', body: JSON.stringify({ slug, keyword: it.keyword }) })
      persist(items.map((i) => i.id === it.id ? { ...i, status: 'drafted', pageId: r?.id } : i))
      setNote(`Drafted "${it.keyword}" ✓ — it's now a draft in Articles (open it to review, then Publish).`)
    } catch (e: any) { setErr(e.message || 'Draft failed') } finally { setBusy('') }
  }

  // ── Plan Builder: let the AI organise the keywords into pillars, review, apply.
  async function buildClusters() {
    setClustering(true); setErr(''); setNote('')
    try { setProposal(await api<Proposed>('/ai/plan/cluster', { method: 'POST', body: JSON.stringify({ slug }) })) }
    catch (e: any) { setErr(e.message || 'Could not build the topic map') } finally { setClustering(false) }
  }
  async function applyProposal() {
    if (!proposal) return
    const byKw = new Map<string, { cluster: string; role: string; intent: string; funnel: string; contentType: string }>()
    for (const p of proposal.pillars) {
      for (const k of p.keywords) {
        byKw.set(k.keyword.toLowerCase().trim(), { cluster: p.name, role: k.role, intent: k.intent, funnel: k.funnel, contentType: k.contentType })
      }
    }
    const next = items.map((i) => {
      const m = byKw.get(i.keyword.toLowerCase().trim())
      return m ? { ...i, ...m } : i
    })
    const nextPillars: Pillar[] = proposal.pillars.map((p) => ({ name: p.name, description: p.description, businessValue: p.businessValue }))
    setPillars(nextPillars)
    setItems(next)
    try {
      await api(`/account/workspaces/${slug}/article-plan`, { method: 'PUT', body: JSON.stringify({ items: next, auto, pillars: nextPillars }) })
      setNote(`Applied ${nextPillars.length} pillars across ${byKw.size} keywords.`)
      setProposal(null)
    } catch (e: any) { setErr(e.message || 'Could not save the topic map') }
  }

  // Gap analysis: what is MISSING from a pillar (SERP-mined), reviewed before adding.
  async function expandPillar(name: string) {
    setExpanding(name); setErr(''); setNote(''); setExpansion(null)
    try { setExpansion(await api<Expansion>('/ai/plan/expand', { method: 'POST', body: JSON.stringify({ slug, pillar: name }) })) }
    catch (e: any) { setErr(e.message || 'Could not find missing topics') } finally { setExpanding('') }
  }
  function addGap(g: Gap, pillarName: string) {
    if (has(g.keyword)) return
    persist([mk(g.keyword, 'ai-gap', { cluster: pillarName, intent: g.intent, funnel: g.funnel, contentType: g.contentType }), ...items])
    setExpansion((cur) => cur ? { ...cur, missing: cur.missing.filter((m) => m.keyword !== g.keyword) } : cur)
  }
  function addAllGaps() {
    if (!expansion) return
    const fresh = expansion.missing.filter((g) => !has(g.keyword))
    if (fresh.length) persist([...fresh.map((g) => mk(g.keyword, 'ai-gap', { cluster: expansion.pillar, intent: g.intent, funnel: g.funnel, contentType: g.contentType })), ...items])
    setExpansion(null)
    setNote(`Added ${fresh.length} missing topics to "${expansion.pillar}".`)
  }

  // The saved map, for the graph: pillars with their keywords + live status.
  const graphPillars: GraphPillar[] = pillars.map((p) => ({
    name: p.name,
    businessValue: p.businessValue,
    keywords: items.filter((i) => i.cluster === p.name).map((i) => ({
      keyword: i.keyword, role: i.role, status: i.status, alreadyCovered: !!i.coveredBy,
    })),
  })).filter((p) => p.keywords.length)

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
          <button className="btn btn-secondary" onClick={buildClusters} disabled={clustering || items.length < 3}
            title={items.length < 3 ? 'Add at least 3 keywords first' : 'Let the AI organise these keywords into pillars — the topics this site should own'}>
            {clustering ? 'Organising…' : '✦ Build topic map'}
          </button>
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

      {/* Proposed topic map — nothing is saved until this is applied. */}
      {proposal && (
        <div className="ctl-group card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <b style={{ fontSize: 14 }}>Proposed topic map <span className="muted" style={{ fontWeight: 400 }}>({proposal.pillars.length} pillars · review before applying)</span></b>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={applyProposal}>Apply to plan</button>
              <button className="btn btn-ghost" onClick={() => setProposal(null)}>Discard</button>
            </div>
          </div>
          {proposal.pillars.map((p) => (
            <div key={p.name} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13.5 }}>{p.name}</b>
                <span className="status-pill" style={{ fontSize: 10 }}>{p.businessValue} value</span>
                <span className="muted" style={{ fontSize: 12 }}>{p.keywords.length} keywords</span>
              </div>
              {p.description && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{p.description}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {p.keywords.map((k) => (
                  <span key={k.keyword} className="build-chip" style={{ cursor: 'default', opacity: k.alreadyCovered ? 0.55 : 1 }}
                    title={`${k.intent} · ${k.funnel}${k.contentType ? ' · ' + k.contentType : ''}${k.alreadyCovered ? ' · already covered' : ''}`}>
                    {k.role === 'pillar' ? '★ ' : ''}{k.keyword}{k.alreadyCovered ? ' ⚠' : ''}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {!!proposal.unassigned?.length && (
            <div className="muted" style={{ fontSize: 12, marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              Didn&apos;t fit a pillar: {proposal.unassigned.join(' · ')}
            </div>
          )}
        </div>
      )}

      {/* Saved pillars — each can be gap-analysed for what's missing. */}
      {pillars.length > 0 && (
        <div className="ctl-group card" style={{ marginBottom: 14 }}>
          <b style={{ fontSize: 14 }}>Pillars</b>
          <div className="muted" style={{ fontSize: 12, marginTop: 2, marginBottom: 10 }}>
            The topics this site should own. “Find missing topics” mines the live search results for what a visitor expects but you don&apos;t have yet.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pillars.map((p) => {
              const count = items.filter((i) => i.cluster === p.name).length
              return (
                <div key={p.name} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <b style={{ fontSize: 13 }}>{p.name}</b>
                  <span className="status-pill" style={{ fontSize: 10 }}>{p.businessValue || 'medium'} value</span>
                  <span className="muted" style={{ fontSize: 12 }}>{count} keyword{count === 1 ? '' : 's'}</span>
                  <button className="btn-mini" style={{ marginLeft: 'auto' }} disabled={!!expanding}
                    onClick={() => expandPillar(p.name)}>
                    {expanding === p.name ? 'Analysing…' : '✦ Find missing topics'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Gap analysis for one pillar. */}
      {expansion && (
        <div className="ctl-group card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <b style={{ fontSize: 14 }}>Missing from “{expansion.pillar}”
              <span className="muted" style={{ fontWeight: 400 }}> · {expansion.missing.length} found{expansion.serpUsed ? ' · from live search results' : ''}</span>
            </b>
            <div style={{ display: 'flex', gap: 8 }}>
              {!!expansion.missing.length && <button className="btn btn-primary" onClick={addAllGaps}>Add all</button>}
              <button className="btn btn-ghost" onClick={() => setExpansion(null)}>Close</button>
            </div>
          </div>
          {!expansion.missing.length ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Nothing obvious is missing — this cluster looks complete.</p>
          ) : (
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Topic</th><th>Why it&apos;s missing</th><th style={{ width: 120 }}>Intent</th><th style={{ width: 70 }}></th></tr></thead>
              <tbody>
                {expansion.missing.map((g) => (
                  <tr key={g.keyword}>
                    <td><b style={{ fontSize: 13 }}>{g.keyword}</b></td>
                    <td className="muted" style={{ fontSize: 12 }}>{g.reason}</td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{g.intent}{g.funnel ? ` · ${g.funnel}` : ''}</td>
                    <td><button className="btn-mini" onClick={() => addGap(g, expansion.pillar)}>＋ Add</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* The saved map. Hover a pillar to isolate its cluster. */}
      {graphPillars.length > 0 && <ClusterGraph pillars={graphPillars} siteName={slug} />}

      {items.length === 0 ? (
        <div className="aside-block" style={{ textAlign: 'center', padding: 34 }}><p className="muted">No keywords yet. Add one above or pull ideas from Search Console.</p></div>
      ) : (
        <div className="tblwrap">
        {/* Existing cluster names, so they're one keystroke to reuse. */}
        <datalist id="uw-clusters">
          {[...new Set(items.map((i) => i.cluster).filter(Boolean))].map((c) => <option key={c as string} value={c as string} />)}
        </datalist>
        <table className="tbl">
          <thead><tr><th>Keyword</th><th style={{ width: 150 }}>Cluster</th><th style={{ width: 110 }}>Source</th><th style={{ width: 90 }}>Status</th><th style={{ width: 90 }}>SC</th><th style={{ width: 190 }}>Actions</th></tr></thead>
          <tbody>
            {sorted.map((it) => (
              <tr key={it.id}>
                <td>
                  <b>{it.keyword}</b>
                  {it.coveredBy && (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2, color: 'var(--warn, #a15c00)' }}
                      title="Two articles chasing the same query compete with each other and both rank worse. Consider refreshing the existing one instead.">
                      ⚠ Already covered by <a href={`/w/${slug}/p/${it.coveredBy.pageId}`}>{it.coveredBy.title || 'an existing article'}</a>
                    </div>
                  )}
                </td>
                <td>
                  <input className="inp" style={{ fontSize: 12, padding: '5px 8px' }} defaultValue={it.cluster || ''}
                    placeholder="— none —" list="uw-clusters"
                    title="Group related keywords under one topic. Articles in a cluster link to each other, which is how a topic ranks as a unit."
                    onBlur={(e) => { if ((e.target.value.trim() || undefined) !== it.cluster) setCluster(it.id, e.target.value) }} />
                </td>
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
