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

  // 1) HERO — first section, has a heading, a dominant image (bg or content),
  //    little repeated structure. This is what people judge the page on.
  if (fp.isFirst && fp.heading && c.heading <= 3 && cards.length < 3) {
    const img = heroImage(fp)
    const base: any = {
      eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 160), sub: clip(fp.deck, 260),
      image_url: img.url, image_alt: img.alt,
      cta_label: cta?.label || '', cta_href: cta?.href || '',
      cta2_label: cta2?.label || '', cta2_href: cta2?.href || '',
    }
    // Big full-bleed background image → split-hero reads best; a contained
    // image beside text → hero-image.
    if (img.url) {
      const bleed = fp.bg.hasImage || (fp.rect.h >= 420)
      return mk(bleed ? 'split-hero' : 'hero-image', base, 0.82, 'first section w/ heading + hero image')
    }
    return mk('hero-image', base, 0.6, 'first section w/ heading, no image')
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

  // 5) CARD ROWS — the equal-width repeated children the fingerprint found.
  if (cards.length >= 2 && withHeading >= Math.ceil(cards.length / 2)) {
    // Testimonials: quote-shaped cards (blockquotes / a name + a longer line).
    if (c.blockquote >= 2 || (cards.every((x) => !x.imgUrl && x.text.length > 40) && /testimon|review|p[ăa]rer|recenz/i.test(fp.classes + ' ' + fp.heading))) {
      return mk('testimonials-3', {
        eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140), sub: clip(fp.deck, 200),
        items: cards.slice(0, 6).map((x) => ({ quote: clip(x.text || x.heading, 400), author: clip(x.heading, 60), role: '' })),
      }, 0.66, 'quote-shaped cards')
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
    // Icon/heading/desc feature grid.
    const kind = fp.row.cols === 2 ? 'features-2col' : 'features-3'
    return mk(kind, {
      eyebrow: clip(fp.kicker, 60), heading: clip(fp.heading, 140), sub: clip(fp.deck, 200),
      items: cards.slice(0, kind === 'features-2col' ? 2 : 6).map((x) => ({ icon: '', title: clip(x.heading, 120), desc: clip(x.text, 260) })),
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
