// Opportunity engine — rank keywords by ROI, not just presence.
//
// opportunity ≈ demand × ease × business value × standing, penalised for
// cannibalisation. The strongest, cheapest signal is Search Console: queries
// the site already ranks 4–20 for (near-ranking "quick wins") carry real
// impressions and a proven ability to rank. Where the site does NOT yet rank,
// difficulty is estimated from the live SERP (authority of the domains holding
// the top results) and demand falls back to a neutral prior.
//
// Real search volume + a proper difficulty score need a keyword-data provider
// (DataForSEO / Ahrefs / etc.). That plugs in via KeywordMetrics without
// touching the scoring maths — see fetchKeywordMetrics() below, which is inert
// until a provider is wired, exactly like serp.ts.

export type KeywordMetrics = { volume?: number | null; difficulty?: number | null } // difficulty 0–100

export type OppInput = {
  keyword: string
  position?: number | null      // Search Console avg position (null = not ranking)
  impressions?: number | null   // SC impressions in the window (demand proxy)
  clicks?: number | null
  volume?: number | null        // monthly search volume (provider) — preferred demand signal
  difficulty?: number | null    // 0–100 (provider, or SERP-estimated)
  businessValue?: 'high' | 'medium' | 'low'
  intent?: string | null
  covered?: boolean             // already covered by an existing article
}

export type OppTier = 'quick-win' | 'high' | 'medium' | 'low'

export type OppScore = {
  score: number                 // 0–100
  tier: OppTier
  reason: string                // the dominant driver, in plain words
  factors: { demand: number; standing: number; ease: number; value: number; coverage: number }
}

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n))
// log-scaled 0..1 so 10 and 10,000 don't collapse to the same bucket.
const lognorm = (v: number, cap: number) => clamp(Math.log10(1 + Math.max(0, v)) / Math.log10(1 + cap))

/**
 * Score a single keyword. Every signal is optional — the score degrades
 * gracefully to "business value + a neutral prior" when only the keyword and
 * its pillar are known, and sharpens as SC / SERP / provider data arrive.
 */
export function scoreOpportunity(m: OppInput): OppScore {
  // Demand 0..1 — real volume preferred; else SC impressions; else neutral.
  const demand = m.volume != null && m.volume > 0 ? lognorm(m.volume, 50_000)
    : m.impressions != null && m.impressions > 0 ? lognorm(m.impressions, 5_000)
      : 0.30

  // Standing 0..1 — where a near-ranking page sits is the biggest, cheapest win.
  const p = m.position ?? null
  let standing: number, standNote: string
  if (p == null) { standing = 0.45; standNote = 'not ranking yet' }
  else if (p <= 3) { standing = 0.20; standNote = `already #${Math.round(p)}` }
  else if (p <= 10) { standing = 0.70; standNote = `page 1 (#${Math.round(p)})` }
  else if (p <= 20) { standing = 1.00; standNote = `page 2 (#${Math.round(p)})` }
  else { standing = 0.50; standNote = `#${Math.round(p)}` }

  // Ease 0..1 — inverse difficulty; neutral 0.5 when unknown.
  const ease = m.difficulty != null ? clamp(1 - m.difficulty / 100) : 0.5

  // Business value multiplier — pillar value × search intent.
  const bvBase = m.businessValue === 'high' ? 1.30 : m.businessValue === 'low' ? 0.65 : 1.0
  // Buyer-side intent is worth more: a transactional or local searcher is close
  // to converting; commercial (comparing) next; informational is baseline.
  const intentW = /transaction|local/i.test(m.intent || '') ? 1.15
    : /commercial/i.test(m.intent || '') ? 1.08 : 1.0
  const value = bvBase * intentW

  // Cannibalisation — an existing article already targets this; refresh, don't add.
  const coverage = m.covered ? 0.45 : 1.0

  const raw = (0.38 * demand + 0.37 * standing + 0.25 * ease) * value * coverage
  const score = Math.round(clamp(raw) * 100)

  // "Quick win" = near-ranking with real demand — call it out regardless of the
  // banded score, because it's the highest-ROI action a client can take.
  const nearRanking = p != null && p > 3 && p <= 20 && (m.impressions ?? 0) > 0
  let tier: OppTier = nearRanking ? 'quick-win' : score >= 68 ? 'high' : score >= 44 ? 'medium' : 'low'

  const reason = m.covered
    ? 'Already have an article — refresh it rather than write a new one'
    : nearRanking
      ? `Ranking ${standNote} with ${Math.round(m.impressions ?? 0)} impressions — small push to page 1`
      : m.businessValue === 'high'
        ? `High business value${p == null ? '; not ranking yet — worth building' : ''}`
        : demand > 0.6
          ? 'Strong demand for this topic'
          : ease > 0.72
            ? 'Low competition — winnable'
            : 'Standard opportunity'

  return { score, tier, reason, factors: { demand, standing, ease, value, coverage } }
}

// Domains that, when they hold the top results, signal a hard SERP to crack.
const STRONG_DOMAIN = /(?:^|\/\/|\.)(?:wikipedia|youtube|amazon|reddit|facebook|instagram|linkedin|forbes|nytimes|quora|pinterest|tripadvisor|booking|gov|edu)\b|\.gov\b|\.edu\b|medium\.com|apple\.com|microsoft\.com/i

/**
 * Rough difficulty (0–100) from the live SERP: how many authoritative domains
 * occupy the top results. Not a substitute for a DR-based metric, but a usable
 * signal when no keyword provider is wired. Empty SERP → neutral 50.
 */
export function estimateDifficultyFromSerp(results: Array<{ link?: string }>): number {
  const top = (results || []).slice(0, 10)
  if (!top.length) return 50
  const strong = top.filter((r) => STRONG_DOMAIN.test(String(r.link || ''))).length
  // 0 strong domains ≈ 30 (open), 3 ≈ 57, 6+ ≈ 84 (locked down by big players).
  return Math.round(clamp(0.30 + strong * 0.09, 0, 0.95) * 100)
}

// ---- Keyword-data provider seam ------------------------------------------
// Real volume + difficulty come from a paid provider. Inert until one is wired
// (mirrors serp.ts): scoring falls back to Search Console + SERP signals, so
// the engine is fully functional without it, and gains precision once set.

export type KwMetricsMap = Map<string, KeywordMetrics>

export const keywordDataEnabled = () => !!process.env.KEYWORD_API_KEY

/**
 * Fetch volume + difficulty for a batch of keywords. Returns an empty map until
 * a provider is wired — keys are lower-cased, trimmed keywords.
 */
export async function fetchKeywordMetrics(_keywords: string[]): Promise<KwMetricsMap> {
  // TODO: wire the keyword-data provider here (DataForSEO / Ahrefs / etc.),
  // read process.env.KEYWORD_API_KEY, and populate volume/difficulty. Until
  // then the engine runs on Search Console + SERP-estimated difficulty.
  return new Map()
}
