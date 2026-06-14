import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

/*
 * Styled listbox that always resets to placeholder after selection.
 * options: [{ value, label }]
 * onSelect(value) — called with the chosen value
 */
export default function Listbox({ options, placeholder, onSelect }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const choose = (value) => {
    onSelect(value)
    setOpen(false)
    // always resets — trigger always shows placeholder
  }

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
          color: 'var(--text-3)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'border-color var(--duration-fast) var(--ease)',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {placeholder}
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
              onClick={() => choose(opt.value)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '9px 12px',
                border: 'none',
                borderBottom: i < options.length - 1 ? '1px solid var(--border)' : 'none',
                background: 'none',
                fontSize: 'var(--fs-13h)',
                color: 'var(--text-1)',
                cursor: 'pointer',
                lineHeight: 1.45,
                transition: 'background var(--duration-fast) var(--ease)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-page)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
