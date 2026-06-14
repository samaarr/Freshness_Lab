import { useState } from 'react'
import { Utensils, Loader2 } from 'lucide-react'
import { api } from '../api.js'
import { fmtBehind } from './bits.jsx'

export default function AgentPanel({ mode, onInspect }) {
  const [q, setQ] = useState('')
  const [thread, setThread] = useState([])
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const question = q.trim()
    if (!question || busy) return
    setQ(''); setBusy(true)
    setThread(t => [...t, { role: 'user', text: question }])
    try {
      const res = await api.ask(question)
      setThread(t => [...t, { role: 'agent', text: res.answer, provenance: res.provenance }])
    } catch (e) {
      setThread(t => [...t, { role: 'agent', text: `Error: ${e.message}`, provenance: null }])
    } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 41px)' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
        {thread.length === 0 && (
          <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-13)', padding: 'var(--s-2) 0' }}>
            Ask the waiter — try{' '}
            <span className="mono">"Is the risotto available tonight?"</span>{' '}
            after changing availability. Mode: <strong>{mode}</strong>.
          </div>
        )}
        {thread.map((m, i) => m.role === 'user'
          ? (
            <div key={i} style={{
              alignSelf: 'flex-end', maxWidth: '80%',
              background: 'var(--text-1)', color: '#fff',
              borderRadius: 'var(--radius)', borderBottomRightRadius: 'var(--radius-sm)',
              padding: '8px 12px', fontSize: 'var(--fs-13)',
            }}>{m.text}</div>
          )
          : (
            <div key={i} style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'flex-start', alignSelf: 'flex-start', maxWidth: '95%' }}>
              <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-page)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Utensils size={12} strokeWidth={1.75} style={{ color: 'var(--text-3)' }} />
              </div>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', borderTopLeftRadius: 'var(--radius-sm)', padding: '9px 12px' }}>
                <div style={{ fontSize: 'var(--fs-13)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{stripStatusLine(m.text)}</div>
                {m.provenance && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--border)', gap: 'var(--s-3)' }}>
                    <span className="mono" style={{ fontSize: 'var(--fs-11)', color: m.provenance.live_read ? 'var(--green-text)' : 'var(--amber-text)' }}>
                      {m.provenance.live_read
                        ? 'live data'
                        : `${fmtBehind(m.provenance.snapshot_age_s ?? 0)}-old snapshot`}
                    </span>
                    <button onClick={() => onInspect(m.provenance)} style={{ border: 'none', background: 'none', color: 'var(--text-3)', fontSize: 'var(--fs-12)', cursor: 'pointer' }}>
                      why? → inspect
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        {busy && (
          <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center', alignSelf: 'flex-start' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-page)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader2 size={13} strokeWidth={1.75} className="spin" style={{ color: 'var(--text-3)' }} />
            </div>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)' }}>thinking…</span>
          </div>
        )}
      </div>

      <div style={{ padding: 'var(--s-3) var(--s-4)', borderTop: '1px solid var(--border)' }}>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Ask about menu availability…"
          style={{ width: '100%', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius)', padding: '9px 12px', background: 'var(--bg-card)', fontSize: 'var(--fs-13)' }}
        />
      </div>
    </div>
  )
}

const stripStatusLine = (t) => (t || '').replace(/\n?STATUS:\s*\w+\s*$/i, '')
