'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { AppShell } from '@/components/AppShell'

type Workspace = { id: string; name: string; slug: string }
type Me = { user: { id: string; name: string; email: string } }
type ProductMode = 'content' | 'site' | 'both'

export default function WorkspaceSettings() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [ws, setWs] = useState<Workspace | null>(null)
  const [wsName, setWsName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountEmail, setAccountEmail] = useState('')
  const [loading, setLoading] = useState(true)

  const [savingWs, setSavingWs] = useState(false)
  const [savingAcc, setSavingAcc] = useState(false)
  const [wsSavedAt, setWsSavedAt] = useState('')
  const [accSavedAt, setAccSavedAt] = useState('')
  const [wsErr, setWsErr] = useState('')
  const [accErr, setAccErr] = useState('')

  const [product, setProduct] = useState<ProductMode>('site')
  const [productBusy, setProductBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      api<Workspace[]>('/workspaces'),
      api<Me>('/auth/me'),
      api<{ product: ProductMode }>(`/workspaces/${slug}/product-mode`).catch(() => ({ product: 'site' as ProductMode })),
    ]).then(([list, me, pm]) => {
      const found = list.find((w) => w.slug === slug)
      if (!found) { router.push('/'); return }
      setWs(found); setWsName(found.name)
      setAccountName(me.user.name || ''); setAccountEmail(me.user.email || '')
      setProduct(pm.product)
    }).catch(() => router.push('/login')).finally(() => setLoading(false))
  }, [slug])

  // Switch between the content engine (writes into your OWN site) and the
  // uWebsites site builder — the "sides still work together" upgrade path.
  async function setProductMode(next: ProductMode) {
    if (next === product) return
    setProductBusy(true)
    try { await api(`/workspaces/${slug}/product-mode`, { method: 'PUT', body: JSON.stringify({ product: next }) }); setProduct(next) }
    catch { /* leave as-is on failure */ } finally { setProductBusy(false) }
  }

  const [delConfirm, setDelConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [delErr, setDelErr] = useState('')

  async function saveWs() {
    setWsErr(''); setSavingWs(true)
    try {
      await api(`/workspaces/${slug}`, { method: 'PUT', body: JSON.stringify({ name: wsName }) })
      setWsSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setWsErr(e.message || 'Save failed') } finally { setSavingWs(false) }
  }

  async function deleteWs() {
    setDelErr(''); setDeleting(true)
    try {
      await api(`/workspaces/${slug}`, { method: 'DELETE', body: JSON.stringify({ confirm: delConfirm }) })
      router.push('/')
    } catch (e: any) { setDelErr(e.message || 'Delete failed'); setDeleting(false) }
  }

  async function saveAccount() {
    setAccErr(''); setSavingAcc(true)
    try {
      await api('/auth/me', { method: 'PUT', body: JSON.stringify({ name: accountName }) })
      setAccSavedAt(new Date().toLocaleTimeString())
    } catch (e: any) { setAccErr(e.message || 'Save failed') } finally { setSavingAcc(false) }
  }

  if (loading || !ws) return <div className="empty">Loading…</div>

  return (
    <AppShell title="Settings" currentSlug={slug} active="Settings">
      <div style={{ maxWidth: 640 }}>
        <div className="ctl-group">
          <h3>Your account</h3>
          <div className="field"><label>Name</label>
            <input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Your name" />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Shown in the topbar and greetings.</p>
          </div>
          <div className="field" style={{ marginBottom: 0 }}><label>Email</label>
            <input value={accountEmail} disabled style={{ opacity: 0.6 }} />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Email changes need re-verification — coming soon.</p>
          </div>
          <div className="err">{accErr}</div>
          <div className="save-row">
            <button className="btn btn-primary" onClick={saveAccount} disabled={savingAcc || !accountName.trim()}>{savingAcc ? 'Saving…' : 'Save account'}</button>
            {accSavedAt && <span className="saved-tag">Saved {accSavedAt}</span>}
          </div>
        </div>

        <div className="ctl-group" style={{ marginTop: 32 }}>
          <h3>Workspace</h3>
          <div className="field"><label>Workspace name</label>
            <input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="Workspace name" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}><label>URL slug</label>
            <input value={ws.slug} disabled style={{ opacity: 0.6 }} />
            <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>The slug is fixed to keep published URLs stable.</p>
          </div>
          <div className="err">{wsErr}</div>
          <div className="save-row">
            <button className="btn btn-primary" onClick={saveWs} disabled={savingWs || !wsName.trim()}>{savingWs ? 'Saving…' : 'Save workspace'}</button>
            {wsSavedAt && <span className="saved-tag">Saved {wsSavedAt}</span>}
          </div>
        </div>

        <div className="ctl-group" style={{ marginTop: 32 }}>
          <h3>Workspace type</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            {product === 'content'
              ? 'Content mode — this workspace plans and writes articles into your own WordPress site. No canvas, menu or footer here.'
              : product === 'both'
              ? 'Both — this workspace builds a site with uWebsites AND writes articles onto that same site. Nothing hidden.'
              : 'Site mode — this workspace builds and hosts a site with uWebsites (design canvas, menu, footer).'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={`btn ${product === 'content' ? 'btn-primary' : 'btn-secondary'}`} disabled={productBusy} onClick={() => setProductMode('content')}>📝 Content only</button>
            <button className={`btn ${product === 'site' ? 'btn-primary' : 'btn-secondary'}`} disabled={productBusy} onClick={() => setProductMode('site')}>🎨 Full site builder</button>
            <button className={`btn ${product === 'both' ? 'btn-primary' : 'btn-secondary'}`} disabled={productBusy} onClick={() => setProductMode('both')}>🔀 Both</button>
          </div>
        </div>

        <div className="ctl-group" style={{ marginTop: 32 }}>
          <h3>Domains</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Connect a custom domain so your published site lives at your own URL with HTTPS.</p>
          <a className="btn btn-secondary" href={`/w/${slug}/domains`}>Manage domains</a>
        </div>

        <div className="ctl-group danger-zone" style={{ marginTop: 32 }}>
          <h3>Danger zone</h3>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Permanently delete <strong>{ws?.name}</strong> — its pages, branding, menus, images and published site. This cannot be undone.
            To confirm, type the workspace name below.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="inp" style={{ maxWidth: 260 }} value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder={ws?.name || 'workspace name'} />
            <button className="btn btn-danger" onClick={deleteWs} disabled={deleting || delConfirm.trim() !== (ws?.name || '')}>
              {deleting ? 'Deleting…' : 'Delete this workspace'}
            </button>
          </div>
          {delErr && <div className="err" style={{ marginTop: 10 }}>{delErr}</div>}
        </div>
      </div>
    </AppShell>
  )
}
