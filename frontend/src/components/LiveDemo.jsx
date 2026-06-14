import { useState } from 'react'
import { api } from '../api.js'
import { StatusPill, FreshnessChip } from './bits.jsx'
import AgentPanel from './AgentPanel.jsx'
import Inspector from './Inspector.jsx'

export default function LiveDemo({ services, mode, extraSeconds, onChanged }) {
  const [editing, setEditing] = useState(null) // service being runbook-edited
  const [draft, setDraft] = useState('')
  const [inspect, setInspect] = useState(null) // provenance for the drawer

  const flip = async (name, status) => { await api.patchService(name, { status }); onChanged() }
  const saveRunbook = async () => { await api.patchService(editing, { runbook_text: draft }); setEditing(null); onChanged() }

  const tickedAge = (s) => (s == null ? null : s + extraSeconds)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '30fr 30fr 40fr', minHeight: 'calc(100vh - 110px)' }}>
      {/* Operations + Memory state share row structure */}
      <section style={{ borderRight: '1px solid var(--border)' }}>
        <h2 style={hdr}>Operations</h2>
        {services.map(s => (
          <div key={s.name} style={row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
              <span className="mono" style={{ fontSize: 'var(--fs-13)' }}>{s.name}</span>
              <StatusPill status={s.status} />
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>{s.price}</span>
              <select value={s.status} onChange={e => flip(s.name, e.target.value)}
                style={{ fontSize: 'var(--fs-12)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 4px', background: 'var(--bg-card)' }}>
                <option>available</option><option>limited</option><option>sold_out</option>
              </select>
              <button onClick={() => { setEditing(s.name); setDraft('') }} style={{ fontSize: 'var(--fs-12)', border: 'none', background: 'none', color: 'var(--info)' }}>edit runbook</button>
            </div>
          </div>
        ))}
      </section>

      <section style={{ borderRight: '1px solid var(--border)' }}>
        <h2 style={hdr}>Memory state</h2>
        {services.map(s => (
          <div key={s.name} style={row}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <FreshnessChip label="facts" behindS={tickedAge(s.facts_behind_s)} updatesBehind={s.facts_behind_s != null ? s.updates_behind : 0} />
              <FreshnessChip label="search" behindS={tickedAge(s.search_behind_s)} updatesBehind={0} />
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2 style={hdr}>Agent</h2>
        <AgentPanel mode={mode} onInspect={setInspect} />
      </section>

      {editing && (
        <div style={overlay} onClick={() => setEditing(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 'var(--s-3)' }}>Edit runbook — <span className="mono">{editing}</span></div>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={8} placeholder="New runbook text (replaces the current one — this is a semantic change, Mechanism A)…"
              style={{ width: '100%', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', padding: 'var(--s-3)' }} />
            <div style={{ display: 'flex', gap: 'var(--s-2)', marginTop: 'var(--s-3)', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditing(null)} style={btnGhost}>Cancel</button>
              <button onClick={saveRunbook} disabled={!draft.trim()} style={btnPrimary}>Save runbook</button>
            </div>
          </div>
        </div>
      )}

      {inspect && <Inspector provenance={inspect} onClose={() => setInspect(null)} />}
    </div>
  )
}

const hdr = { fontSize: 'var(--fs-12)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--text-3)', padding: 'var(--s-3) var(--s-4)', borderBottom: '1px solid var(--border)', margin: 0 }
const row = { padding: 'var(--s-4)', borderBottom: '1px solid var(--border)', minHeight: 74 }
const overlay = { position: 'fixed', inset: 0, background: 'rgba(20,20,18,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40 }
const modal = { background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: 'var(--s-5)', width: 560, maxWidth: '92vw' }
const btnGhost = { border: '1px solid var(--border-strong)', background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '8px 14px' }
const btnPrimary = { border: 'none', background: 'var(--text-1)', color: '#fff', borderRadius: 'var(--radius)', padding: '8px 14px' }
