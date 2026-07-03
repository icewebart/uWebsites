import { Router } from 'express'
import { and, eq } from 'drizzle-orm'
import { db, pages, workspaces } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { renderPreview } from './publish.js'

// Single-page load/save for the block editor. Account-scoped via the page's
// workspace (page → workspace → account).
export const pagesRouter = Router()

async function loadOwned(id: string, accountId: string) {
  const [row] = await db.select({
    id: pages.id, workspaceId: pages.workspaceId, type: pages.type, slug: pages.slug,
    title: pages.title, status: pages.status, blocks: pages.blocks, seo: pages.seo,
    wsSlug: workspaces.slug, wsName: workspaces.name,
  })
    .from(pages)
    .innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(and(eq(pages.id, id), eq(workspaces.accountId, accountId)))
    .limit(1)
  return row
}

// GET /pages/:id/preview — text/html, rendered with the workspace's branding tokens
// Query: ?edit=1 enables click-to-select behavior + section outlining for the editor
pagesRouter.get('/:id/preview', requireAuth, async (req: AuthRequest, res) => {
  const edit = req.query.edit === '1'
  const sel = req.query.sel != null ? parseInt(String(req.query.sel), 10) : null
  const html = await renderPreview(String(req.params.id), req.user!.accountId, { edit, selectedIndex: Number.isFinite(sel as number) ? sel : null })
  if (!html) return res.status(404).send('not found')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})

// GET /pages/:id
pagesRouter.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  const row = await loadOwned(String(req.params.id), req.user!.accountId)
  if (!row) return res.status(404).json({ ok: false, error: 'page not found' })
  res.json({ ok: true, data: row })
})

// Small library of PAGE TEMPLATES — pre-seeded blocks + SEO defaults so an
// author starts with a real, sensible skeleton instead of a blank page.
// Add more templates here as we grow (product, service-landing, contact, etc.).
type Template = { key: string; label: string; type: string; blocks: any[]; seo?: any }
const TEMPLATES: Template[] = [
  { key: 'article', label: 'Article (with sidebar)', type: 'article',
    blocks: [
      { type: 'hero', props: { heading: 'Your article headline goes here', sub: 'A one-line deck under the headline that promises the reader something specific.' } },
      { type: 'article-body', props: {
        html: '<p><strong>Lead paragraph.</strong> Open with a specific hook — the concrete thing the reader learns or gains here.</p>\n<h2>The core idea</h2>\n<p>Explain the core idea in plain language. One idea per paragraph.</p>\n<h2>Why it matters</h2>\n<p>Ground the idea in a real example or moment.</p>\n<h2>What to do next</h2>\n<p>End with a clear next step. Link to a related page on this site when it helps the reader.</p>',
        toc: true, author: '', publishedAt: '', readMins: 5,
        sidebar: [
          { kind: 'toc', title: 'On this page' },
          { kind: 'author', title: 'About the author', text: 'One sentence about who wrote this.' },
          { kind: 'cta', title: 'Get in touch', text: 'Short line explaining what happens next.', cta_label: 'Contact us', cta_href: '/contact/' },
          { kind: 'related', title: 'Related reading' },
        ],
      } },
      { type: 'cta-banner', props: { heading: 'Ready to talk?', sub: 'Tell us what you\'re working on and we\'ll get back within a day.', cta_label: 'Get in touch', cta_href: '/contact/' } },
    ],
    seo: { description: '', ogImage: '', schemaType: 'Article' },
  },
]

// GET /pages/templates — list templates for the picker.
pagesRouter.get('/templates', requireAuth, async (_req: AuthRequest, res) => {
  res.json({ ok: true, data: TEMPLATES.map((t) => ({ key: t.key, label: t.label, type: t.type })) })
})

// POST /pages — create a blank page in a workspace. Body: { slug, title, type?, template? }
// Enforces per-workspace slug uniqueness (mirrors the DB uniqueness).
pagesRouter.post('/', requireAuth, async (req: AuthRequest, res) => {
  const { slug: wsSlug, title, type: rawType, template } = req.body ?? {}
  let { slug } = req.body ?? {}
  if (!wsSlug || !title) return res.status(400).json({ ok: false, error: 'workspace slug + title required' })
  const [ws] = await db.select().from(workspaces).where(and(eq(workspaces.slug, String(wsSlug)), eq(workspaces.accountId, req.user!.accountId))).limit(1)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const tpl = template ? TEMPLATES.find((t) => t.key === template) : null
  const allowedTypes = ['home', 'service', 'location', 'hub', 'blog_index', 'article', 'category', 'collection_item', 'about', 'contact', 'faq', 'lead_magnet', 'legal', 'thank_you']
  const type = tpl ? tpl.type : (allowedTypes.includes(String(rawType)) ? String(rawType) : 'article')
  // slug: user-supplied or derived from title; guarantee uniqueness per workspace
  const baseSlug = String(slug || title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
  slug = baseSlug
  for (let i = 2; i < 50; i++) {
    const [dup] = await db.select({ id: pages.id }).from(pages).where(and(eq(pages.workspaceId, ws.id), eq(pages.slug, slug))).limit(1)
    if (!dup) break
    slug = `${baseSlug}-${i}`
  }
  const [created] = await db.insert(pages).values({
    workspaceId: ws.id, type: type as any, slug, title: String(title).trim().slice(0, 200), status: 'draft',
    blocks: (tpl?.blocks ?? []) as any, seo: (tpl?.seo ?? {}) as any,
  }).returning()
  res.json({ ok: true, data: { id: created.id, slug: created.slug, title: created.title, type: created.type } })
})

// DELETE /pages/:id — permanently delete a page (except home is protected;
// use the workspace DELETE for that). Account-scoped via workspace ownership.
pagesRouter.delete('/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = String(req.params.id)
  const owned = await loadOwned(id, req.user!.accountId)
  if (!owned) return res.status(404).json({ ok: false, error: 'page not found' })
  if (owned.type === 'home') return res.status(400).json({ ok: false, error: 'The home page cannot be deleted directly — delete the workspace or replace the home content.' })
  await db.delete(pages).where(eq(pages.id, id))
  res.json({ ok: true, data: { deleted: id } })
})

// PUT /pages/:id — save title / blocks / status
pagesRouter.put('/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = String(req.params.id)
  const owned = await loadOwned(id, req.user!.accountId)
  if (!owned) return res.status(404).json({ ok: false, error: 'page not found' })

  const { title, blocks, status } = req.body ?? {}
  const upd: Record<string, any> = { updatedAt: new Date() }
  if (typeof title === 'string' && title.trim()) upd.title = title.trim()
  if (Array.isArray(blocks)) upd.blocks = blocks
  if (status === 'draft' || status === 'published') upd.status = status

  const [updated] = await db.update(pages).set(upd).where(eq(pages.id, id)).returning()
  res.json({ ok: true, data: updated })
})
