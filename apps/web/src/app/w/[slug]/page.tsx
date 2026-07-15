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
  // Articles are hidden from the pages list by default (a site can have 100+),
  // so the list shows just the "normal" pages. Toggle persists per workspace.
  const [showArticles, setShowArticles] = useState(false)
  useEffect(() => { try { setShowArticles(localStorage.getItem(`uw-showArticles-${slug}`) === '1') } catch {} }, [slug])
  function toggleArticles() {
    setShowArticles((v) => { const n = !v; try { localStorage.setItem(`uw-showArticles-${slug}`, n ? '1' : '0') } catch {}; return n })
  }
  const [aiPrompt, setAiPrompt] = useState('')
  const [building, setBuilding] = useState(false)
  const [buildErr, setBuildErr] = useState('')
  const [mode, setMode] = useState<'structured' | 'freeform'>('structured')
  // Which dedicated start screen is showing: the AI prompt builder or the
  // upload-a-design flow. Set from the onboarding card via ?start=design.
  const [panel, setPanel] = useState<'prompt' | 'design'>('prompt')
  const [kitName, setKitName] = useState('')
  const [kitText, setKitText] = useState('')
  const [kitImage, setKitImage] = useState('') // data: URL when an image design is attached
  const [pullBrand, setPullBrand] = useState(true)
  const [designMode, setDesignMode] = useState<'reproduce' | 'freestyle'>('reproduce')
  // When reproducing: 'faithful' = pixel-exact raw-html blocks; 'native' =
  // rebuilt as editable typed sections (a design that declares data-uw-kind
  // sections is always native regardless).
  const [reproMode, setReproMode] = useState<'faithful' | 'native'>('faithful')

  // Downscale a screenshot to ≤1568px (all vision needs) and re-encode as JPEG,
  // so the upload stays small regardless of the original retina resolution.
  function downscaleImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => {
        const img = new Image()
        img.onload = () => {
          const MAX = 1568
          const scale = Math.min(1, MAX / Math.max(img.width, img.height))
          const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('no canvas'))
          ctx.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        }
        img.onerror = () => reject(new Error('bad image'))
        img.src = String(fr.result || '')
      }
      fr.onerror = () => reject(new Error('read failed'))
      fr.readAsDataURL(file)
    })
  }

  function onKitFile(file?: File) {
    if (!file) { setKitName(''); setKitText(''); setKitImage(''); return }
    if (file.type.startsWith('image/')) {
      // An image mockup (Claude Design / Canva / Figma screenshot) → vision path.
      downscaleImage(file)
        .then((dataUrl) => { setKitImage(dataUrl); setKitText(''); setKitName(file.name); setMode('freeform') })
        .catch(() => setBuildErr('Could not read that image — try a PNG or JPG.'))
    } else {
      const reader = new FileReader()
      reader.onload = () => { setKitText(String(reader.result || '')); setKitImage(''); setKitName(file.name); setMode('freeform') }
      reader.readAsText(file)
    }
  }

  async function buildWithAi() {
    // An image design → vision reads it, derives the brand + rebuilds the page.
    // "Reproduce this design" faithfully sectionises the uploaded HTML (no prompt
    // needed); otherwise the AI generates from the prompt (+ optional design kit).
    const fromImage = mode === 'freeform' && !!kitImage
    const reproduce = mode === 'freeform' && !!kitText && designMode === 'reproduce'
    if (!fromImage && !reproduce && !aiPrompt.trim()) return
    setBuildErr(''); setBuilding(true)
    let endpoint: string; let body: any
    if (fromImage) {
      endpoint = '/ai/vision-design'
      body = { slug, imageData: kitImage, type: 'home' }
    } else if (reproduce) {
      endpoint = '/ai/build-from-design'
      body = { slug, designHtml: kitText, type: 'home', faithful: reproMode === 'faithful' }
    } else {
      endpoint = mode === 'freeform' ? '/ai/generate-freeform' : '/ai/generate-page'
      body = { slug, prompt: aiPrompt.trim(), type: 'home' }
      if (mode === 'freeform' && kitText) { body.kitHtml = kitText; body.pullBrand = pullBrand }
    }
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
    const qs = new URLSearchParams(window.location.search)
    setImported(qs.get('imported'))
    // Onboarding "Start from a design" lands here with ?start=design — open the
    // dedicated design-upload screen (free-form under the hood).
    if (qs.get('start') === 'design') { setPanel('design'); setMode('freeform') }
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
  const [savingImages, setSavingImages] = useState(false)
  async function saveImagesToVps() {
    if (!window.confirm('Download every remote image on this site to your server? Do this before the original site goes offline. Free — no AI credits.')) return
    setSavingImages(true)
    try {
      const r = await api<{ found: number; downloaded: number; failed: number }>('/import/mirror-images', { method: 'POST', body: JSON.stringify({ slug }) })
      alert(`Found ${r.found} remote image(s): downloaded ${r.downloaded} to your server${r.failed ? `, ${r.failed} failed (source may be down)` : ''}.`)
    } catch (e: any) { alert(e.message || 'Failed') } finally { setSavingImages(false) }
  }
  const [backfilling, setBackfilling] = useState(false)
  async function backfillFeatured() {
    if (!window.confirm('Re-fetch the featured (hero) image for every article that is missing one, straight from the original site? Then run "Save images" to copy them to your server. Free — no AI credits.')) return
    setBackfilling(true)
    try {
      const r = await api<{ filled: number; pagesChanged: number }>('/import/backfill-featured', { method: 'POST', body: JSON.stringify({ slug }) })
      alert(r.filled
        ? `Restored ${r.filled} article image(s) across ${r.pagesChanged} page(s). Now click "💾 Save images" to copy them to your server.`
        : 'No missing article images were found to restore (or the source had none).')
    } catch (e: any) { alert(e.message || 'Failed') } finally { setBackfilling(false) }
  }
  const [structuringAll, setStructuringAll] = useState(false)
  async function structureAll() {
    const pgs = (data?.pages || []).filter((p) => p.type !== 'home')
    if (!pgs.length) return
    if (!window.confirm(`Rebuild all ${pgs.length} non-home page(s) into clean sections (hero + content + CTA) from their existing content? Free — no AI credits.`)) return
    setStructuringAll(true)
    try {
      const r = await api<{ structured: number; total: number }>(`/workspaces/${slug}/structure-all`, { method: 'POST', body: JSON.stringify({}) })
      alert(`Structured ${r.structured} page(s) — no credits used. Reload a page to see it.`)
    } catch (e: any) { alert(e.message || 'Structure failed') } finally { setStructuringAll(false) }
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
            <div className="build-tabs">
              <button type="button" className={`build-tab ${panel === 'prompt' ? 'on' : ''}`} onClick={() => { setPanel('prompt'); setMode('structured') }}>✦ Build with AI</button>
              <button type="button" className={`build-tab ${panel === 'design' ? 'on' : ''}`} onClick={() => { setPanel('design'); setMode('freeform') }}>🎨 Start from a design</button>
            </div>

            {panel === 'prompt' ? (
              <>
                <h2>Build your homepage with AI</h2>
                <p className="muted">Describe your site — the industry, who it's for, and the vibe. The AI drafts a full homepage using your branding, then you can edit it.</p>
                <textarea className="inp build-ta" rows={4} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. A German-language summer camp for kids aged 8–14 in Cluj. Friendly and playful, with courses, camps, testimonials and a signup CTA." />
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
                    {building ? 'Building your homepage… (~20s)' : '✦ Build with AI'}
                  </button>
                  <span className="muted" style={{ fontSize: 13 }}>or <a href={`/w/${slug}/import`}>import an existing site</a></span>
                </div>
              </>
            ) : (
              <>
                <h2>Start from a design</h2>
                <p className="muted">Upload a design from Claude Design, Canva or Figma — the full HTML or just a screenshot — and we rebuild it as an editable page, on your brand.</p>
                <label className="build-kit">
                  <input type="file" accept=".html,.htm,text/html,image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => onKitFile(e.target.files?.[0])} />
                  <span className="build-kit-btn">📎 {kitName && kitName !== 'Pasted design' ? `Design: ${kitName}` : 'Attach a design — .html or a screenshot (.png/.jpg)'}</span>
                  {kitName && kitName !== 'Pasted design' && <button type="button" className="build-kit-x" onClick={(e) => { e.preventDefault(); onKitFile(undefined) }}>✕</button>}
                  <span className="muted" style={{ fontSize: 12 }}>HTML from Claude/Canva, or an image mockup — the AI reads it and rebuilds the page.</span>
                </label>
                {!kitImage && (
                  <textarea className="inp" rows={2}
                    placeholder="…or paste the design's HTML here (from a Claude artifact or Canva export)"
                    value={kitName === 'Pasted design' ? kitText : ''}
                    onChange={(e) => { const v = e.target.value; setKitText(v); setKitImage(''); setKitName(v.trim() ? 'Pasted design' : '') }}
                    style={{ marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
                )}
                {kitImage && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, fontSize: 13 }}>
                    <img src={kitImage} alt="design preview" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line,#e5e7eb)' }} />
                    <span className="muted"><b>Vision rebuild</b> — the AI reads this image, adopts its colors &amp; fonts as your brand, and rebuilds it as an editable page (no prompt needed).</span>
                  </div>
                )}
                {kitName && !kitImage && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, fontSize: 13 }}>
                    <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="radio" name="dmode" checked={designMode === 'reproduce'} onChange={() => setDesignMode('reproduce')} style={{ width: 'auto' }} />
                      <b>Reproduce this design</b> — match its layout (no prompt needed)
                    </label>
                    {designMode === 'reproduce' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 22, fontSize: 12.5 }}>
                        <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                          <input type="radio" name="repro" checked={reproMode === 'faithful'} onChange={() => setReproMode('faithful')} style={{ width: 'auto' }} />
                          Pixel-exact copy — matches the look closely
                        </label>
                        <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                          <input type="radio" name="repro" checked={reproMode === 'native'} onChange={() => setReproMode('native')} style={{ width: 'auto' }} />
                          Editable sections — rebuilt on your brand, easier to tweak
                        </label>
                      </div>
                    )}
                    <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="radio" name="dmode" checked={designMode === 'freestyle'} onChange={() => setDesignMode('freestyle')} style={{ width: 'auto' }} />
                      Freestyle a new page inspired by it (uses your prompt)
                    </label>
                    {designMode === 'freestyle' && (
                      <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', paddingLeft: 22 }}>
                        <input type="checkbox" checked={pullBrand} onChange={(e) => setPullBrand(e.target.checked)} style={{ width: 'auto' }} />
                        Pull this design's <b>colors, fonts &amp; shape</b> as the brand
                      </label>
                    )}
                  </div>
                )}
                {designMode === 'freestyle' && !!kitText && (
                  <textarea className="inp build-ta" rows={3} value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Describe the page you want (freestyle uses your prompt)…" style={{ marginTop: 8 }} />
                )}
                {buildErr && <div className="err" style={{ marginTop: 10 }}>{buildErr}</div>}
                <div className="build-actions">
                  {(() => {
                    const fromImage = !!kitImage
                    const reproduce = !!kitText && designMode === 'reproduce'
                    const freestyle = !!kitText && designMode === 'freestyle'
                    return (
                      <button className="btn btn-primary" onClick={buildWithAi} disabled={building || (!kitText && !kitImage) || (freestyle && !aiPrompt.trim())}>
                        {building
                          ? (fromImage ? 'Reading your design… (~45s)' : reproduce ? 'Reproducing your design… (~30s)' : 'Designing your page… (~40s)')
                          : fromImage ? '✨ Rebuild from image' : reproduce ? '✨ Reproduce design' : '✨ Freestyle from design'}
                      </button>
                    )
                  })()}
                  <span className="muted" style={{ fontSize: 13 }}>or <a href={`/w/${slug}/import`}>import an existing site</a></span>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
        {/* Full-width action bar — title + primary actions, above everything */}
        <div className="ws-actionbar">
          <div className="ws-title">
            <b>{home?.title || data?.workspace.name}</b>
            <span>{pages.length} pages · /{home?.slug || ''}</span>
          </div>
          <div className="ws-actions">
            <a className="btn btn-ghost" href={`/w/${slug}/p/${home?.id}`}>Edit homepage</a>
            <button className="btn btn-secondary" onClick={structureAll} disabled={structuringAll} title="Rebuild every page into clean sections from existing content — free, no AI credits">
              {structuringAll ? 'Structuring…' : '⚡ Structure all'}
            </button>
            <button className="btn btn-secondary" onClick={polishAllPages} disabled={polishingAll} title="Run the AI design polish on every page (uses credits)">
              {polishingAll ? 'Polishing…' : '✦ Polish all'}
            </button>
            <button className="btn btn-secondary" onClick={verifyLinks} disabled={verifying} title="Rewrite links to the original site into internal links (incl. menu + footer), and resolve placeholder (#) links">
              {verifying ? 'Fixing…' : '🔗 Fix links'}
            </button>
            <button className="btn btn-secondary" onClick={backfillFeatured} disabled={backfilling} title="Re-fetch the featured (hero) image for every article missing one, from the original site">
              {backfilling ? 'Restoring…' : '🖼 Restore article images'}
            </button>
            <button className="btn btn-secondary" onClick={saveImagesToVps} disabled={savingImages} title="Download all remote images to your server — do this before the original site goes offline">
              {savingImages ? 'Saving…' : '💾 Save images'}
            </button>
            <button className="btn btn-primary" onClick={publish} disabled={publishing}>{publishing ? 'Publishing…' : '↗ Publish'}</button>
          </div>
        </div>

        <div className="site-grid">
          {/* main column — quick tiles + taller preview */}
          <div>
            <div className="site-actions site-tiles-top">
              <a className="tile" href={`/w/${slug}/import`}><div><b>Import a site</b><span>WordPress &amp; more</span></div></a>
              <a className="tile" href={`/w/${slug}/branding`}><div><b>Branding</b><span>Colors, fonts, shape</span></div></a>
              <a className="tile" href={`/w/${slug}/domains`}><div><b>Domains</b><span>Connect your URL</span></div></a>
              <a className="tile" href={`/w/${slug}/settings`}><div><b>Settings</b><span>Workspace info</span></div></a>
            </div>
            <div className="site-hero site-hero-tall">
              {home && <iframe src={`${API_URL}/pages/${home.id}/preview`} title="Site preview" />}
            </div>
          </div>

          {/* aside — pages quick-list with add/delete */}
          {(() => {
          const isArticle = (p: Page) => p.type === 'article' || p.type === 'collection_item'
          const articleCount = pages.filter(isArticle).length
          const listPages = showArticles ? pages : pages.filter((p) => !isArticle(p))
          return (
          <div className="aside-block">
            <div className="pages-head">
              <h3>Pages ({listPages.length})</h3>
              <button className="btn-mini" onClick={addPagePrompt} title="Create a new page">＋ New page</button>
            </div>
            {articleCount > 0 && (
              <label className="row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '2px 0 10px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <input type="checkbox" checked={showArticles} onChange={toggleArticles} style={{ cursor: 'pointer' }} />
                Show articles <span className="muted" style={{ fontSize: 11 }}>({articleCount})</span>
              </label>
            )}
            {(showAll ? listPages : listPages.slice(0, 8)).map((p) => (
              <div className="row page-row" key={p.id}>
                <a href={`/w/${slug}/p/${p.id}`} className="page-title" style={{ fontWeight: 500 }}>{p.title || '(untitled)'}</a>
                <span className="muted" style={{ fontSize: 11 }}>{p.type}</span>
                {p.type !== 'home' && (
                  <button className="page-del" title="Delete this page" onClick={() => deletePage(p)}>✕</button>
                )}
              </div>
            ))}
            {listPages.length > 8 && (
              <button className="btn btn-ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show less' : `Show all ${listPages.length}`}
              </button>
            )}
          </div>
          )})()}
        </div>
        </>
      )}

    </AppShell>
  )
}
