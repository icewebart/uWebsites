'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import { ImageUpload } from './ImageUpload'

// Full image control for a section field: upload a file, paste a URL, OR
// generate one with AI — all writing into the same image_url. `caption` seeds
// the AI prompt (usually the section's heading) so the photo is on-topic.
export function ImageField({ slug, value, onChange, caption, height }: {
  slug: string; value: string; onChange: (url: string) => void; caption?: string; height?: number
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function generate() {
    setErr(''); setBusy(true)
    try {
      const r = await api<{ url: string }>('/ai/generate-image', { method: 'POST', body: JSON.stringify({ slug, caption: (caption || '').trim() || 'a relevant, on-brand photo' }) })
      if (r?.url) onChange(r.url)
    } catch (e: any) { setErr(e.message || 'Generation failed') } finally { setBusy(false) }
  }
  return (
    <div>
      <ImageUpload
        slug={slug} value={value} onChange={onChange} height={height}
        extraActions={
          <button className="btn-mini" style={{ flex: '1 1 0', minWidth: 88, justifyContent: 'center' }} onClick={generate} disabled={busy} title="Generate an image for this section with AI (uses credits)">
            {busy ? 'Generating…' : '✨ Generate'}
          </button>
        }
      />
      {err && <p className="err" style={{ fontSize: 12, marginTop: 6 }}>{err}</p>}
    </div>
  )
}
