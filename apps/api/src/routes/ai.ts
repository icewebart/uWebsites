import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { and, eq, sql } from 'drizzle-orm'
import { db, workspaces, pages, brandingTokens, aiJobs } from '@uwebsites/db'
import { requireAuth, type AuthRequest } from '../middleware/auth.js'
import { SECTIONS, SECTION_META } from '../lib/sections.js'
import { pickAesthetic, brandVoicePrompt, COPY_RULES, AESTHETICS } from '../lib/aesthetics.js'
import { generateImage, generateImageResult, photoPrompt, imageGenEnabled, reasonMessage } from '../lib/imagegen.js'
import { upsertMenu } from './menus.js'

// Strip document chrome the model must not emit — the platform wraps every page
// with its OWN header (menu) + footer, so a <header>/<nav>/<footer> in the
// generated body would render the page's chrome twice. Also drops stray
// <html>/<head>/<body> wrappers.
function stripPageChrome(html: string): string {
  return String(html || '')
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .trim()
}

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
            '- hero-image: { eyebrow (short kicker), heading (REQUIRED), sub, image_url (REQUIRED — use an existing URL, else leave "" for a placeholder), image_alt, cta_label, cta_href, cta2_label, cta2_href, variant: "split"|"gradient" }',
            '- hero-blob: { eyebrow (short kicker), heading (REQUIRED), sub, cta_label, cta_href, cta2_label, cta2_href, image_url, image_alt } — playful blob-image hero; great for kids/lifestyle/community',
            '- program-cards: { eyebrow, heading, items (REQUIRED — exactly 3, each { badge (short category), title, desc, cta_label, cta_href, image_url (optional) }) } — colored program/plan/service cards',
            '- stats-band: { items (REQUIRED — 3 or 4, each { value, label }) } — bold colored full-width stats band; put right under a hero',
            '- richtext: { html (REQUIRED, semantic HTML: p/h2/h3/ul/li/strong/em/a) }',
            '- image: { url (REQUIRED), alt }',
            '- features-3: { eyebrow, heading (REQUIRED), sub, variant: "cards"|"minimal", items (REQUIRED — exactly 3, each { icon (ONE emoji), title, desc }) }',
            '- steps: { eyebrow, heading (REQUIRED), items (REQUIRED — 3 or 4, each { title, desc }) } — numbered "how it works" flow',
            '- cta-banner: { heading (REQUIRED), sub, cta_label (REQUIRED), cta_href, variant: "gradient"|"solid" }',
            '- testimonials-3: { eyebrow, heading, items (REQUIRED — 1 to 3, each { quote, author, role, rating (integer 1–5) }) }',
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
    const decorNames = (Array.isArray(a.decor_svgs) ? a.decor_svgs : []).map((d: any) => d?.name).filter(Boolean)
    const hasContext = navLabels.length || cta || a.logo?.url || decorNames.length
    if (!hasContext) return null
    const parts: string[] = [
      `This site is "${workspaceName}".`,
      navLabels.length ? `The original navigation reads: ${navLabels.join(' · ')}. Infer the industry and audience from these labels.` : '',
      cta ? `The main call-to-action on the source site is "${cta}" — match that intent in any CTAs you create.` : '',
      (colors.primary || colors.accent) ? `Brand colors: primary ${colors.primary || '?'} / accent ${colors.accent || '?'}; treat them as the dominant visual signature.` : '',
      (fonts.heading || fonts.body) ? `Typography: headings in "${fonts.heading || '?'}", body in "${fonts.body || '?'}".` : '',
      decorNames.length ? `The brand has custom decorative SVG shapes (${decorNames.join(', ')}); lean into a playful, decorated visual style consistent with them.` : '',
    ].filter(Boolean)
    return parts.join(' ')
  } catch { return null }
}

// Resolve the named aesthetic for a workspace — auto-picked from the imported
// brand (nav labels for industry + primary color for darkness). The caller can
// override by passing a slug in the route body (aesthetic: 'paymark' etc).
async function resolveAesthetic(workspaceId: string, override?: string | null) {
  if (override) {
    const found = AESTHETICS.find((a) => a.slug === override)
    if (found) return found
  }
  try {
    const [row] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, workspaceId)).limit(1)
    const tokens: any = row?.tokens || {}
    const a = tokens.brand_assets || {}
    const navLabels = (Array.isArray(a.nav) ? a.nav : []).map((n: any) => n?.text).filter(Boolean)
    return pickAesthetic({ navLabels, primary: tokens.color?.primary, accent: tokens.color?.accent })
  } catch {
    return pickAesthetic({})
  }
}

// Pull the brand identity a generation needs: real colors/fonts/shape/vibe plus
// the editable tagline + brand voice. Fed to brandVoicePrompt() so the AI
// designs INSIDE the brand instead of imposing a named aesthetic's palette.
async function resolveBrand(workspaceId: string): Promise<{
  colors?: any; fonts?: any; shape?: any; vibe?: string | null; tagline?: string | null; voice?: string | null
}> {
  try {
    const [row] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, workspaceId)).limit(1)
    const t: any = row?.tokens || {}
    return {
      colors: t.color || {}, fonts: t.font || {}, shape: t.shape || {}, vibe: t.vibe || null,
      tagline: t.tagline || t.brand_assets?.tagline || null,
      voice: t.voice || t.brand_voice || null,
    }
  } catch { return {} }
}

// Convenience: aesthetic (for composition + section roster) merged with the
// real brand (for all visuals + voice). Use this everywhere we used to inject
// aestheticPrompt() in a generation/rebuild flow.
async function brandPrompt(workspaceId: string, override?: string | null): Promise<string> {
  const [aesthetic, brand] = await Promise.all([resolveAesthetic(workspaceId, override), resolveBrand(workspaceId)])
  return brandVoicePrompt(aesthetic, brand)
}

async function ownedWs(slug: string, accountId: string) {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.slug, slug), eq(workspaces.accountId, accountId))).limit(1)
  return ws
}

// POST /ai/generate-image — generate a single image from a caption/prompt and
// store it in the workspace's image dir. Returns { url }.
aiRouter.post('/generate-image', requireAuth, async (req: AuthRequest, res) => {
  if (!imageGenEnabled()) return res.status(503).json({ ok: false, error: 'Image generation not configured — set GEMINI_API_KEY on the server.' })
  const { slug, prompt, caption, mood } = req.body ?? {}
  if (!slug || (!prompt && !caption)) return res.status(400).json({ ok: false, error: 'slug and prompt/caption required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const finalPrompt = prompt || photoPrompt(String(caption), mood)
  const { url, reason } = await generateImageResult(ws.slug, finalPrompt, `${ws.id}:${caption || prompt}:${Date.now()}`)
  if (!url) return res.status(reason === 'billing' ? 402 : 502).json({ ok: false, error: reasonMessage(reason) })
  await logAiJob(ws.id, 'image', 'done', { source: 'generate-image', caption: String(caption || '').slice(0, 200) }, 2, url)
  res.json({ ok: true, data: { url } })
})

// POST /ai/fill-images — find every empty image slot in a page (section
// image_url/url props + free-form <div class="uw-img-slot"> placeholders) and
// fill them with generated photos, capped to control cost. Saves the page.
aiRouter.post('/fill-images', requireAuth, async (req: AuthRequest, res) => {
  if (!imageGenEnabled()) return res.status(503).json({ ok: false, error: 'Image generation not configured — set GEMINI_API_KEY on the server.' })
  const { slug, pageId } = req.body ?? {}
  if (!slug || !pageId) return res.status(400).json({ ok: false, error: 'slug and pageId required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [page] = await db.select().from(pages).where(and(eq(pages.id, String(pageId)), eq(pages.workspaceId, ws.id))).limit(1)
  if (!page) return res.status(404).json({ ok: false, error: 'page not found' })

  const blocks = Array.isArray(page.blocks) ? JSON.parse(JSON.stringify(page.blocks)) : []
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const vibe = (tok?.tokens as any)?.vibe
  const navLabels = ((tok?.tokens as any)?.brand_assets?.nav || []).map((n: any) => n?.text).filter(Boolean).slice(0, 6)
  // Give the image model real context so photos are RELEVANT: the site/topic,
  // the industry (inferred from nav), and the brand vibe. Combined with each
  // slot's own caption, this anchors the subject.
  const context = [
    `for the website "${ws.name}"${page.title ? ` — page: "${page.title}"` : ''}`,
    navLabels.length ? `industry/topic inferred from: ${navLabels.join(', ')}` : '',
    vibe ? `${vibe} visual style` : '',
  ].filter(Boolean).join('. ')

  const MAX = 8
  type Gap = { caption: string; apply: (url: string) => void }
  const gaps: Gap[] = []
  let marker = 0

  for (const b of blocks) {
    if (gaps.length >= MAX) break
    const p = (b.props = b.props || {})
    if ((b.type === 'hero-image' || b.type === 'hero-blob' || b.type === 'image-text') && !p.image_url) {
      gaps.push({ caption: p.image_alt || p.heading || '', apply: (u) => { p.image_url = u; if (!p.image_alt) p.image_alt = p.heading || '' } })
    } else if (b.type === 'image' && !p.url) {
      gaps.push({ caption: p.alt || '', apply: (u) => { p.url = u } })
    } else if (b.type === 'program-cards' && Array.isArray(p.items)) {
      for (const it of p.items) { if (gaps.length >= MAX) break; if (!it.image_url) gaps.push({ caption: `${it.badge || ''} ${it.title || ''}`.trim(), apply: (u) => { it.image_url = u } }) }
    } else if (b.type === 'raw-html' && typeof p.html === 'string' && p.html.includes('uw-img-slot')) {
      // Replace each slot div with a unique token now; swap in <img> after gen.
      p.html = p.html.replace(/<div[^>]*class="[^"]*uw-img-slot[^"]*"([^>]*)>([\s\S]*?)<\/div>/gi, (_m: string, attrs: string, inner: string) => {
        if (gaps.length >= MAX) return _m
        const cap = (attrs.match(/data-caption="([^"]*)"/)?.[1] || inner.replace(/<[^>]*>/g, '').trim() || '').slice(0, 200)
        const style = attrs.match(/style="([^"]*)"/)?.[1] || 'width:100%;height:100%;object-fit:cover'
        const token = `__UWIMG_${marker++}__`
        const styleWithCover = /object-fit/.test(style) ? style : style + ';object-fit:cover'
        gaps.push({ caption: cap, apply: (u) => { p.html = p.html.replace(token, `<img src="${u}" alt="${cap.replace(/"/g, '&quot;')}" loading="lazy" style="${styleWithCover}">`) } })
        return token
      })
    }
  }

  if (!gaps.length) return res.json({ ok: true, data: { filled: 0, message: 'No empty image slots found.' } })

  // Generate in parallel (capped) so total latency ≈ the slowest single image.
  const results = await Promise.all(gaps.map((g, i) =>
    generateImageResult(ws.slug, photoPrompt(g.caption, context), `${page.id}:${i}:${g.caption}`).then((r) => ({ g, ...r })),
  ))
  let filled = 0
  for (const { g, url } of results) { if (url) { g.apply(url); filled++ } }
  // Nothing generated and it's a billing/quota problem → tell the user why.
  if (filled === 0) {
    const blocker = results.find((r) => r.reason === 'billing') || results.find((r) => r.reason === 'rate-limit')
    if (blocker) return res.status(blocker.reason === 'billing' ? 402 : 429).json({ ok: false, error: reasonMessage(blocker.reason) })
  }
  // Any raw-html tokens that failed to generate → strip back to an empty box.
  for (const b of blocks) if (b.type === 'raw-html' && typeof b.props?.html === 'string') {
    b.props.html = b.props.html.replace(/__UWIMG_\d+__/g, '<div style="width:100%;height:100%;min-height:180px;background:color-mix(in srgb,var(--primary) 8%,#fff);border-radius:16px"></div>')
  }

  await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, page.id))
  await logAiJob(ws.id, 'image', 'done', { source: 'fill-images', pageId: page.id, filled }, filled * 2, page.id)
  res.json({ ok: true, data: { filled, requested: gaps.length } })
})

// POST /ai/generate-freeform — "no restrictions" mode: Claude authors a
// complete landing page as one self-contained HTML fragment (not the section
// catalog), themed with the workspace's brand tokens + fonts, with image-slot
// placeholders to fill later. Saved as a single raw-html home block. Optionally
// seeded with a pasted design-kit's visible text for content context.
aiRouter.post('/generate-freeform', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured — set ANTHROPIC_API_KEY on the server.' })
  const { slug, prompt, kitHtml, type } = req.body ?? {}
  if (!slug || !prompt) return res.status(400).json({ ok: false, error: 'slug and prompt required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })

  const [tokRow] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const t: any = tokRow?.tokens || {}
  const c = t.color || {}, f = t.font || {}
  const brief = await siteBrief(ws.id, ws.name)
  // Extract just the visible text from a pasted kit for content grounding.
  const kitText = typeof kitHtml === 'string'
    ? kitHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000)
    : ''

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 12000,
      system: `You are an elite product/brand web designer. Author ONE complete, opinionated marketing landing page as a SINGLE self-contained HTML fragment.

OUTPUT RULES (critical):
- Return ONLY the page body markup — a series of <section>…</section> blocks. Do NOT emit <html>, <head>, <body>, a site <header>/<nav>, or a <footer>; the platform wraps the page with those.
- Colors: use ONLY these CSS variables so the page re-themes with the brand — var(--primary) ${c.primary || ''}, var(--accent) ${c.accent || ''}, var(--surface) ${c.surface || ''}, var(--text) ${c.text || ''}. Derive tints with color-mix(in srgb, var(--primary) 8%, #fff) etc. Never hardcode brand hexes.
- Fonts: headings use '${f.heading || 'inherit'}', body uses '${f.body || 'inherit'}' (set font-family inline where needed; the fonts are already loaded).
- Rounded, modern, generous spacing. Every section full-bleed background with an inner max-width:1180px;margin:0 auto;padding:72px 24px container. Alternate surface / soft-tinted section backgrounds for rhythm.
- PHOTOS: never use external image URLs. For every image use a placeholder exactly like <div class="uw-img-slot" data-caption="SPECIFIC description of the wanted photo" style="width:100%;aspect-ratio:4/3;border-radius:16px"></div>. We fill these with real images afterward.
- Decorative flourishes (soft blobs, stars) via inline SVG or CSS circles are welcome when on-brand.
- Buttons: rounded pills in var(--primary)/var(--accent).

CONTENT RULES:
- Real, SPECIFIC copy in the brand's voice — never lorem ipsum, never "Your text here". Concrete headlines, benefits, and CTAs.
- A rich page: hero, a value/benefits grid, a "how it works" or programs section, social proof/testimonials, a stats or trust strip, and a strong closing CTA. 6–9 sections.
${brief ? '\n\nSITE CONTEXT (anchor industry, audience, voice; reflect it in the copy):\n' + brief : ''}${kitText ? '\n\nSOURCE KIT TEXT (reuse the real names, offers and wording from here where relevant):\n' + kitText : ''}`,
      tools: [{ name: 'page', description: 'The generated landing page.', input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Concise, SEO-friendly page title' },
          html: { type: 'string', description: 'The full page body markup — a sequence of <section> blocks, self-contained, themed with the brand CSS variables.' },
        },
        required: ['title', 'html'],
      } as any }],
      tool_choice: { type: 'tool', name: 'page' },
      messages: [{ role: 'user', content: String(prompt) }],
    })
    const toolUse = r.content.find((b: any) => b.type === 'tool_use') as any
    if (!toolUse) return res.status(502).json({ ok: false, error: 'Model returned no page' })
    const { title, html } = toolUse.input as { title: string; html: string }
    const blocks = [{ type: 'raw-html', props: { html: stripPageChrome(html), sourceLabel: 'AI · free-form' } }]
    const pageType = type === 'home' || !type ? 'home' : String(type)
    let created: any
    if (pageType === 'home') {
      const [existingHome] = await db.select().from(pages).where(and(eq(pages.workspaceId, ws.id), eq(pages.type, 'home'))).limit(1)
      const rows = existingHome
        ? await db.update(pages).set({ title, blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, existingHome.id)).returning()
        : await db.insert(pages).values({ workspaceId: ws.id, type: 'home' as any, slug: 'home', title, status: 'draft', blocks: blocks as any }).returning()
      created = rows[0]
    } else {
      const pageSlug = (title || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) + '-' + Math.random().toString(36).slice(2, 6)
      const rows = await db.insert(pages).values({ workspaceId: ws.id, type: 'article' as any, slug: pageSlug, title, status: 'draft', blocks: blocks as any }).returning()
      created = rows[0]
    }
    await logAiJob(ws.id, 'article', 'done', { source: 'freeform', prompt: String(prompt).slice(0, 500), title: created.title }, 2, created.id)
    res.json({ ok: true, data: { id: created.id, slug: created.slug, title: created.title } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'AI generation failed: ' + (e?.message || 'unknown') })
  }
})

// System prompt for the per-section design pass. Each raw-html block is treated
// as ONE section of the page: read its content, keep it, redesign the look.
function critiqueSystemPrompt(c: any, f: any): string {
  return `You are a senior brand & web designer. You are given the current HTML of ONE section of a web page (it was imported from an old website, so its markup is messy/dated). REDESIGN this one section into a clean, modern, well-composed section — but keep 100% of its meaning.

DESIGN GOALS: strong visual hierarchy, generous spacing, clear type scale, purposeful color, rounded cards + soft shadows, tasteful decorative accents, confident CTAs.

HARD RULES (content is sacred — you REDESIGN, you do NOT rewrite):
- Keep EVERY piece of text VERBATIM — headings, paragraphs, list items, labels, button text. Do not add, drop, translate or reword anything.
- Keep EVERY link: preserve each <a>'s href EXACTLY and its visible text.
- Keep EVERY image: preserve each <img> with its EXACT src (they are already hosted) and alt; you may restyle/reframe it (rounded corners, aspect) but never remove it or swap it for a color block. If the source used a placeholder <div class="uw-img-slot" data-caption="…">, keep it.
- Keep the section's building blocks: if it's a grid of cards/list/stats, keep the same count and the same content per item.
- Colors ONLY via CSS variables: var(--primary) ${c.primary || ''}, var(--accent) ${c.accent || ''}, var(--accent2), var(--surface), var(--text). Derive tints with color-mix. Never hardcode brand hexes.
- Fonts: headings '${f.heading || 'inherit'}', body '${f.body || 'inherit'}'.
- Output ONLY this section's markup — one <section>…</section> (or a couple if it clearly splits). NO <html>/<head>/<body>, and NO site <header>/<nav>/<footer> (the platform adds those).
- Return the redesigned section HTML via the tool.`
}

// POST /ai/critique-page — design pass. Goes through EACH raw-html block of the
// page (imported or free-form), one by one (in parallel), keeps its text/links/
// images and redesigns the layout into real page design. Structured sections
// are left untouched.
aiRouter.post('/critique-page', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured — set ANTHROPIC_API_KEY on the server.' })
  const { slug, pageId } = req.body ?? {}
  if (!slug || !pageId) return res.status(400).json({ ok: false, error: 'slug and pageId required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [page] = await db.select().from(pages).where(and(eq(pages.id, String(pageId)), eq(pages.workspaceId, ws.id))).limit(1)
  if (!page) return res.status(404).json({ ok: false, error: 'page not found' })
  const blocks = Array.isArray(page.blocks) ? JSON.parse(JSON.stringify(page.blocks)) : []

  const MAX_BLOCKS = 14
  const targets = blocks
    .map((b: any, i: number) => ({ b, i }))
    .filter((x: any) => x.b?.type === 'raw-html' && typeof x.b?.props?.html === 'string' && x.b.props.html.length > 120)
    .slice(0, MAX_BLOCKS)
  if (!targets.length) return res.status(400).json({ ok: false, error: 'Design polish works on imported / full-custom (raw-html) pages. This page is built from editable sections instead.' })

  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const t: any = tok?.tokens || {}
  const system = critiqueSystemPrompt(t.color || {}, t.font || {})
  const tools = [{ name: 'section', description: 'The redesigned section.', input_schema: {
    type: 'object', properties: { html: { type: 'string', description: 'The redesigned section HTML (<section> markup only).' } }, required: ['html'],
  } as any }]

  const imgSrcs = (h: string) => [...String(h).matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])
  const hrefs = (h: string) => [...String(h).matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1])
  try {
    // Redesign each raw-html block in parallel — total time ≈ the slowest block.
    const results = await Promise.all(targets.map(async ({ b, i }: any) => {
      const orig = String(b.props.html)
      const oImgs = imgSrcs(orig), oHrefs = [...new Set(hrefs(orig))]
      // Tell the model exactly which assets MUST survive — big compliance boost.
      const assets = [
        oImgs.length ? `You MUST keep every one of these images, each as an <img> with this EXACT src:\n${oImgs.map((s) => `- ${s}`).join('\n')}` : '',
        oHrefs.length ? `You MUST keep every one of these links, each as an <a> with this EXACT href:\n${oHrefs.map((s) => `- ${s}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n')
      try {
        const r = await a.messages.create({
          model: MODEL, max_tokens: 8000, system,
          tools, tool_choice: { type: 'tool', name: 'section' },
          messages: [{ role: 'user', content: `Redesign this section.\n\n${assets ? assets + '\n\n' : ''}--- CURRENT SECTION HTML ---\n${orig.slice(0, 24000)}` }],
        })
        const tu = r.content.find((x: any) => x.type === 'tool_use') as any
        const html = tu?.input?.html ? stripPageChrome(tu.input.html) : ''
        if (html.length < 40) return { i, ok: false }
        // HARD GUARANTEE: the redesign must contain every original image src and
        // link href. If it dropped any, reject it and keep the original block.
        const keepsAll = oImgs.every((s) => html.includes(s)) && oHrefs.every((s) => html.includes(s))
        return { i, ok: keepsAll, html: keepsAll ? html : null }
      } catch { return { i, ok: false } }
    }))
    let changed = 0, kept = 0
    for (const r of results) { if (r.ok && r.html) { blocks[r.i].props.html = r.html; changed++ } else { kept++ } }
    if (!changed) return res.status(502).json({ ok: false, error: 'Polish could not redesign any section without dropping content — please try again.' })
    await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, page.id))
    await logAiJob(ws.id, 'edit', 'done', { source: 'critique', pageId: page.id, sections: changed, keptOriginal: kept }, changed * 2, page.id)
    res.json({ ok: true, data: { redesigned: changed, keptOriginal: kept } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Design polish failed: ' + (e?.message || 'unknown') })
  }
})

// POST /ai/normalise-article — reshape ANY article page into the canonical
// structure: [hero] → [article-body with sidebar + auto TOC] → [cta-banner].
// Keeps the article's real words + images verbatim; only the structure and
// markup are cleaned. This is what "normalising" an imported/legacy article
// means — every article ends up with the same reading layout + SEO scaffold.
aiRouter.post('/normalise-article', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured.' })
  const { pageId } = req.body ?? {}
  if (!pageId) return res.status(400).json({ ok: false, error: 'pageId required' })
  const [row] = await db.select({
    id: pages.id, title: pages.title, blocks: pages.blocks, seo: pages.seo, wsId: pages.workspaceId, accId: workspaces.accountId,
  }).from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id)).where(eq(pages.id, String(pageId))).limit(1)
  if (!row || row.accId !== req.user!.accountId) return res.status(404).json({ ok: false, error: 'page not found' })

  // Gather every scrap of text + image from all block kinds (same harvesting as
  // rebuild), so a raw-html or already-typed article both work.
  const cur = (Array.isArray(row.blocks) ? row.blocks : []) as any[]
  const cleanRaw = (h: string) => String(h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\sstyle=("[^"]*"|'[^']*')/gi, '').slice(0, 40000)
  const parts: string[] = []
  const images: string[] = []
  for (const b of cur) {
    const p = b?.props || {}
    if (typeof p.html === 'string') { parts.push(cleanRaw(p.html)); for (const m of p.html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) images.push(m[1]) }
    if (p.heading) parts.push(`<h2>${p.heading}</h2>`)
    if (p.sub) parts.push(`<p>${p.sub}</p>`)
    if ((p.image_url) && /^https?:|^\//.test(p.image_url)) images.push(p.image_url)
  }
  const bodyHtml = parts.join('\n\n').slice(0, 60000)
  const uniqImages = [...new Set(images)].slice(0, 30)
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, row.wsId)).limit(1)
  const t: any = tok?.tokens || {}
  const brief = await siteBrief(row.wsId, row.title)

  const NORMALISE_SCHEMA = {
    type: 'object', properties: {
      heading: { type: 'string', description: 'The article H1 — use the existing title/headline verbatim if there is one.' },
      deck: { type: 'string', description: 'One-sentence standfirst/deck under the title. Reuse an existing intro line if present; otherwise leave empty.' },
      body_html: { type: 'string', description: 'The full article body as clean semantic HTML: <p>, <h2>, <h3>, <ul>/<ol>/<li>, <strong>, <em>, <a href>, <blockquote>, <img src>. Keep ALL original words verbatim. Keep every image (as <img>) using the EXACT src given. Use <h2>/<h3> for the real section breaks so a Table of Contents can be built.' },
      cta_label: { type: 'string', description: 'A specific CTA button label relevant to the article (e.g. "Book a free trial lesson").' },
      cta_href: { type: 'string', description: 'A path for the CTA — "/contact/" if unsure.' },
    }, required: ['heading', 'body_html'],
  }
  try {
    const r = await a.messages.create({
      model: MODEL, max_tokens: 8000,
      system: `You normalise a web article into a clean reading layout. TEXT IS SACRED: keep every original word verbatim — do NOT rewrite, translate, shorten or embellish. Your job is ONLY to (1) pull the real title + intro out, (2) re-emit the body as clean semantic HTML with proper <h2>/<h3> section headings so a table of contents can be generated, (3) keep every image inline using its EXACT src. Drop navigation, footers, cookie banners, share widgets and other chrome — keep only the article itself.

You MUST keep these images, each as an <img> with this EXACT src:
${uniqImages.map((s) => `- ${s}`).join('\n') || '(none)'}
${brief ? '\nSITE CONTEXT (for the CTA only):\n' + brief : ''}`,
      tools: [{ name: 'article', description: 'The normalised article.', input_schema: NORMALISE_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'article' },
      messages: [{ role: 'user', content: `Title: ${row.title}\n\n--- CURRENT ARTICLE CONTENT (messy HTML) ---\n${bodyHtml}` }],
    })
    const tu = r.content.find((x: any) => x.type === 'tool_use') as any
    const out = tu?.input || {}
    const body = stripPageChrome(String(out.body_html || ''))
    if (body.length < 60) return res.status(502).json({ ok: false, error: 'Could not extract an article body.' })
    const blocks: any[] = [
      { type: 'hero', props: { heading: out.heading || row.title, sub: out.deck || '', eyebrow: '' } },
      { type: 'article-body', props: {
        html: body, toc: true, author: '', publishedAt: '', readMins: Math.max(2, Math.round(body.replace(/<[^>]*>/g, ' ').split(/\s+/).length / 200)),
        sidebar: [
          { kind: 'toc', title: 'On this page' },
          ...(out.cta_label ? [{ kind: 'cta', title: 'Next step', text: '', cta_label: out.cta_label, cta_href: out.cta_href || '/contact/' }] : []),
          { kind: 'related', title: 'Related reading' },
        ],
      } },
    ]
    if (out.cta_label) blocks.push({ type: 'cta-banner', props: { heading: out.heading || row.title, sub: '', cta_label: out.cta_label, cta_href: out.cta_href || '/contact/' } })
    const seo = { ...((row.seo as any) || {}), schemaType: 'Article' }
    await db.update(pages).set({ blocks: blocks as any, seo: seo as any, updatedAt: new Date() }).where(eq(pages.id, row.id))
    await logAiJob(row.wsId, 'article', 'done', { source: 'normalise-article', pageId: row.id }, 2, row.id)
    res.json({ ok: true, data: { sections: blocks.length } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Normalise failed: ' + (e?.message || 'unknown') })
  }
})

// POST /ai/critique-section — polish a SINGLE raw-html section. Same content
// guarantee as critique-page (keeps every img src + link href verbatim).
aiRouter.post('/critique-section', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured.' })
  const { slug, pageId, index } = req.body ?? {}
  if (!slug || !pageId || typeof index !== 'number') return res.status(400).json({ ok: false, error: 'slug, pageId, index required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [page] = await db.select().from(pages).where(and(eq(pages.id, String(pageId)), eq(pages.workspaceId, ws.id))).limit(1)
  if (!page) return res.status(404).json({ ok: false, error: 'page not found' })
  const blocks = Array.isArray(page.blocks) ? JSON.parse(JSON.stringify(page.blocks)) : []
  const b = blocks[index]
  if (!b || b.type !== 'raw-html' || typeof b?.props?.html !== 'string' || b.props.html.length < 120) {
    return res.status(400).json({ ok: false, error: 'This section is not a raw-html block, or is too short to redesign.' })
  }
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const t: any = tok?.tokens || {}
  const system = critiqueSystemPrompt(t.color || {}, t.font || {})
  const orig = String(b.props.html)
  const oImgs = [...orig.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])
  const oHrefs = [...new Set([...orig.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]))]
  const assets = [
    oImgs.length ? `You MUST keep every one of these images, each as an <img> with this EXACT src:\n${oImgs.map((s) => `- ${s}`).join('\n')}` : '',
    oHrefs.length ? `You MUST keep every one of these links, each as an <a> with this EXACT href:\n${oHrefs.map((s) => `- ${s}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
  try {
    const r = await a.messages.create({
      model: MODEL, max_tokens: 8000, system,
      tools: [{ name: 'section', description: 'The redesigned section.', input_schema: {
        type: 'object', properties: { html: { type: 'string' } }, required: ['html'],
      } as any }],
      tool_choice: { type: 'tool', name: 'section' },
      messages: [{ role: 'user', content: `Redesign this section.\n\n${assets ? assets + '\n\n' : ''}--- CURRENT SECTION HTML ---\n${orig.slice(0, 24000)}` }],
    })
    const tu = r.content.find((x: any) => x.type === 'tool_use') as any
    const html = tu?.input?.html ? stripPageChrome(tu.input.html) : ''
    if (html.length < 40) return res.status(502).json({ ok: false, error: 'Model returned no section' })
    const keepsAll = oImgs.every((s) => html.includes(s)) && oHrefs.every((s) => html.includes(s))
    if (!keepsAll) return res.status(422).json({ ok: false, error: 'Polish would drop content — please try again.' })
    blocks[index].props.html = html
    await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, page.id))
    await logAiJob(ws.id, 'edit', 'done', { source: 'critique-section', pageId: page.id, index }, 2, page.id)
    res.json({ ok: true, data: { index } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Polish failed: ' + (e?.message || 'unknown') })
  }
})

// POST /ai/verify-links — walk every page's blocks, find placeholder/dead links
// (href of "#", empty, or missing) and match them to REAL pages by link-text ↔
// page title. Fixes CTA cta_href and <a href> inside richtext/raw-html. Returns
// per-page counts.
aiRouter.post('/verify-links', requireAuth, async (req: AuthRequest, res) => {
  const { slug } = req.body ?? {}
  if (!slug) return res.status(400).json({ ok: false, error: 'slug required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const all = await db.select().from(pages).where(eq(pages.workspaceId, ws.id))
  // Build a title → url map. Home = "/", others = "/<slug>/". Also stash a
  // normalized version of the title so the matcher tolerates casing/diacritics.
  const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const index = all.map((p) => ({ id: p.id, title: p.title, type: p.type, slug: p.slug, url: p.type === 'home' ? '/' : `/${p.slug}/`, key: norm(p.title) }))
  const resolve = (linkText: string): string | null => {
    const k = norm(linkText)
    if (!k) return null
    const exact = index.find((p) => p.key === k)
    if (exact) return exact.url
    // partial (e.g. "About us" ↔ "About"), prefer shortest containing title
    const partials = index.filter((p) => p.key && (k.includes(p.key) || p.key.includes(k))).sort((a, b) => a.key.length - b.key.length)
    return partials[0]?.url || null
  }
  const isPlaceholder = (h: any) => typeof h !== 'string' || !h.trim() || h.trim() === '#' || h.trim().toLowerCase() === 'javascript:void(0)'
  const perPage: Array<{ pageId: string; title: string; fixed: number; stillEmpty: number }> = []
  for (const p of all) {
    const blocks = Array.isArray(p.blocks) ? JSON.parse(JSON.stringify(p.blocks)) : []
    let fixed = 0, stillEmpty = 0
    const walkProps = (props: any) => {
      if (!props || typeof props !== 'object') return
      // typed section CTAs: cta_href with cta_label
      if (props.cta_label && isPlaceholder(props.cta_href)) { const u = resolve(props.cta_label); if (u) { props.cta_href = u; fixed++ } else stillEmpty++ }
      if (props.cta2_label && isPlaceholder(props.cta2_href)) { const u = resolve(props.cta2_label); if (u) { props.cta2_href = u; fixed++ } else stillEmpty++ }
      // arrays of items
      for (const key of ['items', 'tiers', 'logos']) if (Array.isArray(props[key])) for (const it of props[key]) walkProps(it)
      // richtext/raw-html: fix <a href="#">Label</a>
      if (typeof props.html === 'string') {
        props.html = props.html.replace(/<a\s+([^>]*?)href=(["'])([^"']*)\2([^>]*)>([\s\S]*?)<\/a>/gi, (m: string, pre: string, q: string, href: string, post: string, txt: string) => {
          if (!isPlaceholder(href)) return m
          const clean = txt.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
          const u = resolve(clean)
          if (u) { fixed++; return `<a ${pre}href=${q}${u}${q}${post}>${txt}</a>` }
          stillEmpty++; return m
        })
      }
    }
    for (const b of blocks) walkProps(b?.props)
    if (fixed) await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, p.id))
    perPage.push({ pageId: p.id, title: p.title, fixed, stillEmpty })
  }
  await logAiJob(ws.id, 'edit', 'done', { source: 'verify-links', pages: perPage.length }, 0)
  res.json({ ok: true, data: { pages: perPage, totalFixed: perPage.reduce((s, x) => s + x.fixed, 0) } })
})

// POST /ai/polish-site — run the design polish on EVERY page in the workspace
// (each page's raw-html sections get redesigned in parallel, then pages are
// polished one after another to keep the API load sane). Returns per-page
// results. Long-running; the client polls after firing.
aiRouter.post('/polish-site', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured.' })
  const { slug } = req.body ?? {}
  if (!slug) return res.status(400).json({ ok: false, error: 'slug required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const rows = await db.select().from(pages).where(eq(pages.workspaceId, ws.id))
  const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
  const t: any = tok?.tokens || {}
  const system = critiqueSystemPrompt(t.color || {}, t.font || {})
  const tools = [{ name: 'section', description: 'The redesigned section.', input_schema: {
    type: 'object', properties: { html: { type: 'string' } }, required: ['html'],
  } as any }]
  const imgSrcs = (h: string) => [...String(h).matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1])
  const hrefs = (h: string) => [...String(h).matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1])
  const perPage: Array<{ pageId: string; title: string; redesigned: number; keptOriginal: number }> = []
  // Serial across pages, parallel across sections within a page. Cap 12 pages
  // per call so we don't blow up on huge sites (still covers most workspaces).
  for (const page of rows.slice(0, 12)) {
    const blocks = Array.isArray(page.blocks) ? JSON.parse(JSON.stringify(page.blocks)) : []
    const targets = blocks
      .map((b: any, i: number) => ({ b, i }))
      .filter((x: any) => x.b?.type === 'raw-html' && typeof x.b?.props?.html === 'string' && x.b.props.html.length > 120)
      .slice(0, 14)
    if (!targets.length) { perPage.push({ pageId: page.id, title: page.title, redesigned: 0, keptOriginal: 0 }); continue }
    const results = await Promise.all(targets.map(async ({ b, i }: any) => {
      const orig = String(b.props.html)
      const oImgs = imgSrcs(orig), oHrefs = [...new Set(hrefs(orig))]
      const assets = [
        oImgs.length ? `You MUST keep every one of these images, each as an <img> with this EXACT src:\n${oImgs.map((s) => `- ${s}`).join('\n')}` : '',
        oHrefs.length ? `You MUST keep every one of these links, each as an <a> with this EXACT href:\n${oHrefs.map((s) => `- ${s}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n')
      try {
        const r = await a.messages.create({
          model: MODEL, max_tokens: 8000, system, tools, tool_choice: { type: 'tool', name: 'section' },
          messages: [{ role: 'user', content: `Redesign this section.\n\n${assets ? assets + '\n\n' : ''}--- CURRENT SECTION HTML ---\n${orig.slice(0, 24000)}` }],
        })
        const tu = r.content.find((x: any) => x.type === 'tool_use') as any
        const html = tu?.input?.html ? stripPageChrome(tu.input.html) : ''
        if (html.length < 40) return { i, ok: false }
        const keepsAll = oImgs.every((s) => html.includes(s)) && oHrefs.every((s) => html.includes(s))
        return { i, ok: keepsAll, html: keepsAll ? html : null }
      } catch { return { i, ok: false } }
    }))
    let redesigned = 0, kept = 0
    for (const r of results) { if (r.ok && r.html) { blocks[r.i].props.html = r.html; redesigned++ } else { kept++ } }
    if (redesigned) await db.update(pages).set({ blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, page.id))
    perPage.push({ pageId: page.id, title: page.title, redesigned, keptOriginal: kept })
  }
  await logAiJob(ws.id, 'edit', 'done', { source: 'polish-site', pages: perPage.length }, perPage.reduce((s, p) => s + p.redesigned * 2, 0), null)
  res.json({ ok: true, data: { pages: perPage } })
})

// POST /ai/extract-footer — sniff out the trailing footer sections of a page
// (newsletter / copyright / footer nav, even when split across several raw-html
// blocks), move their links + tagline into the SITE footer, and remove them
// from the page body so the footer isn't rendered twice.
aiRouter.post('/extract-footer', requireAuth, async (req: AuthRequest, res) => {
  const { slug, pageId } = req.body ?? {}
  if (!slug || !pageId) return res.status(400).json({ ok: false, error: 'slug and pageId required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const [page] = await db.select().from(pages).where(and(eq(pages.id, String(pageId)), eq(pages.workspaceId, ws.id))).limit(1)
  if (!page) return res.status(404).json({ ok: false, error: 'page not found' })
  const blocks = Array.isArray(page.blocks) ? JSON.parse(JSON.stringify(page.blocks)) : []
  const text = (b: any) => String(b?.props?.html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

  // The footer starts at the first trailing block that reads like a footer.
  const startRe = /newsletter|abonează|aboneaz|fii la curent|©|toate drepturile|drepturile rezervate|all rights reserved|©\s*\d{4}/i
  let start = -1
  for (let i = Math.max(1, Math.floor(blocks.length * 0.4)); i < blocks.length; i++) {
    if (blocks[i]?.type === 'raw-html' && startRe.test(text(blocks[i]))) { start = i; break }
  }
  if (start < 0) return res.status(400).json({ ok: false, error: 'Could not spot a footer region (newsletter / copyright) in the lower half of this page.' })

  const footerBlocks = blocks.slice(start)
  const footHtml = footerBlocks.map((b: any) => b?.props?.html || '').join('\n')
  const legalRe = /(termen|privacy|gdpr|confiden|politica|cookie|©|copyright|drepturile)/i
  const items: Array<{ label: string; href: string }> = []
  const seen = new Set<string>()
  for (const m of footHtml.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]
    const label = m[2].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    if (label && label.length < 50 && !seen.has(label.toLowerCase()) && !legalRe.test(label)) { seen.add(label.toLowerCase()); items.push({ label, href }) }
    if (items.length >= 20) break
  }
  const tagline = (footHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)

  if (items.length) await upsertMenu(ws.id, 'footer', { items })
  if (tagline) {
    const [tok] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, ws.id)).limit(1)
    if (tok) {
      const merged = { ...(tok.tokens as any), brand_assets: { ...((tok.tokens as any)?.brand_assets || {}), tagline } }
      await db.update(brandingTokens).set({ tokens: merged as any }).where(eq(brandingTokens.id, tok.id))
    }
  }
  const kept = blocks.slice(0, start)
  await db.update(pages).set({ blocks: kept as any, updatedAt: new Date() }).where(eq(pages.id, page.id))
  await logAiJob(ws.id, 'edit', 'done', { source: 'extract-footer', pageId: page.id, removed: footerBlocks.length, links: items.length }, 1, page.id)
  res.json({ ok: true, data: { removedSections: footerBlocks.length, footerLinks: items.length, tagline: !!tagline } })
})

// POST /ai/generate-page — Claude drafts a full page from a prompt, saves it.
aiRouter.post('/generate-page', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured — set ANTHROPIC_API_KEY on the server.' })
  const { slug, prompt, type, aesthetic: aestheticOverride } = req.body ?? {}
  if (!slug || !prompt) return res.status(400).json({ ok: false, error: 'slug and prompt required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  const brief = await siteBrief(ws.id, ws.name)
  const brandBrief_ = await brandPrompt(ws.id, aestheticOverride)

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 5000,
      system: `You generate uWebsites pages from the section catalog: ${SECTION_KINDS_LIST.join(', ')}. The page must feel like a real, opinionated site — not a generic template. THINK in two steps before emitting: (1) sketch the section order using the preferred roster, (2) write the copy IN THE BRAND'S VOICE.

${brandBrief_}

${COPY_RULES}

DESIGN DIRECTION — make it look designed, not template-y:
- Open with hero-image (eyebrow + a strong image_url or "" placeholder + TWO buttons via cta_label + cta2_label), or hero-blob for playful/kids/lifestyle brands.
- Put a stats-band directly under the hero when you have real numbers.
- Give features-3 an eyebrow and a distinct, meaningful emoji "icon" per item.
- Add a "steps" (how it works) section when there's a process, and testimonials-3 with a rating (5) and role when you have social proof.
- Close with a cta-banner (variant "gradient").
- Set an eyebrow on most section heads. Vary section rhythm; don't repeat the same block style twice in a row.

richtext sections use semantic HTML only (p, h2, h3, ul, li, strong, em, a — no inline styles or scripts). Aim for 5–8 sections, every one fully populated.${brief ? '\n\nSITE CONTEXT (use this to anchor industry, audience, and voice — refer to it in your copy):\n' + brief : ''}`,
      tools: [{ name: 'page', description: 'The generated page.', input_schema: BLOCK_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'page' },
      messages: [{ role: 'user', content: prompt }],
    })
    const toolUse = r.content.find((b: any) => b.type === 'tool_use') as any
    if (!toolUse) return res.status(502).json({ ok: false, error: 'Model returned no page' })
    const { title, blocks } = toolUse.input as { title: string; blocks: any[] }
    const allowedTypes = ['home', 'service', 'location', 'hub', 'blog_index', 'article', 'category', 'collection_item', 'about', 'contact', 'faq', 'lead_magnet', 'legal', 'thank_you']
    const pageType = allowedTypes.includes(String(type)) ? String(type) : 'article'
    // Home is the canonical index page: use slug 'home' and replace the existing
    // home in place (so "Build with AI" on an empty site fills the homepage
    // instead of spawning a random-slug duplicate).
    let created: any
    if (pageType === 'home') {
      const [existingHome] = await db.select().from(pages).where(and(eq(pages.workspaceId, ws.id), eq(pages.type, 'home'))).limit(1)
      if (existingHome) {
        ;[created] = await db.update(pages).set({ title, blocks: blocks as any, updatedAt: new Date() }).where(eq(pages.id, existingHome.id)).returning()
      } else {
        ;[created] = await db.insert(pages).values({ workspaceId: ws.id, type: 'home' as any, slug: 'home', title, status: 'draft', blocks: blocks as any }).returning()
      }
    } else {
      const pageSlug = (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) + '-' + Math.random().toString(36).slice(2, 6)
      ;[created] = await db.insert(pages).values({ workspaceId: ws.id, type: pageType as any, slug: pageSlug, title, status: 'draft', blocks: blocks as any }).returning()
    }
    await logAiJob(ws.id, 'article', 'done', { source: 'generate', pageType, prompt: String(prompt).slice(0, 500), title: created.title }, 1, created.id)
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
  const { slug, pageId, messages, blocks: clientBlocks } = req.body ?? {}
  if (!slug || !pageId || !Array.isArray(messages)) return res.status(400).json({ ok: false, error: 'slug, pageId, messages[] required' })

  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })
  let [page] = await db.select().from(pages).where(and(eq(pages.id, String(pageId)), eq(pages.workspaceId, ws.id))).limit(1)
  if (!page) return res.status(404).json({ ok: false, error: 'page not found' })

  // Operate on the EDITOR's live blocks when the client sends them (so unsaved
  // edits / freshly generated images aren't reverted to the DB copy); fall back
  // to the saved blocks otherwise.
  let blocks: any[] = Array.isArray(clientBlocks) && clientBlocks.length ? clientBlocks : (Array.isArray(page.blocks) ? (page.blocks as any[]) : [])
  const mutations: { tool: string; ok: boolean; note?: string }[] = []
  const catalogSummary = SECTIONS.map((s) => `${s.kind}: ${s.description}`).join('\n')
  const sectionList = blocks.map((b, i) => `${i}: ${b.type}`).join('\n')
  const brief = await siteBrief(ws.id, ws.name)
  const brandBrief_ = await brandPrompt(ws.id)

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
      system: `You are the uWebsites page-builder assistant for "${ws.name}" / page "${page.title}". Use tools to make changes the user asks for; reply briefly with what you did. Whenever you add or rewrite copy, follow the aesthetic and copy rules below — they apply to EVERY edit, no matter how small.

Whenever there are natural next steps (or you'd otherwise ask a yes/no question), END your reply with ONE line exactly like:
OPTIONS: Short action A | Short action B | Short action C
Give 2–4 options, each phrased as a direct instruction the user could click (e.g. "Move it to the top", "Leave it where it is", "Add a matching image"). Do NOT ask the question in prose too — the options ARE the question. Omit the line only when there's genuinely nothing to offer.

${brandBrief_}\n\n${COPY_RULES}\n\nSection catalog:\n${catalogSummary}\n\nCurrent page sections (0-indexed):\n${sectionList || '(empty)'}${brief ? '\n\nSITE CONTEXT:\n' + brief : ''}`,
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
      system: `You are the uWebsites site-building assistant for workspace "${ws.name}". You help the operator plan, rewrite, and structure their website. Be concise (2–4 short paragraphs max). Suggest concrete next actions, but do not invent capabilities. When the user asks to change something, propose what you would do and ask them to confirm.

Whenever there are natural next steps, END your reply with ONE line exactly like:
OPTIONS: Short action A | Short action B | Short action C
Give 2–4 clickable options phrased as direct instructions; the options ARE the question (don't also ask it in prose). Omit only when there's nothing to offer. ${ctx}${brief ? '\n\nSITE CONTEXT:\n' + brief : ''}`,
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
  const { pageId, tone, aesthetic: aestheticOverride } = req.body ?? {}
  if (!pageId) return res.status(400).json({ ok: false, error: 'pageId required' })
  // Rebuild is destructive — it replaces the whole page. Require an explicit
  // instruction so it never runs on a vague click. To polish copy in place
  // without restructure, the editor calls /ai/rewrite-section-html per
  // section (preserves layout, only edits text).
  const userInstruction = String(tone || '').trim()
  if (!userInstruction) {
    return res.status(400).json({ ok: false, error: 'Tell me what to change — leave the instruction empty if you want me to leave the page alone.' })
  }

  const [row] = await db.select({
    id: pages.id, title: pages.title, blocks: pages.blocks, seo: pages.seo,
    wsId: pages.workspaceId, accId: workspaces.accountId,
  }).from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(eq(pages.id, String(pageId))).limit(1)
  if (!row || row.accId !== req.user!.accountId) return res.status(404).json({ ok: false, error: 'page not found' })

  // Source material: gather text + images from EVERY block kind, including
  // raw-html (what re-import-from-source produces). Without this, a page that
  // was just re-imported has no richtext/image blocks, so the rebuild would
  // see an empty body + no images and emit only a bare hero.
  const cur = (Array.isArray(row.blocks) ? row.blocks : []) as any[]
  const heroTitle = cur.find((b) => b.type === 'hero' || b.type === 'hero-image' || b.type === 'hero-blob')?.props?.heading || row.title
  const heroSub = cur.find((b) => b.type === 'hero' || b.type === 'hero-image' || b.type === 'hero-blob')?.props?.sub || ''

  // Strip <style>/<script> from raw-html but keep tags so the AI can see the
  // content structure (headings, paragraphs, lists). Cap per section.
  const cleanRaw = (h: string) => String(h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\sstyle=("[^"]*"|'[^']*')/gi, '')
    .replace(/\s+/g, ' ')
    .slice(0, 9000)

  const images: string[] = []
  const bodyParts: string[] = []
  for (const b of cur) {
    const p = b?.props || {}
    if (b.type === 'richtext' && p.html) bodyParts.push(p.html)
    if (b.type === 'raw-html' && p.html) {
      bodyParts.push(cleanRaw(p.html))
      for (const m of String(p.html).matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) images.push(m[1])
      for (const m of String(p.html).matchAll(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi)) images.push(m[1])
    }
    if (b.type === 'image' && p.url) images.push(p.url)
    if ((b.type === 'hero-image' || b.type === 'hero-blob' || b.type === 'image-text') && p.image_url) images.push(p.image_url)
    // typed sections carry their own text — hand it to the model as prose so
    // it doesn't lose content when reshaping an already-typed page
    if (p.heading) bodyParts.push(`<h2>${p.heading}</h2>`)
    if (p.sub) bodyParts.push(`<p>${p.sub}</p>`)
    if (Array.isArray(p.items)) for (const it of p.items) { if (it?.title) bodyParts.push(`<h3>${it.title}</h3>`); if (it?.desc) bodyParts.push(`<p>${it.desc}</p>`); if (it?.quote) bodyParts.push(`<blockquote>${it.quote} — ${it.author || ''}</blockquote>`); if (it?.q) bodyParts.push(`<p><b>${it.q}</b> ${it.a || ''}</p>`) }
  }
  // Dedupe images, keep http(s) only, cap.
  const uniqImages = [...new Set(images.filter((u) => /^https?:\/\//i.test(u)))].slice(0, 20)
  const bodyHtml = bodyParts.join('\n\n').slice(0, 60000)
  const sourceUrl = (row.seo as any)?.import_source?.url
  const snapshotUrl = (row.seo as any)?.import_source?.snapshot_url
  // Pull workspace name for the brief; we already loaded accId on the join,
  // but not the name — fetch it cheaply.
  const [wsRow] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, row.wsId)).limit(1)
  const brief = await siteBrief(row.wsId, wsRow?.name || 'this site')
  const brandBrief_ = await brandPrompt(row.wsId, aestheticOverride)

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 5000,
      system: `Modify a uWebsites page per a SPECIFIC user instruction. You are NOT asked to reinvent the page; you are asked to apply the instruction precisely.

#1 RULE — TEXT IS SACRED. NEVER rewrite, reword, translate, shorten, expand, "improve", or "punch up" any existing heading, paragraph, label, or item text. Copy the words VERBATIM into the output. The ONLY time you may change text is when the user instruction EXPLICITLY asks for a copy/wording change (e.g. "rewrite the hero headline", "make the intro shorter"). A styling/restructuring/restyling request is NOT permission to touch words.

GUARD RAILS:
- The user instruction below is the single source of authority. Do ONLY what it says.
- If the instruction does NOT mention restructuring, KEEP the same section order and the same content. Touch only what the instruction names.
- If the instruction does not mention adding sections, do NOT add sections.
- Always preserve image URLs and concrete facts (prices, dates, names, places) exactly.
- Output the resulting page via the tool with the FULL block tree (modified parts + unchanged parts, both with text verbatim from the current state unless a copy change was requested).

Section catalog (use these kinds when adding or replacing sections): ${SECTION_KINDS_LIST.join(', ')}

${brandBrief_}

NOTE: the copy rules below apply ONLY to NEW text you are explicitly asked to write. They are NOT a license to rewrite existing text.
${COPY_RULES}

USER INSTRUCTION (this is the ONLY thing that drives changes):
> ${userInstruction}${brief ? '\n\nSITE CONTEXT (background only — do not regenerate from this):\n' + brief : ''}`,
      tools: [{ name: 'page', description: 'The rebuilt page.', input_schema: BLOCK_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'page' },
      // Vision: when we have a snapshot of the original, pass it so Claude can
      // SEE the source structure (number of sections, hero shape, card patterns,
      // overall visual style) instead of guessing from text alone.
      messages: [{ role: 'user', content: [
        ...(snapshotUrl ? [{ type: 'image' as const, source: { type: 'url' as const, url: snapshotUrl } }] : []),
        { type: 'text' as const, text: `Here is the page's ACTUAL content — use ALL of it. Lay every distinct piece out across appropriate typed sections (hero, features-3, program-cards, image-text, testimonials-3, stats-band, faq, cta-banner…). Do NOT collapse the whole page into one hero. Preserve the wording verbatim; only restructure.

Title: ${heroTitle}
Subhead: ${heroSub}
Source URL: ${sourceUrl || '(unknown)'}

Images available (reuse these real URLs in image/hero sections — do NOT invent image URLs):
${uniqImages.length ? uniqImages.map((u) => '- ' + u).join('\n') : '(none found)'}

CONTENT (headings, paragraphs, lists, cards — this is the material to arrange):
${bodyHtml || '(the page has no readable text content — build a sensible starter layout from the title + site context)'}

Apply ONLY the user instruction. Return the FULL rebuilt block tree.` },
      ] }],
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

// POST /ai/generate-nav — suggest menu items for header or footer using the
// workspace's site brief + the list of pages that already exist. Returns
// `{ items: [{label, href}], cta? }` (cta only for header). The caller PUTs
// the result back to /workspaces/:slug/menus.
const NAV_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'Ordered nav items. Use existing page paths from PAGES below when possible; only invent paths when the page truly does not exist yet.',
      items: { type: 'object', properties: { label: { type: 'string' }, href: { type: 'string' } }, required: ['label', 'href'] },
    },
    cta: {
      type: 'object',
      description: 'Optional primary call-to-action button. Only for header location. Omit if the site does not need one.',
      properties: { label: { type: 'string' }, href: { type: 'string' } },
    },
  },
  required: ['items'],
}

aiRouter.post('/generate-nav', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured — set ANTHROPIC_API_KEY on the server.' })
  const { slug, location } = req.body ?? {}
  const loc = location === 'footer' ? 'footer' : 'header'
  if (!slug) return res.status(400).json({ ok: false, error: 'slug required' })
  const ws = await ownedWs(String(slug), req.user!.accountId)
  if (!ws) return res.status(404).json({ ok: false, error: 'workspace not found' })

  // Page list — give Claude real hrefs to link to instead of inventing /about
  const pageRows = await db.select({ type: pages.type, slug: pages.slug, title: pages.title }).from(pages).where(eq(pages.workspaceId, ws.id))
  const pageList = pageRows.map((p) => `  - "${p.title || p.slug}"  →  ${p.type === 'home' ? '/' : '/' + p.slug}`).join('\n') || '  (no pages yet)'
  const brief = await siteBrief(ws.id, ws.name)

  const intent = loc === 'header'
    ? 'Build a HEADER navigation: 3–6 short items (1–2 words each) that cover the primary user journeys. Optionally include ONE main CTA (e.g. "Book a call", "Get started", "Sign up") when it matches the site\'s intent.'
    : 'Build a FOOTER navigation: 4–10 utility / discoverability links (About, Contact, Legal, Resources, Categories, etc.). No CTA. Short labels (1–3 words).'

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: `You design website navigation for uWebsites sites. Use REAL page hrefs from the list. Match the site's industry and tone. Avoid generic filler ("Home, About, Contact") when richer pages exist.${brief ? '\n\nSITE CONTEXT:\n' + brief : ''}`,
      tools: [{ name: 'nav', description: 'Suggested navigation.', input_schema: NAV_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'nav' },
      messages: [{ role: 'user', content: `${intent}\n\nPAGES (use these hrefs when possible):\n${pageList}` }],
    })
    const toolUse = r.content.find((b: any) => b.type === 'tool_use') as any
    if (!toolUse) return res.status(502).json({ ok: false, error: 'Model returned no nav' })
    const input = toolUse.input as { items: { label: string; href: string }[]; cta?: { label: string; href: string } }
    const items = (input.items || []).slice(0, loc === 'header' ? 8 : 12).map((i) => ({ label: String(i.label || '').slice(0, 40), href: String(i.href || '').slice(0, 500) })).filter((i) => i.label && i.href)
    const cta = loc === 'header' && input.cta?.label ? { label: String(input.cta.label).slice(0, 40), href: String(input.cta.href || '').slice(0, 500) } : undefined
    await logAiJob(ws.id, 'edit', 'done', { source: 'generate-nav', location: loc, count: items.length }, 1)
    res.json({ ok: true, data: { items, cta } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'AI nav generation failed: ' + (e?.message || 'unknown') })
  }
})

// GET /ai/dashboard-suggestions — Claude looks at the account state (page
// counts, last publish, missing pieces) and returns 3–5 prioritized next-step
// suggestions. Cached client-side; the dashboard hits this once per load.
const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      description: '3 to 5 ranked, actionable next-step suggestions for the account.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short imperative (≤ 50 chars). e.g. "Publish your homepage", "Add 3 service pages".' },
          rationale: { type: 'string', description: 'One sentence why this matters now, referencing the specific workspace state.' },
          action: { type: 'string', description: 'What to click / where to go (free text), e.g. "Open the homepage and click Publish" or "Use AI page-chat to draft 3 pages".' },
          impact: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Business impact ranking.' },
        },
        required: ['title', 'rationale', 'impact'],
      },
    },
  },
  required: ['suggestions'],
}

aiRouter.get('/dashboard-suggestions', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.json({ ok: true, data: { suggestions: [] } })
  const wss = await db.select().from(workspaces).where(eq(workspaces.accountId, req.user!.accountId))
  if (!wss.length) return res.json({ ok: true, data: { suggestions: [
    { title: 'Create your first workspace', rationale: 'You haven\'t set up any sites yet — start with an import or a blank workspace.', impact: 'high', action: 'Click "+ New workspace" in the topbar.' },
  ] } })

  // Compile a compact JSON state for the model — counts only, no PII.
  const state = await Promise.all(wss.map(async (w) => {
    const [count] = await db.select({
      all: sql<number>`count(*)::int`,
      drafts: sql<number>`sum(case when ${pages.status}='draft' then 1 else 0 end)::int`,
      pub: sql<number>`sum(case when ${pages.status}='published' then 1 else 0 end)::int`,
      articles: sql<number>`sum(case when ${pages.type}='article' then 1 else 0 end)::int`,
    }).from(pages).where(eq(pages.workspaceId, w.id))
    const [home] = await db.select({ id: pages.id, seo: pages.seo }).from(pages).where(and(eq(pages.workspaceId, w.id), eq(pages.type, 'home'))).limit(1)
    const [tokens] = await db.select().from(brandingTokens).where(eq(brandingTokens.workspaceId, w.id)).limit(1)
    return {
      name: w.name,
      pages: count?.all ?? 0, drafts: count?.drafts ?? 0, published: count?.pub ?? 0, articles: count?.articles ?? 0,
      hasHome: !!home, importedFrom: ((home?.seo as any)?.import_source?.url) ?? null,
      brandingDone: !!tokens?.tokens,
    }
  }))

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: 'You are a website-builder operations advisor. Given JSON state for an account\'s workspaces, propose the 3-5 most impactful next steps — concrete, ranked by impact. Refer to workspaces by name. Prefer "publish now" / "fill gap" / "produce content" over generic advice. No fluff.',
      tools: [{ name: 'suggest', description: 'Return next-step suggestions.', input_schema: SUGGEST_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'suggest' },
      messages: [{ role: 'user', content: `Account state:\n${JSON.stringify(state, null, 2)}\n\nReturn 3-5 prioritized suggestions.` }],
    })
    const toolUse = r.content.find((b: any) => b.type === 'tool_use') as any
    if (!toolUse) return res.json({ ok: true, data: { suggestions: [] } })
    const items = (toolUse.input as any).suggestions || []
    res.json({ ok: true, data: { suggestions: items.slice(0, 5) } })
  } catch (e: any) {
    res.json({ ok: true, data: { suggestions: [], error: e?.message || 'AI suggestion failed' } })
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

// ---- Approach C: AI polish over raw-html sections (from the sectionizer) ----
// Two operations:
//   - rewrite-section-html  rewrite copy IN PLACE while preserving the
//                           layout / class names / structure. The model only
//                           edits visible text inside text-bearing tags.
//   - typify-section        convert a raw-html section to a typed catalog
//                           section (hero/features-3/etc) by extracting its
//                           text + image URLs into the proper props.

aiRouter.post('/rewrite-section-html', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured.' })
  const { pageId, sectionIndex, instruction } = req.body ?? {}
  if (!pageId || typeof sectionIndex !== 'number') return res.status(400).json({ ok: false, error: 'pageId + sectionIndex required' })

  const [row] = await db.select({ id: pages.id, blocks: pages.blocks, wsId: pages.workspaceId, accId: workspaces.accountId, name: workspaces.name })
    .from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(eq(pages.id, String(pageId))).limit(1)
  if (!row || row.accId !== req.user!.accountId) return res.status(404).json({ ok: false, error: 'page not found' })
  const blocks = (Array.isArray(row.blocks) ? row.blocks : []) as any[]
  const target = blocks[sectionIndex]
  if (!target || target.type !== 'raw-html') return res.status(400).json({ ok: false, error: 'target section is not raw-html' })

  const brief = await siteBrief(row.wsId, row.name)
  const brandBrief_ = await brandPrompt(row.wsId)

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: `You rewrite visible TEXT inside an HTML fragment while preserving every tag, attribute, class name, and visual structure. ABSOLUTE RULES:
- Output the WHOLE fragment with the same outer markup. Same tag tree. Same classes. Same id attributes. Same image src URLs (do not change images).
- Only change the TEXT NODES — the words a visitor reads.
- Do NOT add or remove any tags.
- Do NOT change href URLs unless the instruction explicitly says to.
- If the instruction is vague ("punch it up", "shorter") apply our brand voice + copy rules below. If specific ("change the hero headline to X"), follow it precisely.
- Output ONLY the modified HTML fragment — no commentary, no markdown fences.

${brandBrief_}

${COPY_RULES}${brief ? '\n\nSITE CONTEXT:\n' + brief : ''}`,
      messages: [{ role: 'user', content: `Instruction: ${instruction || 'Polish the copy per the aesthetic and copy rules. Make every claim specific. Avoid filler.'}\n\nHTML fragment:\n${target.props?.html || ''}` }],
    })
    let txt = r.content.map((b: any) => b.type === 'text' ? b.text : '').join('').trim()
    // Strip accidental markdown fences if Claude added them
    txt = txt.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim()
    if (!txt) return res.status(502).json({ ok: false, error: 'empty response' })

    const newBlocks = blocks.slice()
    newBlocks[sectionIndex] = { ...target, props: { ...(target.props || {}), html: txt } }
    await db.update(pages).set({ blocks: newBlocks as any, updatedAt: new Date() }).where(eq(pages.id, row.id))
    await logAiJob(row.wsId, 'edit', 'done', { source: 'rewrite-section-html', sectionIndex }, 1, row.id)
    res.json({ ok: true, data: { sectionIndex, blocks: newBlocks } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'AI rewrite failed: ' + (e?.message || 'unknown') })
  }
})

const TYPIFY_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: SECTION_KINDS_LIST, description: 'The catalog kind that best matches the source HTML.' },
    props: { type: 'object', description: 'Section props for the chosen kind — match the schema in lib/sections.ts. Extract text from the HTML; use IMAGE URLs that appear in the HTML verbatim (do not invent).' },
  },
  required: ['type', 'props'],
}

aiRouter.post('/typify-section', requireAuth, async (req: AuthRequest, res) => {
  const a = ai()
  if (!a) return res.status(503).json({ ok: false, error: 'AI not configured.' })
  const { pageId, sectionIndex } = req.body ?? {}
  if (!pageId || typeof sectionIndex !== 'number') return res.status(400).json({ ok: false, error: 'pageId + sectionIndex required' })

  const [row] = await db.select({ id: pages.id, blocks: pages.blocks, wsId: pages.workspaceId, accId: workspaces.accountId, name: workspaces.name })
    .from(pages).innerJoin(workspaces, eq(pages.workspaceId, workspaces.id))
    .where(eq(pages.id, String(pageId))).limit(1)
  if (!row || row.accId !== req.user!.accountId) return res.status(404).json({ ok: false, error: 'page not found' })
  const blocks = (Array.isArray(row.blocks) ? row.blocks : []) as any[]
  const target = blocks[sectionIndex]
  if (!target || target.type !== 'raw-html') return res.status(400).json({ ok: false, error: 'target section is not raw-html' })

  try {
    const r = await a.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: `Convert an HTML fragment into one of our typed catalog sections: ${SECTION_KINDS_LIST.join(', ')}. Pick the BEST-matching kind. Extract text content verbatim into the kind's props (heading, sub, items, etc per the catalog schema). For image-bearing kinds, use image URLs that already appear in the HTML — do not invent. Return via the section tool.`,
      tools: [{ name: 'section', description: 'The typed section.', input_schema: TYPIFY_SCHEMA as any }],
      tool_choice: { type: 'tool', name: 'section' },
      messages: [{ role: 'user', content: `HTML fragment:\n${target.props?.html || ''}` }],
    })
    const toolUse = r.content.find((b: any) => b.type === 'tool_use') as any
    if (!toolUse) return res.status(502).json({ ok: false, error: 'Model returned no typed section' })
    const { type, props } = toolUse.input as { type: string; props: any }

    const newBlocks = blocks.slice()
    newBlocks[sectionIndex] = { type, props: props || {} }
    await db.update(pages).set({ blocks: newBlocks as any, updatedAt: new Date() }).where(eq(pages.id, row.id))
    await logAiJob(row.wsId, 'edit', 'done', { source: 'typify-section', sectionIndex, type }, 1, row.id)
    res.json({ ok: true, data: { sectionIndex, blocks: newBlocks } })
  } catch (e: any) {
    res.status(502).json({ ok: false, error: 'Typify failed: ' + (e?.message || 'unknown') })
  }
})
