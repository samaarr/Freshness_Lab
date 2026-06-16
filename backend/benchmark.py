"""Benchmark harness — deterministic scenarios, exact-match grading, one JSON out.

Per trial, TWO booleans (the thesis pair):
  retrieval_hit  — did $vectorSearch return the expected dish?
  answer_correct — did the parsed STATUS match ground truth at ask time?
Scenarios:
  mechanism_b — status flips; staggered across lag_points.
                retrieval stays flat (embedding unchanged); correctness slopes down.
  mechanism_a — runbook rewrites; staggered + mid-rebuild each time.
                Old recipe queries progressively miss the updated embeddings;
                both retrieval and correctness decline together.
  control     — live mode, fully fresh; both lines flat near 100%.
"""
import random
import time

import db
import mode as mode_state
import pipeline
from agent import retrieve, compose_context, call_claude
from config import COLLECTION_BENCH
from grading import parse_status

# ── query sets ────────────────────────────────────────────────────────────────

# Name-based queries — used by Mechanism B and Control.
# These find the right dish by name even when the recipe text changes.
QUERY_SET = [
    ("Is the risotto available tonight?",      "risotto"),
    ("Can I order the risotto?",               "risotto"),
    ("Is carbonara on the menu?",              "carbonara"),
    ("Is carbonara available?",                "carbonara"),
    ("Can I get bruschetta?",                  "bruschetta"),
    ("Is bruschetta available tonight?",       "bruschetta"),
    ("Is margherita pizza available?",         "margherita"),
    ("Is tiramisu available for dessert?",     "tiramisu"),
]

# Semantic queries about ORIGINAL recipe content — used by Mechanism A.
# After a runbook rewrite + rebuild, the embedding shifts and these old queries miss.
QUERY_SET_A = [
    ("Which Italian rice dish is slow-cooked with saffron and parmesan?",   "risotto"),
    ("What dish uses white wine, arborio rice, and butter?",                "risotto"),
    ("Which pasta has a rich sauce made from cured pork and egg yolk?",     "carbonara"),
    ("What Roman pasta is finished with guanciale and pecorino?",           "carbonara"),
    ("Which starter features fresh tomatoes on grilled bread with garlic?", "bruschetta"),
    ("What Italian antipasto uses olive oil and fresh basil on toast?",     "bruschetta"),
    ("Which thin pizza has only tomato sauce and fresh mozzarella?",        "margherita"),
    ("What Italian dessert is made with espresso-soaked ladyfingers?",      "tiramisu"),
]

FLIP_TARGETS = ["risotto", "carbonara", "bruschetta", "margherita"]

# Original runbook texts — used to restore the DB to a clean state before each run
# so that mechanism_b status flips and mechanism_a rewrites always start from a
# known baseline (not whatever a previous run left behind).
ORIGINAL_RUNBOOKS = {
    "risotto": (
        "Risotto — creamy arborio rice slow-cooked with white wine and vegetable stock, "
        "finished with parmesan, saffron, and butter. Vegetarian."
    ),
    "carbonara": (
        "Carbonara — spaghetti tossed with guanciale, raw egg yolk, pecorino romano, "
        "and cracked black pepper. No cream. Finished off the heat so the egg stays silky. "
        "Contains egg and pork."
    ),
    "bruschetta": (
        "Bruschetta — grilled sourdough rubbed with raw garlic, topped with marinated "
        "San Marzano tomatoes, fresh basil, sea salt, and extra-virgin olive oil. Vegan. "
        "Contains gluten."
    ),
    "margherita": (
        "Margherita — wood-fired pizza with San Marzano tomato base, fresh fior di latte "
        "mozzarella, basil, and olive oil on a 48-hour fermented dough. Vegetarian. "
        "Contains gluten and dairy."
    ),
}

# Rewrites deliberately omit the dish's own name so the embedding shifts away
# from the original; old recipe queries can no longer find the right document.
MECH_A_REWRITES = {
    "risotto": (
        "Seasonal grain bowl — slow-cooked farro with porcini mushrooms, chanterelles, "
        "and aged pecorino. Hearty and warming. Available vegan with cashew cream. "
        "No rice, no saffron."
    ),
    "carbonara": (
        "Braised noodle dish — house-made pasta slow-cooked with wild boar ragù, "
        "san marzano tomatoes, and fresh basil. No eggs or cured pork. Rich and hearty."
    ),
    "bruschetta": (
        "Focaccia board — thick-cut house bread with whipped ricotta, local honey, "
        "and candied walnuts. No tomatoes or garlic. Sweet and savory shared plate."
    ),
    "margherita": (
        "Umami flatbread — thin-crust base with caramelised onion, gorgonzola, "
        "and toasted pine nuts. No tomato sauce or mozzarella. Rich and savoury."
    ),
}


# ── helpers ────────────────────────────────────────────────────────────────────

def _snapshot_truths() -> dict[str, str]:
    """Current ground-truth status for every dish — read before any rebuild."""
    return {doc["name"]: doc["status"] for doc in db.services().find({}, {"name": 1, "status": 1})}


def _ask_graded(question: str, expected_service: str, mode: str,
                truths: dict[str, str]) -> dict:
    doc = retrieve(question)
    retrieval_hit = bool(doc and doc["name"] == expected_service)
    answer_correct = False
    parsed = "unparsed"
    if doc:
        context = compose_context(doc, mode)
        answer = call_claude(question, context)
        parsed = parse_status(answer)
        truth = truths.get(expected_service, "unknown")
        answer_correct = (parsed == truth) and retrieval_hit
    return {"retrieval_hit": retrieval_hit, "answer_correct": answer_correct, "parsed": parsed}


# ── scenario runner ────────────────────────────────────────────────────────────

def run_scenario(scenario: str, seed: int = 42,
                 lag_points: list[int] | None = None) -> dict:
    """Deterministic: fixed RNG seed, fixed query sets, cached LLM answers."""
    rng = random.Random(seed)
    lag_points = lag_points or [0, 10, 30, 60, 120]
    results = []

    if scenario == "control":
        # Live mode: everything syncs on change — both lines stay near 100%.
        # We measure the same queries at each nominal lag point; since live mode
        # always has fresh data, results are cached and identical across points.
        # This produces the flat "floor" line that contrasts with the degrading scenarios.
        mode_state.set_mode("live")
        pipeline.rebuild_all()
        time.sleep(1)
        truths = _snapshot_truths()
        for lag in lag_points:
            for q, svc in QUERY_SET:
                r = _ask_graded(q, svc, "live", truths)
                results.append({"lag_s": lag, "nominal_lag_s": lag, **r})

    elif scenario == "mechanism_b":
        # Factual drift: status flips, embeddings untouched.
        # Reset all flip targets to "available" first — previous runs may have left them
        # in "sold_out", which would make the flip a no-op and kill all divergence.
        for name in FLIP_TARGETS:
            db.services().update_one({"name": name}, {"$set": {"status": "available"}})
        mode_state.set_mode("baseline")
        pipeline.rebuild_all()
        db.ledger().delete_many({"synced_at": None})

        flip_schedule = rng.sample(FLIP_TARGETS, k=3)
        t0 = time.monotonic()
        try:
            for i, lag in enumerate(lag_points):
                while time.monotonic() - t0 < lag:
                    time.sleep(0.5)

                # Flip one additional dish stale just before each measurement (skip lag=0)
                if i > 0 and flip_schedule:
                    name = flip_schedule.pop(0)
                    db.services().update_one({"name": name}, {"$set": {"status": "sold_out"}})
                    time.sleep(1.5)  # let watcher record the pending row

                truths = _snapshot_truths()
                for q, svc in QUERY_SET:
                    r = _ask_graded(q, svc, "baseline", truths)
                    results.append({"lag_s": lag, "nominal_lag_s": lag, **r})
        finally:
            for name in FLIP_TARGETS:
                db.services().update_one({"name": name}, {"$set": {"status": "available"}})
            pipeline.rebuild_all()

    else:  # mechanism_a
        # Semantic drift: runbook rewrites shift the embedding.
        # Restore original runbook texts first — previous runs leave rewrites in the DB.
        for name, text in ORIGINAL_RUNBOOKS.items():
            db.services().update_one({"name": name}, {"$set": {"runbook_text": text}})
        mode_state.set_mode("baseline")
        pipeline.rebuild_all()
        db.ledger().delete_many({"synced_at": None})

        rewrite_schedule = rng.sample(list(MECH_A_REWRITES.keys()), k=3)
        t0 = time.monotonic()
        try:
            for i, lag in enumerate(lag_points):
                while time.monotonic() - t0 < lag:
                    time.sleep(0.5)

                if i > 0 and rewrite_schedule:
                    name = rewrite_schedule.pop(0)
                    db.services().update_one(
                        {"name": name},
                        {"$set": {"runbook_text": MECH_A_REWRITES[name]}}
                    )
                    # Rebuild to push the new text into the vector index;
                    # this makes the embedding stale relative to old recipe queries.
                    pipeline.rebuild_all()
                    db.ledger().delete_many({"synced_at": None})
                    time.sleep(0.5)

                truths = _snapshot_truths()
                for q, svc in QUERY_SET_A:
                    r = _ask_graded(q, svc, "baseline", truths)
                    results.append({"lag_s": lag, "nominal_lag_s": lag, **r})
        finally:
            for name, text in ORIGINAL_RUNBOOKS.items():
                db.services().update_one({"name": name}, {"$set": {"runbook_text": text}})
            pipeline.rebuild_all()

    # ── aggregate per nominal lag point ───────────────────────────────────────
    by_lag: dict[int, dict] = {}
    for r in results:
        key = r.get("nominal_lag_s", r["lag_s"])
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
    db.get_db()[COLLECTION_BENCH].update_one(
        {"_id": scenario}, {"$set": out}, upsert=True
    )
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
        vals = [r["ttf_ms"] for r in
                db.ledger().find({"mode": m, "ttf_ms": {"$ne": None}})]
        out[m] = {"p50_ms": pct(vals, 50), "p95_ms": pct(vals, 95), "n": len(vals)}
    return out
