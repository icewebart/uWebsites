'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Item = { source: string; path: string; title: string; type: string; confidence: number; note: string }
type ScanResult = { site: string; total: number; counts: Record<string, number>; redirects: any[]; items: Item[] }

// Default-discard rules: commerce + low-confidence "page" sweep get unchecked
// by default; the rest are kept.
function defaultKeep(item: Item): boolean {
  if (item.type === 'commerce') return false
  if (item.type === 'page' && item.confidence < 0.4) return false
  return true
}

export default function ImportPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [keep, setKeep] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!result) return
    const next: Record<string, boolean> = {}
    for (const it of result.items) next[it.path] = defaultKeep(it)
    setKeep(next)
  }, [result])

  async function scan(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true); setResult(null)
    try {
      setResult(await api<ScanResult>('/import/scan', { method: 'POST', body: JSON.stringify({ url }) }))
    } catch (e: any) { setErr(e.message || 'Scan failed') } finally { setBusy(false) }
  }

  async function commit(mode: 'home' | 'all') {
    setErr(''); setImporting(true)
    try {
      const keepPaths = Object.entries(keep).filter(([, v]) => v).map(([k]) => k)
      const r = await api<{ created: number; redirects: number; brandingApplied?: boolean }>(
        '/import/commit', { method: 'POST', body: JSON.stringify({ slug, url, mode, keepPaths }) },
      )
      router.push(`/w/${slug}?imported=${r.created}${r.brandingApplied ? '&branding=1' : ''}`)
    } catch (e: any) { setErr(e.message || 'Import failed'); setImporting(false) }
  }

  function toggleAll(v: boolean) {
    if (!result) return
    const next: Record<string, boolean> = {}
    for (const it of result.items) next[it.path] = v
    setKeep(next)
  }

  const sortedCounts = result ? Object.entries(result.counts).sort((a, b) => b[1] - a[1]) : []
  const keepCount = Object.values(keep).filter(Boolean).length
  const discardCount = result ? result.items.length - keepCount : 0

  return (
    <AppShell title="Import a site" currentSlug={slug} active="Website">
      <form onSubmit={scan} style={{ display: 'flex', gap: 10, maxWidth: 600 }}>
        <input className="inp" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-old-site.com" autoFocus required />
        <button className="btn btn-primary" disabled={busy} style={{ whiteSpace: 'nowrap' }}>{busy ? 'Scanning…' : 'Scan site'}</button>
      </form>
      <p className="muted" style={{ fontSize: 13, margin: '10px 0 20px' }}>
        We read the site's WordPress REST API, classify every page, and propose redirects. Nothing on the source site is changed.
      </p>
      <div className="err">{err}</div>

      {result && (
        <div>
          <div className="stat-row">
            <div className="s"><b>{keepCount}</b><span>to import</span></div>
            <div className="s"><b>{discardCount}</b><span>discarded</span></div>
            <div className="s"><b>{result.total}</b><span>URLs scanned</span></div>
            <div className="s"><b>{result.redirects.length}</b><span>redirects proposed</span></div>
          </div>
          <div className="chips">
            {sortedCounts.map(([t, n]) => <span className="chip" key={t}><b>{n}</b>{t}</span>)}
          </div>
          <div style={{ display: 'flex', gap: 6, margin: '10px 0 8px', fontSize: 12 }}>
            <button className="btn btn-ghost" onClick={() => toggleAll(true)} style={{ padding: '4px 10px' }}>Keep all</button>
            <button className="btn btn-ghost" onClick={() => toggleAll(false)} style={{ padding: '4px 10px' }}>Discard all</button>
          </div>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Type</th><th>Path</th><th>Title</th><th style={{ width: 110 }}>Action</th></tr></thead>
              <tbody>
                {result.items.map((i, idx) => {
                  const kept = keep[i.path] !== false
                  return (
                    <tr key={idx} className={kept ? '' : 'row-discarded'}>
                      <td><span className="ty">{i.type}</span>{i.confidence < 0.65 && <span className="lowconf">review</span>}</td>
                      <td className="muted">{i.path}</td>
                      <td>{i.title}</td>
                      <td>
                        <button className={`keep-btn ${kept ? 'keep' : 'discard'}`} onClick={() => setKeep((m) => ({ ...m, [i.path]: !kept }))} title={kept ? 'Click to discard' : 'Click to keep'}>
                          {kept ? '✓ Keep' : '✕ Discard'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => commit('home')} disabled={importing || keepCount === 0}>
              {importing ? 'Importing…' : 'Import homepage first'}
            </button>
            <button className="btn btn-secondary" onClick={() => commit('all')} disabled={importing || keepCount === 0}>
              Import {keepCount} kept {keepCount === 1 ? 'page' : 'pages'}
            </button>
            <a className="btn btn-ghost" href={`/w/${slug}`}>Cancel</a>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Imports include each page's content, featured image, and your site's branding (colors, fonts, logo, nav, CTA). 301 redirects are created for dropped URLs.
          </p>
        </div>
      )}
    </AppShell>
  )
}
