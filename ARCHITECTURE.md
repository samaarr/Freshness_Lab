# Architecture

One MongoDB Atlas collection holds both truth and vectors; an instrumented freshness
pipeline sits on its change stream; the agent path composes context differently per
mode; a deterministic benchmark replays churn; a React front renders it live.

## Data model (`services`)
factual: status · error_rate · on_call · updated_at        — NEVER embedded
semantic: runbook_text                                      — the ONLY embedded text
index metadata: embedding · embedding_version · embedded_at · content_hash(runbook_text) · snapshot_text

`snapshot_text` deliberately renders the factual fields into the stored blob — it
faithfully simulates the naive "embed the document, serve the snapshot" pattern
that baseline mode answers from.

## Freshness pipeline (backend/{watcher,classifier,pipeline}.py)
change stream (full_document=updateLookup, resume-token aware)
  → classify(updatedFields):
      semantic → re-embed runbook_text, bump embedding_version, refresh snapshot   (Mechanism A fix)
      factual  → refresh snapshot_text only; vector and version UNTOUCHED          (Mechanism B fix)
      ignore   → pipeline's own writes (loop guard — PIPELINE_FIELDS contract)
  → freshness_ledger row {changed_at (cluster time), synced_at, ttf_ms, version before/after}

Modes: live = sync immediately · baseline = observe + record debt; sync only on
POST /api/rebuild (the "scheduled backfill"), which stamps honest TTF on pending rows.

## Agent path (backend/agent.py)
question → $vectorSearch (runbook embedding) → context fork:
  live: render from CURRENT fields (live re-read)        baseline: serve snapshot_text
→ Claude, strict-context system prompt, temperature 0, answers cached by (question, context) hash
→ provenance record → the inspector is a pure renderer over it.
Answers end with `STATUS: up|degraded|down|unknown` — graded by exact match, never LLM-judged.

## Benchmark (backend/benchmark.py)
Per trial, two booleans: retrieval_hit and answer_correct — that pair IS the thesis.
Scenarios: mechanism_b (status flips; flat retrieval, collapsing correctness),
mechanism_a (runbook rewrites; both degrade), control (zero staleness; the
fresh-but-wrong floor). Fixed seed, fixed query set, cached LLM → reruns deterministic.

## Known limits (scope guards, BRIEF §5)
Single node, tiny corpus — at this scale index rebuilds are instant, so baseline
vs delta cost is instrumented and cited (SPFresh) rather than organically reproduced.
No reranking, auth, multi-tenant, second backend, or autoEmbed integration (README-only).
