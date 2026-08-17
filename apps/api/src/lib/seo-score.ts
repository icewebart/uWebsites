// On-page SEO score — a RankMath/Yoast-style deterministic checklist, NOT the
// AI "publish readiness" grade already stored at seo.review.score (that's a
// one-time subjective writing-quality verdict from the editor pass at write
// time; this is a mechanical checklist anyone can re-run anytime against the
// current title/meta/body/keyword, same rules RankMath/Yoast apply).

export type SeoCheck = { id: string; label: string; pass: boolean; hint?: string }
export type SeoScore = { score: number; checks: SeoCheck[] }

function stripTags(html: string): string {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
function wordCount(text: string): number {
  return text ? text.split(/\s+/).filter(Boolean).length : 0
}
function norm(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

/** Score one article. `html` is the article-body block's HTML; `imageAlts` are
 * every alt attribute found in the body + hero image. Every check is worth
 * equal weight (RankMath/Yoast do too, roughly) — simple beats a fake-precise
 * weighting scheme neither of them actually earns either. */
export function scoreArticleSeo(input: {
  title: string
  metaDescription?: string
  keyword?: string
  html: string
  slug?: string
  imageAlts?: string[]
}): SeoScore {
  const keyword = norm(input.keyword || '')
  const title = String(input.title || '')
  const meta = String(input.metaDescription || '')
  const html = String(input.html || '')
  const text = stripTags(html)
  const words = wordCount(text)
  const slug = norm(input.slug || '')
  const alts = input.imageAlts || []
  const h2s = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/gis)].map((m) => norm(stripTags(m[1])))
  const internalLinks = [...html.matchAll(/<a\s[^>]*href=["'](\/[^"'#][^"']*|https?:\/\/[^"']*)["']/gi)]
  const externalLinks = internalLinks.filter((m) => /^https?:\/\//i.test(m[1]) && !/uwebsites\.net/i.test(m[1]))
  const internalOnly = internalLinks.length - externalLinks.length
  const firstPara = norm(text.slice(0, 400))

  const checks: SeoCheck[] = []
  const has = (id: string, label: string, pass: boolean, hint?: string) => checks.push({ id, label, pass, hint })

  if (keyword) {
    has('kw-title', 'Focus keyword in title', norm(title).includes(keyword), 'Put the exact keyword phrase in the title.')
    has('kw-slug', 'Focus keyword in URL', !!slug && slug.replace(/-/g, ' ').includes(keyword.replace(/\s+/g, ' ')), 'Slug should contain the keyword.')
    has('kw-meta', 'Focus keyword in meta description', norm(meta).includes(keyword), 'Mention the keyword in the meta description.')
    has('kw-first', 'Focus keyword in the first paragraph', firstPara.includes(keyword), 'Use the keyword within the first ~100 words.')
    has('kw-h2', 'Focus keyword in a subheading', h2s.some((h) => h.includes(keyword)), 'Work the keyword (or a close variant) into at least one H2.')
  } else {
    has('kw-set', 'Has a target keyword set', false, 'No keyword assigned — the rest of this checklist can\'t run without one.')
  }

  has('title-len', 'Title length is search-friendly (≤ 60 chars)', title.length > 0 && title.length <= 60, `Currently ${title.length} chars — Google truncates past ~60.`)
  has('meta-len', 'Meta description is 120–160 characters', meta.length >= 120 && meta.length <= 160, `Currently ${meta.length} chars.`)
  has('word-count', 'Content is at least 600 words', words >= 600, `Currently ${words} words — thin content rarely competes.`)
  has('h2-present', 'Has at least one subheading (H2)', h2s.length >= 1, 'Break the article up with H2s — helps both readers and featured snippets.')
  has('internal-links', 'Has at least one internal link', internalOnly >= 1, 'Link to another page on this site.')
  has('external-links', 'Has at least one external authority link', externalLinks.length >= 1, 'Link out to one credible external source.')
  const imgCount = (html.match(/<img\b/gi) || []).length
  has('image-alt', 'Every image has alt text', imgCount === 0 || alts.every((a) => a && a.trim().length > 0), 'Add descriptive alt text to every image.')
  has('faq-or-list', 'Uses a list or FAQ structure', /<ol\b|<ul\b|faq/i.test(html), 'Ordered/unordered lists and FAQs are snippet-friendly.')

  const passed = checks.filter((c) => c.pass).length
  const score = checks.length ? Math.round((passed / checks.length) * 100) : 0
  return { score, checks }
}
