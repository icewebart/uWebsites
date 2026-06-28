'use client'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Item = { source: string; path: string; title: string; type: string; confidence: number; note: string }
type ScanResult = { site: string; total: number; counts: Record<string, number>; redirects: any[]; items: Item[] }

export default function ImportPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)

  async function scan(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true); setResult(null)
    try {
      setResult(await api<ScanResult>('/import/scan', { method: 'POST', body: JSON.stringify({ url }) }))
    } catch (e: any) { setErr(e.message || 'Scan failed') } finally { setBusy(false) }
  }

  async function commit(mode: 'home' | 'all') {
    setErr(''); setImporting(true)
    try {
      const r = await api<{ created: number; redirects: number }>('/import/commit', { method: 'POST', body: JSON.stringify({ slug, url, mode }) })
      router.push(`/w/${slug}?imported=${r.created}`)
    } catch (e: any) { setErr(e.message || 'Import failed'); setImporting(false) }
  }

  const sortedCounts = result ? Object.entries(result.counts).sort((a, b) => b[1] - a[1]) : []

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
            <div className="s"><b>{result.total}</b><span>URLs found</span></div>
            <div className="s"><b>{sortedCounts.length}</b><span>page types</span></div>
            <div className="s"><b>{result.redirects.length}</b><span>redirects proposed</span></div>
          </div>
          <div className="chips">
            {sortedCounts.map(([t, n]) => <span className="chip" key={t}><b>{n}</b>{t}</span>)}
          </div>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Type</th><th>Path</th><th>Title</th></tr></thead>
              <tbody>
                {result.items.map((i, idx) => (
                  <tr key={idx}>
                    <td><span className="ty">{i.type}</span>{i.confidence < 0.65 && <span className="lowconf">review</span>}</td>
                    <td className="muted">{i.path}</td>
                    <td>{i.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => commit('home')} disabled={importing}>
              {importing ? 'Importing…' : 'Import homepage first'}
            </button>
            <button className="btn btn-secondary" onClick={() => commit('all')} disabled={importing}>
              Import all {result.total} pages
            </button>
            <a className="btn btn-ghost" href={`/w/${slug}`}>Cancel</a>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Imports include each page's content and featured image. Commerce &amp; unclassified pages are skipped; 301 redirects are created for dropped URLs. We recommend starting with the homepage so you can review the look before pulling the rest.
          </p>
        </div>
      )}
    </AppShell>
  )
}
