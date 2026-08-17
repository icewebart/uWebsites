'use client'
import { Fragment, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { TabBar } from '@/components/TabBar'
import { ClusterGraph, type GraphPillar } from '@/components/ClusterGraph'

// The approved plan for one article — a cheap review surface, since rejecting a
// twenty-line brief costs seconds and rejecting a finished article costs a
// regeneration plus your reading time.
type Brief = {
  title: string; angle: string; searchIntent?: string; wordTarget?: number
  outline: { h2: string; points: string[] }[]
  mustCover: string[]
  internalLinks: { url: string; anchor: string }[]
  cta?: string; status: 'draft' | 'approved'; generatedAt?: string; serpUsed?: boolean
}
type Item = { id: string; keyword: string; brief?: Brief; status: 'idea' | 'queued' | 'drafted' | 'published'; priority: number; source: string; impressions?: number; position?: number; pageId?: string; createdAt: string; coveredBy?: { pageId: string; title: string } | null; cluster?: string; role?: string; intent?: string; funnel?: string; contentType?: string }
type Pillar = { name: string; description?: string; businessValue?: string }
type Plan = { items: Item[]; auto: boolean; scLinked: boolean; pillars?: Pillar[]; autoApproveBriefs?: boolean; cadenceDays?: number | null }
// A proposed map from /ai/plan/cluster — reviewed before anything is saved.
type Proposed = { pillars: { name: string; description: string; businessValue: string; keywords: { keyword: string; role: string; intent: string; funnel: string; contentType: string; alreadyCovered: boolean }[] }[]; unassigned: string[] }
type Opp = { query: string; impressions: number; position: number; clicks: number }
// A custom-API connection (e.g. kids.ro) — content demand pulled straight
// from the connected site's own visitors, not a keyword tool guess.
type DemandTopic = { topic: string; kind: 'no_results' | 'thin_coverage' | 'empty_city_category'; citySlug: string | null; category?: string; count: number; lastSeen: string | null }
type DemandResponse = { generatedAt: string; windowDays: number; note?: string; topics: DemandTopic[] }
// The opportunity engine's output — one ranked row per keyword.
type Ranked = {
  id: string | null; keyword: string; source: 'plan' | 'search-console'
  score: number; tier: 'quick-win' | 'high' | 'medium' | 'low'; reason: string
  position: number | null; impressions: number | null; clicks: number | null
  volume: number | null; difficulty: number | null
  businessValue: 'high' | 'medium' | 'low'; cluster: string | null; intent: string | null; intentSource: 'plan' | 'serp' | null
  inPlan: boolean; coveredBy: { pageId: string; title: string } | null
}
type OppEngine = {
  opportunities: Ranked[]
  signals: { searchConsole: boolean; serpDifficulty: boolean; keywordProvider: boolean; days: number }
  counts: { total: number; quickWins: number; discovered: number }
}
// Phase C — content decay + the publishing calendar.
type DecayRow = { pageId: string; title: string; slug: string; url: string; severity: 'dropped' | 'slipping'; reason: string; lostClicks: number; positionNow: number; positionPrev: number; clicksNow: number; clicksPrev: number; keyword: string | null; freshnessNote: string | null }
type CalTask = { kind: 'refresh' | 'new'; title: string; keyword?: string | null; pageId?: string | null; id?: string | null; severity?: 'dropped' | 'slipping'; reason: string; priority: number }
type Calendar = {
  decay: DecayRow[]
  schedule: { week: number; items: CalTask[] }[]
  cadence: { perWeek: number; plan: string }
  signals: { searchConsole: boolean; serpFreshness: boolean }
  counts: { decaying: number; dropped: number; queued: number }
}
// Gap analysis for one pillar — proposed, never auto-added.
type Gap = { keyword: string; intent: string; funnel: string; contentType: string; reason: string }
type Expansion = { pillar: string; hub: string; missing: Gap[]; serpUsed: boolean }
// Plan Builder entry mode A — the interview, for a site with no keywords yet.
type Answers = { about: string; offers: string; audience: string; priorityServices: string; market: string; language: string }
const EMPTY_ANSWERS: Answers = { about: '', offers: '', audience: '', priorityServices: '', market: '', language: '' }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()))

// Opportunity tier → colour + label for the ranked table.
const scoreColor = (t: Ranked['tier']) => t === 'quick-win' ? '#128a4b' : t === 'high' ? '#2563eb' : t === 'medium' ? '#a15c00' : '#6b7280'
const tierLabel = (t: Ranked['tier']) => t === 'quick-win' ? 'Quick win' : t === 'high' ? 'High' : t === 'medium' ? 'Medium' : 'Low'
const sevColor = (s: DecayRow['severity']) => s === 'dropped' ? '#c0392b' : '#a15c00'

// The brief outline is structured (H2 + points) but edits best as plain text:
// one H2 per line, its points indented with "- ". These round-trip it.
function outlineToText(outline: Brief['outline']): string {
  return (outline || []).map((s) => [s.h2, ...(s.points || []).map((p) => `- ${p}`)].join('\n')).join('\n')
}
function textToOutline(text: string): Brief['outline'] {
  const out: Brief['outline'] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^[-*•]\s*/.test(line)) { if (out.length) out[out.length - 1].points.push(line.replace(/^[-*•]\s*/, '')) }
    else out.push({ h2: line, points: [] })
  }
  return out
}

export default function ArticlePlanPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [auto, setAuto] = useState(false)
  const [scLinked, setScLinked] = useState(false)
  const [kw, setKw] = useState('')
  const [bulk, setBulk] = useState('')
  const [opps, setOpps] = useState<Opp[] | null>(null)
  const [sugg, setSugg] = useState<{ seed: string; suggestions: string[] } | null>(null)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState(''); const [err, setErr] = useState('')
  const [pillars, setPillars] = useState<Pillar[]>([])
  const [proposal, setProposal] = useState<Proposed | null>(null)
  const [clustering, setClustering] = useState(false)
  const [expansion, setExpansion] = useState<Expansion | null>(null)
  const [expanding, setExpanding] = useState('')
  const [wizard, setWizard] = useState<Answers | null>(null)
  const [briefLoaded, setBriefLoaded] = useState(false)
  const [proposing, setProposing] = useState(false)
  const [openBrief, setOpenBrief] = useState<string | null>(null)
  const [briefing, setBriefing] = useState('')
  const [briefSaved, setBriefSaved] = useState('')
  const [autoApprove, setAutoApprove] = useState(false)
  // null = no override, just the account plan's cadence (e.g. Unlimited = daily).
  const [cadenceDays, setCadenceDays] = useState<number | null>(null)
  // The page does four jobs; tabs keep each one calm. Remembered across visits.
  const [tab, setTab] = useState<'map' | 'keywords' | 'opportunities' | 'calendar' | 'briefs'>('keywords')
  const [engine, setEngine] = useState<OppEngine | null>(null)
  const [scoring, setScoring] = useState(false)
  const [cal, setCal] = useState<Calendar | null>(null)
  const [calBusy, setCalBusy] = useState(false)
  const [refreshing, setRefreshing] = useState('')
  const [refreshed, setRefreshed] = useState<Record<string, { changes: string[]; wpUpdated: boolean }>>({})
  const [customConn, setCustomConn] = useState<{ name: string } | null>(null)
  const [demand, setDemand] = useState<DemandResponse | null>(null)
  useEffect(() => { try { const t = localStorage.getItem('uw-plan-tab') as any; if (t) setTab(t) } catch {} }, [])
  function goTab(t: 'map' | 'keywords' | 'opportunities' | 'calendar' | 'briefs') { setTab(t); try { localStorage.setItem('uw-plan-tab', t) } catch {} }
  // Load the calendar the first time the tab is opened (a couple of SC calls).
  useEffect(() => { if (tab === 'calendar' && !cal && !calBusy) loadCalendar() }, [tab])

  useEffect(() => {
    api<Plan>(`/account/workspaces/${slug}/article-plan`).then((d) => { setItems(d.items); setAuto(d.auto); setScLinked(d.scLinked); setPillars(d.pillars || []); setAutoApprove(!!d.autoApproveBriefs); setCadenceDays(d.cadenceDays ?? null) }).catch(() => router.push(`/w/${slug}`))
    // Step 0 of the interview is to NOT ask what we already know — prefill from
    // the Business Brief so the wizard is a confirmation, not a form.
    api<{ tokens: any }>(`/workspaces/${slug}/branding`).then((d) => {
      const bb = d?.tokens?.business_brief || {}
      setPrefill({ ...EMPTY_ANSWERS, about: bb.about || '', offers: bb.offers || '', audience: bb.audience || '' })
      setBriefLoaded(true)
    }).catch(() => setBriefLoaded(true))
    api<{ name: string } | null>(`/workspaces/${slug}/custom-connection`).then(setCustomConn).catch(() => setCustomConn(null))
  }, [slug])
  const [prefill, setPrefill] = useState<Answers>(EMPTY_ANSWERS)

  // Autosave whenever the list/auto changes (debounced-ish via a stable save).
  async function persist(next: Item[], nextAuto = auto, nextApprove = autoApprove, nextCadence = cadenceDays) {
    setItems(next); setAuto(nextAuto); setAutoApprove(nextApprove); setCadenceDays(nextCadence)
    try { await api(`/account/workspaces/${slug}/article-plan`, { method: 'PUT', body: JSON.stringify({ items: next, auto: nextAuto, pillars, autoApproveBriefs: nextApprove, cadenceDays: nextCadence }) }) }
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
  // Custom-API demand pull (e.g. kids.ro) — topics its own visitors search
  // for and it doesn't have, straight from real behaviour, not a guess.
  async function pullDemand() {
    setBusy('demand'); setErr(''); setDemand(null)
    try { setDemand(await api<DemandResponse>(`/workspaces/${slug}/custom-connection/pull-demand`, { method: 'POST' })) }
    catch (e: any) { setErr(e.message || 'Could not pull content demand') } finally { setBusy('') }
  }
  const demandKindLabel: Record<DemandTopic['kind'], string> = { no_results: 'no results', thin_coverage: 'thin coverage', empty_city_category: 'no inventory here' }
  function addDemandTopic(t: DemandTopic) {
    if (has(t.topic)) return
    persist([mk(t.topic, 'custom-api', { impressions: t.count || undefined }), ...items])
    setDemand((cur) => cur ? { ...cur, topics: cur.topics.filter((x) => x.topic !== t.topic) } : cur)
  }

  // Keyword discovery — Google Autocomplete around the seed in the add box.
  async function expandKeywords() {
    const seed = kw.trim(); if (!seed) return
    setBusy('expand'); setErr(''); setSugg(null)
    try { setSugg(await api<{ seed: string; suggestions: string[] }>(`/account/workspaces/${slug}/article-plan/expand`, { method: 'POST', body: JSON.stringify({ seed }) })) }
    catch (e: any) { setErr(e.message || 'Could not expand that keyword') } finally { setBusy('') }
  }
  function addSuggestion(k: string) {
    if (has(k)) return
    persist([mk(k, 'autocomplete'), ...items])
    setSugg((cur) => cur ? { ...cur, suggestions: cur.suggestions.filter((s) => s !== k) } : cur)
  }

  // The opportunity engine — score & rank every keyword by ROI. Uses Search
  // Console standing + SERP-estimated difficulty + business value on the server.
  async function runEngine() {
    setScoring(true); setErr(''); setNote('')
    try { setEngine(await api<OppEngine>(`/account/workspaces/${slug}/article-plan/opportunities`, { method: 'POST', body: JSON.stringify({}) })) }
    catch (e: any) { setErr(e.message || 'Could not score opportunities') } finally { setScoring(false) }
  }
  // Phase C — load the decay report + publishing calendar.
  async function loadCalendar() {
    setCalBusy(true); setErr('')
    try { setCal(await api<Calendar>(`/workspaces/${slug}/content/calendar`)) }
    catch (e: any) { setErr(e.message || 'Could not build the calendar') } finally { setCalBusy(false) }
  }
  // Refresh a decaying article in place (rewrites against the live SERP, keeps
  // the URL so rankings aren't lost; updates the WP post if it's already live).
  async function refreshArticle(pageId: string) {
    setRefreshing(pageId); setErr('')
    try {
      const r = await api<{ changes: string[]; wpUpdated: boolean }>('/ai/refresh-article', { method: 'POST', body: JSON.stringify({ pageId }) })
      setRefreshed((cur) => ({ ...cur, [pageId]: { changes: r.changes || [], wpUpdated: !!r.wpUpdated } }))
      setNote('Article refreshed ✓ — open it to review the updated draft.')
    } catch (e: any) { setErr(e.message || 'Refresh failed') } finally { setRefreshing('') }
  }
  // Pull a discovered (Search-Console-only) opportunity into the plan, carrying
  // its standing so the row shows the same numbers.
  function addRanked(r: Ranked) {
    if (has(r.keyword)) return
    persist([mk(r.keyword, 'search-console', { impressions: r.impressions ?? undefined, position: r.position != null ? Math.round(r.position * 10) / 10 : undefined, cluster: r.cluster || undefined, intent: r.intent || undefined }), ...items])
    setEngine((cur) => cur ? { ...cur, opportunities: cur.opportunities.map((o) => o.keyword === r.keyword ? { ...o, inPlan: true, id: 'pending' } : o) } : cur)
  }
  // Draft straight from the engine — find or create the plan item, then write.
  async function draftRanked(r: Ranked) {
    let it = items.find((i) => i.id === r.id || i.keyword.toLowerCase().trim() === r.keyword.toLowerCase().trim())
    if (!it) { it = mk(r.keyword, 'search-console', { impressions: r.impressions ?? undefined, position: r.position != null ? Math.round(r.position * 10) / 10 : undefined, cluster: r.cluster || undefined }); await persist([it, ...items]) }
    await draftNow(it)
  }
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
  // Entry mode A — no keywords yet. The map is derived from the business itself
  // (Business Brief + what's already published), then reviewed in the same panel.
  async function proposeFromBusiness() {
    if (!wizard) return
    setProposing(true); setErr(''); setNote('')
    try {
      setProposal(await api<Proposed>('/ai/plan/propose', { method: 'POST', body: JSON.stringify({ slug, answers: wizard }) }))
      setWizard(null)
    } catch (e: any) { setErr(e.message || 'Could not build a proposal') } finally { setProposing(false) }
  }

  async function applyProposal() {
    if (!proposal) return
    const byKw = new Map<string, { cluster: string; role: string; intent: string; funnel: string; contentType: string }>()
    const order: string[] = []
    for (const p of proposal.pillars) {
      for (const k of p.keywords) {
        const key = k.keyword.toLowerCase().trim()
        if (!byKw.has(key)) order.push(k.keyword.trim())
        byKw.set(key, { cluster: p.name, role: k.role, intent: k.intent, funnel: k.funnel, contentType: k.contentType })
      }
    }
    // Existing keywords get enriched in place; anything the proposal invented
    // (entry mode A) is created — otherwise a from-scratch map would apply to
    // nothing and look like it silently failed.
    const enriched = items.map((i) => {
      const m = byKw.get(i.keyword.toLowerCase().trim())
      return m ? { ...i, ...m } : i
    })
    const created = order.filter((k) => !has(k)).map((k) => mk(k, 'ai-plan', byKw.get(k.toLowerCase())!))
    const next = [...created, ...enriched]
    const nextPillars: Pillar[] = proposal.pillars.map((p) => ({ name: p.name, description: p.description, businessValue: p.businessValue }))
    setPillars(nextPillars)
    setItems(next)
    try {
      await api(`/account/workspaces/${slug}/article-plan`, { method: 'PUT', body: JSON.stringify({ items: next, auto, pillars: nextPillars }) })
      setNote(`Applied ${nextPillars.length} pillars${created.length ? ` · ${created.length} new keywords added` : ''} across ${byKw.size} keywords.`)
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

  // ── Content briefs. Generated per keyword, reviewed, then the writer executes
  //    them instead of improvising. Nothing is auto-approved unless you say so.
  async function writeBrief(it: Item) {
    setBriefing(it.id); setErr('')
    try {
      const b = await api<Brief>('/ai/plan/brief', { method: 'POST', body: JSON.stringify({ slug, keyword: it.keyword }) })
      await persist(items.map((i) => i.id === it.id ? { ...i, brief: b } : i))
      setOpenBrief(it.id)
    } catch (e: any) { setErr(e.message || 'Could not write the brief') } finally { setBriefing('') }
  }
  function patchBrief(id: string, patch: Partial<Brief>) {
    persist(items.map((i) => i.id === id && i.brief ? { ...i, brief: { ...i.brief, ...patch } } : i))
    setBriefSaved(id); setTimeout(() => setBriefSaved((c) => c === id ? '' : c), 1800)
  }
  async function writeBriefsBulk() {
    // The next few unbriefed keywords, highest priority first — one click for a
    // month of planning rather than one click per keyword.
    const queue = sorted.filter((i) => !i.brief && i.status !== 'published').slice(0, 5)
    if (!queue.length) return
    setBriefing('bulk'); setErr('')
    let next = items
    for (const it of queue) {
      try {
        const b = await api<Brief>('/ai/plan/brief', { method: 'POST', body: JSON.stringify({ slug, keyword: it.keyword }) })
        next = next.map((i) => i.id === it.id ? { ...i, brief: b } : i)
      } catch { /* one failure shouldn't lose the briefs already written */ }
    }
    await persist(next)
    setBriefing(''); setNote(`Wrote ${next.filter((i) => i.brief).length - items.filter((i) => i.brief).length} briefs — review them before the writer runs.`)
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

  // Live counts, shown above every tab so switching lens never loses the big picture.
  const briefedCount = items.filter((i) => i.brief).length
  const approvedCount = items.filter((i) => i.brief && (i.brief.status === 'approved' || autoApprove)).length

  // Does this keyword already have an article (ours, or a matched existing page)?
  const articleOf = (it: Item): { pageId: string; kind: 'article' | 'draft' } | null => {
    const pageId = it.coveredBy?.pageId || it.pageId
    if (!pageId) return null
    return { pageId, kind: (it.coveredBy || it.status === 'published') ? 'article' : 'draft' }
  }
  const writtenCount = items.filter((i) => articleOf(i)).length
  // The write step requires a plan: a brief must exist, and be approved (or the
  // workspace auto-approves). This is the "brief, then write" flow.
  const readyToDraft = (it: Item) => !!it.brief && (it.brief.status === 'approved' || autoApprove)
  const draftTip = (it: Item) => !it.brief ? 'Plan a brief first — click ✦ Brief, review it, approve.'
    : (it.brief.status !== 'approved' && !autoApprove) ? 'Approve the brief first (open it → Approve brief).'
    : 'Write the article to the approved brief'
  // A link to our own draft/article for this keyword (only when WE wrote one).
  const seeArticle = (it: Item) => it.pageId
    ? <a className={`kw-has${it.status === 'published' ? '' : ' draft'}`} href={`/w/${slug}/p/${it.pageId}`}>{it.status === 'published' ? '✓ See article' : '✎ See draft'}</a>
    : null

  // The expandable brief editor, shared by the Keywords and Briefs tabs.
  const briefPanel = (it: Item) => (!it.brief ? null : (
    <div style={{ display: 'grid', gap: 10, maxWidth: 780 }}>
      <div>
        <label className="muted" style={{ fontSize: 11.5 }}>Working title</label>
        <input className="inp" defaultValue={it.brief.title} style={{ fontSize: 13 }}
          onBlur={(e) => e.target.value !== it.brief!.title && patchBrief(it.id, { title: e.target.value })} />
      </div>
      <div>
        <label className="muted" style={{ fontSize: 11.5 }}>The angle — what makes this different from its siblings</label>
        <textarea className="inp" rows={2} defaultValue={it.brief.angle} style={{ fontSize: 13 }}
          onBlur={(e) => e.target.value !== it.brief!.angle && patchBrief(it.id, { angle: e.target.value })} />
      </div>
      {!!it.brief.outline?.length && (
        <div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>Outline · target ~{it.brief.wordTarget} words{it.brief.serpUsed ? ' · grounded in live search results' : ''} · one H2 per line, indent points with “- ”</div>
          <textarea className="inp" style={{ fontSize: 12.5, minHeight: 130, fontFamily: 'inherit' }}
            defaultValue={outlineToText(it.brief.outline)}
            onBlur={(e) => { const o = textToOutline(e.target.value); if (JSON.stringify(o) !== JSON.stringify(it.brief!.outline)) patchBrief(it.id, { outline: o }) }} />
        </div>
      )}
      <div><div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>Must cover · one per line</div>
        <textarea className="inp" style={{ fontSize: 12.5, minHeight: 70, fontFamily: 'inherit' }}
          defaultValue={(it.brief.mustCover || []).join('\n')}
          onBlur={(e) => { const m = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); if (JSON.stringify(m) !== JSON.stringify(it.brief!.mustCover)) patchBrief(it.id, { mustCover: m }) }} />
      </div>
      {!!it.brief.internalLinks?.length && (
        <div><div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>Internal links (verified against real pages)</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
            {it.brief.internalLinks.map((l, li) => <li key={li}>{l.anchor} → <span className="muted">{l.url}</span></li>)}
          </ul></div>
      )}
      <div>
        <label className="muted" style={{ fontSize: 11.5 }}>Leads to (which offer this article should push)</label>
        <input className="inp" defaultValue={it.brief.cta || ''} style={{ fontSize: 13 }}
          onBlur={(e) => e.target.value !== (it.brief!.cta || '') && patchBrief(it.id, { cta: e.target.value })} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {it.brief.status === 'approved'
          ? <span className="muted" style={{ fontSize: 12 }}>✓ Approved — the writer will follow this.</span>
          : <button className="btn btn-primary" onClick={() => patchBrief(it.id, { status: 'approved' })}>Approve brief</button>}
        <button className="btn-mini" onClick={() => writeBrief(it)} disabled={!!briefing}>{briefing === it.id ? 'Rewriting…' : '↻ Rewrite'}</button>
        <button className="btn-mini danger" onClick={() => persist(items.map((i) => i.id === it.id ? { ...i, brief: undefined } : i))}>Discard</button>
        <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto', color: briefSaved === it.id ? 'var(--forest)' : undefined }}>
          {briefSaved === it.id ? '✓ Saved' : 'Edits save automatically'}
        </span>
      </div>
    </div>
  ))

  const briefBadge = (it: Item) => it.brief ? (
    <button className="btn-mini" onClick={() => setOpenBrief(openBrief === it.id ? null : it.id)} title={it.brief.angle}>
      {openBrief === it.id ? '▾' : '▸'} {it.brief.status === 'approved' || autoApprove ? '✓ brief' : 'draft brief'}
    </button>
  ) : (
    <button className="btn-mini" onClick={() => writeBrief(it)} disabled={!!briefing}
      title="Plan the article before writing it — angle, outline, what it must cover, which pages it links to.">
      {briefing === it.id ? 'Planning…' : '✦ Brief'}
    </button>
  )

  return (
    <AppShell title="Article Plan" currentSlug={slug} active="Article Plan">
      <TabBar tabs={[
        { label: 'Overview', href: `/w/${slug}/content`, active: false },
        { label: 'Plan', href: `/w/${slug}/article-plan`, active: true },
        { label: 'Library', href: `/w/${slug}/articles`, active: false },
      ]} />
      {/* Stat strip — visible on every tab, so a tab never hides the whole picture. */}
      <div className="uw-stats">
        <div className="st"><b>{items.length}</b><span>Keywords</span></div>
        <div className="st"><b>{pillars.length}</b><span>Pillars</span></div>
        <div className="st"><b>{writtenCount}</b><span>Written</span></div>
        <div className="st"><b>{briefedCount}</b><span>Briefed</span></div>
        <div className="st"><b>{approvedCount}</b><span>Approved</span></div>
        <div style={{ marginLeft: 'auto' }}><span className={`status-pill ${auto ? 'live' : 'draft'}`}>{auto ? '⏱ Weekly auto-write on' : 'Auto-write off'}</span></div>
      </div>

      {/* Tabs follow the pipeline: shape topics → groom the queue → approve briefs. */}
      <div className="uw-tabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'map' ? 'on' : ''} onClick={() => goTab('map')}>Map <span className="tc">{pillars.length}</span></button>
        <button className={tab === 'keywords' ? 'on' : ''} onClick={() => goTab('keywords')}>Keywords <span className="tc">{items.length}</span></button>
        <button className={tab === 'opportunities' ? 'on' : ''} onClick={() => goTab('opportunities')}>Opportunities{engine ? <span className="tc">{engine.counts.total}</span> : null}</button>
        <button className={tab === 'calendar' ? 'on' : ''} onClick={() => goTab('calendar')}>Calendar{cal && cal.counts.decaying > 0 ? <span className="tc" style={{ background: '#a15c0022', color: '#a15c00' }}>{cal.counts.decaying}</span> : null}</button>
        <button className={tab === 'briefs' ? 'on' : ''} onClick={() => goTab('briefs')}>Briefs <span className="tc">{briefedCount}</span></button>
      </div>

      {note && <div className="banner-ok" style={{ marginBottom: 12 }}>{note}</div>}
      {err && <div className="err" style={{ marginBottom: 12 }}>{err}</div>}

      {/* ── ① MAP — shape what this site should own. ─────────────────────── */}
      {tab === 'map' && (<>
      <div className="dash-sub" style={{ marginBottom: 14 }}>
        The topics this site should own, and how they link. Build the map from your existing keywords, or from the business itself.
      </div>
      <div className="ctl-group card" style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={buildClusters} disabled={clustering || items.length < 3}
          title={items.length < 3 ? 'Add at least 3 keywords first (Keywords tab)' : 'Let the AI organise these keywords into pillars — the topics this site should own'}>
          {clustering ? 'Organising…' : '✦ Build topic map from keywords'}
        </button>
        <button className={`btn ${items.length < 3 ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setWizard(prefill)} disabled={!briefLoaded || !!wizard}
          title="No keyword list yet? Build the map from what the business actually sells.">
          ✦ Start from the business
        </button>
      </div>

      {/* Entry mode A: the interview. Prefilled from the Business Brief — every
          field left blank here is a field the AI has to guess, so the answers
          are the difference between a real map and generic slop. */}
      {wizard && (
        <div className="ctl-group card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
            <b style={{ fontSize: 14 }}>Build the plan from the business</b>
            <button className="btn-mini" onClick={() => setWizard(null)}>Cancel</button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: '0 0 12px' }}>
            Answer what you can — this is prefilled from your <a href={`/w/${slug}/business-brief`}>Business Brief</a>. The AI proposes pillars and keywords; nothing is saved until you review and apply.
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            {([
              ['about', 'What does the business do?', 'e.g. We run German language courses for adults and children in Bucharest', 3],
              ['offers', 'What do you actually sell?', 'e.g. group courses, private lessons, exam prep (Goethe, telc), corporate training', 2],
              ['priorityServices', 'Which of those bring in the most revenue?', 'The AI weights these pillars highest', 1],
              ['audience', 'Who buys it?', 'e.g. parents of school-age kids, professionals relocating to Germany', 2],
            ] as [keyof Answers, string, string, number][]).map(([k, label, ph, rows]) => (
              <div key={k}>
                <label className="muted" style={{ fontSize: 12 }}>{label}</label>
                <textarea className="inp" rows={rows} value={wizard[k]} placeholder={ph}
                  onChange={(e) => setWizard({ ...wizard, [k]: e.target.value })} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label className="muted" style={{ fontSize: 12 }}>Where do you serve?</label>
                <input className="inp" value={wizard.market} placeholder="e.g. Bucharest / nationwide / EU"
                  onChange={(e) => setWizard({ ...wizard, market: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 160px' }}>
                <label className="muted" style={{ fontSize: 12 }}>Keyword language</label>
                <input className="inp" value={wizard.language} placeholder="e.g. Romanian"
                  onChange={(e) => setWizard({ ...wizard, language: e.target.value })} />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <button className="btn btn-primary" onClick={proposeFromBusiness} disabled={proposing || (!wizard.about.trim() && !wizard.offers.trim())}>
              {proposing ? 'Thinking…' : '✦ Propose pillars & keywords'}
            </button>
            {!wizard.about.trim() && !wizard.offers.trim() && (
              <span className="muted" style={{ fontSize: 12 }}>Describe the business first — a map built from nothing would be generic.</span>
            )}
          </div>
        </div>
      )}

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
      {graphPillars.length > 0
        ? <ClusterGraph pillars={graphPillars} siteName={slug} />
        : <div className="aside-block" style={{ textAlign: 'center', padding: 30 }}><p className="muted">No topic map yet. Add keywords on the <b>Keywords</b> tab then “Build topic map”, or “Start from the business” above.</p></div>}
      </>)}

      {/* ── ② KEYWORDS — the working queue. ─────────────────────────────── */}
      {tab === 'keywords' && (<>
      <div className="ctl-group card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}><label className="muted" style={{ fontSize: 12 }}>Add a keyword</label><input className="inp" value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOne()} placeholder="e.g. tabere de vara pentru copii" /></div>
          <button className="btn btn-primary" onClick={addOne} disabled={!kw.trim()}>＋ Add</button>
          <button className="btn btn-secondary" onClick={expandKeywords} disabled={!kw.trim() || busy === 'expand'} title="Find related keywords people actually search (Google Autocomplete)">{busy === 'expand' ? 'Expanding…' : '✨ Expand'}</button>
          <button className="btn btn-secondary" onClick={pullSC} disabled={!scLinked || busy === 'sc'} title={scLinked ? 'Pull near-ranking queries from Search Console' : 'Link a Search Console property first (Tracking)'}>{busy === 'sc' ? 'Pulling…' : '↧ Pull from Search Console'}</button>
          {customConn && (
            <button className="btn btn-secondary" onClick={pullDemand} disabled={busy === 'demand'} title={`Pull real search demand from ${customConn.name}'s own visitors`}>{busy === 'demand' ? 'Pulling…' : `↧ Pull demand from ${customConn.name}`}</button>
          )}
        </div>
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>Paste a list (one keyword per line)</summary>
          <textarea className="inp" rows={4} style={{ marginTop: 8 }} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'keyword one\nkeyword two\nkeyword three'} />
          <button className="btn-mini" style={{ marginTop: 6 }} onClick={addBulk} disabled={!bulk.trim()}>Add all</button>
        </details>
      </div>

      {sugg && (
        <div className="ctl-group card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b style={{ fontSize: 14 }}>Related keywords <span className="muted" style={{ fontWeight: 400 }}>(Google Autocomplete for “{sugg.seed}”)</span></b>
            <button className="btn-mini" onClick={() => setSugg(null)}>Close</button>
          </div>
          {!sugg.suggestions.length ? <p className="muted" style={{ fontSize: 13 }}>No new suggestions — you may already have these, or the seed is too specific.</p> : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {sugg.suggestions.map((s) => (
                <button key={s} className="btn-mini" onClick={() => addSuggestion(s)} title="Add to plan">＋ {s}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {demand && (
        <div className="ctl-group card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <b style={{ fontSize: 14 }}>Content demand from {customConn?.name} <span className="muted" style={{ fontWeight: 400 }}>(what its own visitors search for and don&apos;t find)</span></b>
            <button className="btn-mini" onClick={() => setDemand(null)}>Close</button>
          </div>
          {!demand.topics.length ? <p className="muted" style={{ fontSize: 13 }}>No demand gaps right now — everything searched for is either covered or already an article.</p> : (
            <div className="tblwrap"><table className="tbl">
              <thead><tr><th>Topic</th><th style={{ width: 130 }}>Signal</th><th style={{ width: 70 }}>Count</th><th style={{ width: 80 }}></th></tr></thead>
              <tbody>{demand.topics.map((t) => (
                <tr key={t.topic}><td>{t.topic}{t.citySlug ? <span className="muted" style={{ fontSize: 11 }}> · {t.citySlug}</span> : null}</td><td className="muted" style={{ fontSize: 12 }}>{demandKindLabel[t.kind]}</td><td className="muted" style={{ fontSize: 12 }}>{t.count || '—'}</td><td>{has(t.topic) ? <span className="muted" style={{ fontSize: 12 }}>added</span> : <button className="btn-mini" onClick={() => addDemandTopic(t)}>＋ Add</button>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </div>
      )}

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

      {items.length === 0 ? (
        <div className="aside-block" style={{ textAlign: 'center', padding: 34 }}><p className="muted">No keywords yet. Add one above or pull ideas from Search Console.</p></div>
      ) : (
        <div className="tblwrap">
        {/* Existing cluster names, so they're one keystroke to reuse. */}
        <datalist id="uw-clusters">
          {[...new Set(items.map((i) => i.cluster).filter(Boolean))].map((c) => <option key={c as string} value={c as string} />)}
        </datalist>
        <table className="tbl">
          <thead><tr><th>Keyword</th><th style={{ width: 150 }}>Cluster</th><th style={{ width: 110 }}>Source</th><th style={{ width: 90 }}>Status</th><th style={{ width: 90 }}>SC</th><th style={{ width: 104 }}>Brief</th><th style={{ width: 190 }}>Actions</th></tr></thead>
          <tbody>
            {sorted.map((it) => (
              <Fragment key={it.id}>
              <tr>
                <td>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{it.keyword}</b>{seeArticle(it)}</div>
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
                <td>{briefBadge(it)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {it.pageId
                      ? <a className="btn-mini" href={`/w/${slug}/p/${it.pageId}`}>{it.status === 'published' ? 'See article ↗' : 'See draft ↗'}</a>
                      : <button className="btn-mini" onClick={() => draftNow(it)} disabled={busy === it.id || !readyToDraft(it)} title={draftTip(it)}>{busy === it.id ? 'Writing…' : '✍ Draft now'}</button>}
                    <button className="btn-mini" title="Raise priority" onClick={() => bump(it.id, 1)}>▲</button>
                    <button className="btn-mini danger" onClick={() => remove(it.id)}>✕</button>
                  </div>
                </td>
              </tr>
              {openBrief === it.id && it.brief && (
                <tr><td colSpan={7} style={{ background: 'var(--bg-soft, rgba(127,127,127,.05))', padding: '14px 12px' }}>{briefPanel(it)}</td></tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
      )}
      </>)}

      {/* ── ③ OPPORTUNITIES — the engine: every keyword ranked by ROI. */}
      {tab === 'opportunities' && (<>
      <div className="ctl-group card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <b style={{ fontSize: 14 }}>Opportunity engine</b>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
              Ranks every keyword by ROI — real demand, how close you are to page 1, how hard the SERP is, and how much the topic is worth to the business. Quick wins float to the top.
            </p>
          </div>
          <button className="btn btn-primary" onClick={runEngine} disabled={scoring || items.length === 0}>
            {scoring ? 'Scoring…' : engine ? '↻ Rescore' : '⚡ Score opportunities'}
          </button>
        </div>
        {engine && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span>{engine.counts.quickWins} quick win{engine.counts.quickWins === 1 ? '' : 's'}</span>
            <span>·</span>
            <span title="Ranked using: Search Console standing, live-SERP difficulty, and business value.">
              Signals: {engine.signals.searchConsole ? '✓ Search Console' : '○ Search Console'} · {engine.signals.serpDifficulty ? '✓ SERP difficulty' : '○ SERP difficulty'} · {engine.signals.keywordProvider ? '✓ volume' : '○ volume (add a keyword tool)'}
            </span>
            {engine.counts.discovered > 0 && <><span>·</span><span>{engine.counts.discovered} discovered in Search Console (not yet planned)</span></>}
          </div>
        )}
      </div>

      {!engine ? (
        <div className="aside-block" style={{ textAlign: 'center', padding: 34 }}>
          <p className="muted">{items.length === 0 ? 'Add keywords first, then score them.' : 'Score your keywords to see what to write next, ranked by opportunity.'}</p>
        </div>
      ) : !engine.opportunities.length ? (
        <div className="aside-block" style={{ textAlign: 'center', padding: 34 }}><p className="muted">Nothing to rank yet.</p></div>
      ) : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr>
            <th style={{ width: 64 }}>Score</th><th>Keyword</th>
            <th style={{ width: 104 }}>Standing</th><th style={{ width: 88 }}>Difficulty</th>
            <th style={{ width: 74 }}>Value</th><th style={{ width: 150 }}>Actions</th>
          </tr></thead>
          <tbody>
            {engine.opportunities.map((o) => (
              <tr key={(o.id || o.keyword) + o.source}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, width: 22 }}>{o.score}</span>
                    <span style={{ display: 'inline-block', height: 6, borderRadius: 3, flex: 1, minWidth: 20, background: 'var(--bg-soft, rgba(127,127,127,.15))' }}>
                      <span style={{ display: 'block', height: '100%', borderRadius: 3, width: `${o.score}%`, background: scoreColor(o.tier) }} />
                    </span>
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <b>{o.keyword}</b>
                    <span className="status-pill" style={{ background: `${scoreColor(o.tier)}22`, color: scoreColor(o.tier), fontSize: 10.5, fontWeight: 700 }}>{tierLabel(o.tier)}</span>
                    {o.intent && <span className="muted" style={{ fontSize: 10.5, textTransform: 'capitalize' }} title={o.intentSource === 'serp' ? 'Intent detected from the live SERP' : 'Intent from the topic map'}>{o.intent}{o.intentSource === 'serp' ? ' ·SERP' : ''}</span>}
                    {!o.inPlan && <span className="muted" style={{ fontSize: 10.5 }}>discovered</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{o.reason}</div>
                  {o.coveredBy && (
                    <div style={{ fontSize: 11, marginTop: 2, color: 'var(--warn, #a15c00)' }}>
                      ⚠ Covered by <a href={`/w/${slug}/p/${o.coveredBy.pageId}`}>{o.coveredBy.title || 'an existing article'}</a> — refresh instead
                    </div>
                  )}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{o.position != null ? `#${o.position.toFixed(1)}${o.impressions != null ? ` · ${o.impressions} impr` : ''}` : '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>{o.difficulty != null ? `${o.difficulty}/100` : '—'}</td>
                <td><span className="muted" style={{ fontSize: 12, textTransform: 'capitalize' }}>{o.businessValue}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {o.coveredBy
                      ? <a className="btn-mini" href={`/w/${slug}/p/${o.coveredBy.pageId}`}>Refresh ↗</a>
                      : o.inPlan
                        ? <button className="btn-mini" onClick={() => draftRanked(o)} disabled={busy === o.id}>{busy === o.id ? 'Writing…' : '✍ Draft'}</button>
                        : <button className="btn-mini" onClick={() => addRanked(o)}>＋ Add to plan</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      </>)}

      {/* ── ④ CALENDAR — content decay + a scheduled refresh/publish plan. */}
      {tab === 'calendar' && (<>
      <div className="ctl-group card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <b style={{ fontSize: 14 }}>Content calendar</b>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
              Catches articles that are slipping in Search Console before they fall off, and schedules refreshes alongside your top new opportunities — {cal ? cal.cadence.perWeek : '—'}/week.
            </p>
          </div>
          <button className="btn btn-secondary" onClick={loadCalendar} disabled={calBusy}>{calBusy ? 'Scanning…' : cal ? '↻ Rescan' : 'Scan'}</button>
        </div>
        {cal && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span>{cal.counts.decaying} decaying{cal.counts.dropped > 0 ? ` (${cal.counts.dropped} dropped)` : ''}</span>
            <span>·</span>
            <span>{cal.counts.queued} queued to write</span>
            <span>·</span>
            <span title="Decay from Search Console window-over-window; freshness from the live SERP.">Signals: {cal.signals.searchConsole ? '✓ Search Console' : '○ Search Console — link it on Tracking'} · {cal.signals.serpFreshness ? '✓ SERP freshness' : '○ SERP freshness'}</span>
          </div>
        )}
      </div>

      {calBusy && !cal ? (
        <div className="aside-block" style={{ textAlign: 'center', padding: 34 }}><p className="muted">Scanning Search Console for slipping articles…</p></div>
      ) : !cal ? null : (<>
        {!cal.signals.searchConsole && (
          <div className="banner-ok" style={{ marginBottom: 14, background: '#a15c0014', borderColor: '#a15c0033' }}>
            <span className="muted" style={{ fontSize: 12.5 }}>Decay detection needs Search Console — <a href={`/w/${slug}/tracking`}>link a property</a> to catch slipping articles. The schedule below still orders your queued keywords by opportunity.</span>
          </div>
        )}
        {/* Decay alerts */}
        {cal.decay.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <b style={{ fontSize: 13 }}>Needs attention</b>
            <div className="tblwrap" style={{ marginTop: 8 }}><table className="tbl">
              <thead><tr><th>Article</th><th style={{ width: 120 }}>Trend</th><th style={{ width: 200 }}>Actions</th></tr></thead>
              <tbody>{cal.decay.map((d) => (
                <tr key={d.pageId}>
                  <td>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <b>{d.title}</b>
                      <span className="status-pill" style={{ background: `${sevColor(d.severity)}22`, color: sevColor(d.severity), fontSize: 10.5, fontWeight: 700, textTransform: 'capitalize' }}>{d.severity}</span>
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{d.reason}</div>
                    {refreshed[d.pageId] && (
                      <div style={{ fontSize: 11, marginTop: 3, color: 'var(--ok, #128a4b)' }}>
                        ✓ Refreshed{refreshed[d.pageId].wpUpdated ? ' · updated on WordPress' : ''}{refreshed[d.pageId].changes.length ? ` — ${refreshed[d.pageId].changes[0]}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{d.positionPrev > 0 && d.positionNow > 0 ? `#${d.positionPrev.toFixed(0)}→#${d.positionNow.toFixed(0)}` : d.clicksNow === 0 ? 'fell out' : `${d.clicksNow} clicks`}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="btn-mini" onClick={() => refreshArticle(d.pageId)} disabled={refreshing === d.pageId}>{refreshing === d.pageId ? 'Refreshing…' : '↻ Refresh'}</button>
                      <a className="btn-mini" href={`/w/${slug}/p/${d.pageId}`}>See article ↗</a>
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        )}

        {/* Weekly schedule */}
        {cal.schedule.length === 0 ? (
          <div className="aside-block" style={{ textAlign: 'center', padding: 28 }}><p className="muted">{cal.decay.length ? 'All caught up on new content — the refreshes above are the priority.' : 'Nothing scheduled — add keywords or wait for Search Console data to build up.'}</p></div>
        ) : (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
            {cal.schedule.map((wk) => (
              <div key={wk.week} className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .3, marginBottom: 8 }} className="muted">{wk.week === 1 ? 'This week' : `Week ${wk.week}`}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {wk.items.map((t, i) => (
                    <div key={i} style={{ borderLeft: `3px solid ${t.kind === 'refresh' ? sevColor(t.severity || 'slipping') : '#2563eb'}`, paddingLeft: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: t.kind === 'refresh' ? sevColor(t.severity || 'slipping') : '#2563eb' }}>{t.kind === 'refresh' ? 'Refresh' : 'Write'}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, margin: '1px 0' }}>{t.title}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{t.reason}</div>
                      <div style={{ marginTop: 4 }}>
                        {t.kind === 'refresh' && t.pageId
                          ? <button className="btn-mini" onClick={() => refreshArticle(t.pageId!)} disabled={refreshing === t.pageId}>{refreshing === t.pageId ? 'Refreshing…' : '↻ Refresh'}</button>
                          : (() => { const it = items.find((x) => x.id === t.id); return it ? (it.pageId ? <a className="btn-mini" href={`/w/${slug}/p/${it.pageId}`}>See draft ↗</a> : <button className="btn-mini" onClick={() => draftNow(it)} disabled={busy === it.id || !readyToDraft(it)} title={draftTip(it)}>{busy === it.id ? 'Writing…' : '✍ Draft'}</button>) : null })()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </>)}
      </>)}

      {/* ── ⑤ BRIEFS — plan each article before it's written, review & approve. */}
      {tab === 'briefs' && (<>
      <div className="ctl-group card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={writeBriefsBulk} disabled={!!briefing || !items.some((i) => !i.brief && i.status !== 'published')}
            title="Plan the next 5 unbriefed articles: angle, outline, must-cover points, internal links.">
            {briefing === 'bulk' ? 'Planning…' : '✦ Brief next 5'}
          </button>
          <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', marginLeft: 'auto' }}>
            <input type="checkbox" checked={auto} onChange={(e) => persist(items, e.target.checked)} style={{ width: 'auto' }} /> Weekly auto-write
          </label>
          {auto && (
            <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}
              title="Slows down JUST this workspace, without touching your account's plan cadence or any other workspace on it.">
              Write every
              <input type="number" min={0} max={30} className="num" style={{ width: 52 }}
                placeholder="plan default" value={cadenceDays ?? ''}
                onChange={(e) => persist(items, auto, autoApprove, e.target.value ? Number(e.target.value) : null)} />
              days
            </label>
          )}
          <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
            title="Briefs are still written and still enforced by the quality gate — they just don't wait for your approval before the weekly writer runs.">
            <input type="checkbox" checked={autoApprove} onChange={(e) => persist(items, auto, e.target.checked)} style={{ width: 'auto' }} /> Auto-approve briefs
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>
          A keyword with an <b>approved brief</b> is written to that plan rather than improvised, and the quality gate grades the draft on whether it followed the brief. Drafts land in <a href={`/w/${slug}/articles`}>Library</a>.
          {auto && !cadenceDays && ' Currently writing as often as your plan allows — set a day count above to slow just this workspace down.'}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="aside-block" style={{ textAlign: 'center', padding: 34 }}><p className="muted">No keywords yet. Add some on the <b>Keywords</b> tab first.</p></div>
      ) : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Keyword</th><th style={{ width: 160 }}>Cluster</th><th style={{ width: 130 }}>Brief</th><th style={{ width: 130 }}></th></tr></thead>
          <tbody>
            {sorted.map((it) => (
              <Fragment key={it.id}>
              <tr>
                <td><div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{it.keyword}</b>{seeArticle(it)}</div></td>
                <td className="muted" style={{ fontSize: 12 }}>{it.cluster || '—'}</td>
                <td>{briefBadge(it)}</td>
                <td>{it.pageId
                  ? <a className="btn-mini" href={`/w/${slug}/p/${it.pageId}`}>{it.status === 'published' ? 'See article ↗' : 'See draft ↗'}</a>
                  : <button className="btn-mini" onClick={() => draftNow(it)} disabled={busy === it.id || !readyToDraft(it)} title={draftTip(it)}>{busy === it.id ? 'Writing…' : '✍ Draft now'}</button>}</td>
              </tr>
              {openBrief === it.id && it.brief && (
                <tr><td colSpan={4} style={{ background: 'var(--bg-soft, rgba(127,127,127,.05))', padding: '14px 12px' }}>{briefPanel(it)}</td></tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
      )}
      </>)}
    </AppShell>
  )
}
