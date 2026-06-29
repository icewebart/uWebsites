'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { MenuTreeEditor, type Tree } from '@/components/MenuTreeEditor'

export default function FooterPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [footer, setFooter] = useState<Tree>({ items: [] })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [err, setErr] = useState('')
  const [generating, setGenerating] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    api<{ header: Tree; footer: Tree }>(`/workspaces/${slug}/menus`)
      .then((d) => setFooter({ items: d.footer.items || [] }))
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
  }, [slug])

  async function generateWithAi() {
    setErr(''); setNote(''); setGenerating(true)
    try {
      const r = await api<{ items: Tree['items'] }>(`/ai/generate-nav`, {
        method: 'POST', body: JSON.stringify({ slug, location: 'footer' }),
      })
      setFooter({ items: r.items || [] })
      setNote('AI suggestion loaded — review and click Save when ready.')
    } catch (e: any) { setErr(e.message || 'AI generation failed') } finally { setGenerating(false) }
  }

  async function save() {
    setErr(''); setSaving(true)
    try {
      await api(`/workspaces/${slug}/menus`, { method: 'PUT', body: JSON.stringify({ footer }) })
      setSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Footer" currentSlug={slug} active="Footer">
      <div className="dash-sub" style={{ marginBottom: 22 }}>
        Edit the footer links that appear on every published page. These are usually About, Contact, Legal, Resources, and category landing pages.
      </div>

      <div className="ev-actions-row">
        <div className="dash-h" style={{ margin: 0 }}>Footer links</div>
        <button className="btn btn-secondary" onClick={generateWithAi} disabled={generating}>
          {generating ? 'Generating…' : '✦ Generate with AI'}
        </button>
      </div>
      {note && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{note}</div>}
      <MenuTreeEditor tree={footer} onChange={setFooter} maxItems={20} />

      <div className="err" style={{ marginTop: 14 }}>{err}</div>
      <div className="save-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save footer'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
      </div>
    </AppShell>
  )
}
