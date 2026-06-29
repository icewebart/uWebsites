'use client'
import { useState } from 'react'
import { api } from '@/lib/api'

type Direction = { id: string; label: string; tone: string; desc: string }

// Pre-canned visual directions. The `tone` string is what we pass to
// /ai/rebuild-page so Claude tunes the layout + copy accordingly.
const DIRECTIONS: Direction[] = [
  { id: 'modern',  label: 'Modern minimalist', tone: 'modern, minimalist, plenty of whitespace, confident, scannable', desc: 'Clean lines, lots of whitespace, focused copy.' },
  { id: 'bold',    label: 'Bold & confident',  tone: 'bold, high-contrast, energetic, punchy short headlines, strong CTAs', desc: 'High contrast, punchy headlines, strong CTAs.' },
  { id: 'premium', label: 'Premium / elegant', tone: 'premium, elegant, restrained palette, refined typography, classy', desc: 'Refined typography, restrained palette.' },
  { id: 'playful', label: 'Playful & warm',    tone: 'playful, friendly, warm tone, approachable, slight humour', desc: 'Friendly tone, approachable copy.' },
  { id: 'editorial', label: 'Editorial',       tone: 'editorial, long-form-friendly, narrative, image-led', desc: 'Narrative voice, image-led layout.' },
  { id: 'as-is',   label: 'Keep my brand voice', tone: 'preserve the original tone of voice exactly; only restructure layout', desc: 'Same voice, just better structure.' },
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
    setErr(''); setBusy(true)
    const tone = [dir.tone, extra.trim()].filter(Boolean).join('. ')
    try {
      const r = await api<{ title: string; blocks: any[] }>('/ai/rebuild-page', {
        method: 'POST', body: JSON.stringify({ pageId, tone }),
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
            <p>AI keeps your real content and images. It restructures the page into a designed layout using the section catalog.</p>
          </div>
        </div>

        <div className="rebuild-body">
          <p className="rebuild-label">Choose a visual direction</p>
          <div className="direction-grid">
            {DIRECTIONS.map((d) => (
              <button key={d.id} className={`direction ${dir.id === d.id ? 'sel' : ''}`} onClick={() => setDir(d)}>
                <b>{d.label}</b>
                <span>{d.desc}</span>
              </button>
            ))}
          </div>
          <p className="rebuild-label">Anything specific? <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-faint)' }}>(optional)</span></p>
          <textarea className="inp" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder='e.g. "Add a testimonials section near the top" or "lead with the offer, not the story"' />
          {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
        </div>

        <div className="rebuild-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={rebuild} disabled={busy}>
            {busy ? 'Rebuilding…' : '✦ Rebuild with AI'}
          </button>
        </div>
      </div>
    </div>
  )
}
