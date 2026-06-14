/* One segmented-control component — reused for Baseline/Live and availability. */
export default function SegmentedControl({ options, value, onChange, mono = false }) {
  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-pill)',
      overflow: 'hidden',
      background: 'var(--bg-card)',
    }}>
      {options.map(({ value: v, label }) => (
        <button
          key={v}
          type="button"
          className="btn-seg"
          onClick={() => onChange(v)}
          style={{
            padding: '5px 13px',
            fontSize: mono ? 'var(--fs-11h)' : 'var(--fs-13h)',
            fontFamily: mono ? 'var(--font-mono)' : 'inherit',
            border: 'none',
            background: value === v ? 'var(--text-1)' : 'transparent',
            color:      value === v ? '#fff' : 'var(--text-2)',
            fontWeight: value === v ? 500 : 400,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
