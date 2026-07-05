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

  // Deterministic, zero-credit: rebuild every article into the template using
  // its existing content. Instant, no AI. This is the cheap path.
  const [structuring, setStructuring] = useState(false)
  async function structureOne(p: Page) {
    setBusyId(p.id); setNote(''); setErr('')
    try {
      await api(`/workspaces/${slug}/rewrap-articles`, { method: 'POST', body: JSON.stringify({ pageId: p.id }) })
      setNote(`Structured "${p.title}" ✓`); await load()
    } catch (e: any) { setErr(e.message || 'Failed') } finally { setBusyId(null) }
  }

  async function structureAll() {
    if (!articles.length) return
    if (!window.confirm(`Give all ${articles.length} article(s) the article layout (hero + sidebar) using their existing content? This is instant and free — no AI credits used.`)) return
    setStructuring(true); setNote(''); setErr('')
    try {
      const r = await api<{ rewrapped: number; total: number }>(`/workspaces/${slug}/rewrap-articles`, { method: 'POST', body: JSON.stringify({}) })
      setNote(`Structured ${r.rewrapped}/${r.total} article(s) ✓ — no credits used.`)
      await load()
    } catch (e: any) { setErr(e.message || 'Failed') } finally { setStructuring(false) }
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

  const [publishing, setPublishing] = useState(false)
  // Publishing rebuilds the whole static site — every article goes live at once.
  async function publishAll() {
    if (!articles.length) return
    if (!window.confirm(`Publish now? This rebuilds the site and takes your ${articles.length} article(s) live.`)) return
    setNote(''); setErr(''); setPublishing(true)
    try {
      const r = await api<{ url: string; pages: number }>(`/workspaces/${slug}/publish`, { method: 'POST', body: JSON.stringify({}) })
      setNote(`Published ✓ — ${articles.length} article(s) live (site rebuilt: ${r.pages} page${r.pages === 1 ? '' : 's'}).`)
    } catch (e: any) { setErr(e.message || 'Publish failed') } finally { setPublishing(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Articles" currentSlug={slug} active="Articles">
      <div className="ev-actions-row" style={{ marginBottom: 18 }}>
        <div className="dash-sub" style={{ margin: 0 }}>
          Long-form pages. <b>⚡ Structure</b> applies the article layout (hero + sidebar) from existing content — free &amp; instant. <b>✦ AI clean</b> tidies messy imported markup — costs credits, use only when needed.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {articles.length > 0 && <button className="btn btn-secondary" onClick={structureAll} disabled={structuring} title="Give every article the hero + sidebar layout using existing content — instant, no AI credits">{structuring ? 'Structuring…' : '⚡ Structure all (free)'}</button>}
          {articles.length > 1 && <button className="btn btn-secondary" onClick={normaliseAll} title="AI cleanup of messy body markup — costs credits, slow">✦ AI Normalise all</button>}
          {articles.length > 0 && <button className="btn btn-secondary" onClick={publishAll} disabled={publishing} title="Rebuild the site and take every article live">{publishing ? 'Publishing…' : '↗ Publish all articles'}</button>}
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
                      <button className="btn-mini" disabled={busyId === p.id} onClick={() => structureOne(p)} title="Apply the article layout using existing content — free, instant">{busyId === p.id ? '…' : '⚡ Structure'}</button>
                      <button className="btn-mini" disabled={busyId === p.id} onClick={() => normalise(p)} title="AI cleanup of messy body markup — costs credits">{busyId === p.id ? '…' : '✦ AI clean'}</button>
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
