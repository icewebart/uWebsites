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
export type SerpData = { results: SerpResult[]; questions: string[]; related: string[] }

const ENDPOINT = 'https://google.serper.dev/search'

export const serpEnabled = () => !!process.env.SERPER_API_KEY

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
    if (!results.length && !questions.length) return null
    return { results, questions, related }
  } catch (e: any) {
    console.warn('[serp] failed for', keyword, e?.message || e)
    return null // grounding is a bonus, never a blocker
  }
}

/** Render SERP data as a prompt block for the writer. */
export function serpPromptBlock(d: SerpData | null): string {
  if (!d) return ''
  const lines: string[] = []
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
