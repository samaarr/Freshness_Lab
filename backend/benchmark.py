"""Benchmark harness — deterministic scenarios, exact-match grading, one JSON out.

Per trial, TWO booleans (the thesis pair):
  retrieval_hit  — did $vectorSearch return the expected doc?
  answer_correct — did the parsed STATUS match ground truth at ask time?
Scenarios:
  mechanism_b — status flips; expect retrieval flat, correctness collapsing (baseline)
  mechanism_a — runbook edits; expect both degrading (baseline)
  control     — zero staleness (live mode); establishes the fresh-but-wrong floor
"""
import random
import time
from datetime import timezone

import db
import mode as mode_state
import pipeline
from agent import retrieve, compose_context, call_claude
from config import COLLECTION_BENCH
from grading import grade, parse_status

QUERY_SET = [
    ("Is checkout healthy?", "checkout"),
    ("What is the current status of checkout?", "checkout"),
    ("Is the payments API up right now?", "payments-api"),
    ("Are payments degraded?", "payments-api"),
    ("Can users log in — is auth-service up?", "auth-service"),
    ("Is the inventory service operational?", "inventory"),
    ("Are notifications being sent — service status?", "notifications"),
    ("Is search working — what is search-api status?", "search-api"),
]

FLIP_TARGETS = ["checkout", "payments-api", "auth-service", "inventory"]


def _snapshot_truths() -> dict[str, str]:
    """Read ground-truth statuses RIGHT NOW from Atlas — call before any rebuild."""
    return {doc["name"]: doc["status"] for doc in db.services().find({}, {"name": 1, "status": 1})}


def _ask_graded(question: str, expected_service: str, mode: str, truths: dict[str, str]) -> dict:
    """
    truths: ground-truth status snapshot taken at query time (before any rebuild).
    This is the fix: we pass in the truth rather than re-reading from Atlas after
    rebuild has already restored everything to 'up'.
    """
    doc = retrieve(question)
    retrieval_hit = bool(doc and doc["name"] == expected_service)
    answer_correct = False
    parsed = "unparsed"
    if doc:
        context = compose_context(doc, mode)
        answer = call_claude(question, context)
        parsed = parse_status(answer)
        truth = truths.get(expected_service, "unknown")
        # answer_correct: parsed status matches what was actually true at ask time
        # AND the right document was retrieved
        answer_correct = (parsed == truth) and retrieval_hit
    return {"retrieval_hit": retrieval_hit, "answer_correct": answer_correct, "parsed": parsed}


def _doc_staleness_s(name: str) -> int:
    row = db.ledger().find_one({"doc_name": name, "synced_at": None}, sort=[("changed_at", 1)])
    if not row:
        return 0
    t = row["changed_at"]
    t = t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    return int((pipeline.utcnow() - t).total_seconds())


def run_scenario(scenario: str, seed: int = 42, lag_points: list[int] | None = None) -> dict:
    """Deterministic: fixed RNG seed, fixed query set, cached LLM answers."""
    rng = random.Random(seed)
    lag_points = lag_points or [0, 10, 30, 60, 120]
    results = []

    if scenario == "control":
        mode_state.set_mode("live")
        pipeline.rebuild_all()
        time.sleep(1)
        truths = _snapshot_truths()
        for q, svc in QUERY_SET:
            r = _ask_graded(q, svc, "live", truths)
            results.append({"lag_s": 0, **r})

    else:
        mode_state.set_mode("baseline")
        pipeline.rebuild_all()   # start from fully fresh state
        db.ledger().delete_many({"synced_at": None})

        targets = rng.sample(FLIP_TARGETS, k=3)
        for name in targets:
            if scenario == "mechanism_b":
                new_status = rng.choice(["down", "degraded"])
                db.services().update_one({"name": name}, {"$set": {"status": new_status}})
            else:  # mechanism_a — rewrite the runbook so its meaning moves
                db.services().update_one({"name": name}, {"$set": {"runbook_text":
                    f"Symptoms: complete rewrite for {name} — database connection pool exhaustion, "
                    f"failover loops, replica lag. Steps: (1) inspect pool metrics (2) fail over "
                    f"primary (3) drain and restart workers. Edited at seed {seed}."}})

        time.sleep(2)  # let the watcher record the pending rows
        t0 = time.monotonic()

        for lag in lag_points:
            while time.monotonic() - t0 < lag:
                time.sleep(0.5)

            # Snapshot truths NOW — while services are still in their flipped state.
            # This is the critical fix: do NOT read truth after rebuild() restores them.
            truths = _snapshot_truths()

            for q, svc in QUERY_SET:
                r = _ask_graded(q, svc, "baseline", truths)
                results.append({
                    "lag_s": _doc_staleness_s(svc) if svc in targets else lag,
                    "nominal_lag_s": lag,
                    **r
                })

        pipeline.rebuild_all()  # restore freshness AFTER all grading is done

    # aggregate per lag point
    by_lag: dict[int, dict] = {}
    for r in results:
        key = r["lag_s"] if scenario == "control" else r.get("nominal_lag_s", r["lag_s"])
        b = by_lag.setdefault(key, {"n": 0, "retr": 0, "corr": 0})
        b["n"] += 1
        b["retr"] += int(r["retrieval_hit"])
        b["corr"] += int(r["answer_correct"])

    curve = [
        {
            "lag_s": k,
            "retrieval_pct": round(100 * v["retr"] / v["n"], 1),
            "correctness_pct": round(100 * v["corr"] / v["n"], 1),
            "n": v["n"],
        }
        for k, v in sorted(by_lag.items())
    ]

    out = {"scenario": scenario, "seed": seed, "curve": curve, "trials": len(results)}
    db.get_db()[COLLECTION_BENCH].update_one({"_id": scenario}, {"$set": out}, upsert=True)
    return out


def ttf_stats() -> dict:
    """p50/p95 TTF, baseline vs live, from the ledger."""
    def pct(values, p):
        if not values:
            return None
        values = sorted(values)
        i = min(len(values) - 1, max(0, int(round(p / 100 * (len(values) - 1)))))
        return values[i]
    out = {}
    for m in ("baseline", "live"):
        vals = [r["ttf_ms"] for r in db.ledger().find({"mode": m, "ttf_ms": {"$ne": None}})]
        out[m] = {"p50_ms": pct(vals, 50), "p95_ms": pct(vals, 95), "n": len(vals)}
    return out