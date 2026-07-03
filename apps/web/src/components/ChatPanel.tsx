'use client'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

type Msg = { role: 'user' | 'assistant'; content: string; options?: string[] }
type Ctx = { type: string; title: string; blocks?: any[] } | undefined
type Block = { type: string; props: Record<string, any> }

// The AI may end a reply with `OPTIONS: A | B | C` — pull those out so we can
// render them as clickable quick-reply buttons instead of making the user type.
function parseOptions(text: string): { text: string; options?: string[] } {
  const m = text.match(/\n*\s*OPTIONS:\s*(.+?)\s*$/is)
  if (!m) return { text }
  const options = m[1].split('|').map((o) => o.trim()).filter(Boolean).slice(0, 4)
  return { text: text.slice(0, m.index).trim(), options: options.length ? options : undefined }
}

const QUICK_WS = [
  'Rebuild this site from the imported content, on-brand',
  'Suggest 5 article topics based on this site',
  'What’s missing for a strong launch?',
]
const QUICK_PAGE = [
  'Add a CTA banner at the end',
  'Make the hero shorter and punchier',
  'Replace the first section with a hero-image',
  'Add a 3-column features section after the hero',
]

export function ChatPanel({ slug, pageId, pageContext, onMutate }: { slug: string; pageId?: string; pageContext?: Ctx; onMutate?: (blocks: Block[]) => void }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, open])

  // Auto-open from URL: ?chat=1 (and optional ?q=text to pre-fill).
  // Also listen for a global event so the sidebar button can open it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('chat') === '1') {
      setOpen(true)
      const q = params.get('q'); if (q) setInput(q)
      // clean the URL so a refresh doesn't keep re-opening
      params.delete('chat'); params.delete('q')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('uw-open-chat', onOpen)
    return () => window.removeEventListener('uw-open-chat', onOpen)
  }, [])

  async function send(text: string) {
    const t = text.trim(); if (!t || busy) return
    const next: Msg[] = [...messages, { role: 'user', content: t }]
    setMessages(next); setInput(''); setBusy(true)
    try {
      if (pageId) {
        // Tool-using page chat — AI can actually mutate the page. Send the
        // editor's live blocks so unsaved edits/images aren't reverted.
        const r = await api<{ reply: string; blocks: Block[]; mutations: { tool: string; ok: boolean }[] }>('/ai/page-chat', {
          method: 'POST', body: JSON.stringify({ slug, pageId, messages: next, blocks: pageContext?.blocks }),
        })
        const applied = (r.mutations || []).filter((m) => m.ok).map((m) => m.tool.replace(/_/g, ' '))
        const tail = applied.length ? `\n\n✓ ${[...new Set(applied)].join(', ')}` : ''
        const parsed = parseOptions(r.reply || '(done)')
        setMessages((m) => [...m, { role: 'assistant', content: parsed.text + tail, options: parsed.options }])
        if (onMutate && Array.isArray(r.blocks)) onMutate(r.blocks)
      } else {
        const r = await api<{ reply: string }>('/ai/chat', {
          method: 'POST', body: JSON.stringify({ slug, messages: next, pageContext }),
        })
        const parsed = parseOptions(r.reply || '(no reply)')
        setMessages((m) => [...m, { role: 'assistant', content: parsed.text, options: parsed.options }])
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Error: ' + (e?.message || 'request failed') }])
    } finally { setBusy(false) }
  }

  const QUICK = pageId ? QUICK_PAGE : QUICK_WS

  return (
    <>
      {!open && (
        <button className="chat-fab" onClick={() => setOpen(true)} aria-label="Open AI chat" title="Ask AI">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>
      )}
      <aside className={`chat-panel${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="chat-head">
          <b>AI assistant</b>
          <button className="chat-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>
        <div className="chat-body" ref={bodyRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              Ask anything about your site — copy, structure, brand, SEO ideas.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'chat-turn user' : 'chat-turn ai'}>
              <div className={`chat-msg ${m.role === 'user' ? 'user' : 'ai'}`}>{m.content}</div>
              {m.role === 'assistant' && m.options && !busy && i === messages.length - 1 && (
                <div className="chat-options">
                  {m.options.map((o) => <button key={o} onClick={() => send(o)}>{o}</button>)}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="chat-msg ai">Thinking…</div>}
        </div>
        {messages.length === 0 && (
          <div className="chat-quick">
            {QUICK.map((q) => <button key={q} onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(input) }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={busy ? 'Waiting…' : 'Ask the AI…'} disabled={busy} />
          <button type="submit" disabled={busy || !input.trim()}>Send</button>
        </form>
      </aside>
    </>
  )
}
