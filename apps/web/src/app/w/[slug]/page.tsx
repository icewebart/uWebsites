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
  const [aiPrompt, setAiPrompt] = useState('')
  const [building, setBuilding] = useState(false)
  const [buildErr, setBuildErr] = useState('')
  const [mode, setMode] = useState<'structured' | 'freeform'>('structured')
  const [kitName, setKitName] = useState('')
  const [kitText, setKitText] = useState('')

  function onKitFile(file?: File) {
    if (!file) { setKitName(''); setKitText(''); return }
    const reader = new FileReader()
    reader.onload = () => { setKitText(String(reader.result || '')); setKitName(file.name); setMode('freeform') }
    reader.readAsText(file)
  }

  async function buildWithAi() {
    if (!aiPrompt.trim()) return
    setBuildErr(''); setBuilding(true)
    const endpoint = mode === 'freeform' ? '/ai/generate-freeform' : '/ai/generate-page'
    const body: any = { slug, prompt: aiPrompt.trim(), type: 'home' }
    if (mode === 'freeform' && kitText) body.kitHtml = kitText
    // Fire the generation. A long free-form build can exceed the proxy timeout,
    // but the page still saves server-side — so we ALSO poll for the new page
    // and open it the moment it exists, whichever happens first.
    let navigated = false
    const open = (id: string) => { if (!navigated) { navigated = true; router.push(`/w/${slug}/p/${id}`) } }
    api<{ id: string }>(endpoint, { method: 'POST', body: JSON.stringify(body) })
      .then((r) => { if (r?.id) open(r.id) })
      .catch(() => { /* may time out at the proxy; the poll below recovers */ })
    const started = Date.now()
    const poll = setInterval(async () => {
      if (navigated) { clearInterval(poll); return }
      if (Date.now() - started > 175000) {
        clearInterval(poll); setBuilding(false)
        setBuildErr('The AI is taking unusually long. Refresh in a moment — your page may already be ready.')
        return
      }
      try {
        const p = await api<PagesResp>(`/workspaces/${slug}/pages`)
        const pg = p.pages?.find((x) => x.type === 'home') || p.pages?.[0]
        if (pg) { clearInterval(poll); open(pg.id) }
      } catch { /* keep polling */ }
    }, 5000)
  }

  useEffect(() => {
    setImported(new URLSearchParams(window.location.search).get('imported'))
    api<PagesResp>(`/workspaces/${slug}/pages`)
      .then(setData)
      .catch(() => router.push('/'))
      .finally(() => setLoading(false))
  }, [slug])

  async function addPagePrompt() {
    const title = window.prompt('New page title (e.g. "About us", "Contact"):', '')
    if (!title || !title.trim()) return
    // Offer a template — pick from ones the API returns; blank if declined.
    let template = ''
    try {
      const tpls = await api<Array<{ key: string; label: string }>>('/pages/templates')
      if (tpls.length) {
        const list = tpls.map((t, i) => `${i + 1}. ${t.label}`).join('\n')
        const pick = window.prompt(`Choose a template (or leave blank for an empty page):\n\n${list}\n\nEnter a number, or press Cancel/leave blank to skip:`, '1')
        const n = parseInt(String(pick), 10)
        if (Number.isFinite(n) && n >= 1 && n <= tpls.length) template = tpls[n - 1].key
      }
    } catch { /* templates optional */ }
    try {
      const r = await api<{ id: string }>('/pages', { method: 'POST', body: JSON.stringify({ slug, title: title.trim(), type: 'article', template: template || undefined }) })
      router.push(`/w/${slug}/p/${r.id}`)
    } catch (e: any) { alert(e.message || 'Could not create page') }
  }

  async function deletePage(p: Page) {
    if (!window.confirm(`Delete "${p.title || p.slug}"? This cannot be undone.`)) return
    try {
      await api(`/pages/${p.id}`, { method: 'DELETE' })
      setData((d) => d ? { ...d, pages: d.pages.filter((x) => x.id !== p.id) } : d)
    } catch (e: any) { alert(e.message || 'Could not delete page') }
  }

  const [polishingAll, setPolishingAll] = useState(false)
  const [verifying, setVerifying] = useState(false)
  async function verifyLinks() {
    setVerifying(true)
    try {
      // 1) rewrite links to the original imported site → internal (free, no AI)
      const rel = await api<{ totalFixed: number }>(`/workspaces/${slug}/relink-internal`, { method: 'POST', body: JSON.stringify({}) })
      // 2) resolve remaining placeholder (#) links by title match
      const r = await api<{ totalFixed: number; pages: Array<{ stillEmpty: number }> }>('/ai/verify-links', { method: 'POST', body: JSON.stringify({ slug }) })
      const unresolved = r.pages.reduce((s, p) => s + p.stillEmpty, 0)
      alert(`Made ${rel.totalFixed} external link(s) internal, and resolved ${r.totalFixed} placeholder link(s).${unresolved ? `\n${unresolved} placeholder link(s) could not be matched — edit them manually or create the target pages.` : ''}`)
    } catch (e: any) { alert(e.message || 'Fix links failed') } finally { setVerifying(false) }
  }
  async function polishAllPages() {
    const pgs = data?.pages || []
    if (!pgs.length) return
    if (!window.confirm(`Run the AI design polish on all ${pgs.length} page(s)? This takes ~30–60s per page.`)) return
    setPolishingAll(true)
    try {
      // Fire and poll — the request will likely exceed the proxy timeout, but
      // the server keeps saving each page as it goes.
      api('/ai/polish-site', { method: 'POST', body: JSON.stringify({ slug }) }).catch(() => {})
      // Simple wait — user can reload / navigate to check progress.
      alert(`Polish started for ${pgs.length} page(s). Each page saves as it finishes; reload in a couple of minutes to see the updated designs.`)
    } finally { setTimeout(() => setPolishingAll(false), 5000) }
  }

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
      // Safety net: make sure every link to the original site is internal before
      // the site goes live (cheap, deterministic, no AI).
      await api(`/workspaces/${slug}/relink-internal`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {})
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
        <div className="build-empty">
          <div className="build-card">
            <h2>Build your homepage with AI</h2>
            <p className="muted">Describe your site — the industry, who it's for, and the vibe. The AI drafts a full homepage using your branding, then you can edit it.</p>

            <div className="build-modes">
              <button className={`build-mode ${mode === 'structured' ? 'on' : ''}`} onClick={() => setMode('structured')}>
                <b>Structured sections</b><span>Editable section-by-section. Best for iterating.</span>
              </button>
              <button className={`build-mode ${mode === 'freeform' ? 'on' : ''}`} onClick={() => setMode('freeform')}>
                <b>Full custom page</b><span>Free-form AI design, no section limits. Best for a bold one-off.</span>
              </button>
            </div>

            <textarea className="inp build-ta" rows={4} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. A German-language summer camp for kids aged 8–14 in Cluj. Friendly and playful, with courses, camps, testimonials and a signup CTA." />

            {mode === 'freeform' && (
              <label className="build-kit">
                <input type="file" accept=".html,.htm,text/html" style={{ display: 'none' }} onChange={(e) => onKitFile(e.target.files?.[0])} />
                <span className="build-kit-btn">📎 {kitName ? `Kit: ${kitName}` : 'Attach a design kit (.html) — optional'}</span>
                {kitName && <button type="button" className="build-kit-x" onClick={(e) => { e.preventDefault(); onKitFile(undefined) }}>✕</button>}
                <span className="muted" style={{ fontSize: 12 }}>The AI reuses the real names, offers and wording from the kit.</span>
              </label>
            )}

            <div className="build-suggestions">
              {['Homepage for a kids language school — courses, camps, testimonials, signup',
                'Landing page for a local coffee roastery — story, products, wholesale',
                'Homepage for a boutique dental clinic — services, team, book appointment'].map((s) => (
                <button key={s} className="build-chip" onClick={() => setAiPrompt(s)}>{s}</button>
              ))}
            </div>
            {buildErr && <div className="err" style={{ marginTop: 10 }}>{buildErr}</div>}
            <div className="build-actions">
              <button className="btn btn-primary" onClick={buildWithAi} disabled={building || !aiPrompt.trim()}>
                {building ? (mode === 'freeform' ? 'Designing your page… (~40s)' : 'Building your homepage… (~20s)') : '✦ Build with AI'}
              </button>
              <span className="muted" style={{ fontSize: 13 }}>or <a href={`/w/${slug}/import`}>import an existing site</a></span>
            </div>
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
                  <button className="btn btn-secondary" onClick={polishAllPages} disabled={polishingAll} title="Run the AI design polish on every page">
                    {polishingAll ? 'Polishing…' : '✦ Polish all pages'}
                  </button>
                  <button className="btn btn-secondary" onClick={verifyLinks} disabled={verifying} title="Rewrite links to the original site into internal links to your imported pages, and resolve placeholder (#) links by title">
                    {verifying ? 'Fixing…' : '🔗 Fix internal links'}
                  </button>
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

          {/* aside — pages quick-list with add/delete */}
          <div className="aside-block">
            <div className="pages-head">
              <h3>Pages ({pages.length})</h3>
              <button className="btn-mini" onClick={addPagePrompt} title="Create a new page">＋ New page</button>
            </div>
            {(showAll ? pages : pages.slice(0, 8)).map((p) => (
              <div className="row page-row" key={p.id}>
                <a href={`/w/${slug}/p/${p.id}`} className="page-title" style={{ fontWeight: 500 }}>{p.title || '(untitled)'}</a>
                <span className="muted" style={{ fontSize: 11 }}>{p.type}</span>
                {p.type !== 'home' && (
                  <button className="page-del" title="Delete this page" onClick={() => deletePage(p)}>✕</button>
                )}
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
