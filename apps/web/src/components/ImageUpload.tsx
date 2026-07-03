'use client'
import { useState } from 'react'
import { api } from '@/lib/api'

// Reusable image upload: pick a file → base64 → POST to the workspace, store the
// returned public URL. Also accepts a pasted URL. Shows a preview.
// `dark` renders the preview on a dark backing (for white/footer logos).
export function ImageUpload({ slug, value, onChange, dark, accept = 'image/*', height = 140 }: {
  slug: string; value: string; onChange: (url: string) => void; dark?: boolean; accept?: string; height?: number
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function pick(file?: File | null) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setErr('Image is over 5MB — use a smaller file.'); return }
    setErr(''); setBusy(true)
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file)
      })
      const r = await api<{ url: string }>(`/workspaces/${slug}/upload-image`, { method: 'POST', body: JSON.stringify({ dataUrl }) })
      onChange(r.url)
    } catch (e: any) { setErr(e.message || 'Upload failed') } finally { setBusy(false) }
  }
  return (
    <div>
      {value && (
        <div style={{ marginBottom: 8, padding: dark ? 16 : 0, background: dark ? '#1a1a1f' : undefined, borderRadius: 8, border: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
          <img src={value} alt="" style={{ maxWidth: '100%', maxHeight: height, objectFit: 'contain', borderRadius: dark ? 0 : 8 }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="btn-mini" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Uploading…' : (value ? 'Replace' : '⬆ Upload')}
          <input type="file" accept={accept} style={{ display: 'none' }} disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {value && <button className="btn-mini danger" onClick={() => onChange('')}>Delete</button>}
      </div>
      <input className="inp" style={{ marginTop: 8 }} placeholder="…or paste an image URL" value={value} onChange={(e) => onChange(e.target.value)} />
      {err && <p className="err" style={{ fontSize: 12, marginTop: 6 }}>{err}</p>}
    </div>
  )
}
