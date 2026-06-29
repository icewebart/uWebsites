import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { and, eq } from 'drizzle-orm'
import { db, workspaces, pages, brandingTokens, aiJobs } from '@uwebsites/db'
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
          props: { type: 'object', description: [
            'Section props by kind. Provide REAL content for EVERY field listed — empty arrays/strings render as blank white sections.',
            '- hero: { heading (REQUIRED, full sentence), sub (recommended), cta_label, cta_href }',
            '- hero-image: { heading (REQUIRED), sub, image_url (REQUIRED — use an existing URL from the page), image_alt, cta_label, cta_href }',
            '- richtext: { html (REQUIRED, semantic HTML: p/h2/h3/ul/li/strong/em/a) }',
            '- image: { url (REQUIRED), alt }',
            '- features-3: { heading (REQUIRED), sub, items (REQUIRED — exactly 3, each { title, desc }) }',
            '- cta-banner: { heading (REQUIRED), sub, cta_label (REQUIRED), cta_href }',
            '- testimonials-3: { heading, items (REQUIRED — 1 to 3, each { quote, author, role }) }',
            '- pricing-3: { heading, tiers (REQUIRED — 2 to 3, each { name, price, period, items: [string,...], cta_label, cta_href, featured: boolean }) }',
            '- faq: { heading (REQUIRED), items (REQUIRED — at least 2, each { q, a }) }',
            '- logo-cloud: { heading, logos (REQUIRED — only include this section if you have real logo URLs) }',
            '- image-text: { heading (REQUIRED), html (REQUIRED — at least one <p>), image_url (REQUIRED), image_alt, image_side: "left"|"right" }',
            '- stats-row: { heading, items (REQUIRED — exactly 3, each { value, label }) }',
            'RULE: if you do not have material to populate a section properly, DO NOT include it. Prefer 3 fully-populated sections over 6 empty ones.',
          ].join('\n') },
        },
        required: ['type', 'props'],
      },
    },
  },
  required: ['title', 'blocks'],
}

// Best-effort AI usage logging. We don't fail the route on a log-write error.
// `kind` reuses the existing ai_job_kind enum (article | edit | image | import).
// We discriminate sub-types via input.source ("generate" / "rebuild" / "chat" / "rewrite").
async function logAiJob(workspaceId: string | null, kind: 'article' | 'edit' | 'image' | 'import', status: 'done' | 'failed', input: any, costCredits = 1, outputRef?: string | null) {
  if (!workspaceId) return
  try { await db.insert(aiJobs).values({ workspaceId, kind, status, input: input ?? {}, costCredits, outputRef: outputRef ?? null }) } catch {}
}

// Build a short "site brief" from the workspace's branding tokens / brand_assets
// — gives Claude real-world context (industry, audience, voice) it can infer
// from the nav items, CTA, and visible brand. Returned as plain prose for the
// system prompt; null when there's nothing meaningful to share.
async function siteBrief(workspaceId: string, workspaceName: string): Promise<string | null> {
  try {
    const [row] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, workspaceId)).limit(1)
    const tokens: any = row?.tokens || {}
    const a = tokens.brand_assets || {}
    const navLabels = (Array.isArray(a.nav) ? a.nav : []).map((n: any) => n?.text).filter(Boolean).slice(0, 12)
    const cta = a.cta?.label
    const colors = tokens.color || {}
    const fonts = tokens.font || {}
    const hasContext = navLabels.length || cta || a.logo?.url
    if (!hasContext) return null
    const parts: string[] = [
      `This site is "${workspaceName}".`,
      navLabels.length ? `The original navigation reads: ${navLabels.join(' · ')}. Infer the industry and audience from these labels.` : '',
      cta ? `The main call-to-action on the source site is "${cta}" — match that intent in any CTAs you create.` : '',
      (colors.primary || colors.accent) ? `Brand colors: primary ${colors.primary || '?'} / accent ${colors.accent || '?'}; treat them as the dominant visual signature.` : '',
      (fonts.heading || fonts.body) ? `Typography: headings in "${fonts.heading || '?'}", body in "${fonts.body || '?'}".` : '',
    ].filter(Boolean)
    return parts.join(' ')
  } catch { return null }
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
  const brief = await siteBrief(ws.id, ws.name)

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: `You generate uWebsites pages from the section catalog: ${SECTION_KINDS_LIST.join(', ')}. Always start with a hero or hero-image. Then mix sections appropriate to the page — features-3, image-text, testimonials-3, stats-row, pricing-3, logo-cloud, faq, cta-banner. End with cta-banner where useful. richtext is for prose; use semantic HTML only (p, h2, h3, ul, li, strong, em, a — no inline styles or scripts). Aim for 4–8 sections.${brief ? '\n\nSITE CONTEXT:\n' + brief : ''}`,
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
    await logAiJob(ws.id, 'article', 'done', { source: 'generate', prompt: String(prompt).slice(0, 500), title: created.title }, 1, created.id)
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
  const brief = await siteBrief(ws.id, ws.name)

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
      system: `You are the uWebsites page-builder assistant for "${ws.name}" / page "${page.title}". Use tools to make changes the user asks for; reply briefly with what you did. Section catalog:\n${catalogSummary}\n\nCurrent page sections (0-indexed):\n${sectionList || '(empty)'}${brief ? '\n\nSITE CONTEXT:\n' + brief : ''}`,
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

  await logAiJob(ws.id, 'edit', 'done', { source: 'page-chat', pageId: page.id, mutations: mutations.length }, 1)
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
  const brief = await siteBrief(ws.id, ws.name)

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: `You are the uWebsites site-building assistant for workspace "${ws.name}". You help the operator plan, rewrite, and structure their website. Be concise (2–4 short paragraphs max). Suggest concrete next actions, but do not invent capabilities. When the user asks to change something, propose what you would do and ask them to confirm. ${ctx}${brief ? '\n\nSITE CONTEXT:\n' + brief : ''}`,
      messages: messages
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-12)
        .map((m: any) => ({ role: m.role, content: m.content })),
    })
    const reply = r.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
    await logAiJob(ws.id, 'edit', 'done', { source: 'chat' }, 1)
    res.json({ ok: true, data: { reply } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Chat failed: ' + (e?.message || 'unknown') })
  }
})

// POST /ai/rebuild-page — take an imported (or otherwise contentful) page and
// redesign it as a structured layout using the section catalog, preserving the
// original copy and images. Useful right after importing a WP page that came
// in as one giant richtext block.
aiRouter.post('/rebuild-page', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured.' })
  const { pageId, tone } = req.body ?? {}
  if (!pageId) return res.status(400).json({ ok: false, error: 'pageId required' })

  const [row] = await db.select({
    id: pages.id, title: pages.title, blocks: pages.blocks, seo: pages.seo,
    wsId: pages.workspaceId, accId: workspaces.accountId,
  }).from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(eq(pages.id, String(pageId))).limit(1)
  if (!row || row.accId !== req.user!.accountId) return res.status(404).json({ ok: false, error: 'page not found' })

  // Source material: concatenate any richtext html, capture hero title and any image urls
  const cur = (Array.isArray(row.blocks) ? row.blocks : []) as any[]
  const heroTitle = cur.find((b) => b.type === 'hero' || b.type === 'hero-image')?.props?.heading || row.title
  const heroSub = cur.find((b) => b.type === 'hero' || b.type === 'hero-image')?.props?.sub || ''
  const images: string[] = cur.flatMap((b) => b.type === 'image' && b.props?.url ? [b.props.url] : b.type === 'hero-image' && b.props?.image_url ? [b.props.image_url] : [])
  const bodyHtml = cur.filter((b) => b.type === 'richtext').map((b) => b.props?.html || '').join('\n\n').slice(0, 60000)
  const sourceUrl = (row.seo as any)?.import_source?.url
  // Pull workspace name for the brief; we already loaded accId on the join,
  // but not the name — fetch it cheaply.
  const [wsRow] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, row.wsId)).limit(1)
  const brief = await siteBrief(row.wsId, wsRow?.name || 'this site')

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: `Rebuild this page into a well-structured layout using the uWebsites section catalog: ${SECTION_KINDS_LIST.join(', ')}. PRESERVE the actual copy and image URLs from the source — extract a strong hero from the title and first paragraph, then break the body into a few designed sections. DO NOT invent facts; reword for clarity is OK.

CRITICAL: every section you include must be FULLY populated per the tool schema. NEVER emit a section with empty items/tiers/logos or missing required fields — empty sections render as blank white space. If you can't fill a section with real content from the source, skip it. Aim for 3–5 strong sections, not 6 thin ones.

Output via the page tool.${tone ? '\n\nTone: ' + tone : ''}${brief ? '\n\nSITE CONTEXT (use this to decide industry, audience, and voice):\n' + brief : ''}`,
      tools: [{ name: 'page', description: 'The rebuilt page.', input_schema: BLOCK_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'page' },
      messages: [{ role: 'user', content: `Title: ${heroTitle}\nSubhead: ${heroSub}\nSource URL: ${sourceUrl || '(unknown)'}\nAvailable images: ${images.join(', ') || '(none)'}\n\nBody HTML:\n${bodyHtml || '(empty)'}` }],
    })
    const toolUse = r.content.find((b: any) => b.type === 'tool_use') as any
    if (!toolUse) return res.status(502).json({ ok: false, error: 'Model returned no rebuilt page' })
    const { title, blocks } = toolUse.input as { title: string; blocks: any[] }
    await db.update(pages).set({ title: title || row.title, blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, row.id))
    await logAiJob(row.wsId, 'article', 'done', { source: 'rebuild', pageId: row.id }, 2, row.id)
    res.json({ ok: true, data: { title: title || row.title, blocks } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Rebuild failed: ' + (e?.message || 'unknown') })
  }
})

// POST /ai/rewrite-block — rewrite a single block's content
aiRouter.post('/rewrite-block', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured — set ANTHROPIC_API_KEY on the server.' })
  const { block, instruction, slug } = req.body ?? {}
  if (!block || !instruction) return res.status(400).json({ ok: false, error: 'block and instruction required' })
  const ws = slug ? await ownedWs(String(slug), req.user!.accountId) : null
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
    await logAiJob(ws?.id ?? null, 'edit', 'done', { source: 'rewrite-block', kind: block.type }, 1)
    res.json({ ok: true, data: { props: parsed.props || parsed } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'AI rewrite failed: ' + (e?.message || 'unknown') })
  }
})
