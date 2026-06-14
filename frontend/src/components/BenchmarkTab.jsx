import { useEffect, useState } from 'react'
import { api } from '../api.js'

const fmt = (ms) =>
  ms == null ? '—'
  : ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
  : `${(ms / 1000).toFixed(1)}s`

export default function BenchmarkTab() {
  const [data, setData] = useState(null)
  const [running, setRunning] = useState(null)

  const load = () => api.benchResults().then(setData).catch(() => {})
  useEffect(() => { load() }, [])

  const run = async (scenario) => {
    setRunning(scenario)
    try { await api.benchRun(scenario); await load() } finally { setRunning(null) }
  }

  const by = (s) => data?.results?.find(r => r.scenario === s)

  return (
    <div style={{ padding: 'var(--s-6) var(--s-5)', maxWidth: 1100, margin: '0 auto' }}>

      {/* hero stats + run controls */}
      <div style={{ display: 'flex', gap: 'var(--s-7)', alignItems: 'flex-end', marginBottom: 'var(--s-6)' }}>
        <Stat label="p95 TTF · baseline" value={fmt(data?.ttf?.baseline?.p95_ms)} />
        <Stat label="p95 TTF · live sync" value={fmt(data?.ttf?.live?.p95_ms)} green />
        <div style={{ flex: 1 }} />

        {/* run buttons — right-aligned group */}
        <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
          {[
            ['mechanism_b', 'Mechanism B'],
            ['mechanism_a', 'Mechanism A'],
            ['control',     'Control'],
          ].map(([s, label]) => (
            <button
              key={s}
              className="btn-ghost"
              onClick={() => run(s)}
              disabled={!!running}
              style={{
                border: '1px solid var(--border-strong)',
                background: running === s ? 'var(--bg-page)' : 'var(--bg-card)',
                borderRadius: 'var(--radius)',
                padding: '6px 13px',
                fontSize: 'var(--fs-12)',
                color: running === s ? 'var(--text-3)' : 'var(--text-2)',
                opacity: running && running !== s ? 0.5 : 1,
                transition: 'opacity var(--duration-fast) var(--ease)',
              }}
            >
              {running === s ? 'running…' : `run ${label}`}
            </button>
          ))}
        </div>
      </div>

      <ChartCard
        title="Mechanism B — payload drift"
        subtitle="status flips · retrieval stays flat; answer correctness collapses — the headline failure"
        result={by('mechanism_b')}
      />
      <ChartCard
        title="Mechanism A — retrieval drift"
        subtitle="runbook rewrites · both retrieval and correctness degrade together"
        result={by('mechanism_a')}
      />
      <ChartCard
        title="Control — zero staleness"
        subtitle="live mode, fully fresh · establishes the fresh-but-wrong floor"
        result={by('control')}
      />
    </div>
  )
}

function Stat({ label, value, green }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-11)', color: 'var(--text-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
        {label}
      </div>
      <div className="mono" style={{
        fontSize: 'var(--fs-26)', fontWeight: 500, lineHeight: 1,
        color: green ? 'var(--green-text)' : 'var(--text-1)',
      }}>
        {value}
      </div>
    </div>
  )
}

function ChartCard({ title, subtitle, result }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--s-5)',
      marginBottom: 'var(--s-5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
        <div style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--text-1)' }}>
          {title}
        </div>
        {/* top-right legend — no overlapping text at any values */}
        <div style={{ display: 'flex', gap: 'var(--s-4)', flexShrink: 0, marginLeft: 'var(--s-4)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-11h)', color: 'var(--green-text)' }}>
            <span style={{ width: 10, height: 2, background: 'var(--green)', display: 'inline-block', borderRadius: 1, flexShrink: 0 }} />
            retrieval health
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-11h)', color: 'var(--red-text)' }}>
            <span style={{ width: 10, height: 2, background: 'var(--red)', display: 'inline-block', borderRadius: 1, flexShrink: 0 }} />
            answer correctness
          </span>
        </div>
      </div>
      <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', marginBottom: 'var(--s-4)' }}>
        {subtitle}
      </div>
      {result?.curve?.length
        ? <DivergenceChart curve={result.curve} />
        : (
          <div style={{ padding: 'var(--s-6) 0', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-12)' }}>
              Run the scenario to see the divergence chart
            </div>
          </div>
        )}
    </div>
  )
}

/* Hand-rolled SVG — legend moved to card header, no in-chart text collision */
function DivergenceChart({ curve }) {
  const W = 760, H = 240, PAD_L = 48, PAD_R = 16, PAD_T = 16, PAD_B = 40
  const xs = curve.map(c => c.lag_s)
  const maxX = Math.max(...xs, 1)
  const x = (v) => PAD_L + (v / maxX) * (W - PAD_L - PAD_R)
  const y = (pct) => PAD_T + (1 - pct / 100) * (H - PAD_T - PAD_B)
  const path = (key) => curve.map((c, i) => `${i ? 'L' : 'M'}${x(c.lag_s)},${y(c[key])}`).join(' ')

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {/* grid lines */}
      {[0, 25, 50, 75, 100].map(p => (
        <g key={p}>
          <line
            x1={PAD_L} x2={W - PAD_R}
            y1={y(p)} y2={y(p)}
            stroke={p === 0 ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.05)'}
            strokeWidth={1}
            strokeDasharray={p === 0 ? '' : '3 5'}
          />
          <text x={PAD_L - 8} y={y(p) + 4} textAnchor="end" fontSize="11"
            fill="var(--text-3)" fontFamily="var(--font-mono)">{p}%</text>
        </g>
      ))}

      {/* x-axis labels */}
      {xs.map(v => (
        <text key={v} x={x(v)} y={H - PAD_B + 18} textAnchor="middle" fontSize="11"
          fill="var(--text-3)" fontFamily="var(--font-mono)">{v}s</text>
      ))}
      <text x={(PAD_L + W - PAD_R) / 2} y={H - 4} textAnchor="middle" fontSize="11"
        fill="var(--text-3)" fontFamily="var(--font-ui)">staleness lag (s)</text>

      {/* series lines */}
      <path d={path('retrieval_pct')}   fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d={path('correctness_pct')} fill="none" stroke="var(--red)"   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
