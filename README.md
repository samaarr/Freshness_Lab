# freshness-lab

**Retrieval metrics stay green while answer correctness collapses.**

## What this is (and isn't)

This problem is **well documented** — this project does not claim to have discovered it. MongoDB's [Automated Embedding announcement](https://www.mongodb.com/company/blog/product-release-announcements/ai-search-for-agents-announcing-automated-embedding-atlas) describes the failure verbatim; SPFresh (SOSP '23) and VBASE (OSDI '23) formalized the index-freshness and one-store problems; the AAAI '24 RGB benchmark and the EMNLP '24 knowledge-conflicts survey measure the downstream symptom; practitioners have been writing about it through 2026 (dev.to's *RAG Is a Data Engineering Problem*, dbi-services' pgvector CDC series).

What hasn't been published is the **measured relationship** between index-freshness and downstream answer correctness — a freshness SLO plotted against answer accuracy, per failure mechanism. So this project builds it.



Live demo: https://freshness-lab.vercel.app

This is a small, instrumented demo of a failure mode that production RAG systems hit and most dashboards never catch. The retrieval layer reports healthy. Similarity scores look fine. The vector index finds the right document every time. And the answer is still stale, because the *value* the system serves was frozen at embed time and the live field moved on.

The demo lets you cause that failure on purpose, watch it happen against a real MongoDB Atlas pipeline, and see the two distinct ways "stale" actually shows up.

---

## The measured result

Running the benchmark against the live pipeline, as staleness lag grows:

- **Retrieval health stays flat near 100%.** `$vectorSearch` keeps finding the correct document. By every metric a retrieval dashboard tracks, nothing is wrong.
- **Answer correctness falls to ~37%.** The served answers are increasingly wrong, because they read a snapshot that no longer matches the live record.
- **Time-to-freshness, p95: ~19 minutes (batch baseline) vs ~1.1 seconds (live sync).**

That gap between the green retrieval line and the falling correctness line is the whole point. It is the part a similarity-score dashboard will never show you.

---

## Two ways data goes stale

Most writing on RAG freshness treats "stale" as one problem: the data changed, re-embed it. That misses half the failure. This demo separates the two, because they have different fixes and only one of them is solvable by re-embedding.

**Mechanism B — payload drift (the headline).** A structured fact changes (a dish sells out: `status` goes `available -> sold_out`). The document's text description is unchanged, so the embedding is still perfectly valid and `$vectorSearch` still returns the document at high similarity. But the answer the system serves reads a *snapshot* of the record taken at embed time, and that snapshot still says `available`. Retrieval is healthy. The answer is confidently wrong. Re-embedding does not fix this, because the embedding was never the problem. The fix is to re-read the live field at query time instead of trusting the snapshot.

**Mechanism A — retrieval drift (the commodity case).** The description itself is rewritten (`runbook_text` changes). Now the stored vector encodes the *old* meaning. Until the document is re-embedded, search matches on what the text used to say. This one *is* fixed by re-embedding, and it is the case most of the literature already covers.

Keeping both in one demo is deliberate. B is the differentiated insight and the rigorous case where "retrieval stays green" is literally true. A is the familiar one. Side by side they show that "freshness" is not a single lever.

---

## How it works

A restaurant menu lives in one MongoDB collection. Each dish is the source of truth (its live fields), plus a vector embedding of its description, plus a `snapshot_text` captured at embed time. A query asks the RAG agent something ("is the risotto available tonight?"), the agent retrieves via Atlas Vector Search, and answers.

There are two modes:

- **Baseline** models a batch pipeline: a full rebuild re-embeds and re-snapshots every document, and it only runs when you trigger it (or on the optional auto-sweep timer). Between runs, data rots. This is how a lot of real ingestion pipelines actually behave.
- **Live sync** models a streaming pipeline: a MongoDB Change Stream watcher catches each write, classifies it, and reconciles just that document in around a second.

Every freshness indicator in the UI is derived from the backend's ledger of unsynced changes, not from a guess in the frontend. A card reads "stale" because the change-stream watcher recorded a pending change and hasn't reconciled it yet, not because you clicked something. That distinction is the difference between a demo that fakes the state and one that reports it.

### Stack

- MongoDB Atlas (M0) with Atlas Vector Search, 384-dim index
- MongoDB Change Streams, resume-token aware, for the live watcher
- `sentence-transformers` (all-MiniLM-L6-v2), CPU-only torch in deploy
- Claude (Anthropic API) as the RAG agent, temperature 0
- FastAPI backend with Server-Sent Events for live updates
- React + Vite frontend
- Deployed on Railway (backend) and Vercel (frontend)

### The pipeline path

```
PATCH a field
  -> Atlas Change Stream
    -> watcher classifies the change (factual / semantic / ignore)
      -> router syncs or queues it
        -> freshness ledger records pending vs synced
          -> /api/services + SSE
            -> UI derives every freshness indicator from that ledger
```

---

## State-correctness audit

Before deploying, I audited the pipeline for one specific property: every piece of state the UI shows must be *caused by* the real pipeline, not painted optimistically by the frontend. I wrote seven invariants covering the watcher, the ledger, the SSE stream, and the render path, and traced each through the actual code.

It found four real violations. The user-visible ones are fixed:

- **Backlog reconciliation on mode switch.** Switching baseline -> live now runs a real reconciliation pass over pending changes (the same way a streaming sync service catches up its backlog on startup), so cards reflect true synced state instead of leftover batch debt.
- **Honest failure surfacing.** A failed background refresh used to be swallowed silently, so a dead backend looked like a healthy frozen dashboard. It now surfaces.
- **Seed no longer creates phantom staleness.** Re-seeding against a running server used to leave spurious pending rows.

Two lower-severity issues are documented as known tradeoffs rather than papered over: a sub-100ms time-of-check/time-of-use race on the mode read in the watcher (a real production concern, fixed by threading mode-at-write-time through the change event, out of scope for a demo), and a `reset` that re-embeds without reverting edited content (intended, but worth a clearer label).

I left the `# TODO(audit)` markers in the code at those two sites. The point of saying this out loud: knowing where your own system lies to you, and choosing which lies to fix now versus document, is most of the job.

---

## Run it locally

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in MONGODB_URI, ANTHROPIC_API_KEY
python seed.py         # loads the menu, embeds, waits for the index to be READY
uvicorn main:app --reload

# frontend
cd frontend
npm install
cp .env.example .env   # set VITE_API_BASE to your backend URL
npm run dev
```

Tests: `pytest backend/tests/`

---

## Related Work

### Foundational RAG pattern
- Lewis et al., *RAG for Knowledge-Intensive NLP Tasks*

### Retrieval + reasoning under stale or conflicting context
- Chen et al., *Benchmarking LLMs in RAG* (AAAI 2024)
- Chen et al., *Knowledge Conflicts for LLMs* (EMNLP 2024)
- Longpre et al., work on knowledge conflict in LLMs
- Lazaridou et al., temporal generalization and model staleness

### Vector index freshness and ANN update systems
- Xu et al., *SPFresh* (SOSP 2023)
- Zhang et al., *VBASE* (OSDI 2023)
- Subramanya et al., *DiskANN*
- VLDB / production systems (AnalyticDB-V, other vector DBMS work)

### End-to-end production systems addressing freshness
- MongoDB, *Automated Embedding in Atlas* (2026)

---

Built by Samar Patil. Code: https://github.com/samaarr/Freshness_Lab
