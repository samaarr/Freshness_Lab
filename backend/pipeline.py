"""Freshness pipeline — router, sync logic, ledger, rebuild.

Routes (from classifier):
  semantic -> re-embed runbook_text, refresh snapshot, bump embedding_version (Mechanism A fix)
  factual  -> NO re-embed, NO version bump; refresh snapshot_text only (Mechanism B fix)
The pipeline's own writes touch only PIPELINE_FIELDS, so the watcher classifies
them as "ignore" — the infinite-loop guard lives in that contract.
"""
import time
from datetime import datetime, timezone

import db
import events
from classifier import classify
from config import COLLECTION_BENCH  # noqa: F401  (re-exported for benchmark)
from embedder import get_embedder
from snapshot import content_hash, render_snapshot


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _norm(dt: datetime | None) -> datetime | None:
    """Ensure datetime is timezone-aware (UTC). Atlas clusterTime is tz-aware;
    utcnow() is also tz-aware; but Mongo may return naive datetimes from
    stored documents — normalise all of them here so subtraction never fails."""
    if dt is None:
        return dt
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _ledger_insert(doc_name: str, field_class: str, changed_fields: list[str],
                   mode: str, changed_at: datetime, synced_at: datetime | None,
                   v_before: int, v_after: int) -> None:
    changed_at = _norm(changed_at)
    synced_at  = _norm(synced_at)
    ttf_ms = max(0, int((synced_at - changed_at).total_seconds() * 1000)) if synced_at else None
    db.ledger().insert_one({
        "doc_name": doc_name,
        "field_class": field_class,
        "changed_fields": changed_fields,
        "mode": mode,
        "changed_at": changed_at,
        "synced_at": synced_at,
        "ttf_ms": ttf_ms,
        "embedding_version_before": v_before,
        "embedding_version_after": v_after,
    })


def sync_semantic(doc: dict) -> dict:
    """Mechanism A fix: re-embed from runbook_text only."""
    emb = get_embedder()
    now = utcnow()
    new_version = int(doc.get("embedding_version", 0)) + 1
    t0 = time.perf_counter()
    embedding = emb.embed(doc["runbook_text"])
    embed_ms = int((time.perf_counter() - t0) * 1000)
    update = {
        "embedding": embedding,
        "embedding_version": new_version,
        "embedded_at": now,
        "embed_ms": embed_ms,
        "content_hash": content_hash(doc["runbook_text"]),
        "snapshot_text": render_snapshot(doc),
    }
    db.services().update_one({"name": doc["name"]}, {"$set": update})
    return {**doc, **update}


def sync_factual(doc: dict) -> dict:
    """Mechanism B fix: refresh the served snapshot; the vector is untouched."""
    new_snapshot = render_snapshot(doc)
    db.services().update_one({"name": doc["name"]}, {"$set": {"snapshot_text": new_snapshot}})
    return {**doc, "snapshot_text": new_snapshot}


def handle_change(doc_name: str, changed_fields: set[str], full_doc: dict,
                  mode: str, changed_at: datetime | None = None) -> str:
    """Called by the watcher for every update event. Returns the route taken."""
    route = classify(changed_fields)
    if route == "ignore":
        return route

    changed_at = _norm(changed_at or utcnow())
    v_before = int(full_doc.get("embedding_version", 0))

    if mode == "live":
        if route == "semantic":
            updated = sync_semantic(full_doc)
        else:
            updated = sync_factual(full_doc)
        synced_at = utcnow()
        v_after = int(updated.get("embedding_version", v_before))
        _ledger_insert(doc_name, route, sorted(changed_fields), mode, changed_at, synced_at, v_before, v_after)
    else:
        # baseline: observe + record the debt; sync happens only on /api/rebuild
        _ledger_insert(doc_name, route, sorted(changed_fields), mode, changed_at, None, v_before, v_before)

    events.publish("freshness", {"doc_name": doc_name, "route": route, "mode": mode})
    return route


def reconcile_pending() -> dict:
    """Switch-to-live backlog reconciliation.

    Re-syncs every doc that has pending (synced_at=None) baseline rows, then
    closes those rows with an honest synced_at and computed ttf_ms.  A doc
    with any semantic pending row gets sync_semantic (covers factual drift too);
    a doc with only factual rows gets sync_factual (no re-embed needed).
    Called by /api/mode when transitioning baseline → live.
    """
    synced_at = utcnow()
    pending_by_doc: dict[str, list[dict]] = {}
    for row in db.ledger().find({"synced_at": None}):
        pending_by_doc.setdefault(row["doc_name"], []).append(row)

    if not pending_by_doc:
        return {"docs_synced": 0, "rows_closed": 0}

    docs_synced = 0
    rows_closed = 0
    for doc_name, rows in pending_by_doc.items():
        doc = db.services().find_one({"name": doc_name})
        if not doc:
            continue
        has_semantic = any(r["field_class"] == "semantic" for r in rows)
        if has_semantic:
            sync_semantic(doc)
        else:
            sync_factual(doc)
        for row in rows:
            changed_at = _norm(row["changed_at"])
            ttf_ms = max(0, int((synced_at - changed_at).total_seconds() * 1000))
            db.ledger().update_one(
                {"_id": row["_id"]},
                {"$set": {"synced_at": synced_at, "ttf_ms": ttf_ms}},
            )
            rows_closed += 1
        docs_synced += 1

    events.publish("reconcile", {"docs_synced": docs_synced, "rows_closed": rows_closed})
    return {"docs_synced": docs_synced, "rows_closed": rows_closed}


# TODO(audit): reset_all re-embeds from current state but does not revert runbook_text
# or status to seed defaults. A "restore defaults" endpoint is needed. See audit Inv-7/Root-E.
def reset_all() -> dict:
    """Demo reset: re-embed all docs from current state, wipe entire ledger so TTF starts fresh."""
    now = utcnow()
    count = 0
    for doc in db.services().find({}):
        sync_semantic(doc)
        count += 1
    deleted = db.ledger().delete_many({}).deleted_count
    events.publish("reset", {"docs": count, "ledger_cleared": deleted})
    return {"docs_reset": count, "ledger_cleared": deleted, "reset_at": now.isoformat()}


def rebuild_all() -> dict:
    """Baseline-mode 'scheduled backfill': sync every doc, stamp all pending ledger rows."""
    synced_at = utcnow()
    count = 0
    for doc in db.services().find({}):
        sync_semantic(doc)  # full rebuild re-embeds everything (the expensive, honest baseline)
        count += 1
    pending = list(db.ledger().find({"synced_at": None}))
    for row in pending:
        changed_at = _norm(row["changed_at"])
        ttf_ms = max(0, int((synced_at - changed_at).total_seconds() * 1000))
        db.ledger().update_one(
            {"_id": row["_id"]},
            {"$set": {"synced_at": synced_at, "ttf_ms": ttf_ms}}
        )
    events.publish("rebuild", {"docs": count, "pending_closed": len(pending)})
    return {"docs_rebuilt": count, "pending_closed": len(pending), "synced_at": synced_at.isoformat()}


def freshness_state() -> list[dict]:
    """Per-doc current freshness for the UI chips. Derived from pending ledger rows."""
    now = utcnow()
    pending: dict[str, dict] = {}
    for row in db.ledger().find({"synced_at": None}).sort("changed_at", 1):
        entry = pending.setdefault(row["doc_name"], {"factual": None, "semantic": None, "updates_behind": 0})
        cls = row["field_class"]
        if entry[cls] is None:
            entry[cls] = row["changed_at"]
        entry["updates_behind"] += 1

    out = []
    for doc in db.services().find({}, {"_id": 0, "embedding": 0}):
        p = pending.get(doc["name"], {"factual": None, "semantic": None, "updates_behind": 0})
        def age(ts):
            if ts is None:
                return None
            t = _norm(ts)
            return int((now - t).total_seconds())
        embedded_at_dt = _norm(doc.get("embedded_at"))
        out.append({
            "name": doc["name"],
            "status": doc["status"],
            "price": doc.get("price", "n/a"),
            "facts_behind_s": age(p["factual"]),
            "search_behind_s": age(p["semantic"]),
            "updates_behind": p["updates_behind"],
            "embedding_version": doc.get("embedding_version"),
            "embedded_at": embedded_at_dt.isoformat() if embedded_at_dt else None,
            "embed_ms": doc.get("embed_ms"),
            "content_fresh": doc.get("content_hash") == content_hash(doc["runbook_text"]),
        })
    return out