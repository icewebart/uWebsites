'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Page = { id: string; type: string; slug: string; title: string; status: string }
type PagesResp = { workspace: { id: string; name: string; slug: string }; pages: Page[] }

export default function WorkspaceHome() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [imported, setImported] = useState<string | null>(null)
  const [data, setData] = useState<PagesResp | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setImported(new URLSearchParams(window.location.search).get('imported'))
    api<PagesResp>(`/workspaces/${slug}/pages`)
      .then(setData)
      .catch(() => router.push('/'))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) return <div className="empty">Loading…</div>
  const pages = data?.pages ?? []

  return (
    <AppShell title={data?.workspace.name || 'Workspace'} currentSlug={slug}>
      {imported && (
        <div className="banner-ok">✓ Imported {imported} pages into this workspace.</div>
      )}

      {pages.length === 0 ? (
        <div className="empty">
          <p>No pages in <strong>{data?.workspace.name}</strong> yet.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            <a className="btn btn-primary" href={`/w/${slug}/import`}>📥 Import a site</a>
            <button className="btn btn-secondary">Build from template</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span className="muted">{pages.length} pages</span>
            <a className="btn btn-secondary" href={`/w/${slug}/import`}>📥 Import more</a>
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
