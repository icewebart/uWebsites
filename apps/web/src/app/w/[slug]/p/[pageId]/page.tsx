'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { ChatPanel } from '@/components/ChatPanel'

type Block = { type: string; props: Record<string, any> }
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
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string>('')
  const [err, setErr] = useState('')
  const [previewKey, setPreviewKey] = useState(0)
  const [pvTab, setPvTab] = useState<'preview' | 'original'>('preview')

  useEffect(() => {
    api<PageData>(`/pages/${pageId}`)
      .then((p) => { setPage(p); setTitle(p.title); setStatus(p.status); setBlocks(Array.isArray(p.blocks) ? p.blocks : []) })
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
  }, [pageId])

  function upd(i: number, partial: Record<string, any>) {
    setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, props: { ...b.props, ...partial } } : b)))
  }
  function move(i: number, dir: number) {
    setBlocks((bs) => {
      const j = i + dir
      if (j < 0 || j >= bs.length) return bs
      const copy = [...bs];[copy[i], copy[j]] = [copy[j], copy[i]]; return copy
    })
  }
  function remove(i: number) { setBlocks((bs) => bs.filter((_, idx) => idx !== i)) }
  async function aiRewrite(i: number) {
    const block = blocks[i]; if (!block) return
    const instruction = window.prompt('How should AI rewrite this section?', 'Make it shorter and more energetic.')
    if (!instruction) return
    try {
      const r = await api<{ props: Record<string, any> }>('/ai/rewrite-block', { method: 'POST', body: JSON.stringify({ block, instruction }) })
      setBlocks((bs) => bs.map((b, idx) => (idx === i ? { ...b, props: { ...b.props, ...r.props } } : b)))
    } catch (e: any) { alert(e.message || 'Rewrite failed') }
  }
  function add(type: string) {
    const props = type === 'hero' ? { heading: '', sub: '' }
      : type === 'image' ? { url: '', alt: '' }
      : { html: '' }
    setBlocks((bs) => [...bs, { type, props }])
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

  return (
    <AppShell title={title || 'Edit page'} currentSlug={slug} active="Website">
      <div className="editor">
        <div className="editor-col">
        <div style={{ marginBottom: 14 }}>
          <a className="btn btn-ghost" href={`/w/${slug}`}>← {page?.wsName}</a>
          <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{page?.type} · /{page?.slug}</span>
        </div>

        <div className="editor-bar">
          <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title" />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </div>

        {blocks.map((b, i) => (
          <div className="block-card" key={i}>
            <div className="block-head">
              <span className="block-type">{b.type}</span>
              <div className="block-ctrls">
                <button onClick={() => aiRewrite(i)} title="Rewrite with AI">↻</button>
                <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === blocks.length - 1} title="Move down">↓</button>
                <button onClick={() => remove(i)} title="Delete">✕</button>
              </div>
            </div>
            {b.type === 'hero' && (<>
              <div className="field"><label>Heading</label><input className="inp" value={b.props.heading || ''} onChange={(e) => upd(i, { heading: e.target.value })} /></div>
              <div className="field" style={{ marginBottom: 0 }}><label>Subheading</label><input className="inp" value={b.props.sub || ''} onChange={(e) => upd(i, { sub: e.target.value })} /></div>
            </>)}
            {b.type === 'richtext' && (
              <div className="field" style={{ marginBottom: 0 }}><label>Content</label><textarea className="inp" value={b.props.html || ''} onChange={(e) => upd(i, { html: e.target.value })} placeholder="Write content…" /></div>
            )}
            {b.type === 'image' && (<>
              <div className="field"><label>Image URL</label><input className="inp" value={b.props.url || ''} onChange={(e) => upd(i, { url: e.target.value })} placeholder="https://…" /></div>
              <div className="field" style={{ marginBottom: 0 }}><label>Alt text</label><input className="inp" value={b.props.alt || ''} onChange={(e) => upd(i, { alt: e.target.value })} placeholder="What's in this image?" /></div>
              {b.props.url && <img src={b.props.url} alt={b.props.alt || ''} style={{ marginTop: 10, maxWidth: '100%', borderRadius: 8 }} />}
            </>)}
            {b.type !== 'hero' && b.type !== 'richtext' && b.type !== 'image' && (
              <div className="muted" style={{ fontSize: 13 }}>No editor for "{b.type}" blocks yet.</div>
            )}
          </div>
        ))}

        <div className="add-block">
          <button className="btn btn-secondary" onClick={() => add('hero')}>＋ Hero</button>
          <button className="btn btn-secondary" onClick={() => add('richtext')}>＋ Text</button>
          <button className="btn btn-secondary" onClick={() => add('image')}>＋ Image</button>
        </div>

        <div className="err" style={{ marginTop: 16 }}>{err}</div>
        <div className="save-row">
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
        </div>
        </div>

        <div className="editor-col">
          <div className="pv-controls">
            <div style={{ display: 'flex', gap: 6 }}>
              <button className={`btn ${pvTab === 'preview' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPvTab('preview')}>Live preview</button>
              {page?.seo?.import_source && (
                <button className={`btn ${pvTab === 'original' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPvTab('original')}>Original</button>
              )}
            </div>
            {pvTab === 'preview'
              ? <button className="btn btn-ghost" onClick={() => setPreviewKey((k) => k + 1)}>Refresh</button>
              : <a className="btn btn-ghost" href={page?.seo?.import_source?.url} target="_blank" rel="noreferrer">Open source ↗</a>}
          </div>
          {pvTab === 'preview' ? (
            <iframe key={previewKey} className="preview-frame" src={`${API_URL}/pages/${pageId}/preview?t=${previewKey}`} title="Preview" />
          ) : (
            <div className="preview-frame" style={{ overflow: 'auto', padding: 0 }}>
              {page?.seo?.import_source?.snapshot_url && (
                <img src={page.seo.import_source.snapshot_url} alt="Original page" style={{ display: 'block', width: '100%', height: 'auto' }} />
              )}
            </div>
          )}
        </div>
      </div>
      <ChatPanel slug={slug} pageContext={{ type: page?.type || '', title, blocks }} />
    </AppShell>
  )
}
