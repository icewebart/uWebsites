'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { MenuTreeEditor, type Tree } from '@/components/MenuTreeEditor'

type PageStub = { id: string; type: string; title: string }
type PagesResp = { pages: PageStub[] }

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
  const [tab, setTab] = useState<'preview' | 'links'>('preview')
  const [previewKey, setPreviewKey] = useState(0)
  const [pages, setPages] = useState<PageStub[]>([])
  const [extractPageId, setExtractPageId] = useState('')
  const [extracting, setExtracting] = useState(false)

  useEffect(() => {
    Promise.all([
      api<{ header: Tree; footer: Tree }>(`/workspaces/${slug}/menus`),
      api<PagesResp>(`/workspaces/${slug}/pages`),
    ])
      .then(([m, p]) => {
        setFooter({ items: m.footer.items || [] })
        const list = p.pages || []
        setPages(list)
        const home = list.find((x) => x.type === 'home') || list[0]
        if (home) setExtractPageId(home.id)
      })
      .catch(() => router.push(`/w/${slug}`))
      .finally(() => setLoading(false))
  }, [slug])

  async function extractFromPage() {
    if (!extractPageId) return
    if (!window.confirm('Detect the trailing footer sections (newsletter / copyright / footer links) of the selected page, move them into this site footer, and remove those blocks from the page body?')) return
    setErr(''); setNote(''); setExtracting(true)
    try {
      const r = await api<{ removedSections: number; footerLinks: number }>('/ai/extract-footer', {
        method: 'POST', body: JSON.stringify({ slug, pageId: extractPageId }),
      })
      const m = await api<{ footer: Tree }>(`/workspaces/${slug}/menus`)
      setFooter({ items: m.footer.items || [] })
      setPreviewKey((k) => k + 1)
      setNote(`Extracted ${r.footerLinks} link(s) from ${r.removedSections} section(s) on that page.`)
    } catch (e: any) { setErr(e.message || 'Extract failed') } finally { setExtracting(false) }
  }

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
      setPreviewKey((k) => k + 1)
    } catch (e: any) { setErr(e.message || 'Save failed') } finally { setSaving(false) }
  }

  if (loading) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Footer" currentSlug={slug} active="Footer">
      <div className="dash-sub" style={{ marginBottom: 22 }}>
        Edit the footer links that appear on every published page. These are usually About, Contact, Legal, Resources, and category landing pages.
      </div>

      <div className="ev-actions-row">
        <div className="nav-tabs">
          <button className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>Preview</button>
          <button className={tab === 'links' ? 'on' : ''} onClick={() => setTab('links')}>Links</button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {pages.length > 0 && (
            <>
              <select className="inp" style={{ maxWidth: 220 }} value={extractPageId} onChange={(e) => setExtractPageId(e.target.value)} title="Which page to extract the footer from">
                {pages.map((p) => <option key={p.id} value={p.id}>{p.title || '(untitled)'} · {p.type}</option>)}
              </select>
              <button className="btn btn-secondary" onClick={extractFromPage} disabled={extracting || !extractPageId} title="Sniff out the trailing footer sections of the selected page and move them here">
                {extracting ? 'Extracting…' : '⇩ Extract footer from page'}
              </button>
            </>
          )}
          <button className="btn btn-secondary" onClick={generateWithAi} disabled={generating}>
            {generating ? 'Generating…' : '✦ Generate with AI'}
          </button>
        </div>
      </div>
      {note && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{note}</div>}

      {tab === 'preview' ? (
        <div className="nav-preview-frame footer-frame">
          <iframe key={previewKey} src={`${API_URL}/workspaces/${slug}/menus/preview?t=${previewKey}#footer`} title="Footer preview" />
        </div>
      ) : (
        <MenuTreeEditor tree={footer} onChange={setFooter} maxItems={20} />
      )}

      <div className="err" style={{ marginTop: 14 }}>{err}</div>
      <div className="save-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save footer'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
        {tab === 'preview' && <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>Preview reflects the last saved state — click Save to update.</span>}
      </div>
    </AppShell>
  )
}
