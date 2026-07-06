'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'
import { AppShell } from '@/components/AppShell'
import { MenuTreeEditor, type Tree } from '@/components/MenuTreeEditor'

type PageStub = { id: string; type: string; title: string }
type PagesResp = { pages: PageStub[] }

// Tiny CSS mocks for each footer layout preset.
const bar = (w: string, c = '#c9cfd6', h = 4) => <span style={{ display: 'block', width: w, height: h, background: c, borderRadius: 2 }} />
const col = () => <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{bar('70%')}{bar('90%', '#dfe3e8')}{bar('80%', '#dfe3e8')}</span>
const FOOTER_STYLES: { id: string; name: string; desc: string; mock: React.ReactNode }[] = [
  { id: 'columns', name: 'Columns', desc: 'Brand + link columns + newsletter', mock: <span style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 6, width: '100%' }}>{col()}{col()}{col()}</span> },
  { id: 'mega', name: 'Mega', desc: 'Wider — 4 columns + newsletter', mock: <span style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr', gap: 4, width: '100%' }}>{col()}{col()}{col()}{col()}</span> },
  { id: 'simple', name: 'Simple', desc: 'Centered logo + one row of links', mock: <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: '100%' }}>{bar('40%', '#9aa2ab', 6)}<span style={{ display: 'flex', gap: 8 }}>{bar('30px')}{bar('30px')}{bar('30px')}</span></span> },
  { id: 'minimal', name: 'Minimal', desc: 'One line: logo + links', mock: <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>{bar('26%', '#9aa2ab', 6)}<span style={{ display: 'flex', gap: 6 }}>{bar('24px')}{bar('24px')}{bar('24px')}</span></span> },
  { id: 'cta', name: 'CTA band', desc: 'Big call-to-action on top', mock: <span style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}><span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{bar('45%', '#9aa2ab', 6)}<span style={{ width: 34, height: 12, background: 'var(--forest)', borderRadius: 6 }} /></span>{bar('100%', '#e6e9ec', 1)}<span style={{ display: 'flex', gap: 6 }}>{bar('24px')}{bar('24px')}</span></span> },
]

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
        setFooter({ ...(m.footer as any), items: m.footer.items || [] })
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
    if (!window.confirm('Pull the footer links into your site footer — from the page\'s own footer sections if present, otherwise straight from the original site\'s footer. (Footer blocks found in the page body are moved out of it.)')) return
    setErr(''); setNote(''); setExtracting(true)
    try {
      const r = await api<{ removedSections: number; footerLinks: number; source?: string }>('/ai/extract-footer', {
        method: 'POST', body: JSON.stringify({ slug, pageId: extractPageId }),
      })
      const m = await api<{ footer: Tree }>(`/workspaces/${slug}/menus`)
      setFooter((f) => ({ ...(f as any), ...(m.footer as any), items: m.footer.items || [] }))
      setPreviewKey((k) => k + 1)
      setNote(r.source === 'site'
        ? `Pulled ${r.footerLinks} link(s) from the original site's footer. Review, then Save.`
        : `Extracted ${r.footerLinks} link(s) from ${r.removedSections} section(s) on that page.`)
    } catch (e: any) { setErr(e.message || 'Extract failed') } finally { setExtracting(false) }
  }

  async function generateWithAi() {
    setErr(''); setNote(''); setGenerating(true)
    try {
      const r = await api<{ items: Tree['items'] }>(`/ai/generate-nav`, {
        method: 'POST', body: JSON.stringify({ slug, location: 'footer' }),
      })
      setFooter((f) => ({ ...(f as any), items: r.items || [] }))
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
      <div className="dash-sub" style={{ marginBottom: 16 }}>
        The footer on every published page. Pick a layout, edit the links, and (for Columns/Mega) toggle the newsletter.
      </div>

      <div className="dash-h" style={{ marginTop: 0 }}>Footer design</div>
      <div className="footer-style-grid">
        {FOOTER_STYLES.map((s) => {
          const cur = (footer as any).style || 'columns'
          return (
            <button key={s.id} className={`fstyle-card${cur === s.id ? ' on' : ''}`} onClick={() => setFooter((f) => ({ ...f, style: s.id } as any))}>
              <div className="fstyle-mock">{s.mock}</div>
              <b>{s.name}</b><span>{s.desc}</span>
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0 22px' }}>
        {['columns', 'mega'].includes((footer as any).style || 'columns') && (
          <label className="muted" style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={(footer as any).newsletter !== false} onChange={(e) => setFooter((f) => ({ ...f, newsletter: e.target.checked } as any))} style={{ width: 'auto' }} /> Show newsletter signup
          </label>
        )}
        {(footer as any).style === 'cta' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="inp" style={{ maxWidth: 180 }} placeholder="CTA button label" value={(footer as any).cta?.label || ''} onChange={(e) => setFooter((f) => ({ ...f, cta: { ...(f as any).cta, label: e.target.value } } as any))} />
            <input className="inp" style={{ maxWidth: 180 }} placeholder="CTA link (/contact/)" value={(footer as any).cta?.href || ''} onChange={(e) => setFooter((f) => ({ ...f, cta: { ...(f as any).cta, href: e.target.value } } as any))} />
          </div>
        )}
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
          {(() => {
            const fs = (footer as any).style || 'columns'
            const nl = (footer as any).newsletter !== false ? 1 : 0
            const ctaQ = fs === 'cta' ? `&cta_label=${encodeURIComponent((footer as any).cta?.label || '')}&cta_href=${encodeURIComponent((footer as any).cta?.href || '')}` : ''
            const src = `${API_URL}/workspaces/${slug}/menus/preview?t=${previewKey}&style=${fs}&nl=${nl}${ctaQ}#footer`
            // key includes the live selection so picking a layout re-renders the
            // preview immediately (no Save needed to see the design change).
            return <iframe key={`${previewKey}-${fs}-${nl}`} src={src} title="Footer preview" />
          })()}
        </div>
      ) : (
        <MenuTreeEditor tree={footer} onChange={setFooter} maxItems={20} />
      )}

      <div className="err" style={{ marginTop: 14 }}>{err}</div>
      <div className="save-row" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save footer'}</button>
        {savedAt && <span className="saved-tag">Saved {savedAt}</span>}
        {tab === 'preview' && <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>Layout previews live; links & content reflect the last save.</span>}
      </div>
    </AppShell>
  )
}
