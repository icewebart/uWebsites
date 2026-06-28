'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Workspace = { id: string; name: string; slug: string }

export default function WorkspaceHome() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [ws, setWs] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const list = await api<Workspace[]>('/workspaces')
        const found = list.find((w) => w.slug === slug)
        if (!found) { router.push('/'); return }
        setWs(found)
      } catch { router.push('/login') } finally { setLoading(false) }
    })()
  }, [slug])

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title={ws?.name || 'Workspace'} currentSlug={slug}>
      <div className="empty">
        <p>No pages in <strong>{ws?.name}</strong> yet.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
          <a className="btn btn-primary" href={`/w/${slug}/import`}>📥 Import a site</a>
          <button className="btn btn-secondary">✨ Build from template</button>
        </div>
      </div>
    </AppShell>
  )
}
