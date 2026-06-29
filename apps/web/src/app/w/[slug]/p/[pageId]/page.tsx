'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { SectionPicker } from '@/components/SectionPicker'
import { AiRebuildModal } from '@/components/AiRebuildModal'

type Block = { type: string; props: Record<string, any> }
type Section = { kind: string; name: string; description: string; category: string; defaults: Record<string, any> }
type PageData = {
  id: string; type: string; slug: string; title: string; status: string
  blocks: Block[]; wsSlug: string; wsName: string
  seo?: { import_source?: { url: string; snapshot_url: string; imported_at: string } }
}

export default function PageEditor() {
  const { slug, pageId } = useParams<{ slug: string; pageId: string }>()
  const router = useRouter()
  const [page, setPage] = useState<PageData | null>(null)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState('draft')
  const [blocks, setBlocks] = useState<Block[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')
  const [previewKey, setPreviewKey] = useState(0)
  const [pvTab, setPvTab] = useState<'preview' | 'original'>('preview')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<'add' | 'replace'>('add')
  const [rebuildOpen, setRebuildOpen] = useState(false)
  const [catalog, setCatalog] = useState<Record<string, Section>>({})

  useEffect(() => {
    api<PageData>(`/pages/${pageId}`)
      .then((p) => { setPage(p); setTitle(p.title); setStatus(p.status); setBlocks(Array.isArray(p.blocks) ? p.blocks : []) })
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
    api<Section[]>(`/sections`).then((arr) => setCatalog(Object.fromEntries(arr.map((s) => [s.kind, s])))).catch(() => {})
  }, [pageId])

  // listen for section selection clicks + inline text edits from the preview iframe
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d: any = ev.data
      if (!d || d.source !== 'uw-preview') return
      if (d.type === 'select' && typeof d.index === 'number') setSelected(d.index)
      if (d.type === 'text' && typeof d.index === 'number' && typeof d.field === 'string') {
        setBlocks((bs) => bs.map((b, i) => i === d.index ? { ...b, props: { ...b.props, [d.field]: d.value } } : b))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  function upd(i: number, partial: Record<string, any>) {
    setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, props: { ...b.props, ...partial } } : b)))
  }
  function move(i: number, dir: number) {
    setBlocks((bs) => {
      const j = i + dir
      if (j < 0 || j >= bs.length) return bs
      const c = [...bs];[c[i], c[j]] = [c[j], c[i]]; return c
    })
    if (selected === i) setSelected(i + dir)
    else if (selected === i + dir) setSelected(i)
  }
  function remove(i: number) {
    setBlocks((bs) => bs.filter((_, idx) => idx !== i))
    if (selected === i) setSelected(null)
    else if (selected !== null && selected > i) setSelected(selected - 1)
  }
  function addFromCatalog(s: Section) {
    if (pickerMode === 'replace' && selected !== null) {
      // Keep shared text-y props where it makes sense (heading/sub/title carry over)
      const cur = blocks[selected]
      const carry: Record<string, any> = {}
      for (const k of ['heading', 'sub', 'title']) if (cur?.props?.[k]) carry[k] = cur.props[k]
      setBlocks((bs) => bs.map((b, idx) => idx === selected ? { type: s.kind, props: { ...structuredClone(s.defaults), ...carry } } : b))
    } else {
      setBlocks((bs) => [...bs, { type: s.kind, props: structuredClone(s.defaults) }])
      setSelected(blocks.length)
    }
    setPickerOpen(false); setPickerMode('add')
  }
  async function aiRewrite(i: number) {
    const block = blocks[i]; if (!block) return
    const instruction = window.prompt('How should AI rewrite this section?', 'Make it shorter and more energetic.')
    if (!instruction) return
    try {
      const r = await api<{ props: Record<string, any> }>('/ai/rewrite-block', { method: 'POST', body: JSON.stringify({ block, instruction, slug }) })
      setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, props: { ...b.props, ...r.props } } : b)))
    } catch (e: any) { alert(e.message || 'Rewrite failed') }
  }

  function applyRebuild(data: { title: string; blocks: Block[] }) {
    setBlocks(data.blocks); setTitle(data.title); setSelected(null); setPreviewKey((k) => k + 1); setSavedAt(new Date().toLocaleTimeString())
  }

  async function save() {
    setErr(''); setSaving(true)
    try {
      await api(`/pages/${pageId}`, { method: 'PUT', body: JSON.stringify({ title, blocks, status }) })
      setSavedAt(new Date().toLocaleTimeString())
      setPreviewKey((k) => k + 1)
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  const sel = selected != null ? blocks[selected] : null
  const selMeta = sel ? catalog[sel.type] : null

  return (
    <AppShell
      title={title || 'Edit page'} currentSlug={slug} active="Website"
      chatPageId={pageId}
      chatPageContext={{ type: page?.type || '', title, blocks }}
      onChatMutate={(newBlocks) => { setBlocks(newBlocks); setPreviewKey((k) => k + 1); setSavedAt(new Date().toLocaleTimeString()) }}
    >
      <div className="editor-bar2">
        <a className="back" href={`/w/${slug}`}>← {page?.wsName}</a>
        <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title" />
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="draft">Draft</option><option value="published">Published</option></select>
        {savedAt && <span className="muted" style={{ fontSize: 12 }}>Saved {savedAt}</span>}
        <a className="btn btn-ghost" href={`${API_URL}/pages/${pageId}/preview`} target="_blank" rel="noreferrer" title="Open in a new tab (without editor UI)">↗ Preview</a>
        {page?.seo?.import_source && (
          <button className="btn btn-secondary" onClick={() => setRebuildOpen(true)} title="Restructure into a designed layout using the section catalog">✦ AI rebuild</button>
        )}
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}

      <div className="editor-v2">
        {/* Preview / Original */}
        <div className="ev-preview">
          <div className="pv-tabs">
            <div className="group">
              <button className={pvTab === 'preview' ? 'on' : ''} onClick={() => setPvTab('preview')}>Preview</button>
              {page?.seo?.import_source && (
                <button className={pvTab === 'original' ? 'on' : ''} onClick={() => setPvTab('original')}>Original</button>
              )}
            </div>
            <div className="group">
              {pvTab === 'preview'
                ? <button onClick={() => setPreviewKey((k) => k + 1)}>↻ Refresh</button>
                : <a href={page?.seo?.import_source?.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--text-muted)', padding: '5px 10px' }}>Open ↗</a>}
            </div>
          </div>
          {pvTab === 'preview'
            ? <iframe key={previewKey} src={`${API_URL}/pages/${pageId}/preview?edit=1&sel=${selected ?? ''}&t=${previewKey}`} title="Preview" />
            : page?.seo?.import_source?.snapshot_url
              ? <div style={{ overflow: 'auto', height: '100%' }}><img src={page.seo.import_source.snapshot_url} alt="Original" style={{ display: 'block', width: '100%' }} /></div>
              : <div className="ev-empty">No original snapshot available.</div>}
        </div>

        {/* Side panel */}
        <div className="ev-side">
          {/* Section list */}
          <div className="ev-card">
            <h4>Sections</h4>
            <div className="sec-list">
              {blocks.length === 0 && <div className="ev-empty">No sections yet. Add one below.</div>}
              {blocks.map((b, i) => {
                const meta = catalog[b.type]
                return (
                  <div key={i} className={`sec-row ${selected === i ? 'active' : ''}`} onClick={() => setSelected(i)}>
                    <div className="lbl"><span className="num">{i + 1}</span><span>{meta?.name || b.type}</span></div>
                    <span className="kind">{b.type}</span>
                  </div>
                )
              })}
            </div>
            <div className="add-section">
              <button className="btn btn-secondary" onClick={() => setPickerOpen(true)}>＋ Add section</button>
            </div>
          </div>

          {/* Selected section editor */}
          {sel && selected !== null && (
            <div className="ev-card">
              <h4>{selMeta?.name || sel.type}</h4>
              <SectionForm block={sel} onChange={(partial) => upd(selected, partial)} />
              <div className="ev-actions">
                <button onClick={() => aiRewrite(selected)} title="Rewrite with AI">↻ AI rewrite</button>
                <button onClick={() => { setPickerMode('replace'); setPickerOpen(true) }} title="Replace with another section kind">⇄ Replace</button>
                <button onClick={() => move(selected, -1)} disabled={selected === 0} title="Move up">↑</button>
                <button onClick={() => move(selected, 1)} disabled={selected === blocks.length - 1} title="Move down">↓</button>
                <button className="danger" onClick={() => remove(selected)} title="Delete">✕</button>
              </div>
            </div>
          )}

          {!sel && blocks.length > 0 && (
            <div className="ev-card"><div className="ev-empty">Click a section in the preview, or pick one from the list above, to edit it.</div></div>
          )}
        </div>
      </div>

      <SectionPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addFromCatalog} />
      <AiRebuildModal
        open={rebuildOpen}
        pageId={pageId}
        pageTitle={title}
        snapshotUrl={page?.seo?.import_source?.snapshot_url}
        onClose={() => setRebuildOpen(false)}
        onDone={applyRebuild}
      />
    </AppShell>
  )
}

// Contextual form per section kind. Keeps the editor uncluttered: only the
// fields for the selected section are shown.
function SectionForm({ block, onChange }: { block: Block; onChange: (partial: Record<string, any>) => void }) {
  const p = block.props || {}
  const setItems = (items: any[]) => onChange({ items })
  switch (block.type) {
    case 'hero':
      return (<>
        <div className="field"><label>Heading</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        <div className="field"><label>Subheading</label><input className="inp" value={p.sub || ''} onChange={(e) => onChange({ sub: e.target.value })} /></div>
        <div className="field"><label>CTA label</label><input className="inp" value={p.cta_label || p.cta?.label || ''} onChange={(e) => onChange({ cta_label: e.target.value })} placeholder="Get started" /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>CTA link</label><input className="inp" value={p.cta_href || p.cta?.href || ''} onChange={(e) => onChange({ cta_href: e.target.value })} placeholder="/signup" /></div>
      </>)
    case 'hero-image':
      return (<>
        <div className="field"><label>Heading</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        <div className="field"><label>Subheading</label><input className="inp" value={p.sub || ''} onChange={(e) => onChange({ sub: e.target.value })} /></div>
        <div className="field"><label>Image URL</label><input className="inp" value={p.image_url || ''} onChange={(e) => onChange({ image_url: e.target.value })} placeholder="https://…" /></div>
        <div className="field"><label>Image alt</label><input className="inp" value={p.image_alt || ''} onChange={(e) => onChange({ image_alt: e.target.value })} /></div>
        <div className="field"><label>CTA label</label><input className="inp" value={p.cta_label || ''} onChange={(e) => onChange({ cta_label: e.target.value })} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>CTA link</label><input className="inp" value={p.cta_href || ''} onChange={(e) => onChange({ cta_href: e.target.value })} /></div>
      </>)
    case 'richtext':
      return <div className="field" style={{ marginBottom: 0 }}><label>Content</label><textarea className="inp" value={p.html || ''} onChange={(e) => onChange({ html: e.target.value })} placeholder="Write content…" /></div>
    case 'image':
      return (<>
        <div className="field"><label>Image URL</label><input className="inp" value={p.url || ''} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://…" /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>Alt text</label><input className="inp" value={p.alt || ''} onChange={(e) => onChange({ alt: e.target.value })} /></div>
      </>)
    case 'features-3':
      return (<>
        <div className="field"><label>Heading</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        <div className="field"><label>Subheading</label><input className="inp" value={p.sub || ''} onChange={(e) => onChange({ sub: e.target.value })} /></div>
        {(p.items || []).slice(0, 3).map((it: any, j: number) => (
          <div className="field" key={j}>
            <label>Item {j + 1}</label>
            <input className="inp" placeholder="Title" value={it.title || ''} onChange={(e) => setItems((p.items || []).map((x: any, k: number) => k === j ? { ...x, title: e.target.value } : x))} />
            <input className="inp" style={{ marginTop: 6 }} placeholder="Description" value={it.desc || ''} onChange={(e) => setItems((p.items || []).map((x: any, k: number) => k === j ? { ...x, desc: e.target.value } : x))} />
          </div>
        ))}
      </>)
    case 'cta-banner':
      return (<>
        <div className="field"><label>Heading</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        <div className="field"><label>Subheading</label><input className="inp" value={p.sub || ''} onChange={(e) => onChange({ sub: e.target.value })} /></div>
        <div className="field"><label>Button label</label><input className="inp" value={p.cta_label || ''} onChange={(e) => onChange({ cta_label: e.target.value })} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>Button link</label><input className="inp" value={p.cta_href || ''} onChange={(e) => onChange({ cta_href: e.target.value })} /></div>
      </>)
    case 'testimonials-3':
      return (<>
        <div className="field"><label>Heading</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        {(p.items || []).slice(0, 3).map((it: any, j: number) => (
          <div className="field" key={j}>
            <label>Testimonial {j + 1}</label>
            <textarea className="inp" placeholder="Quote" value={it.quote || ''} onChange={(e) => setItems((p.items || []).map((x: any, k: number) => k === j ? { ...x, quote: e.target.value } : x))} />
            <input className="inp" style={{ marginTop: 6 }} placeholder="Author" value={it.author || ''} onChange={(e) => setItems((p.items || []).map((x: any, k: number) => k === j ? { ...x, author: e.target.value } : x))} />
            <input className="inp" style={{ marginTop: 6 }} placeholder="Role" value={it.role || ''} onChange={(e) => setItems((p.items || []).map((x: any, k: number) => k === j ? { ...x, role: e.target.value } : x))} />
          </div>
        ))}
      </>)
    case 'pricing-3': {
      const setTiers = (tiers: any[]) => onChange({ tiers })
      return (<>
        <div className="field"><label>Heading</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        {(p.tiers || []).slice(0, 3).map((t: any, j: number) => (
          <div className="field" key={j}>
            <label>Tier {j + 1}{t.featured ? ' · featured' : ''}</label>
            <input className="inp" placeholder="Name" value={t.name || ''} onChange={(e) => setTiers((p.tiers || []).map((x: any, k: number) => k === j ? { ...x, name: e.target.value } : x))} />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input className="inp" placeholder="€19" value={t.price || ''} onChange={(e) => setTiers((p.tiers || []).map((x: any, k: number) => k === j ? { ...x, price: e.target.value } : x))} />
              <input className="inp" placeholder="/mo" value={t.period || ''} onChange={(e) => setTiers((p.tiers || []).map((x: any, k: number) => k === j ? { ...x, period: e.target.value } : x))} />
            </div>
            <textarea className="inp" style={{ marginTop: 6 }} placeholder="One feature per line" value={(t.items || []).join('\n')} onChange={(e) => setTiers((p.tiers || []).map((x: any, k: number) => k === j ? { ...x, items: e.target.value.split('\n').filter(Boolean) } : x))} />
            <input className="inp" style={{ marginTop: 6 }} placeholder="Button label" value={t.cta_label || ''} onChange={(e) => setTiers((p.tiers || []).map((x: any, k: number) => k === j ? { ...x, cta_label: e.target.value } : x))} />
            <input className="inp" style={{ marginTop: 6 }} placeholder="Button link" value={t.cta_href || ''} onChange={(e) => setTiers((p.tiers || []).map((x: any, k: number) => k === j ? { ...x, cta_href: e.target.value } : x))} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={!!t.featured} onChange={(e) => setTiers((p.tiers || []).map((x: any, k: number) => ({ ...x, featured: k === j ? e.target.checked : false })))} />
              Mark as "Most popular"
            </label>
          </div>
        ))}
      </>)
    }
    case 'faq':
      return (<>
        <div className="field"><label>Heading</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        {(p.items || []).map((it: any, j: number) => (
          <div className="field" key={j}>
            <label>Q&amp;A {j + 1}</label>
            <input className="inp" placeholder="Question" value={it.q || ''} onChange={(e) => setItems((p.items || []).map((x: any, k: number) => k === j ? { ...x, q: e.target.value } : x))} />
            <textarea className="inp" style={{ marginTop: 6 }} placeholder="Answer" value={it.a || ''} onChange={(e) => setItems((p.items || []).map((x: any, k: number) => k === j ? { ...x, a: e.target.value } : x))} />
          </div>
        ))}
        <div className="ev-actions" style={{ marginTop: 4 }}>
          <button onClick={() => setItems([...(p.items || []), { q: '', a: '' }])}>＋ Add Q&amp;A</button>
          {(p.items || []).length > 0 && <button className="danger" onClick={() => setItems((p.items || []).slice(0, -1))}>− Remove last</button>}
        </div>
      </>)
    case 'logo-cloud': {
      const setLogos = (logos: any[]) => onChange({ logos })
      return (<>
        <div className="field"><label>Heading</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        {(p.logos || []).map((l: any, j: number) => (
          <div className="field" key={j}>
            <label>Logo {j + 1}</label>
            <input className="inp" placeholder="Image URL" value={l.url || ''} onChange={(e) => setLogos((p.logos || []).map((x: any, k: number) => k === j ? { ...x, url: e.target.value } : x))} />
            <input className="inp" style={{ marginTop: 6 }} placeholder="Alt" value={l.alt || ''} onChange={(e) => setLogos((p.logos || []).map((x: any, k: number) => k === j ? { ...x, alt: e.target.value } : x))} />
          </div>
        ))}
        <div className="ev-actions" style={{ marginTop: 4 }}>
          <button onClick={() => setLogos([...(p.logos || []), { url: '', alt: '' }])}>＋ Add logo</button>
          {(p.logos || []).length > 0 && <button className="danger" onClick={() => setLogos((p.logos || []).slice(0, -1))}>− Remove last</button>}
        </div>
      </>)
    }
    case 'image-text':
      return (<>
        <div className="field"><label>Heading</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        <div className="field"><label>Body (HTML)</label><textarea className="inp" value={p.html || ''} onChange={(e) => onChange({ html: e.target.value })} /></div>
        <div className="field"><label>Image URL</label><input className="inp" value={p.image_url || ''} onChange={(e) => onChange({ image_url: e.target.value })} placeholder="https://…" /></div>
        <div className="field"><label>Image alt</label><input className="inp" value={p.image_alt || ''} onChange={(e) => onChange({ image_alt: e.target.value })} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label>Image side</label>
          <select className="inp" value={p.image_side || 'right'} onChange={(e) => onChange({ image_side: e.target.value })}>
            <option value="right">Right</option><option value="left">Left</option>
          </select>
        </div>
      </>)
    case 'stats-row':
      return (<>
        <div className="field"><label>Heading (optional)</label><input className="inp" value={p.heading || ''} onChange={(e) => onChange({ heading: e.target.value })} /></div>
        {(p.items || []).map((it: any, j: number) => (
          <div className="field" key={j}>
            <label>Stat {j + 1}</label>
            <input className="inp" placeholder="Value (e.g. 80+)" value={it.value || ''} onChange={(e) => setItems((p.items || []).map((x: any, k: number) => k === j ? { ...x, value: e.target.value } : x))} />
            <input className="inp" style={{ marginTop: 6 }} placeholder="Label" value={it.label || ''} onChange={(e) => setItems((p.items || []).map((x: any, k: number) => k === j ? { ...x, label: e.target.value } : x))} />
          </div>
        ))}
        <div className="ev-actions" style={{ marginTop: 4 }}>
          <button onClick={() => setItems([...(p.items || []), { value: '', label: '' }])}>＋ Add stat</button>
          {(p.items || []).length > 0 && <button className="danger" onClick={() => setItems((p.items || []).slice(0, -1))}>− Remove last</button>}
        </div>
      </>)
    default:
      return <div className="muted" style={{ fontSize: 13 }}>No editor for "{block.type}" sections yet.</div>
  }
}
