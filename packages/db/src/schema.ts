// uWebsites schema — see "Websiterium - 02 Data Model". Workspace-as-tenant,
// append-only credit ledger. Drizzle + Postgres.
import {
  pgTable, uuid, text, timestamp, boolean, integer, jsonb, pgEnum,
} from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('workspace_role', ['owner', 'editor', 'writer', 'viewer'])
export const pageTypeEnum = pgEnum('page_type', [
  'home', 'service', 'location', 'hub', 'blog_index', 'article', 'category',
  'collection_item', 'about', 'contact', 'faq', 'lead_magnet', 'legal', 'thank_you',
])
export const pageStatusEnum = pgEnum('page_status', ['draft', 'published'])
export const aiJobKindEnum = pgEnum('ai_job_kind', ['article', 'edit', 'image', 'import'])
export const aiJobStatusEnum = pgEnum('ai_job_status', ['queued', 'running', 'done', 'failed'])
export const buildStatusEnum = pgEnum('build_status', ['queued', 'building', 'deployed', 'failed'])

// ---- tenancy & accounts ----
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('trial'),
  stripeCustomerId: text('stripe_customer_id'),
  // Account-level settings & integrations (e.g. { cloudflare: { apiToken, verified } }).
  // Stored server-side; secrets are never returned to the client.
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),       // null for SSO-only users
  name: text('name').notNull(),
  googleId: text('google_id').unique(),
  twofaSecret: text('twofa_secret'),          // mandatory 2FA for owners
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  brandVoice: jsonb('brand_voice'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  role: roleEnum('role').notNull().default('owner'),
})

// ---- domains & branding ----
export const domains = pgTable('domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  hostname: text('hostname').notNull().unique(),
  status: text('status').notNull().default('pending'),
  dnsVerifiedAt: timestamp('dns_verified_at'),
  sslStatus: text('ssl_status').notNull().default('none'),
  sslError: text('ssl_error'),
})

export const brandingTokens = pgTable('branding_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  tokens: jsonb('tokens').notNull(),
  version: integer('version').notNull().default(1),
})

export const menus = pgTable('menus', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  location: text('location').notNull(),       // header | footer | mega
  tree: jsonb('tree').notNull(),
})

// ---- content ----
export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  type: pageTypeEnum('type').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  status: pageStatusEnum('status').notNull().default('draft'),
  locale: text('locale').notNull().default('en'),
  blocks: jsonb('blocks').notNull().default('[]'),
  seo: jsonb('seo'),
  publishedVersion: integer('published_version'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  schema: jsonb('schema').notNull(),
})

export const collectionItems = pgTable('collection_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  collectionId: uuid('collection_id').notNull().references(() => collections.id),
  fields: jsonb('fields').notNull(),
  slug: text('slug').notNull(),
  status: pageStatusEnum('status').notNull().default('draft'),
})

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  url: text('url').notNull(),
  alt: text('alt'),
  width: integer('width'),
  height: integer('height'),
  source: text('source').notNull().default('upload'),  // upload | ai | stock
})

export const redirects = pgTable('redirects', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  fromPath: text('from_path').notNull(),
  toPath: text('to_path').notNull(),
  code: integer('code').notNull().default(301),
})

// ---- AI, builds, ledger, audit ----
export const aiJobs = pgTable('ai_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  kind: aiJobKindEnum('kind').notNull(),
  input: jsonb('input'),
  status: aiJobStatusEnum('status').notNull().default('queued'),
  costCredits: integer('cost_credits').notNull().default(0),
  outputRef: text('output_ref'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const builds = pgTable('builds', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  status: buildStatusEnum('status').notNull().default('queued'),
  artifactRef: text('artifact_ref'),
  deployedAt: timestamp('deployed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Append-only. balance = sum(delta). Debit in the same tx as the ai_job under
// a per-account advisory lock (uPosty ADR-001 pattern).
export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  ref: text('ref'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ---- WordPress delivery ----
// A client's external WordPress site that we publish generated articles into.
// `authSecret` is either a WP Application Password (Phase 1, REST API) or the
// token issued by our plugin (Phase 2). Server-side only — NEVER returned to
// the client (the API returns a masked hint), same rule as accounts.settings.
export const wordpressConnections = pgTable('wordpress_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id),
  siteUrl: text('site_url').notNull(),                    // https://client.com
  mode: text('mode').notNull().default('app_password'),   // app_password | plugin
  username: text('username'),                             // app_password mode only
  authSecret: text('auth_secret').notNull(),
  defaultStatus: text('default_status').notNull().default('draft'), // draft | publish
  postsCreated: integer('posts_created').notNull().default(0),
  lastPostAt: timestamp('last_post_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ---- billing ----
// One row per account's Stripe subscription (latest wins; we upsert by
// stripeSubscriptionId on webhook). accounts.plan mirrors `plan` here for quick
// reads; this table holds the full Stripe status + period for the account page.
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  plan: text('plan').notNull(),                       // starter | growth | studio
  status: text('status').notNull(),                   // active | trialing | past_due | canceled | ...
  priceId: text('price_id'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target: text('target'),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
