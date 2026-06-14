import { useState, Fragment } from 'react'
import { api } from '../api.js'
import {
  Brain, FileText, RadioTower, ChevronRight, ChevronDown,
  X, Check, Loader2, Utensils, SendHorizontal,
} from 'lucide-react'
import SegmentedControl from './SegmentedControl.jsx'
import Listbox from './Listbox.jsx'

/* ── constants ───────────────────────────────────────────── */
const DISH = 'risotto'

/* Part 0 fix: every recipe rewrite begins with the dish name
   so the embedding stays anchored and retrieval doesn't drift. */
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

const PIPELINE_STEPS = ['change stream', 'watcher', 'route', 'ledger']

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

/* inline-code chip for identifiers inside prose captions */
const Id = ({ children }) => (
  <span className="mono" style={{
    fontSize: 'inherit', background: 'rgba(0,0,0,0.04)',
    border: '0.5px solid var(--border-strong)',
    borderRadius: 3, padding: '0 4px',
  }}>{children}</span>
)

/* ── main component ──────────────────────────────────────── */
export default function RestaurantFlow({ services, mode, extraSeconds, onChanged }) {
  const dish = services.find((s) => s.name === DISH) || services[0] || {}
  const [thread, setThread]   = useState([])
  const [busy, setBusy]       = useState(false)
  const [inspect, setInspect] = useState(null)
  const [q, setQ]             = useState('')

  const rawBehind = dish.facts_behind_s
  const behind    = rawBehind == null ? null : rawBehind + (extraSeconds || 0)
  const stale     = behind != null && behind > 0
  const live      = mode === 'live'

  /* always binds to the LATEST answered question's provenance */
  const last  = [...thread].reverse().find((m) => m.role === 'agent' && m.provenance)
  const prov  = last?.provenance
  const diverged = prov && prov.context_status && prov.truth_status
                && prov.context_status !== prov.truth_status

  /* ── handlers (unchanged logic) ───────────────────────── */
  const setAvailability = async (status) => { await api.patchService(DISH, { status }); onChanged() }
  const setRecipe       = async (text)   => { if (text) { await api.patchService(DISH, { runbook_text: text }); onChanged() } }

  const ask = async (question) => {
    if (busy) return
    setBusy(true)
    setThread((t) => [...t, { role: 'user', text: question }])
    try {
      const res = await api.ask(question)
      setThread((t) => [...t, { role: 'agent', text: stripStatus(res.answer), provenance: res.provenance }])
    } catch (e) {
      setThread((t) => [...t, { role: 'agent', text: `Could not answer: ${e.message}`, provenance: null }])
    } finally { setBusy(false) }
  }

  const handleSend = () => {
    if (!q.trim() || busy) return
    ask(q.trim())
    setQ('')
  }

  /* ── render ────────────────────────────────────────────── */
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '0 var(--s-5) var(--s-7)' }}>

      {/* ════════════════════════════════════════════════════
          1 · CHANGE SOMETHING REAL
      ════════════════════════════════════════════════════ */}
      <Eyebrow n="1" label="Change something real" top />

      <div className="two-col">

        {/* availability card */}
        <div style={card}>
          <div style={cardTitle}>
            {dish.status === 'sold_out' ? 'The risotto sold out'
              : dish.status === 'limited' ? 'Availability: limited'
              : 'Availability — change it here'}
          </div>
          <div style={cardBody}>A live fact changed — the note card needs one value updated. The waiter already knows the dish.</div>
          <div style={{ marginTop: 'var(--s-4)' }}>
            <SegmentedControl
              options={AVAIL_OPTIONS}
              value={dish.status || 'available'}
              onChange={setAvailability}
              mono
            />
          </div>
          <div style={techCap}>
            factual field flips → refresh stored value · no re-embed · mechanism B
          </div>
        </div>

        {/* recipe card */}
        <div style={card}>
          <div style={cardTitle}>The chef rewrote the risotto</div>
          <div style={cardBody}>The description's meaning changed — the waiter must re-read and re-memorise the whole dish.</div>
          <div style={{ marginTop: 'var(--s-4)' }}>
            <Listbox
              options={RECIPE_OPTIONS}
              placeholder="choose a recipe rewrite…"
              onSelect={setRecipe}
            />
          </div>
          <div style={techCap}>
            semantic text changed → recompute embedding · new vector · mechanism A
          </div>
        </div>

      </div>

      <TwoHairlines />

      {/* ════════════════════════════════════════════════════
          2 · WHERE THE WAITER KEEPS IT
      ════════════════════════════════════════════════════ */}
      <Eyebrow n="2" label="Where the waiter keeps it" />

      <div className="two-col">

        {/* note card — signature stale badge lives here */}
        <div style={{ ...card, borderColor: (stale && !live) ? 'rgba(226,75,74,0.4)' : 'var(--border)', transition: 'border-color var(--duration-heal) var(--ease)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s-4)' }}>
            <div>
              <div style={cardTitle}>The waiter's note card</div>
              <div className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginTop: 2 }}>snapshot_text</div>
            </div>

            {/* ── SIGNATURE STALE BADGE — mutes to neutral in live mode ── */}
            {stale ? (
              live ? (
                /* live mode: note is old but bypassed — muted, not alarming */
                <div className="status-transition" style={{
                  flexShrink: 0, textAlign: 'center',
                  background: 'var(--bg-page)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '6px 10px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
                    <span className="mono" style={{ fontSize: 'var(--fs-20)', fontWeight: 600, color: 'var(--text-3)', lineHeight: 1 }}>
                      {fmtBehind(behind)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2, letterSpacing: '0.03em' }}>bypassed</div>
                </div>
              ) : (
                /* baseline mode: full red alarm */
                <div className="status-transition" style={{
                  flexShrink: 0, textAlign: 'center',
                  background: 'var(--red-bg)',
                  border: '1px solid rgba(226,75,74,0.25)',
                  borderRadius: 'var(--radius)',
                  padding: '6px 10px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
                    <span className="mono" style={{ fontSize: 'var(--fs-20)', fontWeight: 600, color: 'var(--red)', lineHeight: 1 }}>
                      {fmtBehind(behind)}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--red-text)', marginTop: 2, letterSpacing: '0.03em' }}>behind</div>
                </div>
              )
            ) : (
              <div className="status-transition" style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, marginTop: 2 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
                <span style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)' }}>current</span>
              </div>
            )}
          </div>
          <div style={{ ...cardBody, marginTop: 'var(--s-4)' }}>
            {stale
              ? (live
                  ? `Note is ${fmtBehind(behind)} old — bypassed. Live mode reads fresh from the database.`
                  : `Still shows the value from ${fmtBehind(behind)} ago.`)
              : 'Currently matches the kitchen.'}
          </div>
          <div style={techCap}>
            field on the MongoDB services document · served as context in baseline via <Id>snapshot_text</Id>
          </div>
        </div>

        {/* vector search card */}
        <div style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s-4)' }}>
            <div>
              <div style={cardTitle}>The waiter's memory</div>
              <div className="mono" style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)', marginTop: 2 }}>Atlas Vector Search</div>
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
            How the waiter recognises which dish you mean — say "risotto" and it knows what to look up.
          </div>
          <div style={techCap}>
            index on the <Id>embedding</Id> field · queried with <Id>$vectorSearch</Id>
          </div>
        </div>

      </div>

      {/* ── sync lane (inset — it's an aside, not a story step) ── */}
      <div style={{ marginTop: 'var(--s-5)', marginLeft: 'var(--s-5)' }}>
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '14px var(--card-pad)',
        }}>
          {/* title row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 'var(--fs-15)' }}>
              <RadioTower size={16} strokeWidth={1.75} style={{ color: live ? 'var(--green)' : 'var(--text-3)', transition: 'color var(--duration-heal) var(--ease)' }} />
              The manager's radio — live-sync lane
            </span>
            <span className="mono status-transition" style={{
              fontSize: 'var(--fs-11h)', padding: '2px 9px', borderRadius: 'var(--radius-sm)',
              background: live ? 'var(--green-bg)' : 'var(--bg-page)',
              color: live ? 'var(--green-text)' : 'var(--text-3)',
              border: live ? '1px solid rgba(29,158,117,0.25)' : '1px solid var(--border)',
            }}>
              {live ? 'on' : 'off · baseline'}
            </span>
          </div>

          {/* pipeline step chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
            {PIPELINE_STEPS.map((step, i) => (
              <Fragment key={step}>
                <span className="status-transition" style={{
                  fontSize: 'var(--fs-11h)', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                  background: live ? 'var(--green-bg)' : 'var(--bg-page)',
                  color: live ? 'var(--green-text)' : 'var(--text-3)',
                  border: live ? '1px solid rgba(29,158,117,0.2)' : '1px solid var(--border)',
                }}>
                  {step}
                </span>
                {i < PIPELINE_STEPS.length - 1 && (
                  <ChevronRight size={10} strokeWidth={1.75} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
                )}
              </Fragment>
            ))}
          </div>

          {/* one sentence */}
          <div style={{ ...cardBody, marginTop: 10 }}>
            {live
              ? 'On. Any change flows through instantly — note card refreshed, memory re-learned — in about 1.5 s.'
              : 'Off. Changes are batched; the waiter finds out only at the next scheduled rebuild.'}
          </div>
        </div>
      </div>

      <SingleHairline />

      {/* ════════════════════════════════════════════════════
          3 · HOW IT ANSWERS  (the climax card)
      ════════════════════════════════════════════════════ */}
      <Eyebrow n="3" label="How it answers" />

      <div style={{
        background: 'var(--bg-card)',
        border: '1.5px solid var(--text-1)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--card-pad)',
      }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--fs-15)', marginBottom: 4 }}>
          To answer, the waiter does two separate things
        </div>
        <div style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)' }}>only one of these steps can go stale</div>

        <ClimaxStep
          n={1} Icon={Brain}
          label="Recognises which dish you asked about"
          ok
          badge={prov ? `found ${prov.retrieved_doc} · ${prov.similarity_score}` : null}
          badgeEmpty="finds the dish by meaning"
          caption={<>uses the waiter's memory (<Id>Atlas Vector Search</Id>)</>}
        />
        <ClimaxStep
          n={2} Icon={FileText}
          label="Reads the note card to answer"
          ok={prov ? prov.live_read || !stale : !stale}
          badge={prov
            ? (prov.live_read ? 'read live — fresh' : `note ${fmtBehind(prov.snapshot_age_s) || 'n/a'} old`)
            : null}
          badgeEmpty={stale ? `note is ${fmtBehind(behind)} old` : 'note is current'}
          caption={<>uses the note card (<Id>snapshot_text</Id> · operational document)</>}
        />

        {/* punchline */}
        <div style={{
          marginTop: 'var(--s-5)', paddingTop: 'var(--s-4)',
          borderTop: '1px solid var(--border)',
          fontWeight: 600, fontSize: 'var(--fs-15)',
          color: diverged ? 'var(--red-text)' : prov ? 'var(--text-1)' : 'var(--text-3)',
          transition: 'color var(--duration-heal) var(--ease)',
        }}>
          {prov
            ? (diverged
                ? 'The waiter knew which dish you meant — but read you outdated information.'
                : 'Both steps worked correctly — the answer is fresh.')
            : 'ask the waiter below — this fills in live'}
        </div>
        <div style={techCap}>
          retrieval healthy · payload {stale && !live ? 'stale' : 'fresh'} — the failure retrieval metrics miss
        </div>
      </div>

      <SingleHairline />

      {/* ════════════════════════════════════════════════════
          4 · ASK THE WAITER
      ════════════════════════════════════════════════════ */}
      <Eyebrow n="4" label="Ask the waiter" />

      <div style={{
        background: 'var(--bg-page)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* chat header */}
        <div style={{ padding: '12px var(--card-pad)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Utensils size={13} strokeWidth={1.75} style={{ color: 'var(--text-3)' }} />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-15)' }}>AI waiter</div>
            <div style={{ fontSize: 'var(--fs-11h)', color: 'var(--text-3)' }}>what the guest sees · {mode} mode</div>
          </div>
        </div>

        {/* thread */}
        <div style={{ padding: 'var(--s-4) var(--card-pad)', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)', minHeight: 80 }}>
          {thread.length === 0 && (
            <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-13h)' }}>Tap a question below to ask the waiter.</div>
          )}
          {thread.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{
              alignSelf: 'flex-end', maxWidth: '75%',
              background: 'var(--text-1)', color: '#fff',
              borderRadius: 'var(--radius)', borderBottomRightRadius: 'var(--radius-sm)',
              padding: '9px 14px', fontSize: 'var(--fs-13h)', lineHeight: 1.45,
            }}>{m.text}</div>
          ) : (
            <div key={i} style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'flex-start', alignSelf: 'flex-start', maxWidth: '80%' }}>
              <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Utensils size={12} strokeWidth={1.75} style={{ color: 'var(--text-3)' }} />
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', gap: 'var(--s-4)' }}>
                    {/* Part 0 fix: "answered from live data" in live mode */}
                    <span className="mono" style={{ fontSize: 'var(--fs-11h)', color: m.provenance.live_read ? 'var(--green-text)' : 'var(--amber-text)' }}>
                      {m.provenance.live_read
                        ? 'answered from live data'
                        : `answered from a note ${fmtBehind(m.provenance.snapshot_age_s) || ''} old`}
                    </span>
                    <button
                      className="link-quiet"
                      onClick={() => setInspect(m.provenance)}
                      style={{ border: 'none', background: 'none', color: 'var(--text-3)', fontSize: 'var(--fs-11h)', padding: 0, flexShrink: 0 }}
                    >
                      why? → inspect
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* typing indicator */}
          {busy && (
            <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', alignSelf: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={13} strokeWidth={1.75} className="spin" style={{ color: 'var(--text-3)' }} />
              </div>
              <span style={{ fontSize: 'var(--fs-13h)', color: 'var(--text-3)' }}>thinking…</span>
            </div>
          )}
        </div>

        {/* suggestion chips — above input row */}
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

        {/* input row — pinned to bottom */}
        <div style={{ padding: 'var(--s-3) var(--card-pad) var(--s-4)', display: 'flex', gap: 'var(--s-2)' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask the waiter anything about the menu…"
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

/* ── ClimaxStep ──────────────────────────────────────────── */
function ClimaxStep({ n, Icon, label, ok, badge, badgeEmpty, caption }) {
  const display = badge ?? badgeEmpty
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', marginTop: 'var(--s-4)', paddingTop: 'var(--s-4)', borderTop: '1px solid var(--border)' }}>
      <span className="mono" style={{ width: 16, fontSize: 'var(--fs-13h)', color: 'var(--text-3)', flexShrink: 0 }}>{n}</span>
      <Icon size={16} strokeWidth={1.75} style={{ color: ok ? 'var(--green-text)' : 'var(--red-text)', flexShrink: 0, transition: 'color var(--duration-heal) var(--ease)' }} />
      <span style={{ flex: 1, fontSize: 'var(--fs-13h)' }}>{label}</span>
      <span className="mono status-transition" style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
        fontSize: 'var(--fs-11h)', padding: '3px 9px', borderRadius: 'var(--radius-sm)',
        background: ok ? 'var(--green-bg)' : (badge ? 'var(--red-bg)' : 'var(--bg-page)'),
        color: ok ? 'var(--green-text)' : (badge ? 'var(--red-text)' : 'var(--text-3)'),
        border: ok ? '1px solid rgba(29,158,117,0.2)' : (badge ? '1px solid rgba(226,75,74,0.2)' : '1px solid var(--border)'),
      }}>
        {badge != null && (ok
          ? <Check size={10} strokeWidth={2.5} />
          : <X size={10} strokeWidth={2.5} />
        )}
        {display}
      </span>
      {caption && <div style={{ display: 'none' }}>{caption}</div>}
    </div>
  )
}

/* ── Inspector drawer ────────────────────────────────────── */
function Drawer({ p, onClose }) {
  const wrong      = p.context_status && p.truth_status && p.context_status !== p.truth_status
  const age        = p.snapshot_age_s != null ? (fmtBehind(p.snapshot_age_s) ?? '—') : '—'
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
        {/* header */}
        <div style={{ padding: 'var(--s-4) var(--card-pad)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-15)' }}>
            {wrong ? 'Why was this answer wrong?' : 'Answer provenance'}
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', alignItems: 'center', width: 28, height: 28, borderRadius: 'var(--radius)' }}>
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>

        <div style={{ padding: 'var(--card-pad)', flex: 1 }}>

          {/* ── thesis line — the visual peak ── */}
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

          {/* narrative */}
          <p style={{ fontSize: 'var(--fs-13h)', color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 var(--s-5)' }}>
            {wrong
              ? <>The agent found the right dish, then read a note{' '}
                  <span className="mono" style={{ color: 'var(--red-text)' }}>{age} behind</span>.
                  It reported faithfully — <strong>the data layer failed, not the LLM</strong>.</>
              : <>Retrieved <span className="mono">{p.retrieved_doc}</span> via <span className="mono">$vectorSearch</span>.{' '}
                  {p.live_read
                    ? 'Availability re-read live at query time — always fresh in live mode.'
                    : `Served from snapshot ${age} old — currently consistent with truth.`}</>
            }
          </p>

          {/* used vs truth cards */}
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

          {/* vector mechanics expand */}
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
                Retrieved <span className="mono">{p.retrieved_doc}</span> via cosine vector search on the runbook embedding (v{p.embedding_version_used}) — recomputed only when the runbook description changes.<br /><br />
                Availability is a structured field — <strong>never embedded</strong>; live mode re-reads it at query time.<br />
                Baseline mode serves <span className="mono">snapshot_text</span> captured at embed time — the naive pattern this project makes visible.
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
      fontSize: 'var(--fs-11h)', letterSpacing: '0.07em', color: 'var(--text-3)',
      marginBottom: 'var(--s-4)',
      marginTop: top ? 'var(--s-5)' : 'var(--s-7)',
    }}>
      {n} · {label}
    </div>
  )
}

function TwoHairlines() {
  return (
    <div className="two-hairlines" style={{ padding: '0' }}>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
        <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
        <div style={{ width: 1, height: 24, background: 'var(--border-strong)' }} />
      </div>
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

/* ── style constants ─────────────────────────────────────── */
const STATUS_MAP = {
  available: { bg: 'var(--green-bg)', fg: 'var(--green-text)' },
  limited:   { bg: 'var(--amber-bg)', fg: 'var(--amber-text)' },
  sold_out:  { bg: 'var(--red-bg)',   fg: 'var(--red-text)'   },
  up:        { bg: 'var(--green-bg)', fg: 'var(--green-text)' },
  degraded:  { bg: 'var(--amber-bg)', fg: 'var(--amber-text)' },
  down:      { bg: 'var(--red-bg)',   fg: 'var(--red-text)'   },
}

/* one card anatomy — used everywhere */
const card = {
  background:   'var(--bg-card)',
  border:       '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding:      'var(--card-pad)',
}

/* Inter body copy inside cards */
const cardTitle = { fontWeight: 600, fontSize: 'var(--fs-15)', marginBottom: 0 }
const cardBody  = { fontSize: 'var(--fs-13h)', color: 'var(--text-2)', lineHeight: 1.5 }

/* tech caption — Inter (not mono), identifiers get <Id> inline chips */
const techCap = {
  fontFamily:  'var(--font-ui)',
  fontSize:    'var(--fs-11h)',
  color:       'var(--text-3)',
  marginTop:   'var(--s-4)',
  lineHeight:  1.5,
}
