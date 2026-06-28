'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'

export default function Signup() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await api('/auth/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) })
      router.push('/onboarding')
    } catch (e: any) { setErr(e.message || 'Signup failed'); setBusy(false) }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <img className="auth-logo-img" src="/uwebsites.svg" alt="uWebsites" />
        <h1>Create your account</h1>
        <p className="auth-sub">Start free — 1 workspace, no credit card.</p>
        <a className="oauth" href={`${API_URL}/auth/google`}>Continue with Google</a>
        <div className="divider">or</div>
        <form onSubmit={submit}>
          <div className="field"><label>Full name</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="field"><label>Work email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label>Password</label><input type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <div className="err">{err}</div>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create account →'}</button>
        </form>
        <p className="auth-foot">Already have an account? <a href="/login">Log in</a></p>
      </div>
    </div>
  )
}
