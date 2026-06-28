'use client'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

type Msg = { role: 'user' | 'assistant'; content: string }
type Ctx = { type: string; title: string; blocks?: { type: string }[] } | undefined

const QUICK = [
  'Rebuild this site from the imported content, on-brand',
  'Make the homepage more concise',
  'Suggest 5 article topics based on this site',
  'What’s missing for a strong launch?',
]

export function ChatPanel({ slug, pageContext }: { slug: string; pageContext?: Ctx }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, open])

  async function send(text: string) {
    const t = text.trim(); if (!t || busy) return
    const next: Msg[] = [...messages, { role: 'user', content: t }]
    setMessages(next); setInput(''); setBusy(true)
    try {
      const r = await api<{ reply: string }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ slug, messages: next, pageContext }),
      })
      setMessages((m) => [...m, { role: 'assistant', content: r.reply || '(no reply)' }])
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: 'Error: ' + (e?.message || 'request failed') }])
    } finally { setBusy(false) }
  }

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
            <div key={i} className={`chat-msg ${m.role === 'user' ? 'user' : 'ai'}`}>{m.content}</div>
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
