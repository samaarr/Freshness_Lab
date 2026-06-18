"""Offline unit tests — no Atlas, no torch, no network. Run: pytest tests/ -q"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("EMBEDDER", "fake")
os.environ.setdefault("MONGODB_URI", "mongodb://unused")

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from classifier import classify
from embedder import FakeEmbedder
from grading import grade, parse_status
from snapshot import content_hash, render_snapshot
import pipeline


# --- classifier: the crux ---------------------------------------------------
def test_semantic_change():
    assert classify({"runbook_text"}) == "semantic"

def test_factual_only_change_is_not_semantic():
    assert classify({"status"}) == "factual"
    assert classify({"status", "price"}) == "factual"

def test_pipeline_writes_are_ignored_loop_guard():
    assert classify({"embedding", "embedding_version", "embedded_at", "content_hash", "snapshot_text"}) == "ignore"
    assert classify({"updated_at"}) == "ignore"
    assert classify({"embedding.0", "embedding.1"}) == "ignore"  # dotted subpaths

def test_mixed_classifies_semantic():
    assert classify({"runbook_text", "status"}) == "semantic"

def test_empty_ignored():
    assert classify(set()) == "ignore"


# --- snapshot ----------------------------------------------------------------
DOC = {"name": "risotto", "status": "available", "price": "EUR 24",
       "runbook_text": "Symptoms: X. Steps: Y."}

def test_snapshot_contains_facts():
    s = render_snapshot(DOC)
    assert "availability: available" in s and "EUR 24" in s and "Symptoms: X" in s

def test_snapshot_reflects_flip():
    s = render_snapshot({**DOC, "status": "sold_out"})
    assert "availability: sold_out" in s

def test_content_hash_is_runbook_only():
    h1 = content_hash(DOC["runbook_text"])
    h2 = content_hash(DOC["runbook_text"])
    assert h1 == h2
    assert content_hash("different") != h1


# --- grading -----------------------------------------------------------------
def test_parse_status():
    assert parse_status("Dish is ready.\nSTATUS: available") == "available"
    assert parse_status("Sold out.\nstatus: SOLD_OUT") == "sold_out"
    assert parse_status("no machine line") == "unparsed"

def test_grade_exact_match():
    assert grade("Fine.\nSTATUS: available", "available") is True
    assert grade("Fine.\nSTATUS: available", "sold_out") is False


# --- reconcile_pending -------------------------------------------------------
# Scenario: pending baseline row exists → switch to live → row closed with real
# ttf, freshness_state reports in-sync.

def _make_mock_db(pending_rows, service_docs):
    """Build a mock db module for pipeline tests."""
    ledger_coll = MagicMock()
    ledger_coll.find.return_value = list(pending_rows)
    ledger_updates = []
    def _ledger_update_one(filter_, update, **kw):
        ledger_updates.append(update)
    ledger_coll.update_one.side_effect = _ledger_update_one

    services_coll = MagicMock()
    services_coll.find.return_value = list(service_docs)
    services_coll.find_one.side_effect = lambda q, *a, **kw: next(
        (d for d in service_docs if d["name"] == q.get("name")), None
    )
    services_coll.update_one.return_value = MagicMock()

    mock_db = MagicMock()
    mock_db.ledger.return_value = ledger_coll
    mock_db.services.return_value = services_coll

    return mock_db, ledger_updates


def test_reconcile_factual_row_closed_with_honest_ttf():
    age_s = 45
    changed_at = datetime.now(timezone.utc) - timedelta(seconds=age_s)
    row = {
        "_id": "row_f1",
        "doc_name": "risotto",
        "field_class": "factual",
        "changed_at": changed_at,
        "synced_at": None,
        "ttf_ms": None,
    }
    doc = {"name": "risotto", "status": "sold_out", "price": "EUR 24",
           "runbook_text": "Creamy rice.", "embedding_version": 2}

    mock_db, ledger_updates = _make_mock_db([row], [doc])

    with patch.object(pipeline, "db", mock_db), \
         patch.object(pipeline.events, "publish"), \
         patch("pipeline.get_embedder", return_value=FakeEmbedder()):
        result = pipeline.reconcile_pending()

    assert result["docs_synced"] == 1
    assert result["rows_closed"] == 1

    assert len(ledger_updates) == 1
    u = ledger_updates[0]["$set"]
    assert u["synced_at"] is not None
    assert u["ttf_ms"] >= age_s * 1000           # at least as old as the pending row
    assert u["ttf_ms"] < (age_s + 10) * 1000     # not wildly over (within 10s of process time)

    # sync_factual refreshes snapshot — services.update_one must have been called
    mock_db.services.return_value.update_one.assert_called()


def test_reconcile_semantic_row_triggers_reembed():
    changed_at = datetime.now(timezone.utc) - timedelta(seconds=10)
    row = {
        "_id": "row_s1",
        "doc_name": "risotto",
        "field_class": "semantic",
        "changed_at": changed_at,
        "synced_at": None,
        "ttf_ms": None,
    }
    doc = {"name": "risotto", "status": "available", "price": "EUR 24",
           "runbook_text": "Truffle mushroom risotto.", "embedding_version": 1}

    mock_db, ledger_updates = _make_mock_db([row], [doc])
    fake_emb = FakeEmbedder()

    with patch.object(pipeline, "db", mock_db), \
         patch.object(pipeline.events, "publish"), \
         patch("pipeline.get_embedder", return_value=fake_emb):
        result = pipeline.reconcile_pending()

    assert result["rows_closed"] == 1
    u = ledger_updates[0]["$set"]
    assert u["ttf_ms"] >= 0

    # sync_semantic calls services.update_one with embedding field
    call_args = mock_db.services.return_value.update_one.call_args
    assert "embedding" in call_args[0][1]["$set"]


def test_reconcile_semantic_takes_priority_over_factual():
    """When a doc has both semantic and factual pending rows, sync_semantic is called."""
    t = datetime.now(timezone.utc) - timedelta(seconds=20)
    rows = [
        {"_id": "row_f", "doc_name": "risotto", "field_class": "factual",  "changed_at": t, "synced_at": None, "ttf_ms": None},
        {"_id": "row_s", "doc_name": "risotto", "field_class": "semantic", "changed_at": t, "synced_at": None, "ttf_ms": None},
    ]
    doc = {"name": "risotto", "status": "sold_out", "price": "EUR 24",
           "runbook_text": "New description.", "embedding_version": 3}

    mock_db, ledger_updates = _make_mock_db(rows, [doc])

    with patch.object(pipeline, "db", mock_db), \
         patch.object(pipeline.events, "publish"), \
         patch("pipeline.get_embedder", return_value=FakeEmbedder()):
        result = pipeline.reconcile_pending()

    assert result["docs_synced"] == 1
    assert result["rows_closed"] == 2
    assert len(ledger_updates) == 2

    call_args = mock_db.services.return_value.update_one.call_args
    assert "embedding" in call_args[0][1]["$set"]


def test_freshness_state_in_sync_after_reconcile():
    """freshness_state returns None staleness when no pending rows remain."""
    doc = {
        "name": "risotto", "status": "available", "price": "EUR 24",
        "runbook_text": "Creamy rice.", "embedding_version": 1,
        "embedded_at": datetime.now(timezone.utc), "embed_ms": 120,
        "content_hash": content_hash("Creamy rice."),
    }

    # Simulate post-reconcile state: ledger has no pending rows
    ledger_coll = MagicMock()
    find_result = MagicMock()
    find_result.sort.return_value = []          # .find(...).sort(...) → empty
    ledger_coll.find.return_value = find_result

    services_coll = MagicMock()
    services_coll.find.return_value = [doc]

    mock_db = MagicMock()
    mock_db.ledger.return_value = ledger_coll
    mock_db.services.return_value = services_coll

    with patch.object(pipeline, "db", mock_db):
        state = pipeline.freshness_state()

    assert len(state) == 1
    row = state[0]
    assert row["facts_behind_s"] is None
    assert row["search_behind_s"] is None
    assert row["content_fresh"] is True


# --- fake embedder -----------------------------------------------------------
def test_fake_embedder_deterministic_and_normalized():
    e = FakeEmbedder()
    v1, v2 = e.embed("hello"), e.embed("hello")
    assert v1 == v2 and len(v1) == 384
    assert abs(sum(x * x for x in v1) - 1.0) < 1e-6
    assert e.embed("other") != v1
