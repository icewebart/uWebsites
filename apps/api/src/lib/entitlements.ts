import { and, eq, gte, inArray } from 'drizzle-orm'
import { db, accounts, workspaces, aiJobs } from '@uwebsites/db'
import { limitsForPlan, type PlanLimits } from '@uwebsites/shared'

// Plan-tier enforcement. Limits are PER ACCOUNT (see PLANS.limits + TRIAL_LIMITS)
// and checked at the action: creating a workspace, generating an article. Guards
// return a user-facing message when over the limit, or null when allowed.

export async function accountLimits(accountId: string): Promise<{ plan: string; limits: PlanLimits }> {
  const [acc] = await db.select({ plan: accounts.plan }).from(accounts).where(eq(accounts.id, accountId)).limit(1)
  return { plan: acc?.plan || 'trial', limits: limitsForPlan(acc?.plan) }
}

async function accountWorkspaceIds(accountId: string): Promise<string[]> {
  const rows = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.accountId, accountId))
  return rows.map((r) => r.id)
}

// Real article-WRITING jobs across the account's workspaces in the last 7 days.
// kind='article' is also logged by freeform/page generation (landing-page
// builds), so filter to the article writer's sources — building a page must not
// eat the article quota.
const ARTICLE_WRITE_SOURCES = new Set(['generate-article', 'auto-write'])
export async function articlesThisWeek(accountId: string): Promise<number> {
  const ids = await accountWorkspaceIds(accountId)
  if (!ids.length) return 0
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const rows = await db.select({ input: aiJobs.input }).from(aiJobs)
    .where(and(inArray(aiJobs.workspaceId, ids), eq(aiJobs.kind, 'article'), gte(aiJobs.createdAt, weekAgo)))
  return rows.filter((r) => ARTICLE_WRITE_SOURCES.has((r.input as any)?.source)).length
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// null = allowed; string = block with this message.
export async function guardCreateWorkspace(accountId: string): Promise<string | null> {
  const { limits } = await accountLimits(accountId)
  const ids = await accountWorkspaceIds(accountId)
  return ids.length >= limits.websites
    ? `Your plan includes ${plural(limits.websites, 'website')}. Upgrade to add more.`
    : null
}

export async function guardWriteArticle(accountId: string): Promise<string | null> {
  const { limits } = await accountLimits(accountId)
  const used = await articlesThisWeek(accountId)
  return used >= limits.articlesPerWeek
    ? `You've used your ${plural(limits.articlesPerWeek, 'AI article')} for this week. Upgrade for a higher cadence.`
    : null
}
