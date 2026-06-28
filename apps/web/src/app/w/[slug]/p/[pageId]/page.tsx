'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Block = { type: string; props: Record<string, any> }
type PageData = {
  id: string; type: string; slug: string; title: string; status: string
  blocks: Block[]; wsSlug: string; wsName: string
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
  function add(type: string) {
    const props = type === 'hero' ? { heading: '', sub: '' } : { html: '' }
    setBlocks((bs) => [...bs, { type, props }])
  }

  async function save() {
    setErr(''); setSaving(true)
    try {
      await api(`/pages/${pageId}`, { method: 'PUT', body: JSON.stringify({ title, blocks, status }) })
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title={title || 'Edit page'} currentSlug={slug} active="Website">
      <div className="editor">
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
            {b.type !== 'hero' && b.type !== 'richtext' && (
              <div className="muted" style={{ fontSize: 13 }}>No editor for "{b.type}" blocks yet.</div>
            )}
          </div>
        ))}

        <div className="add-block">
          <button className="btn btn-secondary" onClick={() => add('hero')}>＋ Hero</button>
          <button className="btn btn-secondary" onClick={() => add('richtext')}>＋ Text</button>
        </div>

        <div className="err" style={{ marginTop: 16 }}>{err}</div>
        <div className="save-row">
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
        </div>
      </div>
    </AppShell>
  )
}
