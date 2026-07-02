// Image generation via Google's Gemini image model ("nano-banana",
// gemini-2.5-flash-image). Given a caption + brand mood, generates a photo and
// stores it in the workspace's img dir (never hotlinked). Returns the local URL
// or null if the key is missing / the call fails, so callers can degrade
// gracefully to an empty slot.
import { saveImageBytes } from './image-host.js'

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'
const ENDPOINT = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`

export function imageGenEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY
}

// Build a strong photo prompt from a caption + optional brand mood.
export function photoPrompt(caption: string, mood?: string): string {
  const base = caption?.trim() || 'a clean, modern lifestyle photo relevant to the brand'
  return [
    `A high-quality, photorealistic photograph for a website: ${base}.`,
    mood ? `Mood: ${mood}.` : '',
    'Natural lighting, sharp focus, professional composition, editorial quality.',
    'No text, no words, no watermark, no logo, no borders. Fill the frame.',
  ].filter(Boolean).join(' ')
}

export type ImageGenReason = 'ok' | 'no-key' | 'billing' | 'rate-limit' | 'failed'
export type ImageGenResult = { url: string | null; reason: ImageGenReason }

// Generate one image and store it. Returns { url, reason } — reason lets callers
// surface WHY it failed (e.g. free-tier quota of 0 → 'billing').
export async function generateImageResult(slug: string, prompt: string, keyHint?: string): Promise<ImageGenResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) return { url: null, reason: 'no-key' }
  try {
    const r = await fetch(ENDPOINT(MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      // Free tier has a 0 quota for image models — distinguish that from a
      // transient rate limit so the UI can tell the user to enable billing.
      if (r.status === 429) return { url: null, reason: /limit:\s*0|free_tier/i.test(body) ? 'billing' : 'rate-limit' }
      return { url: null, reason: 'failed' }
    }
    const j: any = await r.json()
    const parts = j?.candidates?.[0]?.content?.parts || []
    const img = parts.find((p: any) => p?.inlineData?.data || p?.inline_data?.data)
    const data = img?.inlineData?.data || img?.inline_data?.data
    if (!data) return { url: null, reason: 'failed' }
    const mime = img?.inlineData?.mimeType || img?.inline_data?.mime_type || 'image/png'
    const ext = /jpe?g/i.test(mime) ? '.jpg' : /webp/i.test(mime) ? '.webp' : '.png'
    const buf = Buffer.from(data, 'base64')
    const url = await saveImageBytes(slug, buf, ext, keyHint || prompt)
    return { url, reason: 'ok' }
  } catch {
    return { url: null, reason: 'failed' }
  }
}

// Convenience wrapper — just the URL (or null).
export async function generateImage(slug: string, prompt: string, keyHint?: string): Promise<string | null> {
  return (await generateImageResult(slug, prompt, keyHint)).url
}

export function reasonMessage(reason: ImageGenReason): string {
  switch (reason) {
    case 'billing': return 'Image generation needs billing enabled on your Google Cloud project — the Gemini free tier has a 0 quota for image models. Enable billing at console.cloud.google.com (same project as the API key), then try again.'
    case 'rate-limit': return 'Gemini rate limit hit — wait a moment and try again.'
    case 'no-key': return 'Image generation not configured — set GEMINI_API_KEY on the server.'
    default: return 'Image generation failed.'
  }
}
