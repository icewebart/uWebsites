import { Router, type Request, type Response } from 'express'
import { and, desc, eq } from 'drizzle-orm'
import { db, workspaces, accounts, brandingTokens, aiJobs, builds } from '@uwebsites/db'
import { planById } from '@uwebsites/shared'
import { writeArticleForKeyword } from './ai.js'
import { buildSite } from './publish.js'
import { articlesThisWeek } from '../lib/entitlements.js'

// The auto-write engine — the motor behind Article Plan's "Weekly auto-write"
// toggle. Meant to be pinged once a day (see /internal/cron/auto-write). Each
// run writes AT MOST ONE article per eligible workspace, so a daily tick fills
// the weekly cadence gradually (Starter 1/wk → day 1; Studio 7/wk → 1/day) and
// self-heals a missed day instead of bursting.

export const cronRouter = Router()

type PlanItem = { id: string; keyword: string; status: string; priority?: number; pageId?: string; [k: string]: any }

export async function runAutoWrite(): Promise<{ checked: number; written: Array<{ slug: string; title: string }>; errors: number }> {
  const written: Array<{ slug: string; title: string }> = []
  let checked = 0, errors = 0

  const rows = await db.select({ ws: workspaces, plan: accounts.plan })
    .from(workspaces).innerJoin(accounts, eq(workspaces.accountId, accounts.id))

  for (const { ws, plan } of rows) {
    try {
      const [tokRow] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
      const tokens: any = tokRow?.tokens || {}
      const ap = tokens.article_plan
      if (!ap || ap.auto !== true) continue // toggle off → skip
      checked++
      const items: PlanItem[] = Array.isArray(ap.items) ? ap.items : []

      // Cadence gate. Paid plans get PLANS.limits.articlesPerWeek PER ACCOUNT
      // (rolling 7 days, so a multi-site account can't over-produce); a
      // free/trial account gets ONE sample article, ever.
      const planDef = planById(plan)
      let eligible: boolean
      if (planDef) {
        const thisWeek = await articlesThisWeek(ws.accountId) // includes any written earlier this run
        eligible = thisWeek < planDef.limits.articlesPerWeek
      } else {
        const jobs = await db.select().from(aiJobs)
          .where(and(eq(aiJobs.workspaceId, ws.id), eq(aiJobs.kind, 'article')))
          .orderBy(desc(aiJobs.createdAt)).limit(300)
        const autoEver = jobs.filter((j) => (j.input as any)?.source === 'auto-write').length
        eligible = autoEver < 1
      }
      if (!eligible) continue

      // Next keyword: highest priority among idea/queued items.
      const next = items
        .filter((i) => i.keyword && (i.status === 'idea' || i.status === 'queued'))
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0]
      if (!next) continue // dry plan — nothing to write

      const art = await writeArticleForKeyword(ws, next.keyword, { publish: true })
      written.push({ slug: ws.slug, title: art.title })

      // Mark the item published + attach the page (re-read tokens to avoid
      // clobbering any concurrent edit), then persist.
      const [freshTok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
      const ft: any = freshTok?.tokens || tokens
      const fap = ft.article_plan || ap
      fap.items = (Array.isArray(fap.items) ? fap.items : items).map((i: PlanItem) =>
        i.id === next.id ? { ...i, status: 'published', pageId: art.id } : i)
      ft.article_plan = fap
      if (freshTok) await db.update(brandingTokens).set({ tokens: ft }).where(eq(brandingTokens.id, freshTok.id))

      // Auto-publish: rebuild the static site so the new article is live — but
      // ONLY if the owner has published this site at least once. We won't
      // auto-launch a site (and sweep its in-progress drafts live) on their behalf.
      const [prior] = await db.select({ id: builds.id }).from(builds)
        .where(and(eq(builds.workspaceId, ws.id), eq(builds.status, 'deployed'))).limit(1)
      if (prior) {
        try { await buildSite(ws) } catch (e) { console.error('[auto-write] build failed for', ws.slug, e) }
      }
    } catch (e) {
      errors++
      console.error('[auto-write] error for workspace', ws?.slug, e)
    }
  }
  return { checked, written, errors }
}

// POST /internal/cron/auto-write — machine-to-machine; gated by CRON_SECRET.
// Inert (503) until CRON_SECRET is set, so it can ship before the cron is wired.
cronRouter.post('/auto-write', async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(503).json({ ok: false, error: 'CRON_SECRET not configured' })
  if (req.headers['x-cron-key'] !== secret) return res.status(401).json({ ok: false, error: 'unauthorized' })
  try {
    res.json({ ok: true, data: await runAutoWrite() })
  } catch (e: any) {
    console.error('[auto-write] run failed', e)
    res.status(500).json({ ok: false, error: e?.message || 'auto-write failed' })
  }
})
