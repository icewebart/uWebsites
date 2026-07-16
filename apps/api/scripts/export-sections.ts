/**
 * Emit the section catalog as a self-contained contract spec (markdown).
 *
 *   pnpm --filter @uwebsites/api exec tsx scripts/export-sections.ts > ../../docs/SECTION-CONTRACT.md
 *
 * The output is designed to be pasted straight into Claude (Design/Code) so it
 * emits data-uw-kind sections that import into uWebsites at 100% fidelity.
 * Re-run whenever SECTIONS changes — never hand-edit the generated doc.
 */
import { SECTIONS } from '../src/lib/sections.js'

const t = (v: any): string =>
  typeof v === 'boolean' ? 'true|false'
    : typeof v === 'number' ? 'number'
      : 'text'

// A default that's an array = a repeatable list; its item fields come from [0].
const listsOf = (d: Record<string, any>) =>
  Object.entries(d).filter(([, v]) => Array.isArray(v) && v.length && typeof v[0] === 'object')

const scalarsOf = (d: Record<string, any>) =>
  Object.entries(d).filter(([, v]) => !Array.isArray(v))

const out: string[] = []
out.push(`# uWebsites — Section Contract

Generated from the live section catalog (\`apps/api/src/lib/sections.ts\`) — ${SECTIONS.length} sections.
Do not hand-edit; regenerate with \`scripts/export-sections.ts\`.

## How to use this

Design a page as a flat list of \`<section>\` blocks. Tag each one with a
\`data-uw-kind\` from this catalog, tag every piece of content with
\`data-uw-field\`, and wrap repeatable items in \`data-uw-items\` / \`data-uw-item\`.
Anything tagged this way imports as a native, editable, on-brand section.

\`\`\`html
<meta name="uw-brand"
      data-primary="#E2572B" data-accent="#3554E0"
      data-surface="#FFF9EF" data-text="#3A2E1F"
      data-heading-font="Baloo 2" data-body-font="Nunito">

<section data-uw-kind="features-3">
  <div data-uw-field="eyebrow">Why us</div>
  <h2 data-uw-field="heading">Three reasons</h2>
  <div data-uw-items="items">
    <div data-uw-item>
      <div data-uw-field="icon">🎯</div>
      <div data-uw-field="title">Clear plan</div>
      <div data-uw-field="desc">Objectives from day one.</div>
    </div>
  </div>
</section>
\`\`\`

Rules:
- Buttons: \`<a data-uw-field="cta_label" href="/target">Label</a>\` — the \`href\` becomes \`cta_href\`.
- Images: \`<img data-uw-field="image_url" alt="specific description">\` — leave \`src\` empty; the alt drives the real image.
- \`html\` fields take real rich text (\`<p>\`, \`<h3>\`, \`<ul>\`).
- Fields are optional — omit what you don't need.
`)

const byCat = new Map<string, typeof SECTIONS>()
for (const s of SECTIONS) {
  const arr = byCat.get(s.category) || []
  arr.push(s)
  byCat.set(s.category, arr as any)
}

out.push(`\n## Quick index\n`)
for (const [cat, list] of byCat) {
  out.push(`- **${cat}** — ${list.map((s) => `\`${s.kind}\``).join(', ')}`)
}

out.push(`\n## Catalog\n`)
for (const [cat, list] of byCat) {
  out.push(`\n### ${cat}\n`)
  for (const s of list) {
    const d = (s.defaults || {}) as Record<string, any>
    const scalars = scalarsOf(d)
    const lists = listsOf(d)
    out.push(`#### \`${s.kind}\` — ${s.name}`)
    out.push(`${s.description}`)
    if (scalars.length) {
      out.push(`\nFields: ${scalars.map(([k, v]) => `\`${k}\` (${t(v)})`).join(' · ')}`)
    }
    for (const [key, val] of lists) {
      const itemKeys = Object.keys(val[0])
      out.push(`\nRepeatable \`data-uw-items="${key}"\` → each \`data-uw-item\`: ${itemKeys.map((k) => `\`${k}\``).join(' · ')}`)
    }
    out.push('')
  }
}

console.log(out.join('\n'))
