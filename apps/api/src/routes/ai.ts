import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, pages, brandingTokens } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { SECTIONS, SECTION_META } from '../lib/sections.js'

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
const SECTION_KINDS = SECTIONS.map((s) => s.kind)
const SECTION_KINDS_LIST = [...SECTION_KINDS]

// Strict tool — Claude returns a typed block tree (no parsing of free-form
// JSON). Kept loose-ish on inner props because oneOf is finicky; we validate
// the kind name and the renderer is forgiving on missing props.
const BLOCK_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Page title (concise, SEO-friendly)' },
    blocks: {
      type: 'array',
      description: 'Ordered list of typed sections.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: SECTION_KINDS_LIST, description: 'Section kind from the uWebsites catalog.' },
          props: { type: 'object', description: 'Section-specific props. See SECTIONS catalog for shapes — hero/hero-image, richtext, image, features-3, cta-banner, testimonials-3, pricing-3, faq, logo-cloud, image-text, stats-row.' },
        },
        required: ['type', 'props'],
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
      system: `You generate uWebsites pages from the section catalog: ${SECTION_KINDS_LIST.join(', ')}. Always start with a hero or hero-image. Then mix sections appropriate to the page — features-3, image-text, testimonials-3, stats-row, pricing-3, logo-cloud, faq, cta-banner. End with cta-banner where useful. richtext is for prose; use semantic HTML only (p, h2, h3, ul, li, strong, em, a — no inline styles or scripts). Aim for 4–8 sections.`,
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

// ============ /ai/page-chat — tool-using site-builder chat ============
// Claude can call tools to mutate the page (add/move/remove/rewrite/replace
// sections, restyle branding). Tools execute server-side against the DB. The
// endpoint loads the page after tool calls and returns the new blocks so the
// client can refresh the preview iframe.
const PAGE_TOOLS: Anthropic.Tool[] = [
  { name: 'add_section', description: 'Append a new section to the page. Kind must come from the catalog. Props use the section\'s schema; pass only fields you want to set (defaults fill the rest).', input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: SECTION_KINDS },
      after_index: { type: 'integer', description: 'Optional. Insert AFTER this 0-based index. Omit to append at end.' },
      props: { type: 'object', description: 'Section props, e.g. {heading, sub, image_url, items[...]}.' },
    },
    required: ['kind'],
  } },
  { name: 'update_section', description: 'Patch props on an existing section by index. Only the fields you provide change.', input_schema: {
    type: 'object',
    properties: { index: { type: 'integer' }, props: { type: 'object' } },
    required: ['index', 'props'],
  } },
  { name: 'rewrite_section', description: 'Rewrite a section in-place per a natural-language instruction (a second AI call rewrites the props).', input_schema: {
    type: 'object',
    properties: { index: { type: 'integer' }, instruction: { type: 'string' } },
    required: ['index', 'instruction'],
  } },
  { name: 'replace_section', description: 'Replace a section with a different kind from the catalog.', input_schema: {
    type: 'object',
    properties: { index: { type: 'integer' }, kind: { type: 'string', enum: SECTION_KINDS }, props: { type: 'object' } },
    required: ['index', 'kind'],
  } },
  { name: 'move_section', description: 'Move a section up or down by one position.', input_schema: {
    type: 'object',
    properties: { index: { type: 'integer' }, direction: { type: 'string', enum: ['up', 'down'] } },
    required: ['index', 'direction'],
  } },
  { name: 'remove_section', description: 'Delete a section by index.', input_schema: {
    type: 'object', properties: { index: { type: 'integer' } }, required: ['index'],
  } },
  { name: 'restyle_branding', description: 'Update the workspace branding tokens. Only provide the fields you want to change (deep-merged).', input_schema: {
    type: 'object',
    properties: { tokens: { type: 'object' } },
    required: ['tokens'],
  } },
]

function deepMerge(a: any, b: any): any {
  if (!a || typeof a !== 'object') return b
  if (!b || typeof b !== 'object') return a
  const out: any = Array.isArray(a) ? [...a] : { ...a }
  for (const k of Object.keys(b)) out[k] = (typeof b[k] === 'object' && b[k] && !Array.isArray(b[k])) ? deepMerge(a[k], b[k]) : b[k]
  return out
}

async function runRewrite(client: Anthropic, block: any, instruction: string) {
  const r = await client.messages.create({
    model: MODEL, max_tokens: 1500,
    system: 'Rewrite the given section per the instruction. Return ONLY a JSON object with the new props (no commentary).',
    messages: [{ role: 'user', content: `Section kind: ${block.type}\nCurrent props: ${JSON.stringify(block.props)}\nInstruction: ${instruction}\n\nReturn JSON: { "props": { ... } }` }],
  })
  const txt = r.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('no JSON in rewrite response')
  const parsed = JSON.parse(m[0])
  return parsed.props || parsed
}

aiRouter.post('/page-chat', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured.' })
  const { slug, pageId, messages } = req.body ?? {}
  if (!slug || !pageId || !Array.isArray(messages)) return res.status(400).json({ ok: false, error: 'slug, pageId, messages[] required' })

  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  let [page] = await db.select().from(pages).where(and(eq(pages.id, String(pageId)), eq(pages.workspaceId, ws.id))).limit(1)
  if (!page) return res.status(404).json({ ok: false, error: 'page not found' })

  let blocks: any[] = Array.isArray(page.blocks) ? (page.blocks as any[]) : []
  const mutations: { tool: string; ok: boolean; note?: string }[] = []
  const catalogSummary = SECTIONS.map((s) => `${s.kind}: ${s.description}`).join('\n')
  const sectionList = blocks.map((b, i) => `${i}: ${b.type}`).join('\n')

  // Simple tool-use loop (max 3 hops to keep cost predictable).
  let convo: any[] = messages
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m: any) => ({ role: m.role, content: m.content }))

  let finalText = ''
  for (let hop = 0; hop < 3; hop++) {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 1500,
      tools: PAGE_TOOLS,
      system: `You are the uWebsites page-builder assistant for "${ws.name}" / page "${page.title}". Use tools to make changes the user asks for; reply briefly with what you did. Section catalog:\n${catalogSummary}\n\nCurrent page sections (0-indexed):\n${sectionList || '(empty)'}`,
      messages: convo,
    })
    const toolUses = r.content.filter((c: any) => c.type === 'tool_use') as any[]
    const textParts = r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim()
    if (textParts) finalText = textParts
    if (toolUses.length === 0) break

    // Execute each tool, record outcome, feed results back.
    const toolResults: any[] = []
    for (const tu of toolUses) {
      const inp = tu.input || {}
      try {
        switch (tu.name) {
          case 'add_section': {
            const meta = SECTION_META[inp.kind]
            if (!meta) throw new Error(`unknown kind ${inp.kind}`)
            const block = { type: inp.kind, props: deepMerge(structuredClone(meta.defaults), inp.props || {}) }
            const at = typeof inp.after_index === 'number' ? inp.after_index + 1 : blocks.length
            blocks = [...blocks.slice(0, at), block, ...blocks.slice(at)]
            mutations.push({ tool: 'add_section', ok: true, note: `${inp.kind} at ${at}` })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Added ${inp.kind} at index ${at}.` })
            break
          }
          case 'update_section': {
            const i = inp.index
            if (i < 0 || i >= blocks.length) throw new Error(`index ${i} out of range`)
            blocks = blocks.map((b, idx) => idx === i ? { ...b, props: deepMerge(b.props, inp.props || {}) } : b)
            mutations.push({ tool: 'update_section', ok: true, note: `index ${i}` })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Updated section ${i}.` })
            break
          }
          case 'rewrite_section': {
            const i = inp.index
            if (i < 0 || i >= blocks.length) throw new Error(`index ${i} out of range`)
            const newProps = await runRewrite(a, blocks[i], String(inp.instruction))
            blocks = blocks.map((b, idx) => idx === i ? { ...b, props: { ...b.props, ...newProps } } : b)
            mutations.push({ tool: 'rewrite_section', ok: true, note: `index ${i}` })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Rewrote section ${i}.` })
            break
          }
          case 'replace_section': {
            const i = inp.index
            const meta = SECTION_META[inp.kind]
            if (i < 0 || i >= blocks.length) throw new Error(`index ${i} out of range`)
            if (!meta) throw new Error(`unknown kind ${inp.kind}`)
            blocks = blocks.map((b, idx) => idx === i ? { type: inp.kind, props: deepMerge(structuredClone(meta.defaults), inp.props || {}) } : b)
            mutations.push({ tool: 'replace_section', ok: true, note: `${i} -> ${inp.kind}` })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Replaced section ${i} with ${inp.kind}.` })
            break
          }
          case 'move_section': {
            const i = inp.index, dir = inp.direction === 'up' ? -1 : 1
            const j = i + dir
            if (i < 0 || i >= blocks.length || j < 0 || j >= blocks.length) throw new Error('move out of range')
            const c = [...blocks];[c[i], c[j]] = [c[j], c[i]]; blocks = c
            mutations.push({ tool: 'move_section', ok: true, note: `${i} ${inp.direction}` })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Moved section ${i} ${inp.direction}.` })
            break
          }
          case 'remove_section': {
            const i = inp.index
            if (i < 0 || i >= blocks.length) throw new Error(`index ${i} out of range`)
            blocks = blocks.filter((_, idx) => idx !== i)
            mutations.push({ tool: 'remove_section', ok: true, note: `index ${i}` })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Removed section ${i}.` })
            break
          }
          case 'restyle_branding': {
            const [existing] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
            const cur = (existing?.tokens as any) ?? { color: { primary: '#16324A', accent: '#8FD7F1', surface: '#FFFFFF', text: '#16242E' }, font: { heading: 'Space Grotesk', body: 'Inter', scale: 1.2, lineHeight: 1.6 }, shape: { buttonRadius: '12px', cardRadius: '16px', borderWidth: '1px' }, space: { sectionGap: '64px', sectionPaddingY: '48px', container: '1200px' } }
            const merged = deepMerge(cur, inp.tokens || {})
            if (existing) await db.update(brandingTokens).set({ tokens: merged }).where(eq(brandingTokens.id, existing.id))
            else await db.insert(brandingTokens).values({ workspaceId: ws.id, tokens: merged })
            mutations.push({ tool: 'restyle_branding', ok: true })
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Branding tokens updated.' })
            break
          }
          default:
            toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Unknown tool.', is_error: true })
        }
      } catch (e: any) {
        mutations.push({ tool: tu.name, ok: false, note: e?.message || 'error' })
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Error: ' + (e?.message || 'unknown'), is_error: true })
      }
    }

    // Feed results back so Claude can decide on next move or summarize.
    convo = [...convo, { role: 'assistant', content: r.content }, { role: 'user', content: toolResults }]
  }

  // Persist if anything changed
  if (mutations.some((m) => m.ok && m.tool !== 'restyle_branding')) {
    await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, page.id))
  }

  res.json({ ok: true, data: { reply: finalText || '(no message)', blocks, mutations } })
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
