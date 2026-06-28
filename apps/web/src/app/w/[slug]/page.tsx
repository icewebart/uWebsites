'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Page = { id: string; type: string; slug: string; title: string; status: string; seo?: { import_source?: { url: string } } }
type PagesResp = { workspace: { id: string; name: string; slug: string }; pages: Page[] }

export default function WorkspaceHome() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [imported, setImported] = useState<string | null>(null)
  const [data, setData] = useState<PagesResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState('')
  const [pubErr, setPubErr] = useState('')

  useEffect(() => {
    setImported(new URLSearchParams(window.location.search).get('imported'))
    api<PagesResp>(`/workspaces/${slug}/pages`)
      .then(setData)
      .catch(() => router.push('/'))
      .finally(() => setLoading(false))
  }, [slug])

  async function importRest(url: string) {
    if (!window.confirm(`Import remaining pages from ${url}?`)) return
    try {
      const r = await api<{ created: number }>('/import/commit', { method: 'POST', body: JSON.stringify({ slug, url, mode: 'rest' }) })
      router.replace(`/w/${slug}?imported=${r.created}`)
      setTimeout(() => window.location.reload(), 50)
    } catch (e: any) { alert(e.message || 'Import failed') }
  }

  async function aiGenerate() {
    const prompt = window.prompt('Describe the page you want (e.g. "An article about choosing the right summer camp for a 9-year-old, friendly tone, 4 sections")')
    if (!prompt) return
    try {
      const r = await api<{ id: string; slug: string }>(`/ai/generate-page`, { method: 'POST', body: JSON.stringify({ slug, prompt }) })
      router.push(`/w/${slug}/p/${r.id}`)
    } catch (e: any) { alert(e.message || 'AI generation failed') }
  }

  async function publish() {
    setPubErr(''); setPublishing(true); setPublishedUrl('')
    try {
      const r = await api<{ url: string; pages: number }>(`/workspaces/${slug}/publish`, { method: 'POST' })
      setPublishedUrl(r.url)
    } catch (e: any) { setPubErr(e.message || 'Publish failed') } finally { setPublishing(false) }
  }

  if (loading) return <div className="empty">Loading…</div>
  const pages = data?.pages ?? []

  return (
    <AppShell title={data?.workspace.name || 'Workspace'} currentSlug={slug} active="Website">
      {imported && (
        <div className="banner-ok">✓ Imported {imported} pages into this workspace.</div>
      )}

      {(() => {
        // Suggest importing the rest when only one page exists and it came from an import.
        const onlyOne = pages.length === 1
        const src = onlyOne ? pages[0].seo?.import_source?.url : null
        return src ? (
          <div className="banner-ok" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)', color: 'var(--text)' }}>
            <strong>Homepage imported.</strong> <span className="muted" style={{ fontWeight: 400 }}>Continue and pull in the remaining pages from {src}.</span>
            <button className="btn btn-primary" style={{ marginLeft: 12 }} onClick={() => importRest(src)}>Import the rest →</button>
          </div>
        ) : null
      })()}

      {pages.length === 0 ? (
        <div className="empty">
          <p>No pages in <strong>{data?.workspace.name}</strong> yet.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            <a className="btn btn-primary" href={`/w/${slug}/import`}>Import a site</a>
            <button className="btn btn-secondary" onClick={() => alert('AI page generation lives on a page — open the editor on any page to use it.')}>Build with AI</button>
          </div>
        </div>
      ) : (
        <>
          {publishedUrl && (
            <div className="banner-ok">✓ Published — your site is live at <a href={publishedUrl} target="_blank" rel="noreferrer">{publishedUrl}</a></div>
          )}
          {pubErr && <div className="err" style={{ marginBottom: 12 }}>{pubErr}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span className="muted">{pages.length} pages</span>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary" onClick={aiGenerate}>Generate with AI</button>
              <a className="btn btn-secondary" href={`/w/${slug}/import`}>Import more</a>
              <button className="btn btn-primary" onClick={publish} disabled={publishing}>{publishing ? 'Publishing…' : 'Publish'}</button>
            </div>
          </div>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Title</th><th>Type</th><th>Path</th><th>Status</th></tr></thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id}>
                    <td><a href={`/w/${slug}/p/${p.id}`} style={{ fontWeight: 600 }}>{p.title}</a></td>
                    <td><span className="ty">{p.type}</span></td>
                    <td className="muted">/{p.slug}</td>
                    <td><span className="muted">{p.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppShell>
  )
}
