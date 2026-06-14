import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import CommandBar from './components/CommandBar.jsx'
import DivergenceView from './components/DivergenceView.jsx'
import BenchmarkTab from './components/BenchmarkTab.jsx'

export default function App() {
  const [tab, setTab] = useState('live')
  const [mode, setMode] = useState('baseline')
  const [services, setServices] = useState([])
  const [ttf, setTtf] = useState(null)
  const [tick, setTick] = useState(0)
  const fetchedAt = useRef(Date.now())

  const refresh = useCallback(async () => {
    try {
      const [svc, m, bench] = await Promise.all([api.services(), api.mode(), api.benchResults()])
      fetchedAt.current = Date.now()
      setServices(svc)
      setMode(m.mode)
      setTtf(bench.ttf)
    } catch { /* backend not up yet — UI stays calm */ }
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const es = api.events()
    es.onmessage = () => refresh()
    const poll = setInterval(refresh, 5000)
    const heartbeat = setInterval(() => setTick(t => t + 1), 1000)
    return () => { es.close(); clearInterval(poll); clearInterval(heartbeat) }
  }, [refresh])

  const extraSeconds = Math.floor((Date.now() - fetchedAt.current) / 1000)
  const switchMode = async (m) => { await api.setMode(m); refresh() }
  const rebuild    = async () => { await api.rebuild(); refresh() }

  return (
    <div>
      <CommandBar mode={mode} onMode={switchMode} ttf={ttf} onRebuild={rebuild} />

      {/* tab strip */}
      <nav style={{
        display: 'flex', gap: 0,
        padding: '0 var(--s-5)',
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
      }}>
        {[['live', 'Live demo'], ['bench', 'Benchmark']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              background: 'none', border: 'none',
              padding: 'var(--s-3) var(--s-2)',
              marginRight: 'var(--s-4)',
              fontSize: 'var(--fs-13)',
              fontWeight: tab === k ? 600 : 400,
              color:      tab === k ? 'var(--text-1)' : 'var(--text-3)',
              borderBottom: tab === k ? '2px solid var(--text-1)' : '2px solid transparent',
              transition: 'color var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease)',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'live'
        ? <DivergenceView services={services} mode={mode} extraSeconds={extraSeconds} onChanged={refresh} />
        : <BenchmarkTab />}
    </div>
  )
}
