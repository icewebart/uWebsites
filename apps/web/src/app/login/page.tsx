'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, API_URL } from '@/lib/api'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      router.push('/')
    } catch (e: any) { setErr(e.message || 'Login failed'); setBusy(false) }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <img className="auth-logo-img" src="/uwebsites.svg" alt="uWebsites" />
        <h1>Welcome back</h1>
        <p className="auth-sub">Log in to your dashboard.</p>
        <a className="oauth" href={`${API_URL}/auth/google`}>Continue with Google</a>
        <div className="divider">or</div>
        <form onSubmit={submit}>
          <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <div className="err">{err}</div>
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>{busy ? 'Logging in…' : 'Log in →'}</button>
        </form>
        <p className="auth-foot">New here? <a href="/signup">Create an account</a></p>
      </div>
    </div>
  )
}
