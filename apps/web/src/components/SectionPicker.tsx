'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Section = { kind: string; name: string; description: string; category: string; defaults: Record<string, any> }

let cache: Section[] | null = null

export function SectionPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (s: Section) => void }) {
  const [sections, setSections] = useState<Section[]>(cache || [])

  useEffect(() => {
    if (!open || cache) return
    api<Section[]>('/sections').then((s) => { cache = s; setSections(s) }).catch(() => {})
  }, [open])

  if (!open) return null
  const byCat = sections.reduce<Record<string, Section[]>>((acc, s) => { (acc[s.category] = acc[s.category] || []).push(s); return acc }, {})
  const order = ['hero', 'content', 'features', 'media', 'cta']
  const labels: Record<string, string> = { hero: 'Hero sections', content: 'Content', features: 'Features', media: 'Media', cta: 'Call to action' }

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Add a section</h2>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          {sections.length === 0 ? (
            <div className="empty">Loading sections…</div>
          ) : (
            order.filter((c) => byCat[c]?.length).map((c) => (
              <div key={c}>
                <div className="modal-cat-label">{labels[c]}</div>
                <div className="section-grid">
                  {byCat[c].map((s) => (
                    <button key={s.kind} className="section-pick" onClick={() => onPick(s)}>
                      <b>{s.name}</b>
                      <span>{s.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
