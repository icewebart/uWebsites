'use client'
import { useState } from 'react'
import { api } from '@/lib/api'

type Direction = { id: string; label: string; tone?: string; desc: string }

// `auto` is the default — the API auto-picks a named aesthetic from the
// imported brand (nav industry + brand colors). The named slugs map 1:1 to
// the aesthetics defined in apps/api/src/lib/aesthetics.ts.
const DIRECTIONS: Direction[] = [
  { id: 'auto',     label: 'Auto from brand',     desc: 'Pick the right aesthetic from your imported colors, fonts and nav industry. (Recommended)' },
  { id: 'lyric',    label: 'Lyric',               desc: 'Warm + playful — family, learning, wellness, lifestyle.' },
  { id: 'apex',     label: 'Apex',                desc: 'Navy + serif — law, finance, consulting, professional services.' },
  { id: 'paymark',  label: 'Paymark',             desc: 'Dark fintech / B2B SaaS — confident, numbers-first.' },
  { id: 'maison',   label: 'Maison',              desc: 'Editorial warm — hospitality, design, premium home brands.' },
  { id: 'aquafix',  label: 'Aquafix',             desc: 'Trades + transparent pricing — plumbing, HVAC, repair, local services.' },
  { id: 'launchpad',label: 'Launchpad',           desc: 'Pre-launch waitlist with urgency and live counter energy.' },
  { id: 'stark',    label: 'Stark',               desc: 'Brutalist mono — agency, studio, portfolio. Black, white, one accent.' },
  { id: 'obsidian', label: 'Obsidian',            desc: 'Dark cinematic luxury — jewelry, private clubs, high-end.' },
]

export function AiRebuildModal({ open, pageId, pageTitle, snapshotUrl, onClose, onDone }: {
  open: boolean
  pageId: string
  pageTitle: string
  snapshotUrl?: string | null
  onClose: () => void
  onDone: (data: { title: string; blocks: any[] }) => void
}) {
  const [dir, setDir] = useState<Direction>(DIRECTIONS[0])
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!open) return null

  async function rebuild() {
    if (!extra.trim()) { setErr('Tell me what to change. AI Rebuild is a destructive op — empty instruction = no change.'); return }
    setErr(''); setBusy(true)
    const payload: any = { pageId, tone: extra.trim() }
    if (dir.id !== 'auto') payload.aesthetic = dir.id
    try {
      const r = await api<{ title: string; blocks: any[] }>('/ai/rebuild-page', {
        method: 'POST', body: JSON.stringify(payload),
      })
      onDone(r); onClose()
    } catch (e: any) { setErr(e.message || 'Rebuild failed') } finally { setBusy(false) }
  }

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal rebuild-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rebuild-head">
          {snapshotUrl
            ? <img className="rebuild-thumb" src={snapshotUrl} alt="Original" />
            : <div className="rebuild-thumb" />}
          <div className="rebuild-head-text">
            <h2>Rebuild "{pageTitle || 'this page'}" with AI</h2>
            <p>AI keeps your real content and images, then restructures the page in a named aesthetic — typography, palette, section roster and copy voice all chosen together.</p>
          </div>
        </div>

        <div className="rebuild-body">
          <p className="rebuild-label">Aesthetic</p>
          <div className="direction-grid">
            {DIRECTIONS.map((d) => (
              <button key={d.id} className={`direction ${dir.id === d.id ? 'sel' : ''}`} onClick={() => setDir(d)}>
                <b>{d.label}</b>
                <span>{d.desc}</span>
              </button>
            ))}
          </div>
          <p className="rebuild-label">What should I change? <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-faint)' }}>(required — AI only does what you ask)</span></p>
          <textarea className="inp" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder='e.g. "Add a testimonials section near the top" or "Replace the hero with a shorter, sharper headline" or "Drop the pricing section"' />
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>To polish copy on a single section without changing layout, close this and use <b>✦ AI rewrite copy</b> in the section panel instead.</p>
          {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
        </div>

        <div className="rebuild-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={rebuild} disabled={busy || !extra.trim()}>
            {busy ? 'Applying…' : '✦ Apply change'}
          </button>
        </div>
      </div>
    </div>
  )
}
