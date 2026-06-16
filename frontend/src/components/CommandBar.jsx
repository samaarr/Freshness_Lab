import SegmentedControl from './SegmentedControl.jsx'

/* Two-bar mark: short dim bar (stale) / tall green bar (fresh) */
function LogoMark() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="0" y="6" width="5" height="10" rx="1.5" fill="var(--border-strong)" />
      <rect x="9" y="0" width="5" height="16" rx="1.5" fill="var(--green)" />
      <path d="M5 11 L9 5" stroke="var(--border-strong)" strokeWidth="1" strokeLinecap="round" strokeDasharray="1.5 2" />
    </svg>
  )
}

const fmt = (ms) => {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${(ms / 1000).toFixed(1)}s`
}

const MODE_OPTIONS = [
  { value: 'baseline', label: 'Baseline' },
  { value: 'live',     label: 'Live sync' },
]

export default function CommandBar({
  mode, onMode, ttf, onRebuild,
  onReset,
}) {
  const current = ttf?.[mode]
  return (
    <header style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}>

      {/* ── main row ─────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 var(--s-5)', height: 56,
      }}>

        {/* wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <LogoMark />
          <span className="mono" style={{ fontWeight: 500, fontSize: 'var(--fs-14)', letterSpacing: '-0.01em', lineHeight: 1 }}>
            freshness-lab
          </span>
          <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-12)' }}>
            Vector retrieval stays healthy while the served answer goes stale.
          </span>
        </div>

        {/* controls + hero metric */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          {/* reset — always visible, small ghost */}
          <button
            className="btn-ghost"
            onClick={onReset}
            title="Re-embed all docs from current state and clear ledger history"
            style={{
              border: '1px solid var(--border)',
              background: 'none',
              borderRadius: 'var(--radius)',
              padding: '4px 10px',
              fontSize: 'var(--fs-12)',
              color: 'var(--text-3)',
            }}
          >
            ↺ reset demo
          </button>

          {/* rebuild — baseline only */}
          {mode === 'baseline' && (
            <button
              className="btn-ghost"
              onClick={onRebuild}
              style={{
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius)',
                padding: '5px 12px',
                fontSize: 'var(--fs-13)',
                color: 'var(--text-2)',
              }}
            >
              rebuild all · full sweep
            </button>
          )}

          <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={onMode} />

          {/* p95 TTF */}
          <div style={{ textAlign: 'right', minWidth: 100 }}>
            <div style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginBottom: 1 }}>
              p95 time-to-freshness · {mode}
            </div>
            <div
              className="mono status-transition"
              style={{
                fontSize: 'var(--fs-26)',
                fontWeight: 500,
                color: mode === 'live' ? 'var(--green-text)' : 'var(--text-1)',
                lineHeight: 1,
              }}
            >
              {fmt(current?.p95_ms)}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
