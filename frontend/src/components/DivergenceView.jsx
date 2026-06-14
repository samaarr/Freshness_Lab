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

/* ── animation steps for each data-path scenario ────────── */
const FLOW_STEPS = {
  'factual-live': [
    { node: 'fact-card',     caption: 'status changed',                                          ms: 450 },
    { node: 'snap-bypassed', caption: 'snapshot bypassed — live mode re-reads field directly',   ms: 500 },
    { node: 'fork-right',    caption: 're-read live field → answer correct',                     ms: 450 },
  ],
  'factual-baseline': [
    { node: 'fact-card',     caption: 'status changed',                                          ms: 450 },
    { node: 'snap-stale',    caption: 'snapshot not updated — baseline queues the change',       ms: 650 },
  ],
  'semantic': [
    { node: 'recipe-card',   caption: 'runbook_text changed',                                    ms: 450 },
    { node: 'vector-card',   caption: 're-embed fired → new vector in index',                    ms: 500 },
  ],
  'switch-live': [
    { node: 'snap-bypassed', caption: 'live mode — agent bypasses snapshot, re-reads live field', ms: 650 },
  ],
  'switch-baseline': [
    { node: 'snap-stale',    caption: 'baseline mode — snapshot served as-is until rebuild',     ms: 650 },
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

/* one card anatomy — 1px hairline everywhere */
const card = {
  background:   'var(--bg-card)',
  border:       '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding:      'var(--card-pad)',
}
const cardTitle = { fontWeight: 600, fontSize: 'var(--fs-15)' }
const cardBody  = { fontSize: 'var(--fs-13h)', color: 'var(--text-2)', lineHeight: 1.5 }
const techCap   = { fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginTop: 'var(--s-4)', lineHeight: 1.5 }
const whisper   = { fontSize: 'var(--fs-12)', color: 'var(--text-3)', fontStyle: 'italic', marginTop: 'var(--s-2)' }

/* ── main component ──────────────────────────────────────── */
export default function DivergenceView({ services, mode, extraSeconds, onChanged }) {
  const dish = services.find((s) => s.name === DISH) || services[0] || {}
  const [thread, setThread]   = useState([])
  const [busy, setBusy]       = useState(false)
  const [inspect, setInspect] = useState(null)
  const [q, setQ]             = useState('')

  /* animation state: which pipeline node is currently lit */
  const [flow, setFlow]       = useState({ node: null, caption: '' })
  const flowTimers            = useRef([])

  const rawBehind = dish.facts_behind_s
  const behind    = rawBehind == null ? null : rawBehind + (extraSeconds || 0)
  const stale     = behind != null && behind > 0
  const live      = mode === 'live'

  /* latest answered question */
  const last     = [...thread].reverse().find((m) => m.role === 'agent' && m.provenance)
  const prov     = last?.provenance
  const provText = last?.text

  /* fork state: based on latest prov */
  const hasProv      = !!prov
  const forkDiverged = hasProv && prov.context_status !== prov.truth_status

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

  /* ── Task 1: mode-boundary divider + Task 2: mode animation ─
     skip the initial mount — only react to real mode changes   */
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    setThread(t => t.length > 0 ? [...t, { role: 'divider', toMode: mode }] : t)
    runFlow(mode === 'live' ? FLOW_STEPS['switch-live'] : FLOW_STEPS['switch-baseline'])
  }, [mode, runFlow])

  /* ── node ring helper (subtle 2px ring + outer glow) ────── */
  const ring = (node, color = 'green') => {
    if (flow.node !== node) return { boxShadow: 'none', transition: 'box-shadow 300ms var(--ease)' }
    const stroke = { green: '#1d9e75', red: '#e24b4a', grey: 'rgba(0,0,0,0.25)' }[color]
    const glow   = { green: 'rgba(29,158,117,0.10)', red: 'rgba(226,75,74,0.08)', grey: 'rgba(0,0,0,0.04)' }[color]
    return { boxShadow: `0 0 0 2px ${stroke}, 0 0 14px ${glow}`, transition: 'box-shadow 150ms var(--ease)' }
  }

  /* snapshot card: stale = red ring; bypassed = grey ring + dim */
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
    runFlow(FLOW_STEPS['semantic'])
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

  /* ── Task 1: find the last divider — messages before it recede ─ */
  const lastDivIdx = thread.reduce((acc, m, i) => m.role === 'divider' ? i : acc, -1)

  /* ── render ────────────────────────────────────────────── */
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '0 var(--s-5) var(--s-7)' }}>

      {/* ── intro sentence ───────────────────────────────── */}
      <p style={{
        marginTop: 'var(--s-5)', marginBottom: 0,
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

        {/* stored fact — lights up on factual change */}
        <div style={{ ...card, ...ring('fact-card') }}>
          <div style={cardTitle}>Change a stored fact</div>
          <div style={whisper}>(the dish sells out)</div>
          <div style={{ marginTop: 'var(--s-4)' }}>
            <SegmentedControl
              options={AVAIL_OPTIONS}
              value={dish.status || 'available'}
              onChange={setAvailability}
              mono
            />
          </div>
          <div style={techCap}>
            <Id>status</Id> field · mechanism B · snapshot refreshes, no re-embed
          </div>
        </div>

        {/* semantic text — lights up on recipe change */}
        <div style={{ ...card, ...ring('recipe-card') }}>
          <div style={cardTitle}>Change the semantic text</div>
          <div style={whisper}>(the chef rewrites the description)</div>
          <div style={{ marginTop: 'var(--s-4)' }}>
            <Listbox
              options={RECIPE_OPTIONS}
              placeholder="choose a recipe rewrite…"
              onSelect={setRecipe}
            />
          </div>
          <div style={techCap}>
            <Id>runbook_text</Id> field · mechanism A · re-embed → new vector
          </div>
        </div>

      </div>

      {/* TwoHairlines doubles as animation caption display */}
      <TwoHairlines caption={flow.caption} />

      {/* ════════════════════════════════════════════════════
          2 · TWO THINGS SHOULD UPDATE — ONLY ONE DID
      ════════════════════════════════════════════════════ */}
      <Eyebrow n="2" label="Two things should update — only one did" />

      <div className="two-col">

        {/* served value: snapshot_text — lights up red (stale) or dim (bypassed) */}
        <div style={{
          ...card,
          borderColor: (stale && !live) ? 'rgba(226,75,74,0.4)' : 'var(--border)',
          transition: 'border-color var(--duration-heal) var(--ease)',
          ...snapFlowStyle,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s-4)' }}>
            <div>
              <div style={cardTitle}>Served value</div>
              <div className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginTop: 2 }}>snapshot_text</div>
            </div>

            {stale ? (
              <div className="status-transition" style={{
                flexShrink: 0, textAlign: 'center',
                background: live ? 'var(--bg-page)' : 'var(--red-bg)',
                border: `1px solid ${live ? 'var(--border)' : 'rgba(226,75,74,0.25)'}`,
                borderRadius: 'var(--radius)', padding: '6px 10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke={live ? 'var(--text-3)' : 'var(--red)'}
                    strokeWidth="1.75" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>
                  </svg>
                  <span className="mono" style={{
                    fontSize: 'var(--fs-20)', fontWeight: 600, lineHeight: 1,
                    color: live ? 'var(--text-3)' : 'var(--red)',
                  }}>
                    {fmtBehind(behind)}
                  </span>
                </div>
                <div style={{ fontSize: 10, marginTop: 2, letterSpacing: '0.03em',
                  color: live ? 'var(--text-3)' : 'var(--red-text)' }}>
                  stale
                </div>
              </div>
            ) : (
              <div className="status-transition" style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginTop: 2 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
                <span style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)' }}>current</span>
              </div>
            )}
          </div>

          <div style={{ ...cardBody, marginTop: 'var(--s-4)' }}>
            {stale && live
              ? <>Snapshot is {fmtBehind(behind)} old and still stale — but in live mode the agent re-reads the <Id>status</Id> field directly, bypassing it.</>
              : stale
                ? `Snapshot is ${fmtBehind(behind)} old. This is the embed-time value a naive pipeline hands the model.`
                : 'What a naive pipeline hands the model.'}
          </div>
          <div style={whisper}>(the waiter's pre-written note card)</div>
        </div>

        {/* vector index: embedding — lights up green on semantic change */}
        <div style={{ ...card, ...ring('vector-card') }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s-4)' }}>
            <div>
              <div style={cardTitle}>Vector index</div>
              <div className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginTop: 2 }}>
                embedding → Atlas Vector Search
              </div>
            </div>
            <span className="mono status-transition" style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
              background: 'var(--green-bg)', color: 'var(--green-text)',
              border: '1px solid rgba(29,158,117,0.2)',
              borderRadius: 'var(--radius-sm)', padding: '4px 9px',
              fontSize: 'var(--fs-11h)',
            }}>
              <Check size={10} strokeWidth={2.5} />
              {prov ? `found ${prov.retrieved_doc} · ${prov.similarity_score}` : 'healthy'}
            </span>
          </div>
          <div style={{ ...cardBody, marginTop: 'var(--s-4)' }}>
            A status flip barely moves the vector, so <Id>$vectorSearch</Id> still finds the right document.
          </div>
          <div style={whisper}>(the waiter still recognises which dish you mean)</div>
          <div style={techCap}>
            index on the <Id>embedding</Id> field · identical in both modes
          </div>
        </div>

      </div>

      <SingleHairline />

      {/* ════════════════════════════════════════════════════
          3 · THE DIVERGENCE — the proof in one frame
      ════════════════════════════════════════════════════ */}
      <Eyebrow n="3" label="The divergence" />

      <div style={card}>

        <div style={{ fontWeight: 600, fontSize: 'var(--fs-20)', marginBottom: 'var(--s-4)' }}>
          Same question · same retrieval
        </div>

        {/* shared retrieval bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
          padding: '9px var(--s-4)',
          background: 'var(--green-bg)',
          border: '1px solid rgba(29,158,117,0.2)',
          borderRadius: 'var(--radius)',
          marginBottom: 'var(--s-5)',
        }}>
          <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)' }}>
            $vectorSearch
          </span>
          <ChevronRight size={11} strokeWidth={1.75} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <span className="mono" style={{ fontSize: 'var(--fs-13h)', fontWeight: 500, color: 'var(--green-text)', flex: 1 }}>
            {hasProv
              ? `found ${prov.retrieved_doc} · ${prov.similarity_score}`
              : 'finds the right document by meaning — ask below to see'}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <Check size={11} strokeWidth={2.5} style={{ color: 'var(--green-text)' }} />
            <span style={{ fontSize: 'var(--fs-11h)', color: 'var(--green-text)', fontWeight: 500 }}>
              retrieval healthy
            </span>
          </span>
        </div>

        {/* fork columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-4)' }}>

          <ForkColumn
            heading="Read the stored snapshot"
            tech="snapshot_text · embed-time value"
            status={hasProv ? prov.context_status : null}
            ok={hasProv ? !forkDiverged : null}
            verdictLine={hasProv
              ? (forkDiverged
                  ? `✗  WRONG · snapshot ${fmtBehind(prov.snapshot_age_s)} stale`
                  : '✓  CORRECT · snapshot current')
              : null}
            body={hasProv
              ? (!prov.live_read
                  ? provText
                  : 'Agent re-reads the live field in this mode — snapshot not used.')
              : null}
            bodyMono={hasProv && prov.live_read}
          />

          {/* RIGHT fork — lights up on fork-right animation step */}
          <ForkColumn
            heading="Re-read the live field"
            tech="status · current field value"
            status={hasProv ? prov.truth_status : null}
            ok={hasProv ? true : null}
            verdictLine={hasProv ? '✓  CORRECT · payload fresh' : null}
            body={hasProv ? `status: ${prov.truth_status}` : null}
            bodyMono
            isRight
            isLit={flow.node === 'fork-right'}
          />

        </div>

        {/* punchline */}
        <div style={{
          marginTop: 'var(--s-5)', paddingTop: 'var(--s-4)',
          borderTop: '1px solid var(--border)',
          fontWeight: 600, fontSize: 'var(--fs-15)',
          color: forkDiverged ? 'var(--red-text)' : hasProv ? 'var(--green-text)' : 'var(--text-3)',
          transition: 'color var(--duration-heal) var(--ease)',
          lineHeight: 1.5,
        }}>
          {hasProv
            ? (forkDiverged
                ? "Retrieval is identical and green on both sides. Only the read path differs — the model didn't hallucinate, it was handed stale data."
                : 'Both paths agree — the answer is correct. Change the status and ask in baseline to see the fork diverge.')
            : 'Ask a question below — the fork fills in live from the response provenance.'}
        </div>

      </div>

      <SingleHairline />

      {/* ════════════════════════════════════════════════════
          4 · TRY IT
      ════════════════════════════════════════════════════ */}
      <Eyebrow n="4" label="Try it" />

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
              <span className="mono">{mode}</span> mode · the fork in section 3 updates after each answer
            </div>
          </div>
        </div>

        {/* thread — dividers + receded prior-mode messages */}
        <div style={{ padding: 'var(--s-4) var(--card-pad)', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)', minHeight: 80 }}>
          {thread.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-13h)' }}>
              Ask a question — then watch section 3 populate.
            </div>
          )}

          {thread.map((m, i) => {
            /* Task 1: messages before the last mode-divider recede to 45% */
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

            /* agent message */
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
                  border: `1px solid ${answerWrong(m.provenance) ? 'rgba(226,75,74,0.4)' : 'var(--border)'}`,
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

/* ── ForkColumn ──────────────────────────────────────────── */
function ForkColumn({ heading, tech, status, ok, verdictLine, body, bodyMono, isRight, isLit }) {
  const empty   = ok === null
  const correct = ok === true
  const wrong   = ok === false

  const ss = STATUS_MAP[status] || { bg: 'var(--bg-page)', fg: 'var(--text-3)' }

  const bg = empty
    ? 'var(--bg-page)'
    : correct ? 'rgba(29,158,117,0.06)' : 'rgba(226,75,74,0.05)'
  const border = empty
    ? 'var(--border)'
    : correct ? 'rgba(29,158,117,0.22)' : 'rgba(226,75,74,0.22)'

  const litStyle = isLit
    ? { boxShadow: '0 0 0 2px #1d9e75, 0 0 14px rgba(29,158,117,0.10)', transition: 'box-shadow 150ms var(--ease)' }
    : { boxShadow: 'none', transition: 'box-shadow 300ms var(--ease)' }

  return (
    <div className="status-transition" style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 'var(--radius)',
      padding: 'var(--s-4)',
      display: 'flex', flexDirection: 'column', gap: 'var(--s-3)',
      ...litStyle,
    }}>
      <div style={{ fontWeight: 600, fontSize: 'var(--fs-13h)', color: empty ? 'var(--text-3)' : 'var(--text-1)' }}>
        {heading}
      </div>
      <div className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)' }}>{tech}</div>

      {status ? (
        <span className="mono status-transition" style={{
          display: 'inline-flex', alignSelf: 'flex-start',
          fontSize: 'var(--fs-13h)', fontWeight: 500,
          padding: '3px 10px', borderRadius: 'var(--radius-sm)',
          background: ss.bg, color: ss.fg,
        }}>{status}</span>
      ) : (
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', fontStyle: 'italic' }}>
          {isRight ? 'current field value' : 'snapshot value'}
        </span>
      )}

      {verdictLine ? (
        <div className="mono" style={{
          fontSize: 'var(--fs-11h)', fontWeight: 600,
          color: wrong ? 'var(--red-text)' : 'var(--green-text)',
        }}>{verdictLine}</div>
      ) : (
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-3)', fontStyle: 'italic' }}>
          ask below — this fills in live
        </div>
      )}

      {body && (
        <div style={{
          borderTop: '1px solid rgba(0,0,0,0.06)',
          paddingTop: 'var(--s-2)',
          fontSize: bodyMono ? 'var(--fs-11h)' : 'var(--fs-13)',
          fontFamily: bodyMono ? 'var(--font-mono)' : 'var(--font-ui)',
          color: 'var(--text-2)', lineHeight: 1.5,
        }}>{body}</div>
      )}
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
function Eyebrow({ n, label, top }) {
  return (
    <div style={{
      fontSize: 'var(--fs-11h)',
      fontWeight: 600,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--text-2)',
      marginBottom: 'var(--s-4)',
      marginTop: top ? 'var(--s-5)' : 'var(--s-7)',
    }}>
      {n} · {label}
    </div>
  )
}

/* TwoHairlines doubles as animation caption display */
function TwoHairlines({ caption }) {
  return (
    <div className="two-hairlines" style={{ position: 'relative', alignItems: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
        <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
        <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />
      </div>
      {caption && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: '50%',
          transform: 'translateY(-50%)',
          textAlign: 'center',
          zIndex: 1,
          pointerEvents: 'none',
        }}>
          <span className="mono" style={{
            display: 'inline-block',
            background: 'var(--bg-page)',
            padding: '2px var(--s-3)',
            fontSize: 'var(--fs-11h)',
            color: 'var(--text-2)',
            whiteSpace: 'nowrap',
          }}>{caption}</span>
        </div>
      )}
    </div>
  )
}

function SingleHairline() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
      <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />
    </div>
  )
}
