'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Page = { id: string; type: string; slug: string; title: string; status: string; updatedAt?: string }
type PagesResp = { workspace: { id: string; name: string; slug: string }; pages: Page[] }

// Types that belong in the Articles hub (everything editorial / long-form).
const ARTICLE_TYPES = new Set(['article', 'blog_index', 'collection_item', 'category'])

export default function ArticlesPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [data, setData] = useState<PagesResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')

  function load() {
    return api<PagesResp>(`/workspaces/${slug}/pages`).then(setData).catch(() => router.push(`/w/${slug}`))
  }
  useEffect(() => { load().finally(() => setLoading(false)) }, [slug])

  const articles = (data?.pages || []).filter((p) => ARTICLE_TYPES.has(p.type))

  async function newArticle() {
    const title = window.prompt('Article title:', '')
    if (!title || !title.trim()) return
    try {
      const r = await api<{ id: string }>('/pages', { method: 'POST', body: JSON.stringify({ slug, title: title.trim(), type: 'article', template: 'article' }) })
      router.push(`/w/${slug}/p/${r.id}`)
    } catch (e: any) { alert(e.message || 'Could not create article') }
  }

  async function del(p: Page) {
    if (!window.confirm(`Delete "${p.title || p.slug}"? This cannot be undone.`)) return
    setBusyId(p.id)
    try { await api(`/pages/${p.id}`, { method: 'DELETE' }); await load() }
    catch (e: any) { alert(e.message || 'Delete failed') } finally { setBusyId(null) }
  }

  // Normalise: reshape the article into the canonical structure (hero →
  // article-body with sidebar+TOC → CTA), keeping text/images verbatim.
  // Fire normalise and poll the page until it becomes an article (hero+body).
  // The AI call routinely exceeds the 60s proxy timeout — the server still
  // finishes and saves, so we poll instead of surfacing a false 504 error.
  async function runNormalise(pageId: string): Promise<'ok' | 'error'> {
    let apiErr: any = null, done = false
    api('/ai/normalise-article', { method: 'POST', body: JSON.stringify({ pageId }) })
      .then(() => { done = true }).catch((e) => { apiErr = e; done = true })
    const isTimeout = (m: string) => /gateway|timeout|network|fetch|504|502|aborted/i.test(m || '')
    const started = Date.now()
    while (Date.now() - started < 210_000) {
      await new Promise((r) => setTimeout(r, 4000))
      if (apiErr && !isTimeout(apiErr.message || '')) return 'error'
      try {
        const pg = await api<{ blocks?: Array<{ type: string }> }>(`/pages/${pageId}`)
        if (Array.isArray(pg.blocks) && pg.blocks.some((b) => b.type === 'article-hero')) return 'ok'
      } catch { /* keep polling */ }
      if (done && !apiErr) return 'ok'
    }
    return 'error'
  }

  async function normalise(p: Page) {
    if (!window.confirm(`Normalise "${p.title || p.slug}" into the standard article layout (hero → body with sidebar → CTA)? Your text and images are kept; only the structure changes.`)) return
    setBusyId(p.id); setNote('')
    const r = await runNormalise(p.id)
    setBusyId(null)
    if (r === 'error') { setErr(`Could not normalise "${p.title}". Try again.`); return }
    setNote(`Normalised "${p.title}" ✓`); await load()
  }

  async function normaliseAll() {
    if (!articles.length) return
    if (!window.confirm(`Normalise all ${articles.length} article(s) into the standard layout? This runs one after another and can take a while — keep this tab open.`)) return
    setNote(''); setErr('')
    let ok = 0
    for (const p of articles) {
      setBusyId(p.id)
      if (await runNormalise(p.id) === 'ok') ok++
      setNote(`Normalised ${ok}/${articles.length}…`)
    }
    setBusyId(null); setNote(`Normalised ${ok}/${articles.length} article(s) ✓`); await load()
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Articles" currentSlug={slug} active="Articles">
      <div className="ev-actions-row" style={{ marginBottom: 18 }}>
        <div className="dash-sub" style={{ margin: 0 }}>
          Long-form pages — blog posts, guides, resources. New articles start from the SEO-ready template (sidebar, table of contents, schema).
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {articles.length > 1 && <button className="btn btn-secondary" onClick={normaliseAll} title="Reshape every article into the standard layout">✦ Normalise all</button>}
          <button className="btn btn-primary" onClick={newArticle}>＋ New article</button>
        </div>
      </div>
      {note && <div className="banner-ok" style={{ marginBottom: 14 }}>{note}</div>}
      {err && <div className="err" style={{ marginBottom: 14 }}>{err}</div>}

      {articles.length === 0 ? (
        <div className="aside-block" style={{ textAlign: 'center', padding: 40 }}>
          <p className="muted" style={{ marginBottom: 14 }}>No articles yet. Create your first one from the template.</p>
          <button className="btn btn-primary" onClick={newArticle}>＋ New article</button>
        </div>
      ) : (
        <div className="tblwrap">
          <table className="tbl">
            <thead><tr><th>Title</th><th style={{ width: 110 }}>Type</th><th style={{ width: 100 }}>Status</th><th style={{ width: 220 }}>Actions</th></tr></thead>
            <tbody>
              {articles.map((p) => (
                <tr key={p.id}>
                  <td><a href={`/w/${slug}/p/${p.id}`} style={{ fontWeight: 500, color: 'var(--text)', textDecoration: 'none' }}>{p.title || '(untitled)'}</a></td>
                  <td><span className="muted" style={{ fontSize: 12 }}>{p.type}</span></td>
                  <td><span className={`status-pill ${p.status === 'published' ? 'live' : 'draft'}`}>{p.status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <a className="btn-mini" href={`/w/${slug}/p/${p.id}`}>Edit</a>
                      <button className="btn-mini" disabled={busyId === p.id} onClick={() => normalise(p)} title="Reshape into the standard article layout">{busyId === p.id ? '…' : '✦ Normalise'}</button>
                      <button className="btn-mini danger" disabled={busyId === p.id} onClick={() => del(p)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  )
}
