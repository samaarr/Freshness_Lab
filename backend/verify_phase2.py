"""Phase 2 acceptance gate — RUN AGAINST LIVE ATLAS (no uvicorn needed).

Strategy: Checks 1-4 call pipeline.handle_change() directly — no watcher
thread, no Atlas timing race. Check 5 starts the watcher thread and proves
the end-to-end baseline→rebuild TTF flow.

Usage:  .venv/bin/python verify_phase2.py
"""
import sys, time, logging
from datetime import datetime, timezone

import db, mode as mode_state, pipeline
from classifier import classify

logging.basicConfig(level=logging.WARNING)
P, F = "✓", "✗"
STREAM_WAIT = 8   # seconds to wait for change stream cursor in CHECK 5 only

def die(msg): print(f"  {F}  {msg}"); sys.exit(1)
def ok(msg):  print(f"  {P}  {msg}")
def utcnow(): return datetime.now(timezone.utc)


def main():
    print("\n=== Phase 2 verification (live Atlas, direct pipeline calls) ===\n")

    # ── CHECK 1 — classifier ──────────────────────────────────────────────────
    print("CHECK 1 — classifier")
    assert classify({"runbook_text"}) == "semantic"
    assert classify({"status"}) == "factual"
    assert classify({"embedding", "snapshot_text", "embedding_version",
                     "embedded_at", "content_hash"}) == "ignore"
    assert classify({"runbook_text", "status"}) == "semantic"
    ok("classifier routes correct")

    # ── setup — clean slate ───────────────────────────────────────────────────
    name = "risotto"
    pipeline.rebuild_all()
    db.ledger().delete_many({})
    before = db.services().find_one({"name": name})
    if not before:
        die(f"service '{name}' not found — run seed.py first")

    # NOTE: watcher is NOT started yet for checks 1-4. Direct calls only.
    # This ensures no background thread writes phantom ledger rows.

    # ── CHECK 2 — Mechanism B: status flip must NOT re-embed ──────────────────
    print("\nCHECK 2 — Mechanism B proof (status flip must NOT re-embed)")
    mode_state.set_mode("live")

    db.services().update_one({"name": name}, {"$set": {"status": "sold_out"}})
    updated_doc = db.services().find_one({"name": name})

    route = pipeline.handle_change(
        doc_name=name,
        changed_fields={"status"},
        full_doc=updated_doc,
        mode="live",
        changed_at=utcnow(),
    )

    if route != "factual":
        die(f"classifier returned '{route}' for status-only change — expected 'factual'")

    after = db.services().find_one({"name": name})
    if after["embedding_version"] != before["embedding_version"]:
        die(f"embedding_version changed {before['embedding_version']} -> "
            f"{after['embedding_version']} on a status flip — Mechanism B broken")

    row = db.ledger().find_one({"doc_name": name, "field_class": "factual"})
    if not row:
        die("factual ledger row was not written by handle_change")
    if row.get("ttf_ms") is None:
        die(f"ttf_ms is None — datetime normalisation bug; row={row}")

    snapshot_ok = "availability: sold_out" in (after.get("snapshot_text") or "")
    ok(f"version unchanged ({after['embedding_version']}), "
       f"factual row ttf={row['ttf_ms']}ms, snapshot refreshed: {snapshot_ok}")

    # ── CHECK 3 — Mechanism A: runbook edit re-embeds exactly once ────────────
    print("\nCHECK 3 — Mechanism A proof (runbook edit re-embeds exactly once)")
    db.ledger().delete_many({})   # fresh count baseline for check 4

    new_runbook = before["runbook_text"] + " Edited for phase2 verify."
    db.services().update_one({"name": name}, {"$set": {"runbook_text": new_runbook}})
    doc_after_edit = db.services().find_one({"name": name})

    pipeline.handle_change(
        doc_name=name,
        changed_fields={"runbook_text"},
        full_doc=doc_after_edit,
        mode="live",
        changed_at=utcnow(),
    )

    after2 = db.services().find_one({"name": name})
    if after2["embedding_version"] != after["embedding_version"] + 1:
        die(f"expected version +1, got {after['embedding_version']} -> {after2['embedding_version']}")
    if after2["content_hash"] == after["content_hash"]:
        die("content_hash did not change after runbook edit")
    ok(f"version {after['embedding_version']} -> {after2['embedding_version']}, hash changed")

    # ── CHECK 4 — no self-trigger loop (pure logic, no watcher thread) ────────
    # Simulate the watcher receiving the pipeline's OWN secondary write
    # (embedding, snapshot_text, etc.) and confirm it routes to "ignore"
    # and writes NO ledger row.
    print("\nCHECK 4 — no self-trigger loop")
    db.ledger().delete_many({})   # blank slate: any new row = a bug

    pipeline_fields = {"embedding", "embedding_version", "embedded_at",
                       "content_hash", "snapshot_text"}
    loop_route = pipeline.handle_change(
        doc_name=name,
        changed_fields=pipeline_fields,
        full_doc=after2,
        mode="live",
        changed_at=utcnow(),
    )
    if loop_route != "ignore":
        die(f"pipeline fields classified as '{loop_route}' — loop guard broken")

    phantom_rows = db.ledger().count_documents({})
    if phantom_rows != 0:
        die(f"'ignore' route still wrote {phantom_rows} ledger row(s) — loop guard broken")
    ok("pipeline-field change classified as ignore, 0 ledger rows written — no loop")

    # ── CHECK 5 — end-to-end watcher thread + baseline TTF ───────────────────
    print("\nCHECK 5 — baseline vs live TTF (watcher thread + rebuild)")
    import watcher
    watcher.start()
    print("  (watcher thread started — waiting for change stream cursor to open…)")
    time.sleep(STREAM_WAIT)

    mode_state.set_mode("baseline")
    db.ledger().delete_many({})
    db.services().update_one({"name": name}, {"$set": {"status": "limited"}})

    pend = None
    for attempt in range(15):
        time.sleep(1)
        pend = db.ledger().find_one({"doc_name": name, "synced_at": None})
        if pend:
            break

    if not pend:
        die(
            "no pending ledger row after 15 s — change stream did not deliver the event.\n"
            "  Checks 1-4 passed so the pipeline logic is correct.\n"
            "  This is an Atlas M0 timing issue. Re-run or check your MONGODB_URI."
        )

    time.sleep(2)   # ensure TTF > 2 000 ms after rebuild
    pipeline.rebuild_all()
    closed = db.ledger().find_one({"_id": pend["_id"]})
    if closed["synced_at"] is None or closed["ttf_ms"] < 2000:
        die(f"rebuild did not stamp honest TTF (got ttf_ms={closed['ttf_ms']})")
    import benchmark
    ok(f"baseline row closed with ttf={closed['ttf_ms']}ms · stats={benchmark.ttf_stats()}")

    # ── restore ───────────────────────────────────────────────────────────────
    db.services().update_one(
        {"name": name},
        {"$set": {"status": "available", "runbook_text": before["runbook_text"]}}
    )
    time.sleep(2)
    pipeline.rebuild_all()
    db.ledger().delete_many({})

    print(f"\n  {P}  Phase 2 PASSED\n")


if __name__ == "__main__":
    main()