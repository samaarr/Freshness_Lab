import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

/*
 * Controlled listbox.
 * options:     [{ value, label }]
 * value:       currently selected value, or null/undefined for placeholder
 * placeholder: shown when value is null/undefined
 * onSelect(value) — called with the chosen value on every click, even re-selection
 */
export default function Listbox({ options, value, placeholder, onSelect }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const choose = (opt) => {
    onSelect(opt.value)
    setOpen(false)
  }

  const selected = value != null ? options.find(o => o.value === value) : null
  const displayText = selected ? selected.label : placeholder

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      {/* trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '7px 10px',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-card)',
          fontSize: 'var(--fs-13h)',
          color: selected ? 'var(--text-1)' : 'var(--text-3)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'border-color var(--duration-fast) var(--ease)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayText}
        </span>
        <ChevronDown
          size={13}
          strokeWidth={1.75}
          style={{
            color: 'var(--text-3)',
            flexShrink: 0,
            marginLeft: 6,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--duration-fast) var(--ease)',
          }}
        />
      </button>

      {/* dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          zIndex: 20,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          overflow: 'hidden',
        }}>
          {options.map((opt, i) => (
            <button
              key={i}
              type="button"
              onClick={() => choose(opt)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '9px 12px',
                border: 'none',
                borderBottom: i < options.length - 1 ? '1px solid var(--border)' : 'none',
                background: opt.value === value ? 'var(--bg-page)' : 'none',
                fontSize: 'var(--fs-13h)',
                color: 'var(--text-1)',
                cursor: 'pointer',
                lineHeight: 1.45,
                transition: 'background var(--duration-fast) var(--ease)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-page)' }}
              onMouseLeave={e => { e.currentTarget.style.background = opt.value === value ? 'var(--bg-page)' : 'none' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
