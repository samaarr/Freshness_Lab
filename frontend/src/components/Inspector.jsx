import { useState } from 'react'
import { Check, X, ChevronDown } from 'lucide-react'
import { StatusPill, fmtBehind } from './bits.jsx'

export default function Inspector({ provenance: p, onClose }) {
  const [vectorOpen, setVectorOpen] = useState(false)
  const wrong = p.context_status && p.truth_status && p.context_status !== p.truth_status
  const age = p.snapshot_age_s != null ? fmtBehind(p.snapshot_age_s) : '—'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,24,0.2)', backdropFilter: 'blur(1px)' }} />
      <aside
        className="inspector-panel"
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 440, maxWidth: '94vw',
          background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
          overflowY: 'auto', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* header */}
        <div style={{ padding: 'var(--s-4) var(--s-5)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-16)' }}>
            {wrong ? 'Why was this answer wrong?' : 'Answer provenance'}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 'var(--radius)' }}>
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        <div style={{ padding: 'var(--s-5)', flex: 1 }}>
          {/* thesis line — visual peak */}
          <div style={{
            display: 'flex', gap: 'var(--s-4)', padding: '10px var(--s-3)',
            borderRadius: 'var(--radius)',
            background: wrong ? 'var(--red-bg)' : 'var(--green-bg)',
            marginBottom: 'var(--s-4)',
          }}>
            <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-12)', color: 'var(--green-text)' }}>
              <Check size={12} strokeWidth={2.5} /> retrieval healthy · {p.similarity_score}
            </span>
            {wrong && (
              <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-12)', color: 'var(--red-text)' }}>
                <X size={12} strokeWidth={2.5} /> payload stale · {age}
              </span>
            )}
          </div>

          <p style={{ fontSize: 'var(--fs-13)', color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 var(--s-4)' }}>
            {wrong
              ? <>The agent found the right dish, then read a note <span className="mono" style={{ color: 'var(--red-text)' }}>{age} behind</span>. It reported faithfully — <strong>the data layer failed, not the LLM</strong>.</>
              : <>Retrieved <span className="mono">{p.retrieved_doc}</span> via <span className="mono">$vectorSearch</span>. {p.live_read ? 'Availability re-read live at query time.' : `Served from snapshot ${age} old — consistent with truth.`}</>}
          </p>

          <div style={{ fontSize: 'var(--fs-11)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 'var(--s-2)' }}>
            Agent used · current truth
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-2)', marginBottom: 'var(--s-4)' }}>
            <Card title="used">
              <StatusPill status={p.context_status || 'available'} />
              <div className="mono" style={{ fontSize: 'var(--fs-12)', color: 'var(--text-2)', marginTop: 6 }}>v{p.embedding_version_used}</div>
              <div className="mono" style={{ fontSize: 'var(--fs-12)', color: wrong ? 'var(--red-text)' : 'var(--text-3)', marginTop: 2 }}>{age} ago</div>
            </Card>
            <Card title="truth now">
              <StatusPill status={p.truth_status || 'available'} />
              <div className="mono" style={{ fontSize: 'var(--fs-12)', color: 'var(--text-2)', marginTop: 6 }}>v{p.truth_version}</div>
              <div className="mono" style={{ fontSize: 'var(--fs-12)', color: 'var(--green-text)', marginTop: 2 }}>live</div>
            </Card>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s-3)' }}>
            <button
              onClick={() => setVectorOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', padding: 0, fontSize: 'var(--fs-13)', fontWeight: 500, color: 'var(--text-2)', cursor: 'pointer' }}
            >
              <ChevronDown size={14} strokeWidth={1.75} style={{ transform: vectorOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--duration-fast) var(--ease)', color: 'var(--text-3)' }} />
              vector mechanics
            </button>
            {vectorOpen && (
              <div style={{ marginTop: 'var(--s-3)', paddingLeft: 'var(--s-3)', borderLeft: '2px solid var(--border)', fontSize: 'var(--fs-13)', color: 'var(--text-2)', lineHeight: 1.7 }}>
                Retrieved <span className="mono">{p.retrieved_doc}</span> via cosine vector search on the runbook embedding (v{p.embedding_version_used}) — recomputed only when the runbook text changes.<br /><br />
                Availability is a structured field — <strong>never embedded</strong>; live mode re-reads it at query time.<br />
                Baseline mode serves <span className="mono">snapshot_text</span> captured at embed time — the naive pattern this project makes visible.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div style={{ background: 'var(--bg-page)', borderRadius: 'var(--radius)', padding: 'var(--s-3)' }}>
      <div style={{ fontSize: 'var(--fs-11)', color: 'var(--text-3)', marginBottom: 'var(--s-2)' }}>{title}</div>
      {children}
    </div>
  )
}
