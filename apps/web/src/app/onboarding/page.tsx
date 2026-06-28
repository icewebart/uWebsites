'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

type Workspace = { id: string; name: string; slug: string }

export default function Onboarding() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [ws, setWs] = useState('')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [choice, setChoice] = useState<'import' | 'build'>('import')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Step 1 — create the workspace, then advance.
  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault()
    if (!ws.trim()) return
    setErr(''); setBusy(true)
    try {
      const w = await api<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify({ name: ws.trim() }) })
      setWorkspace(w)
      setStep(2)
    } catch (e: any) { setErr(e.message || 'Could not create workspace') } finally { setBusy(false) }
  }

  // Step 2 — branch to import or build.
  function start() {
    if (!workspace) return router.push('/')
    if (choice === 'import') router.push(`/w/${workspace.slug}/import`)
    else router.push(`/w/${workspace.slug}`)
  }

  return (
    <div className="ob">
      <div className="auth-logo" style={{ justifyContent: 'center', marginBottom: 24 }}><span className="mk">u</span> uWebsites</div>

      <div className="steps">
        <span className={`dot${step >= 1 ? ' on' : ''}`}>1</span>
        <span className="seg" />
        <span className={`dot${step >= 2 ? ' on' : ''}`}>2</span>
      </div>

      {step === 1 ? (
        <>
          <h1>Name your workspace</h1>
          <p className="muted">A workspace is one website or brand. You can add more later.</p>
          <form onSubmit={createWorkspace} style={{ maxWidth: 420, margin: '24px auto 0', textAlign: 'left' }}>
            <div className="field"><label>Workspace name</label>
              <input value={ws} onChange={(e) => setWs(e.target.value)} placeholder="e.g. Gutenberg" autoFocus required />
            </div>
            <div className="err" style={{ textAlign: 'center' }}>{err}</div>
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || !ws.trim()}>{busy ? 'Creating…' : 'Continue →'}</button>
          </form>
        </>
      ) : (
        <>
          <h1>How do you want to start?</h1>
          <p className="muted">For <strong>{workspace?.name}</strong>.</p>
          <div className="choice">
            <div className={`choice-card${choice === 'import' ? ' sel' : ''}`} onClick={() => setChoice('import')}>
              <div className="ic">📥</div><h3>Import a site</h3>
              <p className="muted" style={{ fontSize: 13 }}>Pull in an existing WordPress (or other) site; we classify and rebuild it — keeping your URLs.</p>
            </div>
            <div className={`choice-card${choice === 'build' ? ' sel' : ''}`} onClick={() => setChoice('build')}>
              <div className="ic">✨</div><h3>Build a website</h3>
              <p className="muted" style={{ fontSize: 13 }}>Start from a clean, mobile-first template and customise it with AI.</p>
            </div>
          </div>
          <button className="btn btn-primary btn-lg" style={{ minWidth: 240, marginTop: 24 }} onClick={start}>
            {choice === 'import' ? 'Continue to import →' : 'Start building →'}
          </button>
          <div><button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setStep(1)}>← Back</button></div>
        </>
      )}
    </div>
  )
}
