import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, pages } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'

// AI: page generation + section rewrite. Lazy-init the client so the API
// starts even without a key — the routes return 503 in that case.
export const aiRouter = Router()
let client: Anthropic | null = null
function ai(): Anthropic | null {
  if (client) return client
  if (!process.env.ANTHROPIC_API_KEY) return null
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8'

// Strict tool — Claude returns a typed block tree (no parsing of free-form JSON).
const BLOCK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Page title (concise, SEO-friendly)' },
    blocks: {
      type: 'array',
      description: 'Ordered list of typed sections.',
      items: {
        oneOf: [
          { type: 'object', properties: { type: { const: 'hero' }, props: { type: 'object', properties: { heading: { type: 'string' }, sub: { type: 'string' } }, required: ['heading'] } }, required: ['type', 'props'] },
          { type: 'object', properties: { type: { const: 'richtext' }, props: { type: 'object', properties: { html: { type: 'string', description: 'Safe semantic HTML — p, h2, h3, ul, ol, li, strong, em, a only.' } }, required: ['html'] } }, required: ['type', 'props'] },
        ],
      },
    },
  },
  required: ['title', 'blocks'],
}

async function ownedWs(slug: string, accountId: string) {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, accountId))).limit(1)
  return ws
}

// POST /ai/generate-page — Claude drafts a full page from a prompt, saves it.
aiRouter.post('/generate-page', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured — set ANTHROPIC_API_KEY on the server.' })
  const { slug, prompt, type } = req.body ?? {}
  if (!slug || !prompt) return res.status(400).json({ ok: false, error: 'slug and prompt required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: 'You generate uWebsites pages. Output must be on-brand, mobile-friendly, and scannable. Use a single hero block at the top, followed by 2–5 richtext sections with semantic HTML (no inline styles, no scripts, no images).',
      tools: [{ name: 'page', description: 'The generated page.', input_schema: BLOCK_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'page' },
      messages: [{ role: 'user', content: prompt }],
    })
    const toolUse = r.content.find((b: any) => b.type === 'tool_use') as any
    if (!toolUse) return res.status(502).json({ ok: false, error: 'Model returned no page' })
    const { title, blocks } = toolUse.input as { title: string; blocks: any[] }
    const pageSlug = (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) + '-' + Math.random().toString(36).slice(2, 6)
    const allowedTypes = ['home', 'service', 'location', 'hub', 'blog_index', 'article', 'category', 'collection_item', 'about', 'contact', 'faq', 'lead_magnet', 'legal', 'thank_you']
    const pageType = allowedTypes.includes(String(type)) ? String(type) : 'article'
    const [created] = await db.insert(pages).values({
      workspaceId: ws.id, type: pageType as any, slug: pageSlug,
      title, status: 'draft', blocks: blocks as any,
    }).returning()
    res.json({ ok: true, data: { id: created.id, slug: created.slug, title: created.title } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'AI generation failed: ' + (e?.message || 'unknown') })
  }
})

// POST /ai/chat — conversational endpoint for the site-builder chat panel.
// Single-turn (no streaming yet). Grounded in the workspace context: pages,
// branding tokens, and the current page (if any). Returns a plain reply.
aiRouter.post('/chat', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured.' })
  const { slug, messages, pageContext } = req.body ?? {}
  if (!slug || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, error: 'slug and messages[] required' })
  }
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })

  // Build a compact context block — keeps prompt cheap while letting Claude
  // reason about the actual site.
  const ctx = pageContext
    ? `Current page: type=${pageContext.type}, title="${pageContext.title}", blocks=${(pageContext.blocks || []).map((b: any) => b.type).join(',')}`
    : 'No specific page is being edited.'

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: `You are the uWebsites site-building assistant for workspace "${ws.name}". You help the operator plan, rewrite, and structure their website. Be concise (2–4 short paragraphs max). Suggest concrete next actions, but do not invent capabilities. When the user asks to change something, propose what you would do and ask them to confirm. ${ctx}`,
      messages: messages
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-12)
        .map((m: any) => ({ role: m.role, content: m.content })),
    })
    const reply = r.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
    res.json({ ok: true, data: { reply } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Chat failed: ' + (e?.message || 'unknown') })
  }
})

// POST /ai/rewrite-block — rewrite a single block's content
aiRouter.post('/rewrite-block', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured — set ANTHROPIC_API_KEY on the server.' })
  const { block, instruction } = req.body ?? {}
  if (!block || !instruction) return res.status(400).json({ ok: false, error: 'block and instruction required' })
  try {
    const r = await a.messages.create({
      model: MODEL, max_tokens: 1500,
      system: 'Rewrite the given block per the instruction. Return ONLY a JSON object with the new props (no commentary).',
      messages: [{ role: 'user', content: `Block type: ${block.type}\nCurrent props: ${JSON.stringify(block.props)}\nInstruction: ${instruction}\n\nReturn JSON: { "props": { ... } }` }],
    })
    const txt = r.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return res.status(502).json({ ok: false, error: 'no JSON in response' })
    const parsed = JSON.parse(m[0])
    res.json({ ok: true, data: { props: parsed.props || parsed } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'AI rewrite failed: ' + (e?.message || 'unknown') })
  }
})
