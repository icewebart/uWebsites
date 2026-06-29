'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'
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
  const [showAll, setShowAll] = useState(false)

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

  async function publish() {
    setPubErr(''); setPublishing(true); setPublishedUrl('')
    try {
      const r = await api<{ url: string; pages: number }>(`/workspaces/${slug}/publish`, { method: 'POST' })
      setPublishedUrl(r.url)
    } catch (e: any) { setPubErr(e.message || 'Publish failed') } finally { setPublishing(false) }
  }

  if (loading) return <div className="empty">Loading…</div>
  const pages = data?.pages ?? []
  const home = pages.find((p) => p.type === 'home') || pages[0]
  const onlyHome = pages.length === 1
  const importedFrom = onlyHome ? home?.seo?.import_source?.url : null

  return (
    <AppShell title={data?.workspace.name || 'Website'} currentSlug={slug} active="Website">
      {imported && <div className="banner-ok">✓ Imported {imported} pages.</div>}
      {publishedUrl && <div className="banner-ok">✓ Live at <a href={publishedUrl} target="_blank" rel="noreferrer">{publishedUrl}</a></div>}
      {pubErr && <div className="err" style={{ marginBottom: 12 }}>{pubErr}</div>}
      {importedFrom && (
        <div className="banner-ok" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)', color: 'var(--text)' }}>
          <strong>Homepage imported.</strong> <span className="muted" style={{ fontWeight: 400 }}>Continue and pull in the remaining pages from {importedFrom}.</span>
          <button className="btn btn-primary" style={{ marginLeft: 12 }} onClick={() => importRest(importedFrom!)}>Import the rest →</button>
        </div>
      )}

      {pages.length === 0 ? (
        <div className="empty">
          <p>Your website is empty.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            <a className="btn btn-primary" href={`/w/${slug}/import`}>Import a site</a>
            <button className="btn btn-secondary" onClick={() => alert('Open the AI chat (bubble bottom-right) and say "Build me a homepage about …".')}>Build with AI</button>
          </div>
        </div>
      ) : (
        <div className="site-grid">
          {/* main column — preview + actions */}
          <div>
            <div className="site-hero">
              <div className="meta">
                <div>
                  <b>{home?.title || data?.workspace.name}</b>
                  <div className="sub">{pages.length} pages · /{home?.slug || ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a className="btn btn-ghost" href={`/w/${slug}/p/${home?.id}`}>Edit homepage</a>
                  <button className="btn btn-primary" onClick={publish} disabled={publishing}>{publishing ? 'Publishing…' : 'Publish'}</button>
                </div>
              </div>
              {home && <iframe src={`${API_URL}/pages/${home.id}/preview`} title="Site preview" />}
            </div>

            <div className="site-actions">
              <a className="tile" href={`/w/${slug}/import`}><div><b>Import a site</b><span>WordPress &amp; more</span></div></a>
              <a className="tile" href={`/w/${slug}/branding`}><div><b>Branding</b><span>Colors, fonts, shape</span></div></a>
              <a className="tile" href={`/w/${slug}/domains`}><div><b>Domains</b><span>Connect your URL</span></div></a>
              <a className="tile" href={`/w/${slug}/settings`}><div><b>Settings</b><span>Workspace info</span></div></a>
            </div>
          </div>

          {/* aside — pages quick-list */}
          <div className="aside-block">
            <h3>Pages ({pages.length})</h3>
            {(showAll ? pages : pages.slice(0, 8)).map((p) => (
              <div className="row" key={p.id}>
                <a href={`/w/${slug}/p/${p.id}`} style={{ fontWeight: 500 }}>{p.title || '(untitled)'}</a>
                <span className="muted" style={{ fontSize: 11 }}>{p.type}</span>
              </div>
            ))}
            {pages.length > 8 && (
              <button className="btn btn-ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show less' : `Show all ${pages.length}`}
              </button>
            )}
          </div>
        </div>
      )}

    </AppShell>
  )
}
