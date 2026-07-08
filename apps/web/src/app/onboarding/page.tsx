'use client'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'

// useSearchParams forces this client component to opt out of static
// prerender. The Suspense wrapper at the bottom lets the rest of the page
// render while query params resolve.
export const dynamic = 'force-dynamic'

type Workspace = { id: string; name: string; slug: string }

export default function OnboardingPage() {
  return <Suspense fallback={<div className="empty">Loading…</div>}><Onboarding /></Suspense>
}

function Onboarding() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // ?new=1 means the user explicitly chose 'Create new workspace' from the
  // topbar dropdown — they already have workspaces and want another. Skip
  // the auto-redirect-to-dashboard.
  const forceNew = searchParams.get('new') === '1'
  const [step, setStep] = useState<1 | 2>(1)
  const [ws, setWs] = useState('')
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [choice, setChoice] = useState<'import' | 'build' | 'design'>('import')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [checking, setChecking] = useState(true)
  const [existingCount, setExistingCount] = useState(0)

  // First-run onboarding sends users with workspaces back to the dashboard.
  // When forceNew is true (clicked 'Create new workspace' from the dropdown),
  // we skip that redirect and let them create another.
  useEffect(() => {
    api<Workspace[]>('/workspaces')
      .then((list) => {
        const n = Array.isArray(list) ? list.length : 0
        setExistingCount(n)
        if (!forceNew && n > 0) router.replace('/')
        else setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [forceNew])

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
    else if (choice === 'design') router.push(`/w/${workspace.slug}?start=design`)
    else router.push(`/w/${workspace.slug}`)
  }

  if (checking) return <div className="empty">Loading…</div>

  return (
    <div className="ob">
      <img className="auth-logo-img" src="/uwebsites.svg" alt="uWebsites" />
      {forceNew && existingCount > 0 && (
        <div style={{ textAlign: 'center', marginTop: -8, marginBottom: 12 }}>
          <a href="/" className="muted" style={{ fontSize: 12 }}>← Back to dashboard</a>
        </div>
      )}

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
          <div className="choice three">
            <div className={`choice-card${choice === 'import' ? ' sel' : ''}`} onClick={() => setChoice('import')}>
              <div className="ic">⤓</div><h3>Import a site</h3>
              <p className="muted" style={{ fontSize: 13 }}>Pull in an existing WordPress (or other) site; we classify and rebuild it — keeping your URLs.</p>
            </div>
            <div className={`choice-card${choice === 'design' ? ' sel' : ''}`} onClick={() => setChoice('design')}>
              <div className="ic">🎨</div><h3>Start from a design</h3>
              <p className="muted" style={{ fontSize: 13 }}>Have a design from Claude Design, Canva or Figma? Upload the HTML or a screenshot and we rebuild it — on your brand.</p>
            </div>
            <div className={`choice-card${choice === 'build' ? ' sel' : ''}`} onClick={() => setChoice('build')}>
              <div className="ic">✨</div><h3>Build a website</h3>
              <p className="muted" style={{ fontSize: 13 }}>Start from a clean, mobile-first template and customise it with AI.</p>
            </div>
          </div>
          <button className="btn btn-primary btn-lg" style={{ minWidth: 240, marginTop: 24 }} onClick={start}>
            {choice === 'import' ? 'Continue to import →' : choice === 'design' ? 'Upload your design →' : 'Start building →'}
          </button>
          <div><button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setStep(1)}>← Back</button></div>
        </>
      )}
    </div>
  )
}
