# freshness-lab

**Retrieval metrics stay green while answer correctness collapses.**

An interactive demonstration — and a measured benchmark — of how AI agents give confidently wrong answers when their data layer falls behind reality. Flip a service to *down*, ask the assistant "Is checkout healthy?", and watch it answer **"All systems operational"** from a 42-second-old snapshot. Then switch to live sync and watch the same failure heal in under a second.

## What this is (and isn't)

This problem is **well documented** — this project does not claim to have discovered it. MongoDB's [Automated Embedding announcement](https://www.mongodb.com/company/blog/product-release-announcements/ai-search-for-agents-announcing-automated-embedding-atlas) describes the failure verbatim; SPFresh (SOSP '23) and VBASE (OSDI '23) formalized the index-freshness and one-store problems; the AAAI '24 RGB benchmark and the EMNLP '24 knowledge-conflicts survey measure the downstream symptom; practitioners have been writing about it through 2026 (dev.to's *RAG Is a Data Engineering Problem*, dbi-services' pgvector CDC series).

What hasn't been published is the **measured relationship** between index-freshness and downstream answer correctness — a freshness SLO plotted against answer accuracy, per failure mechanism. So this project builds it.

## The two mechanisms

Staleness enters a RAG system through two independent channels with different fixes:

| | What changes | What breaks | Visible to retrieval metrics? | Correct fix |
|---|---|---|---|---|
| **A — retrieval drift** | semantic text (the runbook) | *finding* — the stale vector points at the old meaning | yes (recall drops) | re-embed on semantic change |
| **B — payload drift** | a factual field (`status`) | *serving* — retrieval is perfect, the served value is stale | **no — everything stays green** | never embed facts; re-read live at answer time |

B is the headline: every retrieval dashboard stays green while the user-facing answer is confidently wrong.

## What the demo shows

- **Operations** — flip statuses, rewrite runbooks.
- **Memory state** — per-service freshness chips (`facts` / `search`) with live counting debt.
- **Agent** — strict-context Claude answers, each with a provenance line and a *"why? → inspect"* drawer that compares what the agent used against current truth. Vector mechanics live one click deep.
- **Benchmark** — deterministic scenarios, exact enum grading (never LLM-judged), and the divergence chart: retrieval health vs. answer correctness against staleness lag, per mechanism, with a zero-staleness control.

Built on MongoDB Atlas (vectors beside operational data, change streams as the freshness trigger) as one productized embodiment of the fix — the failure itself applies to every RAG stack.

## Run it

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env        # fill in MONGODB_URI + ANTHROPIC_API_KEY
.venv/bin/python seed.py    # seeds 6 services, creates + polls the vector index
.venv/bin/uvicorn main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm install && npm run dev   # http://localhost:5173
```

Verification gates: `backend/tests/` (offline, `pytest -q`), `backend/verify_phase2.py` (live, proves Mechanism B is preserved and the pipeline never re-triggers on its own writes).

## Lineage

- Xu et al., *SPFresh: Incremental In-Place Update for Billion-Scale Vector Search*, SOSP 2023
- Zhang et al., *VBASE*, OSDI 2023 · Pan, Wang & Li, *Survey of Vector DBMS*, VLDB J. 2024
- Chen et al., *Benchmarking LLMs in RAG*, AAAI 2024 · Xu et al., *Knowledge Conflicts for LLMs*, EMNLP 2024
- MongoDB, *AI Search for Agents: Automated Embedding in Atlas* (2026) — the productized fix this demo's "live sync" mode mirrors, glass-box
