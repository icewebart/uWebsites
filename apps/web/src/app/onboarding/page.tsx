'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

export default function Onboarding() {
  const router = useRouter()
  const [ws, setWs] = useState('')
  const [choice, setChoice] = useState<'import' | 'template'>('import')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    setErr(''); setBusy(true)
    try {
      if (ws.trim()) await api('/workspaces', { method: 'POST', body: JSON.stringify({ name: ws.trim() }) })
      router.push('/')
    } catch (e: any) { setErr(e.message || 'Something went wrong'); setBusy(false) }
  }

  return (
    <div className="ob">
      <div className="auth-logo" style={{ justifyContent: 'center', marginBottom: 24 }}><span className="mk">u</span> uWebsites</div>
      <h1>Set up your first workspace</h1>
      <p className="muted">A workspace is one website or brand. You can add more later.</p>

      <div style={{ maxWidth: 420, margin: '24px auto 0', textAlign: 'left' }}>
        <div className="field"><label>Workspace name</label><input value={ws} onChange={(e) => setWs(e.target.value)} placeholder="e.g. Gutenberg" /></div>
      </div>

      <div className="choice">
        <div className={`choice-card${choice === 'import' ? ' sel' : ''}`} onClick={() => setChoice('import')}>
          <div className="ic">📥</div><h3>Import a site</h3><p className="muted" style={{ fontSize: 13 }}>Pull in an existing site; we classify and rebuild it.</p>
        </div>
        <div className={`choice-card${choice === 'template' ? ' sel' : ''}`} onClick={() => setChoice('template')}>
          <div className="ic">✨</div><h3>Start from a template</h3><p className="muted" style={{ fontSize: 13 }}>Pick a clean, mobile-first template and edit with AI.</p>
        </div>
      </div>

      <div className="err" style={{ textAlign: 'center', marginTop: 14 }}>{err}</div>
      <button className="btn btn-primary btn-lg" style={{ minWidth: 220, marginTop: 8 }} onClick={go} disabled={busy}>{busy ? 'Setting up…' : 'Continue →'}</button>
    </div>
  )
}
