// SERP grounding — what ACTUALLY ranks for a keyword.
//
// The article rules tell the writer to "match or exceed the depth of what
// already ranks", but until now it had no idea what that was: it wrote from
// training data alone. This feeds it the real top results + the questions
// Google shows, so coverage is based on the live SERP instead of a guess.
//
// Provider: serper.dev (simple JSON, cheap). Inert without SERPER_API_KEY —
// fetchSerp() returns null and the writer carries on exactly as before.

export type SerpResult = { title: string; link: string; snippet?: string }
// The featured-snippet Google shows for a query, and its FORMAT — so the writer
// can shape its direct answer to win it (paragraph / list / table).
export type SerpAnswerBox = { format: 'paragraph' | 'list' | 'table'; snippet?: string; source?: string }
export type SerpIntentKind = 'informational' | 'commercial' | 'transactional' | 'navigational' | 'local'
// Search intent inferred from the SERP's SHAPE (what features Google chose to
// show), not from guessing at the words — the most reliable free intent signal.
export type SerpIntent = { kind: SerpIntentKind; confidence: 'high' | 'medium' | 'low'; signals: string[] }
export type SerpData = {
  results: SerpResult[]
  questions: string[]
  related: string[]
  answerBox: SerpAnswerBox | null
  intent: SerpIntent
}

const ENDPOINT = 'https://google.serper.dev/search'
const AUTOCOMPLETE = 'https://google.serper.dev/autocomplete'

export const serpEnabled = () => !!process.env.SERPER_API_KEY

// Read the featured snippet (if any) and classify its format, so the writer can
// mirror it. serper's answerBox shape varies; list/table win over paragraph.
function readAnswerBox(ab: any): SerpAnswerBox | null {
  if (!ab || typeof ab !== 'object') return null
  const format: SerpAnswerBox['format'] = Array.isArray(ab.list) && ab.list.length ? 'list'
    : (ab.table || /<table/i.test(String(ab.snippet || ''))) ? 'table' : 'paragraph'
  const snippet = String(ab.snippet || ab.answer || (Array.isArray(ab.list) ? ab.list.join(' · ') : '') || '').trim().slice(0, 400)
  return { format, snippet: snippet || undefined, source: String(ab.source || ab.link || '').trim() || undefined }
}

// Classify search intent from which SERP features Google chose to surface.
// Priority: a map pack means local; shopping / heavy ads mean transactional;
// a few ads mean commercial; otherwise (answer box, PAA, plain organic) it's
// informational. Confidence reflects how decisive the strongest signal is.
function classifyIntent(j: any): SerpIntent {
  const ads = Array.isArray(j?.ads) ? j.ads.length : 0
  const hasShopping = Array.isArray(j?.shopping) && j.shopping.length > 0
  const hasPlaces = Array.isArray(j?.places) && j.places.length > 0
  const hasAnswer = !!j?.answerBox
  const hasPaa = Array.isArray(j?.peopleAlsoAsk) && j.peopleAlsoAsk.length > 0
  const signals: string[] = []
  if (hasPlaces) {
    signals.push('local map pack')
    if (ads) signals.push(`${ads} ads`)
    return { kind: 'local', confidence: 'high', signals }
  }
  if (hasShopping || ads >= 3) {
    signals.push(hasShopping ? 'shopping results' : `${ads} ads`)
    return { kind: 'transactional', confidence: hasShopping ? 'high' : 'medium', signals }
  }
  if (ads >= 1) {
    signals.push(`${ads} ad${ads > 1 ? 's' : ''}`)
    return { kind: 'commercial', confidence: 'medium', signals }
  }
  if (hasAnswer) signals.push('featured snippet')
  if (hasPaa) signals.push('People Also Ask')
  return { kind: 'informational', confidence: hasAnswer || hasPaa ? 'medium' : 'low', signals: signals.length ? signals : ['plain organic results'] }
}

/**
 * Top organic results + "People also ask" for a keyword.
 * `gl`/`hl` (country / language) sharpen relevance for non-English sites.
 */
export async function fetchSerp(keyword: string, opts: { gl?: string; hl?: string; num?: number } = {}): Promise<SerpData | null> {
  const key = process.env.SERPER_API_KEY
  if (!key || !keyword) return null
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: keyword, num: opts.num ?? 10, ...(opts.gl ? { gl: opts.gl } : {}), ...(opts.hl ? { hl: opts.hl } : {}) }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { console.warn('[serp] HTTP', res.status, 'for', keyword); return null }
    const j: any = await res.json()
    const results: SerpResult[] = (Array.isArray(j?.organic) ? j.organic : [])
      .slice(0, opts.num ?? 10)
      .map((o: any) => ({ title: String(o?.title || '').trim(), link: String(o?.link || ''), snippet: String(o?.snippet || '').trim() }))
      .filter((r: SerpResult) => r.title)
    const questions: string[] = (Array.isArray(j?.peopleAlsoAsk) ? j.peopleAlsoAsk : [])
      .map((q: any) => String(q?.question || '').trim()).filter(Boolean).slice(0, 8)
    const related: string[] = (Array.isArray(j?.relatedSearches) ? j.relatedSearches : [])
      .map((r: any) => String(r?.query || '').trim()).filter(Boolean).slice(0, 8)
    const answerBox = readAnswerBox(j?.answerBox)
    const intent = classifyIntent(j)
    if (!results.length && !questions.length) return null
    return { results, questions, related, answerBox, intent }
  } catch (e: any) {
    console.warn('[serp] failed for', keyword, e?.message || e)
    return null // grounding is a bonus, never a blocker
  }
}

/**
 * Google Autocomplete suggestions for a seed term (serper's autocomplete
 * endpoint). A free keyword-DISCOVERY source — ordered roughly by real
 * popularity — that surfaces phrases people actually type, including ones the
 * site doesn't rank for yet. Empty array when disabled or on any failure.
 */
export async function fetchAutocomplete(seed: string, opts: { gl?: string; hl?: string } = {}): Promise<string[]> {
  const key = process.env.SERPER_API_KEY
  if (!key || !seed.trim()) return []
  try {
    const res = await fetch(AUTOCOMPLETE, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: seed.trim(), ...(opts.gl ? { gl: opts.gl } : {}), ...(opts.hl ? { hl: opts.hl } : {}) }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return []
    const j: any = await res.json()
    const raw = Array.isArray(j?.suggestions) ? j.suggestions : []
    const seen = new Set<string>()
    const out: string[] = []
    for (const s of raw) {
      const v = String(s?.value ?? s ?? '').trim()
      const k = v.toLowerCase()
      if (v && !seen.has(k)) { seen.add(k); out.push(v) }
    }
    return out.slice(0, 12)
  } catch { return [] }
}

// The exact instruction for winning each featured-snippet format.
const SNIPPET_TACTIC: Record<SerpAnswerBox['format'], string> = {
  paragraph: 'Google shows a PARAGRAPH featured snippet here — answer the query directly in a tight 40–55 word paragraph right after the H1 to win it.',
  list: 'Google shows a LIST featured snippet here — put a clear ordered/bulleted list near the top (each item short, leading with the key phrase) to win it.',
  table: 'Google shows a TABLE featured snippet here — include a compact comparison table near the top with clear column headers to win it.',
}

/** Render SERP data as a prompt block for the writer. */
export function serpPromptBlock(d: SerpData | null): string {
  if (!d) return ''
  const lines: string[] = []
  // Intent from the live SERP — tells the writer the format searchers expect.
  if (d.intent && d.intent.confidence !== 'low') {
    lines.push(`DOMINANT SEARCH INTENT (from the live SERP: ${d.intent.signals.join(', ')}): ${d.intent.kind}. Match the content type searchers expect for this intent.`, '')
  }
  // Featured-snippet targeting — mirror the format Google already rewards.
  if (d.answerBox) {
    lines.push(SNIPPET_TACTIC[d.answerBox.format], '')
  }
  if (d.results.length) {
    lines.push('WHAT CURRENTLY RANKS for this keyword (the pages you must outperform — study the angles they take, then go deeper and add what they all miss; never copy their wording):')
    d.results.forEach((r, i) => lines.push(`${i + 1}. ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`))
  }
  if (d.questions.length) {
    lines.push('', 'QUESTIONS GOOGLE SHOWS for this query ("People also ask") — answer each of these explicitly, as H2/H3 headings:')
    d.questions.forEach((q) => lines.push(`- ${q}`))
  }
  if (d.related.length) {
    lines.push('', `RELATED SEARCHES to cover naturally: ${d.related.join(' · ')}`)
  }
  return lines.join('\n')
}
