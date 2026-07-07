import type { SectionFP } from './headless.js'
import type { ImageMirror } from './image-host.js'

// Deterministic DOM → semantic-section classifier. Given the structural
// fingerprint the headless render computed for one top-level section, decide
// which section kind from our catalog it is and build the block props — with
// NO AI (0 credits). Every rule returns a confidence; the caller (Structure)
// keeps the semantic block when confidence clears a threshold and otherwise
// falls back to a styled raw-html block so fidelity is never lost.

export type ClassifiedBlock = { type: string; props: any }
export type Classification = { block: ClassifiedBlock | null; confidence: number; kind: string; reason: string }

const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const clip = (s: string, n: number) => String(s || '').slice(0, n)
const rows = (items: string[]) => items.length ? `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''

// Compose a small, safe richtext body from what the fingerprint extracted.
function proseFromFp(fp: SectionFP): string {
  const parts: string[] = []
  if (fp.deck) parts.push(`<p>${esc(fp.deck)}</p>`)
  if (fp.listItems.length) parts.push(rows(fp.listItems))
  return parts.join('')
}

function heroImage(fp: SectionFP): { url: string; alt: string } {
  if (fp.bg.hasImage && fp.bg.imageUrl) return { url: fp.bg.imageUrl, alt: fp.heading || '' }
  const big = fp.images.find((im) => (im.w || 0) >= 240 || (im.h || 0) >= 180) || fp.images[0]
  return { url: big?.url || '', alt: big?.alt || fp.heading || '' }
}

// ---- the classifier ----
export function classifySection(fp: SectionFP): Classification {
  const c = fp.counts
  const cards = fp.cards || []
  const withImg = cards.filter((x) => x.imgUrl).length
  const withHeading = cards.filter((x) => x.heading).length
  const cta = fp.buttons[0]
  const cta2 = fp.buttons[1]
  const mk = (type: string, props: any, confidence: number, reason: string): Classification => ({ block: { type, props }, confidence, kind: type, reason })

  // 1) HERO — first section, real heading, a DOMINANT image, and enough height
  //    to be a banner. Requiring an image + height avoids promoting a slim
  //    contact/utility bar (phone·email) at the top of the page into a hero with
  //    empty placeholders. A heading that's just contact info is rejected too.
  const looksContact = /^[\s\d()+.\-|/]*$/.test(fp.heading) || /@|\btel\b|\bemail\b/i.test(fp.heading)
  if (fp.isFirst && fp.heading && !looksContact && c.heading <= 3 && cards.length < 3 && fp.rect.h >= 300) {
    const img = heroImage(fp)
    if (img.url) {
      const base: any = {
        eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 160), sub: clip(fp.deck, 260),
        image_url: img.url, image_alt: img.alt,
        cta_label: cta?.label || '', cta_href: cta?.href || '',
        cta2_label: cta2?.label || '', cta2_href: cta2?.href || '',
      }
      // Full-bleed background image → split-hero; a contained image → hero-image.
      const bleed = fp.bg.hasImage || (fp.rect.h >= 420)
      return mk(bleed ? 'split-hero' : 'hero-image', base, 0.82, 'first section w/ heading + hero image')
    }
    // No image → not a confident hero; let raw-html preserve it verbatim.
  }

  // 2) FAQ — accordion/toggle markup is an unambiguous signal.
  if (fp.faqs.length >= 2) {
    return mk('faq-accordion', {
      eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140),
      items: fp.faqs.slice(0, 20).map((q) => ({ q: clip(q.q, 240), a: clip(q.a, 1200) })),
    }, 0.92, `${fp.faqs.length} accordion items`)
  }

  // 3) STATS — ≥3 big-number leads with labels.
  const goodStats = fp.stats.filter((s) => s.value && s.label)
  if (goodStats.length >= 3 && c.img <= goodStats.length) {
    const items = goodStats.slice(0, 8).map((s) => ({ value: clip(s.value, 12), label: clip(s.label, 48) }))
    return items.length <= 4 && !fp.heading
      ? mk('stats-band', { items }, 0.84, `${items.length} stats, no heading`)
      : mk('stats-row', { heading: clip(fp.heading, 140), items }, 0.8, `${items.length} stats`)
  }

  // 4) GALLERY — many images, little prose, not many headings.
  if (c.img >= 4 && c.heading <= 2 && fp.textLen < c.img * 60 && withHeading < 2) {
    // A wide row of small similar images with no captions reads as a logo cloud.
    const small = fp.images.filter((im) => (im.h || 0) > 0 && (im.h || 999) <= 90).length
    if (small >= 4 && fp.textLen < 80) {
      return mk('logo-cloud', { heading: clip(fp.heading, 140), logos: fp.images.slice(0, 12).map((im) => ({ url: im.url, alt: im.alt })) }, 0.62, `${small} small logos`)
    }
    return mk('gallery', {
      eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140), sub: clip(fp.deck, 200),
      items: fp.images.slice(0, 12).map((im) => ({ image_url: im.url, caption: clip(im.alt, 120) })),
    }, 0.72, `${c.img} images, low text`)
  }

  // 5) CARD ROWS — equal-width repeated children. Require the cards to carry
  //    real substance (a description, an image, or an icon) — a row of bare
  //    heading+link items is a nav/menu list, not a feature grid, so let it fall
  //    through to a faithful raw-html block instead.
  const substantive = cards.filter((x) => x.text.length > 20 || x.imgUrl || x.icon).length
  if (cards.length >= 2 && withHeading >= Math.ceil(cards.length / 2) && substantive >= Math.ceil(cards.length / 2)) {
    // Testimonials: quote-shaped cards (blockquotes / a name + a longer line).
    // 4+ of them → the 3-up GSAP slider; fewer → a static 3-column grid.
    if (c.blockquote >= 2 || (cards.every((x) => !x.imgUrl && x.text.length > 40) && /testimon|review|p[ăa]rer|recenz/i.test(fp.classes + ' ' + fp.heading))) {
      const items = cards.slice(0, 16).map((x) => ({ quote: clip(x.text || x.heading, 400), author: clip(x.heading, 60), role: '', rating: 5 }))
      return cards.length > 3
        ? mk('testimonials-slider', { eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140), autoplay: true, items }, 0.68, `${cards.length} testimonials → slider`)
        : mk('testimonials-3', { eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140), sub: clip(fp.deck, 200), items: items.slice(0, 6) }, 0.66, 'quote-shaped cards')
    }
    // Two columns, one image + one text → image-text (checked before cards so a
    // 2-up "photo beside a paragraph" doesn't get read as a 2-card grid).
    if (fp.row.cols === 2 && withImg === 1) {
      const imgCard = cards.find((x) => x.imgUrl)!
      const txtCard = cards.find((x) => !x.imgUrl) || cards[0]
      return mk('image-text', {
        heading: clip(txtCard.heading || fp.heading, 140),
        html: `${txtCard.text ? `<p>${esc(clip(txtCard.text, 800))}</p>` : proseFromFp(fp)}`,
        image_url: imgCard.imgUrl, image_alt: clip(imgCard.imgAlt, 140),
        image_side: cards.indexOf(imgCard) === 0 ? 'left' : 'right',
      }, 0.74, 'two-col image + text')
    }
    // Program cards: image-topped cards (each column has a photo), often w/ a CTA.
    if (fp.row.cols <= 3 && withImg >= Math.max(2, cards.length - 1)) {
      return mk('program-cards', {
        eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140),
        items: cards.slice(0, 3).map((x) => ({ badge: '', title: clip(x.heading, 120), desc: clip(x.text, 260), image_url: x.imgUrl, cta_label: clip(x.label, 32), cta_href: x.href })),
      }, 0.8, `${cards.length} image cards`)
    }
    // Icon/heading/desc feature grid — pick the column count that matches.
    const kind = fp.row.cols === 2 ? 'features-2col' : fp.row.cols === 4 ? 'features-4' : 'features-3'
    const cap = kind === 'features-2col' ? 2 : kind === 'features-4' ? 4 : 6
    return mk(kind, {
      eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140), sub: clip(fp.deck, 200),
      items: cards.slice(0, cap).map((x) => ({ icon: '', title: clip(x.heading, 120), desc: clip(x.text, 260) })),
    }, 0.76, `${cards.length}-col feature grid`)
  }

  // 6) BIG QUOTE — a single prominent blockquote.
  if (c.blockquote >= 1 && c.p <= 3 && cards.length === 0 && fp.textLen < 600) {
    return mk('big-quote', { quote: clip(fp.deck || fp.heading, 400), author: '', role: '', image_url: fp.images[0]?.url || '' }, 0.7, 'single blockquote')
  }

  // 7) SINGLE IMAGE + TEXT (not a card row): one content image beside prose.
  if (c.img === 1 && fp.heading && c.p >= 1 && !fp.bg.hasImage) {
    const im = fp.images[0]
    return mk('image-text', {
      heading: clip(fp.heading, 140), html: proseFromFp(fp),
      image_url: im?.url || '', image_alt: clip(im?.alt || fp.heading, 140),
      image_side: 'right',
    }, 0.6, 'single image beside text')
  }

  // 8) CTA BANNER — short section, a heading + a button, nothing else.
  if (c.button >= 1 && c.img === 0 && fp.textLen < 260 && cards.length === 0 && fp.heading) {
    return mk('cta-banner', { heading: clip(fp.heading, 140), sub: clip(fp.deck, 200), cta_label: cta?.label || '', cta_href: cta?.href || '' }, 0.62, 'short heading + button')
  }

  // 9) PROSE — a text-only section. Low confidence: the caller will usually
  //    prefer a styled raw-html block to keep fidelity, but this is a valid
  //    editable fallback when there's no rendered HTML to fall back to.
  if (fp.heading || fp.deck || fp.listItems.length) {
    const html = `${fp.heading ? `<h2>${esc(clip(fp.heading, 160))}</h2>` : ''}${proseFromFp(fp)}`
    return mk('richtext', { html }, 0.28, 'text-only fallback')
  }

  return { block: null, confidence: 0, kind: 'none', reason: 'nothing recognised' }
}

// ---- the FITTER (the deterministic "Redesign" engine) ----
// classifySection is a precise cascade that bails to raw-html when unsure. The
// fitter instead ALWAYS tries to land on an editable, brand-styled section: it
// takes the confident classifier result when there is one, and otherwise maps
// whatever content the fingerprint extracted into the best-fit catalog section
// (looser bars, column count from item count, alternating image side). It only
// returns { needsAi:true } when a region has NO mappable content at all (a bare
// form / map / embed), which the caller can hand to AI or keep as raw-html.
// This is what turns "boxes of raw HTML" into real sections — with zero AI.
export type FitResult = Classification & { needsAi?: boolean }

// Convert a section's messy source HTML into clean, editable semantic richtext
// WITHOUT losing body copy: drop non-content elements, unwrap divs/spans, keep a
// whitelist (p/h2/h3/ul/ol/li/strong/em/a/blockquote), normalise headings + bold/
// italic, and wrap any loose text in <p>. Used by the fitter's text fallbacks so
// a multi-paragraph section becomes a full, editable richtext block (not a blob).
export function htmlToRichtext(raw: string): string {
  if (!raw) return ''
  let s = String(raw)
  s = s.replace(/<(script|style|svg|noscript|form|iframe|nav|header|footer|button|select|textarea)\b[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<br\b[^>]*>/gi, '\n').replace(/<(img|input|hr|source|track)\b[^>]*>/gi, '')
  s = s.replace(/<\/?h1\b[^>]*>/gi, (m) => m[1] === '/' ? '</h2>' : '<h2>')
  s = s.replace(/<\/?h[4-6]\b[^>]*>/gi, (m) => m[1] === '/' ? '</h3>' : '<h3>')
  const KEEP = /^(p|h2|h3|ul|ol|li|strong|em|b|i|a|blockquote)$/i
  s = s.replace(/<(\/?)([a-zA-Z0-9]+)\b([^>]*)>/g, (_m, slash: string, tag: string, attrs: string) => {
    if (!KEEP.test(tag)) return ''                                  // unwrap: strip tag, keep content
    const t = tag.toLowerCase() === 'b' ? 'strong' : tag.toLowerCase() === 'i' ? 'em' : tag.toLowerCase()
    if (t === 'a' && !slash) {
      const href = (attrs.match(/href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i)?.[1] || '').replace(/^['"]|['"]$/g, '')
      return href ? `<a href="${href.replace(/"/g, '&quot;')}">` : '<a>'
    }
    return `<${slash}${t}>`
  })
  s = s.replace(/&nbsp;/gi, ' ').replace(/[ \t ]+/g, ' ')
  s = s.replace(/<(p|h2|h3|li|blockquote)>\s*<\/\1>/gi, '')          // drop empties
  // Wrap loose top-level text (sections whose copy sat in bare divs) in <p>.
  if (!/<(p|h2|h3|ul|ol|blockquote)[ >]/i.test(s)) {
    const txt = s.replace(/<[^>]+>/g, '').trim()
    if (txt) s = `<p>${s.trim()}</p>`
  }
  return s.replace(/\n{2,}/g, '\n').trim().slice(0, 20000)
}

export function fitSection(fp: SectionFP, html?: string): FitResult {
  // 1) Trust the precise classifier when it's confident.
  const primary = classifySection(fp)
  if (primary.block && primary.confidence >= 0.55) return primary

  const c = fp.counts
  const cards = fp.cards || []
  const withImg = cards.filter((x) => x.imgUrl).length
  const cta = fp.buttons[0]
  const mk = (type: string, props: any, confidence: number, reason: string): FitResult =>
    ({ block: { type, props }, confidence, kind: type, reason })

  const hasText = !!(fp.heading || fp.deck || fp.listItems.length || c.p > 0)
  const anyContent = hasText || cards.length > 0 || c.img > 0 || fp.stats.length > 0 || fp.faqs.length > 0 || fp.buttons.length > 0
  // Nothing extractable (a form/map/embed widget) → AI or raw-html preserves it.
  if (!anyContent) return { block: null, confidence: 0, kind: 'none', reason: 'no mappable content', needsAi: true }

  // 2) Card / feature rows (looser than the strict classifier).
  if (cards.length >= 2) {
    const substantive = cards.filter((x) => x.text.length > 12 || x.imgUrl || x.icon).length
    if (substantive >= 2) {
      // Image-topped cards → program-cards.
      if (fp.row.cols <= 3 && withImg >= Math.max(2, cards.length - 1)) {
        return mk('program-cards', {
          eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140),
          items: cards.slice(0, 3).map((x) => ({ badge: '', title: clip(x.heading, 120), desc: clip(x.text, 260), image_url: x.imgUrl, cta_label: clip(x.label, 32), cta_href: x.href })),
        }, 0.55, 'image cards (fitter)')
      }
      // Column count follows how many cards there are.
      const kind = fp.row.cols === 2 ? 'features-2col' : cards.length >= 4 ? 'features-4' : 'features-3'
      const cap = kind === 'features-2col' ? 2 : kind === 'features-4' ? 4 : 6
      return mk(kind, {
        eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140), sub: clip(fp.deck, 200),
        items: cards.slice(0, cap).map((x) => ({ icon: '', title: clip(x.heading, 120), desc: clip(x.text, 260) })),
      }, 0.55, `${cards.length}-col features (fitter)`)
    }
  }

  // 3) Stats row.
  const stats = fp.stats.filter((s) => s.value && s.label)
  if (stats.length >= 2) {
    return mk('stats-row', { heading: clip(fp.heading, 140), items: stats.slice(0, 6).map((s) => ({ value: clip(s.value, 12), label: clip(s.label, 48) })) }, 0.55, 'stats (fitter)')
  }

  // 4) Image-heavy → gallery, or a strip of tiny images → logo cloud.
  if (c.img >= 3 && fp.textLen < c.img * 90) {
    const small = fp.images.filter((im) => (im.h || 999) <= 90).length
    if (small >= 3 && fp.textLen < 120) {
      return mk('logo-cloud', { heading: clip(fp.heading, 140), logos: fp.images.slice(0, 12).map((im) => ({ url: im.url, alt: im.alt })) }, 0.5, 'logos (fitter)')
    }
    return mk('gallery', { eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140), items: fp.images.slice(0, 12).map((im) => ({ image_url: im.url, caption: clip(im.alt, 120) })) }, 0.5, 'gallery (fitter)')
  }

  // Full body copy from the real HTML (so we never drop paragraphs 2+); falls
  // back to the fingerprint's deck+list when no HTML was passed.
  const bodyRich = (html && htmlToRichtext(html)) || proseFromFp(fp) || (fp.deck ? `<p>${esc(clip(fp.deck, 1200))}</p>` : '')

  // 5) One image beside text → image-text, alternating side down the page.
  if (c.img >= 1 && hasText) {
    const im = fp.images.find((x) => (x.w || 0) >= 120 || (x.h || 0) >= 120) || fp.images[0]
    return mk('image-text', {
      heading: clip(fp.heading, 140), html: bodyRich,
      image_url: im?.url || '', image_alt: clip(im?.alt || fp.heading, 140),
      image_side: (fp.index % 2 === 0) ? 'right' : 'left',
    }, 0.5, 'image + text (fitter)')
  }

  // 6) Short heading + button → CTA banner.
  if (fp.buttons.length >= 1 && fp.textLen < 320 && fp.heading) {
    return mk('cta-banner', { heading: clip(fp.heading, 140), sub: clip(fp.deck, 200), cta_label: cta?.label || '', cta_href: cta?.href || '' }, 0.5, 'cta (fitter)')
  }

  // 7) Universal text catch-all → editable richtext (NOT a raw-html blob). Use
  //    the full HTML so all paragraphs survive; the heading is already inside it.
  const rich = (html && htmlToRichtext(html)) ||
    `${fp.heading ? `<h2>${esc(clip(fp.heading, 160))}</h2>` : ''}${proseFromFp(fp) || (fp.deck ? `<p>${esc(clip(fp.deck, 1200))}</p>` : '')}`
  if (rich && rich.replace(/<[^>]+>/g, '').trim()) return mk('richtext', { html: rich }, 0.5, 'text catch-all (fitter)')

  // 8) Only an image, nothing else → a single image block.
  if (c.img >= 1) return mk('image', { url: fp.images[0].url, alt: clip(fp.images[0].alt, 140) }, 0.45, 'image only (fitter)')

  return { block: null, confidence: 0, kind: 'none', reason: 'unfit', needsAi: true }
}

// ---- image mirroring: rewrite every image URL in a classified block to the
// workspace's /img mirror, stamping the ORIGINAL source URL so heal can always
// recover it later (Phase 4). Mutates + returns the block. ----
const IMG_KEYS = ['image_url', 'url']
export async function mirrorBlockImages(block: ClassifiedBlock, mirror: ImageMirror): Promise<ClassifiedBlock> {
  const one = async (obj: any, key: string, origKey: string) => {
    const src = obj?.[key]
    if (typeof src === 'string' && /^https?:\/\//i.test(src)) {
      try { const m = await mirror.mirror(src); if (m) { obj[origKey] = src; obj[key] = m } } catch { /* leave original */ }
    }
  }
  const p = block.props || {}
  for (const k of IMG_KEYS) await one(p, k, `${k}_orig`)
  if (Array.isArray(p.items)) for (const it of p.items) { await one(it, 'image_url', 'image_url_orig'); await one(it, 'image', 'image_orig') }
  if (Array.isArray(p.logos)) for (const l of p.logos) await one(l, 'url', 'url_orig')
  if (Array.isArray(p.tiers)) for (const t of p.tiers) await one(t, 'image_url', 'image_url_orig')
  return block
}
