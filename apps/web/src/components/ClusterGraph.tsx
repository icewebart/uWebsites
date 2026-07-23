'use client'
import { useMemo, useState } from 'react'

// Topic-map visualisation: the site at the centre, pillars orbiting it, and each
// pillar's keywords fanning outward from their pillar. Deterministic radial
// layout rather than a force simulation — no dependency, and for a tree
// (site → pillar → keyword) it reads more clearly than physics would.

export type GraphKeyword = { keyword: string; role?: string; alreadyCovered?: boolean; status?: string }
export type GraphPillar = { name: string; businessValue?: string; keywords: GraphKeyword[] }

const W = 900, H = 620
const CX = W / 2, CY = H / 2

export function ClusterGraph({ pillars, siteName }: { pillars: GraphPillar[]; siteName: string }) {
  const [focus, setFocus] = useState<string | null>(null)

  const layout = useMemo(() => {
    const n = Math.max(pillars.length, 1)
    // Pillar ring: tighter when there are few pillars so labels don't drift.
    const R1 = n <= 3 ? 150 : n <= 5 ? 175 : 195
    return pillars.map((p, i) => {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2
      const px = CX + Math.cos(ang) * R1
      const py = CY + Math.sin(ang) * R1
      const k = p.keywords.length
      // Fan the keywords outward from their pillar, widening with count.
      const spread = Math.min(Math.PI * 0.85, 0.32 + k * 0.12)
      const R2 = k <= 4 ? 78 : k <= 8 ? 96 : 116
      const kws = p.keywords.map((kw, j) => {
        const t = k === 1 ? 0 : (j / (k - 1)) - 0.5
        const a = ang + t * spread
        // Slight radial stagger keeps dense clusters from forming a hard arc.
        const r = R2 + (j % 2 ? 16 : 0)
        return { ...kw, x: px + Math.cos(a) * r, y: py + Math.sin(a) * r }
      })
      return { ...p, x: px, y: py, kws }
    })
  }, [pillars])

  if (!pillars.length) return null
  const dim = (name: string) => focus !== null && focus !== name

  return (
    <div className="cg-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="cg-svg" role="img" aria-label="Topic map of pillars and keywords">
        {/* pillar → site */}
        {layout.map((p) => (
          <line key={`e-${p.name}`} x1={CX} y1={CY} x2={p.x} y2={p.y}
            className={`cg-edge cg-edge-main${dim(p.name) ? ' dim' : ''}`} />
        ))}
        {/* keyword → pillar */}
        {layout.map((p) => p.kws.map((k, j) => (
          <line key={`k-${p.name}-${j}`} x1={p.x} y1={p.y} x2={k.x} y2={k.y}
            className={`cg-edge${dim(p.name) ? ' dim' : ''}`} />
        )))}

        {/* keyword nodes */}
        {layout.map((p) => p.kws.map((k, j) => (
          <g key={`kn-${p.name}-${j}`} className={`cg-node${dim(p.name) ? ' dim' : ''}`}>
            <title>{k.keyword}{k.alreadyCovered ? ' — already covered' : ''}</title>
            <circle cx={k.x} cy={k.y} r={k.role === 'pillar' ? 7 : 5}
              className={`cg-dot${k.alreadyCovered ? ' covered' : ''}${k.status === 'published' ? ' published' : ''}`} />
            <text x={k.x} y={k.y - 10} className="cg-klabel">
              {k.keyword.length > 22 ? k.keyword.slice(0, 21) + '…' : k.keyword}
            </text>
          </g>
        )))}

        {/* pillar nodes */}
        {layout.map((p) => (
          <g key={`p-${p.name}`} className={`cg-node cg-pillar${dim(p.name) ? ' dim' : ''}`}
            onMouseEnter={() => setFocus(p.name)} onMouseLeave={() => setFocus(null)}>
            <title>{p.name} — {p.keywords.length} keywords</title>
            <circle cx={p.x} cy={p.y} r={Math.min(22, 11 + p.keywords.length * 0.9)}
              className={`cg-pdot v-${p.businessValue || 'medium'}`} />
            <text x={p.x} y={p.y + 34} className="cg-plabel">{p.name}</text>
          </g>
        ))}

        {/* the site itself */}
        <circle cx={CX} cy={CY} r={16} className="cg-center" />
        <text x={CX} y={CY + 34} className="cg-clabel">{siteName}</text>
      </svg>

      <div className="cg-legend">
        <span><i className="cg-key v-high" /> sells</span>
        <span><i className="cg-key v-low" /> traffic only</span>
        <span><i className="cg-key covered" /> already covered</span>
        <span><i className="cg-key published" /> published</span>
      </div>
    </div>
  )
}
