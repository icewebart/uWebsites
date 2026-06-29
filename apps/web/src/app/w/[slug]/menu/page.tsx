'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { MenuTreeEditor, type Tree } from '@/components/MenuTreeEditor'

export default function MenuPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [header, setHeader] = useState<Tree>({ items: [], cta: null })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    api<{ header: Tree; footer: Tree }>(`/workspaces/${slug}/menus`)
      .then((d) => setHeader({ items: d.header.items || [], cta: d.header.cta || null }))
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
  }, [slug])

  async function refreshFromSource() {
    if (!window.confirm('Re-fetch the header menu from your imported source URL? This will overwrite the current items + CTA.')) return
    setErr(''); setNote(''); setRefreshing(true)
    try {
      const r = await api<{ header: Tree; refreshed?: boolean; reason?: string; source?: string }>(
        `/workspaces/${slug}/menus/refresh`, { method: 'POST', body: JSON.stringify({}) },
      )
      setHeader({ items: r.header.items || [], cta: r.header.cta || null })
      setNote(r.refreshed ? `Refreshed from ${r.source}` : (r.reason || 'No changes'))
    } catch (e: any) { setErr(e.message || 'Refresh failed') } finally { setRefreshing(false) }
  }

  async function generateWithAi() {
    setErr(''); setNote(''); setGenerating(true)
    try {
      const r = await api<{ items: Tree['items']; cta?: Tree['cta'] }>(`/ai/generate-nav`, {
        method: 'POST', body: JSON.stringify({ slug, location: 'header' }),
      })
      setHeader({ items: r.items || [], cta: r.cta || null })
      setNote('AI suggestion loaded — review and click Save when ready.')
    } catch (e: any) { setErr(e.message || 'AI generation failed') } finally { setGenerating(false) }
  }

  async function save() {
    setErr(''); setSaving(true)
    try {
      await api(`/workspaces/${slug}/menus`, { method: 'PUT', body: JSON.stringify({ header }) })
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Menu" currentSlug={slug} active="Menu">
      <div className="dash-sub" style={{ marginBottom: 22 }}>
        Edit the header navigation that appears on every published page. On import, we seed this from your old site's nav and main CTA — or let the AI propose a fresh one based on your pages.
      </div>

      <div className="ev-actions-row">
        <div className="dash-h" style={{ margin: 0 }}>Header menu</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={generateWithAi} disabled={generating}>
            {generating ? 'Generating…' : '✦ Generate with AI'}
          </button>
          <button className="btn btn-ghost" onClick={refreshFromSource} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '↻ Refresh from source'}
          </button>
        </div>
      </div>
      {note && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{note}</div>}
      <MenuTreeEditor tree={header} onChange={setHeader} maxItems={10} showCta />

      <div className="err" style={{ marginTop: 14 }}>{err}</div>
      <div className="save-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save menu'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
      </div>
    </AppShell>
  )
}
