import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import {
  FileText, ChevronRight, ChevronDown,
  X, Check, Loader2, SendHorizontal,
} from 'lucide-react'
import SegmentedControl from './SegmentedControl.jsx'
import Listbox from './Listbox.jsx'

/* ── constants ───────────────────────────────────────────── */
const DISH = 'risotto'

const RECIPE_OPTIONS = [
  {
    value: 'Risotto — creamy arborio rice slow-cooked with white wine and vegetable stock, finished with parmesan, saffron, and butter. Vegetarian.',
    label: 'Risotto — classic saffron (original)',
  },
  {
    value: 'Risotto — now finished with truffle oil and sautéed wild mushrooms instead of saffron. Vegetarian.',
    label: 'Risotto — truffle & wild mushroom',
  },
  {
    value: 'Risotto — now built on a peanut-based romesco sauce with roasted red pepper. Contains peanuts.',
    label: 'Risotto — peanut romesco (allergen alert)',
  },
  {
    value: 'Risotto — now made with a cauliflower base instead of rice, with lemon and herbs. Vegan, gluten-free.',
    label: 'Risotto — cauliflower base, vegan',
  },
]

const AVAIL_OPTIONS = [
  { value: 'available', label: 'available' },
  { value: 'limited',   label: 'limited'   },
  { value: 'sold_out',  label: 'sold_out'  },
]

/* ── animation steps ─────────────────────────────────────── */
const FLOW_STEPS = {
  'factual-live': [
    { node: 'fact-card',     caption: 'status changed',                                           ms: 900  },
    { node: 'snap-bypassed', caption: 'snapshot bypassed — live mode re-reads field directly',    ms: 1000 },
    { node: 'fork-right',    caption: 're-read live field → answer correct',                      ms: 900  },
  ],
  'factual-baseline': [
    { node: 'fact-card',     caption: 'status changed',                                           ms: 900  },
    { node: 'snap-stale',    caption: 'snapshot not updated — baseline queues the change',        ms: 1100 },
    { node: 'fork-left',     caption: 'stale snapshot served → answer wrong',                    ms: 900  },
  ],
  'semantic-live': [
    { node: 'recipe-card',   caption: 'runbook_text changed',                                     ms: 900  },
    { node: 'vector-card',   caption: 're-embed fired → new vector in index',                     ms: 1000 },
    { node: 'fork-right',    caption: 'fresh embedding, live re-read → correct',                  ms: 900  },
  ],
  'semantic-baseline': [
    { node: 'recipe-card',   caption: 'runbook_text changed',                                     ms: 900  },
    { node: 'vector-card',   caption: 're-embed queued — search_behind_s climbs until rebuild',   ms: 1100 },
    { node: 'fork-left',     caption: 'snapshot has old description until rebuild',               ms: 900  },
  ],
  'sweep': [
    { node: 'recipe-card', caption: 'auto-sweep: rebuilding all documents',    ms: 500 },
    { node: 'vector-card', caption: 're-embedding all descriptions',            ms: 600 },
    { node: 'fact-card',   caption: 'snapshots refreshed — staleness healed',  ms: 700 },
  ],
  'switch-live': [
    { node: 'snap-bypassed', caption: 'live mode — agent bypasses snapshot, re-reads live field', ms: 1000 },
    { node: 'fork-right',    caption: 'live path now active',                                     ms: 800  },
  ],
  'switch-baseline': [
    { node: 'snap-stale',    caption: 'baseline mode — snapshot served as-is until rebuild',      ms: 1000 },
    { node: 'fork-left',     caption: 'snapshot path now active',                                 ms: 800  },
  ],
}

/* ── helpers ─────────────────────────────────────────────── */
const fmtBehind = (s) => {
  if (s == null) return null
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  if (s >= 60)   return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return `0:${String(s).padStart(2, '0')}`
}

const stripStatus = (s) => (s || '').replace(/\n?STATUS:\s*\w+\s*$/i, '')

function answerWrong(p) {
  if (!p) return false
  return !p.live_read && p.context_status && p.truth_status && p.context_status !== p.truth_status
}

const Id = ({ children }) => (
  <span className="mono" style={{
    fontSize: 'inherit', background: 'rgba(0,0,0,0.04)',
    border: '0.5px solid var(--border-strong)',
    borderRadius: 3, padding: '0 4px',
  }}>{children}</span>
)

const STATUS_MAP = {
  available: { bg: 'var(--green-bg)', fg: 'var(--green-text)' },
  limited:   { bg: 'var(--amber-bg)', fg: 'var(--amber-text)' },
  sold_out:  { bg: 'var(--red-bg)',   fg: 'var(--red-text)'   },
}

const StatusPill = ({ status }) => {
  const ss = STATUS_MAP[status] || { bg: 'var(--bg-page)', fg: 'var(--text-3)' }
  return (
    <span className="mono status-transition" style={{
      fontSize: 'var(--fs-11h)', fontWeight: 500,
      padding: '1px 7px', borderRadius: 'var(--radius-sm)',
      background: ss.bg, color: ss.fg, flexShrink: 0,
    }}>{status || '—'}</span>
  )
}

/* one card anatomy */
const card = {
  background:   'var(--bg-card)',
  border:       '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding:      'var(--card-pad)',
}
const cardTitle = { fontWeight: 600, fontSize: 'var(--fs-15)' }
const cardBody  = { fontSize: 'var(--fs-13h)', color: 'var(--text-2)', lineHeight: 1.5 }
const whisper   = { fontSize: 'var(--fs-12)', color: 'var(--text-3)', fontStyle: 'italic', marginTop: 'var(--s-2)' }

/* ── main component ──────────────────────────────────────── */
export default function DivergenceView({
  services, mode, extraSeconds, onChanged, sweepTick,
  sweepOn, onSweepToggle, sweepCountdown, lastRebuildAgo,
}) {
  const dish = services.find((s) => s.name === DISH) || services[0] || {}
  const [thread, setThread]   = useState([])
  const [busy, setBusy]       = useState(false)
  const [inspect, setInspect] = useState(null)
  const [q, setQ]             = useState('')

  const [flow, setFlow]       = useState({ node: null, caption: '' })
  const flowTimers            = useRef([])

  const rawBehind = dish.facts_behind_s
  const stale     = rawBehind != null && rawBehind > 0
  const behind    = stale ? rawBehind + (extraSeconds || 0) : null
  const live      = mode === 'live'

  const rawSearch    = dish.search_behind_s
  const vectorStale  = rawSearch != null && rawSearch > 0
  const searchBehind = vectorStale ? rawSearch + (extraSeconds || 0) : null

  const embeddedAgoS = dish.embedded_at
    ? Math.floor((Date.now() - new Date(dish.embedded_at).getTime()) / 1000)
    : null

  /* latest answered question */
  const last     = [...thread].reverse().find((m) => m.role === 'agent' && m.provenance)
  const prov     = last?.provenance
  const provText = last?.text

  const hasProv        = !!prov
  const forkDiverged   = hasProv && prov.context_status !== prov.truth_status
  const versionDiverged = hasProv && prov.embedding_version_used !== dish.embedding_version

  /* ── animation runner ───────────────────────────────────── */
  const runFlow = useCallback((steps) => {
    flowTimers.current.forEach(clearTimeout)
    flowTimers.current = []
    let t = 0
    steps.forEach(({ node, caption, ms = 450 }) => {
      const id = setTimeout(() => setFlow({ node, caption: caption ?? '' }), t)
      flowTimers.current.push(id)
      t += ms
    })
    const id = setTimeout(() => setFlow({ node: null, caption: '' }), t)
    flowTimers.current.push(id)
  }, [])

  useEffect(() => () => flowTimers.current.forEach(clearTimeout), [])

  useEffect(() => {
    if (!sweepTick) return
    runFlow(FLOW_STEPS['sweep'])
  }, [sweepTick, runFlow])

  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    setThread(t => t.length > 0 ? [...t, { role: 'divider', toMode: mode }] : t)
    runFlow(mode === 'live' ? FLOW_STEPS['switch-live'] : FLOW_STEPS['switch-baseline'])
  }, [mode, runFlow])

  /* ── node ring helper ────────────────────────────────────── */
  const ring = (node, color = 'green') => {
    if (flow.node !== node) return { boxShadow: 'none', transition: 'box-shadow 300ms var(--ease)' }
    const stroke = { green: '#1d9e75', red: '#e24b4a', grey: 'rgba(0,0,0,0.25)' }[color]
    const glow   = { green: 'rgba(29,158,117,0.10)', red: 'rgba(226,75,74,0.08)', grey: 'rgba(0,0,0,0.04)' }[color]
    return { boxShadow: `0 0 0 2px ${stroke}, 0 0 14px ${glow}`, transition: 'box-shadow 150ms var(--ease)' }
  }

  const snapFlowStyle =
    flow.node === 'snap-stale'
      ? ring('snap-stale', 'red')
      : flow.node === 'snap-bypassed'
        ? { ...ring('snap-bypassed', 'grey'), opacity: 0.55, transition: 'all 200ms var(--ease)' }
        : {}

  /* ── handlers ───────────────────────────────────────────── */
  const setAvailability = async (status) => {
    runFlow(live ? FLOW_STEPS['factual-live'] : FLOW_STEPS['factual-baseline'])
    await api.patchService(DISH, { status })
    onChanged()
  }

  const setRecipe = async (text) => {
    if (!text) return
    runFlow(live ? FLOW_STEPS['semantic-live'] : FLOW_STEPS['semantic-baseline'])
    await api.patchService(DISH, { runbook_text: text })
    onChanged()
  }

  const ask = async (question) => {
    if (busy) return
    setBusy(true)
    setThread((t) => [...t, { role: 'user', text: question, msgMode: mode }])
    try {
      const res = await api.ask(question)
      setThread((t) => [...t, { role: 'agent', text: stripStatus(res.answer), provenance: res.provenance, msgMode: mode }])
    } catch (e) {
      setThread((t) => [...t, { role: 'agent', text: `Could not answer: ${e.message}`, provenance: null, msgMode: mode }])
    } finally { setBusy(false) }
  }

  const handleSend = () => {
    if (!q.trim() || busy) return
    ask(q.trim())
    setQ('')
  }

  const lastDivIdx = thread.reduce((acc, m, i) => m.role === 'divider' ? i : acc, -1)

  /* ── render ────────────────────────────────────────────── */
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 var(--s-5) var(--s-7)' }}>

      {/* ── intro ────────────────────────────────────────── */}
      <p style={{
        marginTop: 'var(--s-4)', marginBottom: 0,
        fontSize: 'var(--fs-13h)', color: 'var(--text-2)', lineHeight: 1.65, maxWidth: 700,
      }}>
        When a stored fact changes, the document's served value and its vector embedding must both stay in sync.
        Vector search can still find the right document while the value it returns is stale — a confidently wrong answer that retrieval metrics never catch.
      </p>

      {/* ════════════════════════════════════════════════════
          1 · A FACT CHANGES
      ════════════════════════════════════════════════════ */}
      <Eyebrow n="1" label="A fact changes" top />

      <div className="two-col">

        <div style={{ ...card, ...ring('fact-card') }}>
          <div style={cardTitle}>Change a stored fact</div>
          <div style={whisper}>(the dish sells out)</div>
          <div style={{ marginTop: 'var(--s-4)' }}>
            <SegmentedControl options={AVAIL_OPTIONS} value={dish.status || 'available'} onChange={setAvailability} mono />
          </div>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginTop: 'var(--s-4)' }}>
            <Id>status</Id> field · mechanism B · snapshot refreshes, no re-embed
          </div>
        </div>

        <div style={{ ...card, ...ring('recipe-card') }}>
          <div style={cardTitle}>Change the semantic text</div>
          <div style={whisper}>(the chef rewrites the description)</div>
          <div style={{ marginTop: 'var(--s-4)' }}>
            <Listbox options={RECIPE_OPTIONS} placeholder="choose a recipe rewrite…" onSelect={setRecipe} />
          </div>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginTop: 'var(--s-4)' }}>
            <Id>runbook_text</Id> field · mechanism A · re-embed → new vector
          </div>
        </div>

      </div>

      <TwoHairlines caption={flow.caption} />

      {/* ════════════════════════════════════════════════════
          2 · TWO THINGS SHOULD UPDATE — ONLY ONE DID
      ════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 'var(--s-4)', flexWrap: 'wrap',
        marginTop: 'var(--s-5)', marginBottom: 'var(--s-4)',
      }}>
        <Eyebrow n="2" label="Two things should update — only one did" inline />
        {mode === 'baseline' && (
          <BaselineSweepButton
            sweepOn={sweepOn}
            onToggle={onSweepToggle}
            sweepCountdown={sweepCountdown}
            lastRebuildAgo={lastRebuildAgo}
          />
        )}
      </div>

      <div className="two-col">

        {/* ── LEFT: Served value (Mechanism B) ─────────── */}
        <div style={{
          ...card,
          borderColor: (stale && !live) ? 'var(--red-border-strong)' : 'var(--border)',
          transition: 'border-color var(--duration-heal) var(--ease)',
          ...snapFlowStyle,
        }}>
          {/* header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s-4)' }}>
            <div>
              <div style={cardTitle}>Served value</div>
              <div className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginTop: 2 }}>snapshot_text</div>
            </div>
            {stale ? (
              <div className="status-transition" style={{
                flexShrink: 0, textAlign: 'center',
                background: live ? 'var(--bg-page)' : 'var(--red-bg)',
                border: `1px solid ${live ? 'var(--border)' : 'var(--red-border)'}`,
                borderRadius: 'var(--radius)', padding: '6px 10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke={live ? 'var(--text-3)' : 'var(--red)'}
                    strokeWidth="1.75" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
                  </svg>
                  <span className="mono" style={{ fontSize: 'var(--fs-20)', fontWeight: 600, lineHeight: 1,
                    color: live ? 'var(--text-3)' : 'var(--red)' }}>
                    {fmtBehind(behind)}
                  </span>
                </div>
                <div style={{ fontSize: 10, marginTop: 2, letterSpacing: '0.03em',
                  color: live ? 'var(--text-3)' : 'var(--red-text)' }}>stale</div>
              </div>
            ) : (
              <div className="status-transition" style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginTop: 2 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
                <span style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)' }}>current</span>
              </div>
            )}
          </div>

          {/* retrieval spine — one compact mono line */}
          <div style={{ marginTop: 'var(--s-4)' }}>
            {hasProv ? (
              <div className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', lineHeight: 1.55 }}>
                $vectorSearch → found {prov.retrieved_doc} · {prov.similarity_score} · embedding v{prov.embedding_version_used}
                <span style={{ color: 'var(--border-strong)' }}> · </span>
                retrieval healthy — found either way; only the read differs.
              </div>
            ) : (
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', fontStyle: 'italic' }}>
                {stale && !live
                  ? <>Snapshot {fmtBehind(behind)} old — a fact changed and baseline hasn't rebuilt.</>
                  : 'What a naive pipeline hands the model.'}
              </div>
            )}
          </div>

          {/* before/after READ — two compact rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 'var(--s-3)' }}>
            {hasProv ? (
              <>
                {/* stale row — snapshot path */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                  background: forkDiverged ? 'rgba(226,75,74,0.05)' : 'rgba(29,158,117,0.04)',
                  border: `1px solid ${forkDiverged ? 'var(--red-border)' : 'var(--green-border)'}`,
                  borderRadius: 'var(--radius-sm)',
                  ...ring('fork-left', 'red'),
                }}>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    read snapshot_text
                  </span>
                  <ChevronRight size={10} strokeWidth={1.75} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                  <StatusPill status={prov.context_status} />
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', flex: 1 }}>
                    {prov.snapshot_age_s != null ? `snapshot ${fmtBehind(prov.snapshot_age_s)} old` : ''}
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', fontWeight: 600, flexShrink: 0,
                    color: forkDiverged ? 'var(--red-text)' : 'var(--green-text)' }}>
                    {forkDiverged ? '✗  WRONG · stale value served' : '✓  CORRECT · snapshot current'}
                  </span>
                </div>

                {/* fresh row — live re-read path */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                  background: 'rgba(29,158,117,0.06)',
                  border: '1px solid var(--green-border)',
                  borderRadius: 'var(--radius-sm)',
                  ...ring('fork-right', 'green'),
                }}>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    re-read live field
                  </span>
                  <ChevronRight size={10} strokeWidth={1.75} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                  <StatusPill status={prov.truth_status} />
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', flex: 1 }}>
                    {prov.ttf_ms != null ? `synced in ${prov.ttf_ms} ms` : 'read at query time'}
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', fontWeight: 600, color: 'var(--green-text)', flexShrink: 0 }}>
                    ✓  CORRECT · payload fresh
                  </span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', fontStyle: 'italic', padding: '4px 0' }}>
                change a fact above, then ask in section 3 — the read story fills in here
              </div>
            )}
          </div>

          <div style={{ ...whisper, marginTop: 'var(--s-3)' }}>(the waiter's pre-written note card)</div>
        </div>

        {/* ── RIGHT: Vector index (Mechanism A) ────────── */}
        <div style={{
          ...card,
          borderColor: vectorStale ? 'var(--red-border-strong)' : 'var(--border)',
          transition: 'border-color var(--duration-heal) var(--ease)',
          ...ring('vector-card'),
        }}>
          {/* header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s-4)' }}>
            <div>
              <div style={cardTitle}>Vector index</div>
              <div className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginTop: 2 }}>
                embedding → Atlas Vector Search
              </div>
            </div>
            {vectorStale ? (
              <div className="status-transition" style={{
                flexShrink: 0, textAlign: 'center',
                background: 'var(--red-bg)', border: '1px solid var(--red-border)',
                borderRadius: 'var(--radius)', padding: '6px 10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke="var(--red)" strokeWidth="1.75" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
                  </svg>
                  <span className="mono" style={{ fontSize: 'var(--fs-20)', fontWeight: 600, lineHeight: 1, color: 'var(--red)' }}>
                    {fmtBehind(searchBehind)}
                  </span>
                </div>
                <div style={{ fontSize: 10, marginTop: 2, letterSpacing: '0.03em', color: 'var(--red-text)' }}>stale</div>
              </div>
            ) : (
              <div className="status-transition" style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginTop: 2 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
                <span style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)' }}>in sync</span>
              </div>
            )}
          </div>

          {/* live metrics */}
          <div style={{ marginTop: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-2)' }}>
              v{dish.embedding_version ?? '—'}
              {embeddedAgoS != null && <span style={{ color: 'var(--text-3)' }}> · re-embedded {fmtBehind(embeddedAgoS)} ago</span>}
              {dish.embed_ms != null && <span style={{ color: 'var(--text-3)' }}> · last recompute {dish.embed_ms} ms</span>}
            </div>
            <div className="mono" style={{
              fontSize: 'var(--fs-11h)', fontWeight: 600,
              color: dish.content_fresh === false ? 'var(--red-text)' : 'var(--green-text)',
            }}>
              {dish.content_fresh === false
                ? 'vector stale vs description ✗'
                : dish.content_fresh === true
                  ? 'vector matches current description ✓'
                  : '—'}
            </div>
          </div>

          {/* before/after EMBEDDING — two compact rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 'var(--s-3)' }}>
            {hasProv ? (
              <>
                {/* stale row — embedding used at query time */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                  background: versionDiverged ? 'rgba(226,75,74,0.05)' : 'rgba(29,158,117,0.04)',
                  border: `1px solid ${versionDiverged ? 'var(--red-border)' : 'var(--green-border)'}`,
                  borderRadius: 'var(--radius-sm)',
                }}>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    embedding v{prov.embedding_version_used}
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', flex: 1 }}>
                    {prov.similarity_score} · vector encodes the {versionDiverged ? 'old' : 'current'} description
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', fontWeight: 600, flexShrink: 0,
                    color: versionDiverged ? 'var(--red-text)' : 'var(--green-text)' }}>
                    {versionDiverged ? '✗  stale embedding' : '✓  current'}
                  </span>
                </div>

                {/* fresh row — current embedding state */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                  background: dish.content_fresh ? 'rgba(29,158,117,0.06)' : 'rgba(226,75,74,0.03)',
                  border: `1px solid ${dish.content_fresh ? 'var(--green-border)' : 'var(--red-border)'}`,
                  borderRadius: 'var(--radius-sm)',
                }}>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    re-embedded v{dish.embedding_version}
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', flex: 1 }}>
                    {dish.embed_ms != null ? `recompute ${dish.embed_ms} ms · ` : ''}vector matches current description
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', fontWeight: 600, flexShrink: 0,
                    color: dish.content_fresh ? 'var(--green-text)' : 'var(--red-text)' }}>
                    {dish.content_fresh ? '✓' : '✗  pending re-embed'}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', fontStyle: 'italic', padding: '4px 0' }}>
                change the description above, then ask in section 3 — fills in here
              </div>
            )}
          </div>

          <div style={{ ...cardBody, marginTop: 'var(--s-3)' }}>
            When the description (<Id>runbook_text</Id>) changes, the vector must be recomputed — until it does, search points at the old meaning.
          </div>
          <div style={whisper}>(the waiter still recognises which dish you mean)</div>
        </div>

      </div>

      <SingleHairline />

      {/* ════════════════════════════════════════════════════
          3 · TRY IT
      ════════════════════════════════════════════════════ */}
      <Eyebrow n="3" label="Try it" />

      <div style={{
        background: 'var(--bg-page)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* chat header */}
        <div style={{ padding: '12px var(--card-pad)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-15)' }}>RAG agent</div>
            <div style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)' }}>
              <span className="mono">{mode}</span> mode · answers update the section 2 cards above
            </div>
          </div>
        </div>

        {/* thread */}
        <div style={{ padding: 'var(--s-4) var(--card-pad)', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)', minHeight: 80 }}>
          {thread.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-13h)' }}>
              Ask a question — then watch the section 2 cards populate.
            </div>
          )}

          {thread.map((m, i) => {
            const receded = lastDivIdx >= 0 && i < lastDivIdx
            const fade    = { opacity: receded ? 0.45 : 1, transition: 'opacity var(--duration-heal) var(--ease)', filter: receded ? 'saturate(0.4)' : 'none' }

            if (m.role === 'divider') {
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', margin: 'var(--s-1) 0' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                    — switched to {m.toMode} —
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              )
            }

            if (m.role === 'user') {
              return (
                <div key={i} style={{
                  ...fade,
                  alignSelf: 'flex-end', maxWidth: '75%',
                  background: 'var(--text-1)', color: '#fff',
                  borderRadius: 'var(--radius)', borderBottomRightRadius: 'var(--radius-sm)',
                  padding: '9px 14px', fontSize: 'var(--fs-13h)', lineHeight: 1.45,
                }}>{m.text}</div>
              )
            }

            return (
              <div key={i} style={{ ...fade, display: 'flex', gap: 'var(--s-3)', alignItems: 'flex-start', alignSelf: 'flex-start', maxWidth: '80%' }}>
                <div style={{
                  flexShrink: 0, width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <FileText size={12} strokeWidth={1.75} style={{ color: 'var(--text-3)' }} />
                </div>
                <div style={{
                  background: 'var(--bg-card)',
                  border: `1px solid ${answerWrong(m.provenance) ? 'var(--red-border-strong)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)', borderTopLeftRadius: 'var(--radius-sm)',
                  padding: '9px 14px',
                  transition: 'border-color var(--duration-heal) var(--ease)',
                }}>
                  <div style={{ fontSize: 'var(--fs-13h)', lineHeight: 1.55 }}>{m.text}</div>
                  {m.provenance && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', gap: 'var(--s-4)',
                    }}>
                      <span className="mono" style={{
                        fontSize: 'var(--fs-11h)',
                        color: m.provenance.live_read ? 'var(--green-text)' : 'var(--amber-text)',
                      }}>
                        {m.provenance.live_read
                          ? 're-read live field · correct'
                          : `read snapshot_text · ${fmtBehind(m.provenance.snapshot_age_s) || ''} old`}
                      </span>
                      <button
                        className="link-quiet"
                        onClick={() => setInspect(m.provenance)}
                        style={{ border: 'none', background: 'none', color: 'var(--text-3)', fontSize: 'var(--fs-11h)', padding: 0, flexShrink: 0, cursor: 'pointer' }}
                      >
                        inspect →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {busy && (
            <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', alignSelf: 'flex-start' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Loader2 size={13} strokeWidth={1.75} className="spin" style={{ color: 'var(--text-3)' }} />
              </div>
              <span style={{ fontSize: 'var(--fs-13h)', color: 'var(--text-3)' }}>thinking…</span>
            </div>
          )}
        </div>

        {/* suggestion chips */}
        <div style={{ padding: 'var(--s-2) var(--card-pad)', display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
          {['Is the risotto available tonight?', "What's in the risotto?"].map((prompt) => (
            <button
              key={prompt}
              className="chip-pill"
              onClick={() => ask(prompt)}
              disabled={busy}
              style={{
                fontSize: 'var(--fs-13)', border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-pill)', padding: '5px 12px',
                background: 'var(--bg-card)', color: 'var(--text-2)',
                opacity: busy ? 0.4 : 1,
              }}
            >{prompt}</button>
          ))}
        </div>

        {/* input row */}
        <div style={{ padding: 'var(--s-3) var(--card-pad) var(--s-4)', display: 'flex', gap: 'var(--s-2)' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask anything about the menu…"
            style={{
              flex: 1, border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius)', padding: '9px 12px',
              background: 'var(--bg-card)', fontSize: 'var(--fs-13h)',
              transition: 'border-color var(--duration-fast) var(--ease)',
            }}
          />
          <button
            className="btn-primary"
            onClick={handleSend}
            disabled={busy || !q.trim()}
            style={{
              border: 'none', background: 'var(--text-1)', color: '#fff',
              borderRadius: 'var(--radius)', padding: '9px 14px',
              fontSize: 'var(--fs-13h)', fontWeight: 500,
              opacity: (busy || !q.trim()) ? 0.4 : 1,
              cursor: (busy || !q.trim()) ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              transition: 'opacity var(--duration-fast) var(--ease)',
            }}
          >
            <SendHorizontal size={14} strokeWidth={1.75} />
            Send
          </button>
        </div>
      </div>

      {inspect && <Drawer p={inspect} onClose={() => setInspect(null)} />}
    </div>
  )
}

/* ── Inspector drawer ────────────────────────────────────── */
function Drawer({ p, onClose }) {
  const wrong   = p.context_status && p.truth_status && p.context_status !== p.truth_status
  const age     = p.snapshot_age_s != null ? (fmtBehind(p.snapshot_age_s) ?? '—') : '—'
  const [vecOpen, setVecOpen] = useState(false)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,26,24,0.22)', backdropFilter: 'blur(1px)' }} />
      <aside
        className="inspector-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 460, maxWidth: '94vw',
          background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
          overflowY: 'auto', display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{ padding: 'var(--s-4) var(--card-pad)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-15)' }}>
            {wrong ? 'Why was this answer wrong?' : 'Answer provenance'}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center', width: 28, height: 28, borderRadius: 'var(--radius)' }}>
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        <div style={{ padding: 'var(--card-pad)', flex: 1 }}>
          <div style={{
            display: 'flex', gap: 'var(--s-4)', padding: '10px var(--s-4)',
            borderRadius: 'var(--radius)',
            background: wrong ? 'var(--red-bg)' : 'var(--green-bg)',
            marginBottom: 'var(--s-5)',
          }}>
            <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-11h)', color: 'var(--green-text)' }}>
              <Check size={12} strokeWidth={2.5} />
              retrieval healthy · {p.similarity_score}
            </span>
            {wrong && (
              <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-11h)', color: 'var(--red-text)' }}>
                <X size={12} strokeWidth={2.5} />
                payload stale · {age}
              </span>
            )}
          </div>

          <p style={{ fontSize: 'var(--fs-13h)', color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 var(--s-5)' }}>
            {wrong
              ? <>The agent found the right document, then read a <Id>snapshot_text</Id>{' '}
                  <span className="mono" style={{ color: 'var(--red-text)' }}>{age} behind</span>.
                  It reported faithfully — <strong>the data layer failed, not the model</strong>.</>
              : <>Retrieved <Id>{p.retrieved_doc}</Id> via <Id>$vectorSearch</Id>.{' '}
                  {p.live_read
                    ? <>Status re-read from the live <Id>status</Id> field at query time — always correct in live mode.</>
                    : <>Served from <Id>snapshot_text</Id> {age} old — consistent with current truth.</>}</>
            }
          </p>

          <div style={{ fontSize: 'var(--fs-11h)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 'var(--s-3)' }}>
            Agent used · current truth
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)', marginBottom: 'var(--s-5)' }}>
            {[
              { label: 'used by agent',  status: p.context_status, version: p.embedding_version_used, sub: `${age} ago`, subColor: wrong ? 'var(--red-text)' : 'var(--text-3)' },
              { label: 'current truth',  status: p.truth_status,   version: p.truth_version,          sub: 'live',       subColor: 'var(--green-text)' },
            ].map(({ label, status, version, sub, subColor }) => {
              const sty = STATUS_MAP[status] || STATUS_MAP.available
              return (
                <div key={label} style={{ background: 'var(--bg-page)', borderRadius: 'var(--radius)', padding: 'var(--s-4)' }}>
                  <div style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginBottom: 'var(--s-3)' }}>{label}</div>
                  <span className="mono status-transition" style={{ fontSize: 'var(--fs-11h)', fontWeight: 500, padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: sty.bg, color: sty.fg }}>{status}</span>
                  <div className="mono" style={{ fontSize: 'var(--fs-13)', color: 'var(--text-3)', marginTop: 'var(--s-3)' }}>v{version}</div>
                  <div className="mono" style={{ fontSize: 'var(--fs-13)', color: subColor, marginTop: 2 }}>{sub}</div>
                </div>
              )
            })}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s-4)' }}>
            <button
              onClick={() => setVecOpen((o) => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', padding: 0, fontSize: 'var(--fs-13h)', fontWeight: 500, color: 'var(--text-2)', cursor: 'pointer' }}
            >
              <ChevronDown size={14} strokeWidth={1.75} style={{ transform: vecOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--duration-fast) var(--ease)', color: 'var(--text-3)' }} />
              vector mechanics
            </button>
            {vecOpen && (
              <div style={{ marginTop: 'var(--s-4)', paddingLeft: 'var(--s-4)', borderLeft: '2px solid var(--border)', fontSize: 'var(--fs-13h)', color: 'var(--text-2)', lineHeight: 1.7 }}>
                Retrieved <Id>{p.retrieved_doc}</Id> via cosine search on the <Id>runbook_text</Id> embedding (v{p.embedding_version_used}) — recomputed only when the description changes (mechanism A).<br /><br />
                <Id>status</Id> is a structured field — <strong>never embedded</strong>. Live mode re-reads it at query time from the document.
                Baseline mode serves <Id>snapshot_text</Id> captured at embed time — this is the naive pattern that causes the divergence.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}

/* ── layout helpers ──────────────────────────────────────── */
const fmtSweepCountdown = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function BaselineSweepButton({ sweepOn, onToggle, sweepCountdown, lastRebuildAgo }) {
  const [tip, setTip] = useState(false)

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}
    >
      <button
        type="button"
        className="btn-ghost"
        onClick={onToggle}
        aria-pressed={sweepOn}
        aria-describedby="sweep-tip"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          border: `1px solid ${sweepOn ? 'rgba(186,117,23,0.35)' : 'var(--border)'}`,
          background: sweepOn ? 'var(--amber-bg)' : 'var(--bg-card)',
          borderRadius: 'var(--radius)',
          padding: '3px 10px',
          fontSize: 'var(--fs-12)',
          color: 'var(--text-2)',
          whiteSpace: 'nowrap',
          lineHeight: 1.4,
          transition: 'background var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease)',
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
          background: sweepOn ? 'var(--amber)' : 'var(--border-strong)',
          transition: 'background var(--duration-fast) var(--ease)',
        }} />
        <span style={{ fontWeight: 500, color: 'var(--text-1)' }}>
          {sweepOn ? 'Auto-sweep on' : 'Auto-sweep'}
        </span>
        <span className="mono" style={{ color: 'var(--text-3)' }}>60s</span>
        {sweepOn && (
          <span className="mono" style={{ color: 'var(--amber-text)' }}>
            · {fmtSweepCountdown(sweepCountdown)}
          </span>
        )}
        {lastRebuildAgo && (
          <span style={{ color: 'var(--text-3)' }}>
            · last <span className="mono">{lastRebuildAgo}</span>
          </span>
        )}
      </button>

      {tip && (
        <div
          id="sweep-tip"
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 20,
            width: 280,
            padding: '10px 12px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            fontSize: 'var(--fs-12)',
            color: 'var(--text-2)',
            lineHeight: 1.55,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>
            Baseline · periodic full rebuild
          </div>
          Re-embeds and re-snapshots every document. Data stays stale until the next sweep.
          <div style={{ marginTop: 6, color: 'var(--text-3)' }}>
            Click to toggle. Demo interval is 60s — real batch jobs usually run hourly or nightly.
          </div>
        </div>
      )}
    </div>
  )
}

function Eyebrow({ n, label, top, inline }) {
  return (
    <div style={{
      fontSize: 'var(--fs-11h)', fontWeight: 600, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: 'var(--text-2)',
      marginBottom: inline ? 0 : 'var(--s-4)',
      marginTop: inline ? 0 : (top ? 'var(--s-4)' : 'var(--s-5)'),
    }}>
      {n} · {label}
    </div>
  )
}

function TwoHairlines({ caption }) {
  return (
    <div className="two-hairlines" style={{ position: 'relative', alignItems: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
        <div style={{ width: 1, height: 14, background: 'var(--border-strong)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
        <div style={{ width: 1, height: 14, background: 'var(--border-strong)' }} />
      </div>
      {caption && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', transform: 'translateY(-50%)', textAlign: 'center', zIndex: 1, pointerEvents: 'none' }}>
          <span className="mono" style={{ display: 'inline-block', background: 'var(--bg-page)', padding: '2px var(--s-3)', fontSize: 'var(--fs-11h)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{caption}</span>
        </div>
      )}
    </div>
  )
}

function SingleHairline() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0' }}>
      <div style={{ width: 1, height: 14, background: 'var(--border-strong)' }} />
    </div>
  )
}
