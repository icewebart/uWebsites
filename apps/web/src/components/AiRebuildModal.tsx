'use client'
import { useState } from 'react'
import { api } from '@/lib/api'

// Optional voice override — used ONLY when the user opens "Advanced". By
// default rebuild derives everything (visuals + voice) from the workspace's
// Branding. These map 1:1 to the aesthetics in apps/api/src/lib/aesthetics.ts,
// but they now only steer copy voice + section roster (NOT the palette).
const VOICES: { id: string; label: string; desc: string }[] = [
  { id: 'auto',     label: 'From my brand',  desc: 'Use my Branding — colors, fonts, tagline and voice. (Recommended)' },
  { id: 'lyric',    label: 'Warm & playful', desc: 'Family, learning, wellness, lifestyle.' },
  { id: 'apex',     label: 'Authoritative',  desc: 'Law, finance, consulting — measured, precise.' },
  { id: 'paymark',  label: 'Numbers-first',  desc: 'B2B / SaaS — confident, metric-led.' },
  { id: 'maison',   label: 'Editorial',      desc: 'Hospitality, design, premium — quietly confident.' },
  { id: 'aquafix',  label: 'Direct/local',   desc: 'Trades & services — plain, reassuring, action-first.' },
  { id: 'stark',    label: 'Terse/bold',     desc: 'Agency / portfolio — blunt, fragments OK.' },
  { id: 'obsidian', label: 'Luxury/minimal', desc: 'High-end — minimal, names materials & makers.' },
]

export function AiRebuildModal({ open, pageId, pageTitle, snapshotUrl, onClose, onDone }: {
  open: boolean
  pageId: string
  pageTitle: string
  snapshotUrl?: string | null
  onClose: () => void
  onDone: (data: { title: string; blocks: any[] }) => void
}) {
  const [voice, setVoice] = useState('auto')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!open) return null

  async function rebuild() {
    if (!extra.trim()) { setErr('Tell me what to change. AI Rebuild is a destructive op — empty instruction = no change.'); return }
    setErr(''); setBusy(true)
    const payload: any = { pageId, tone: extra.trim() }
    if (voice !== 'auto') payload.aesthetic = voice
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
            <p>AI keeps your real content and images, then restructures the page — using your <b>Branding</b> (colors, fonts, tagline and voice) so it comes out on-brand.</p>
          </div>
        </div>

        <div className="rebuild-body">
          <p className="rebuild-label">What should I change? <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-faint)' }}>(required — AI only does what you ask)</span></p>
          <textarea className="inp" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder='e.g. "Add a testimonials section near the top" or "Replace the hero with a shorter, sharper headline" or "Drop the pricing section"' />

          <button className="rebuild-advanced-toggle" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? '▾' : '▸'} Advanced — override the writing voice
          </button>
          {showAdvanced && (
            <>
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>By default the voice comes from your Branding page. Pick a different one just for this rebuild:</p>
              <div className="direction-grid">
                {VOICES.map((d) => (
                  <button key={d.id} className={`direction ${voice === d.id ? 'sel' : ''}`} onClick={() => setVoice(d.id)}>
                    <b>{d.label}</b>
                    <span>{d.desc}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>To polish copy on a single section without changing layout, close this and use <b>✦ AI rewrite copy</b> in the section panel instead. To set your permanent voice, edit <b>Branding → Brand voice</b>.</p>
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
