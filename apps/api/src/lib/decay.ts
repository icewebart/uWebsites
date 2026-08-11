// Content decay — spot articles that are losing ground before they fall off,
// and turn "what to do next" into a dated schedule.
//
// Decay is read from Search Console window-over-window (see scPageTrends): an
// article is decaying when it's shedding clicks or drifting down the rankings
// vs the previous equal-length window. Position is a rank, so a HIGHER position
// number is WORSE. A live-SERP freshness check (are the pages that now outrank
// it more recently updated?) sharpens the call but isn't required.

export type DecaySeverity = 'dropped' | 'slipping' | 'stable' | 'growing'

export type DecayInput = {
  clicksNow: number; clicksPrev: number
  imprNow: number; imprPrev: number
  positionNow: number; positionPrev: number
}

export type DecayVerdict = {
  severity: DecaySeverity
  reason: string
  lostClicks: number      // clicksPrev - clicksNow (negative if growing)
  positionDelta: number   // positionNow - positionPrev (positive = slipped)
}

// Below this, a page has too little history to trust a trend — ignore the noise.
const MIN_PREV_CLICKS = 3
const MIN_PREV_IMPR = 60

export function classifyDecay(t: DecayInput): DecayVerdict {
  const lostClicks = Math.round((t.clicksPrev - t.clicksNow) * 10) / 10
  const bothRanked = t.positionNow > 0 && t.positionPrev > 0
  const positionDelta = bothRanked ? Math.round((t.positionNow - t.positionPrev) * 10) / 10 : 0

  // Not enough prior signal — call it stable rather than invent a trend.
  if (t.clicksPrev < MIN_PREV_CLICKS && t.imprPrev < MIN_PREV_IMPR) {
    return { severity: 'stable', reason: 'Too little traffic to judge a trend', lostClicks, positionDelta }
  }

  // Fell out of results entirely — the worst kind of decay.
  if (t.clicksNow === 0 && t.imprNow === 0 && t.clicksPrev >= MIN_PREV_CLICKS) {
    return { severity: 'dropped', reason: `Fell out of results — was earning ${Math.round(t.clicksPrev)} clicks`, lostClicks, positionDelta }
  }
  // Big rank slide, or lost most of its clicks.
  if ((bothRanked && positionDelta >= 5) || (t.clicksPrev >= 5 && t.clicksNow <= t.clicksPrev * 0.4)) {
    const why = bothRanked && positionDelta >= 5
      ? `Slipped ${positionDelta.toFixed(1)} positions (#${t.positionPrev.toFixed(0)}→#${t.positionNow.toFixed(0)})`
      : `Lost ${Math.round(lostClicks)} of ${Math.round(t.clicksPrev)} clicks`
    return { severity: 'dropped', reason: why, lostClicks, positionDelta }
  }
  // Growing — surface it too, so the calendar can leave it alone.
  if ((bothRanked && positionDelta <= -1.5) || t.clicksNow > t.clicksPrev * 1.25) {
    return { severity: 'growing', reason: 'Gaining ground', lostClicks, positionDelta }
  }
  // Early slide — worth a refresh before it becomes a drop.
  if ((bothRanked && positionDelta >= 1.5) || (t.clicksPrev >= MIN_PREV_CLICKS && t.clicksNow < t.clicksPrev * 0.75) || (t.imprPrev >= MIN_PREV_IMPR && t.imprNow < t.imprPrev * 0.6)) {
    const why = bothRanked && positionDelta >= 1.5
      ? `Drifting down (#${t.positionPrev.toFixed(0)}→#${t.positionNow.toFixed(0)})`
      : lostClicks > 0 ? `Clicks softening (−${Math.round(lostClicks)})` : 'Impressions softening'
    return { severity: 'slipping', reason: why, lostClicks, positionDelta }
  }
  return { severity: 'stable', reason: 'Holding steady', lostClicks, positionDelta }
}

// ---- Publishing calendar ---------------------------------------------------
// Interleave refreshes (decaying articles) with new articles (top plan
// opportunities) into a week-by-week schedule that respects the plan's cadence.

export type CalTask = {
  kind: 'refresh' | 'new'
  title: string
  keyword?: string | null
  pageId?: string | null
  id?: string | null            // plan item id, for 'new'
  severity?: DecaySeverity      // for 'refresh'
  reason: string
  priority: number              // higher = sooner
}

export type CalWeek = { week: number; items: CalTask[] }

/**
 * Greedy schedule: sort every task by priority, then fill `perWeek` slots per
 * week for `weeks` weeks. Refreshing a "dropped" article beats writing a new
 * one — recovering lost traffic is cheaper than earning it — which the caller
 * encodes in each task's priority.
 */
export function buildSchedule(tasks: CalTask[], perWeek: number, weeks = 4): CalWeek[] {
  const slots = Math.max(1, perWeek | 0)
  const ordered = tasks.slice().sort((a, b) => b.priority - a.priority)
  const out: CalWeek[] = []
  for (let w = 0; w < weeks; w++) {
    const items = ordered.slice(w * slots, w * slots + slots)
    if (!items.length) break
    out.push({ week: w + 1, items })
  }
  return out
}
