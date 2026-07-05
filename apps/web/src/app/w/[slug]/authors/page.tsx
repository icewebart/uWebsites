'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { ImageField } from '@/components/ImageField'

type Author = { id: string; name: string; title?: string; bio?: string; avatar?: string; url?: string }
type Tokens = { authors?: Author[]; default_author_id?: string } & Record<string, any>

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()))

export default function AuthorsPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [t, setT] = useState<Tokens | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(''); const [err, setErr] = useState('')

  useEffect(() => {
    api<{ tokens: Tokens }>(`/workspaces/${slug}/branding`).then((d) => {
      const tk = d.tokens || {}
      if (!Array.isArray(tk.authors) || !tk.authors.length) tk.authors = [{ id: uid(), name: '', title: '', bio: '', avatar: '', url: '' }]
      if (!tk.default_author_id) tk.default_author_id = tk.authors[0].id
      setT(tk)
    }).catch(() => router.push(`/w/${slug}`))
  }, [slug])

  const authors = t?.authors || []
  const setA = (i: number, patch: Partial<Author>) => setT((c) => c ? { ...c, authors: (c.authors || []).map((a, k) => k === i ? { ...a, ...patch } : a) } : c)
  const add = () => setT((c) => c ? { ...c, authors: [...(c.authors || []), { id: uid(), name: '', title: '', bio: '', avatar: '', url: '' }] } : c)
  const del = (i: number) => setT((c) => { if (!c) return c; const next = (c.authors || []).filter((_, k) => k !== i); const defId = next.some((a) => a.id === c.default_author_id) ? c.default_author_id : next[0]?.id; return { ...c, authors: next, default_author_id: defId } })

  async function save() {
    if (!t) return
    setErr(''); setSaving(true)
    try { await api(`/workspaces/${slug}/branding`, { method: 'PUT', body: JSON.stringify({ tokens: t }) }); setSavedAt(new Date().toLocaleTimeString()) }
    catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (!t) return <div className="empty">Loading…</div>
  const roles = ['Default', 'Secondary', 'Tertiary']

  return (
    <AppShell title="Authors" currentSlug={slug} active="Authors">
      <div className="dash-sub" style={{ marginBottom: 18 }}>
        Article bylines &amp; author schema (SEO / E-E-A-T). The <b>default</b> author is used on every article automatically; pick a different one per article from the author dropdown in the article editor. Up to three.
      </div>

      {authors.map((a, i) => (
        <div className="ctl-group card" key={a.id} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span className="status-pill draft">{roles[i] || `Author ${i + 1}`}</span>
            <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="radio" name="def" checked={t.default_author_id === a.id} onChange={() => setT((c) => c ? { ...c, default_author_id: a.id } : c)} style={{ width: 'auto' }} /> Default
            </label>
            {authors.length > 1 && <button className="btn-mini danger" style={{ marginLeft: 'auto' }} onClick={() => del(i)}>Remove</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 16, alignItems: 'start' }}>
            <div><label className="muted" style={{ fontSize: 12 }}>Photo</label><ImageField slug={slug} value={a.avatar || ''} onChange={(url) => setA(i, { avatar: url })} caption={a.name || 'author portrait'} height={96} /></div>
            <div>
              <div className="field" style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}><label>Name</label><input className="inp" value={a.name || ''} onChange={(e) => setA(i, { name: e.target.value })} placeholder="e.g. Ana Popescu" /></div>
                <div style={{ flex: 1 }}><label>Title / role</label><input className="inp" value={a.title || ''} onChange={(e) => setA(i, { title: e.target.value })} placeholder="e.g. German teacher" /></div>
              </div>
              <div className="field"><label>Short bio</label><textarea className="inp" rows={2} value={a.bio || ''} onChange={(e) => setA(i, { bio: e.target.value })} placeholder="One or two sentences — shown in the author card at the end of articles." /></div>
              <div className="field" style={{ marginBottom: 0 }}><label>Profile URL <span className="muted" style={{ fontWeight: 400 }}>(optional — LinkedIn, author page…)</span></label><input className="inp" value={a.url || ''} onChange={(e) => setA(i, { url: e.target.value })} placeholder="https://…" /></div>
            </div>
          </div>
        </div>
      ))}
      {authors.length < 3 && <button className="btn-mini" onClick={add}>＋ Add author</button>}

      {err && <div className="err" style={{ marginTop: 14 }}>{err}</div>}
      <div className="save-row" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save authors'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>Publish an article to see the new byline live.</span>
      </div>
    </AppShell>
  )
}
