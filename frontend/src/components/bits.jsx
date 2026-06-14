import { Clock } from 'lucide-react'

export const STATUS_STYLE = {
  available: { bg: 'var(--green-bg)', fg: 'var(--green-text)' },
  limited:   { bg: 'var(--amber-bg)', fg: 'var(--amber-text)' },
  sold_out:  { bg: 'var(--red-bg)',   fg: 'var(--red-text)'   },
  /* legacy */
  up:        { bg: 'var(--green-bg)', fg: 'var(--green-text)' },
  degraded:  { bg: 'var(--amber-bg)', fg: 'var(--amber-text)' },
  down:      { bg: 'var(--red-bg)',   fg: 'var(--red-text)'   },
}

export function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.available
  return (
    <span
      className="mono status-transition"
      style={{
        background: s.bg, color: s.fg,
        fontSize: 'var(--fs-11h)', fontWeight: 500,
        padding: '2px 8px', borderRadius: 'var(--radius-pill)',
      }}
    >
      {status}
    </span>
  )
}

export const fmtBehind = (s) =>
  s == null ? null
  : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  : s >= 60   ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  : `0:${String(s).padStart(2, '0')}`

/*
 * FreshnessChip — used in LiveDemo (not RestaurantFlow).
 * Synced → near-invisible dot. Stale → red clock + counter.
 */
export function FreshnessChip({ label, behindS, updatesBehind }) {
  if (behindS == null) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-13)', color: 'var(--text-3)' }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
        {label} synced
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
      <span className="mono status-transition" style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: 'var(--red-bg)', color: 'var(--red-text)',
        border: '1px solid rgba(226,75,74,0.25)',
        borderRadius: 'var(--radius-sm)', padding: '3px 8px',
        fontSize: 'var(--fs-13)', fontWeight: 500,
      }}>
        <Clock size={11} strokeWidth={2} />
        {label}
        <span style={{ fontWeight: 600 }}>{fmtBehind(behindS)}</span>
      </span>
      {updatesBehind > 0 && (
        <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--red-text)', paddingLeft: 2 }}>
          {updatesBehind} update{updatesBehind > 1 ? 's' : ''} pending
        </span>
      )}
    </span>
  )
}
