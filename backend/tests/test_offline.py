"""Offline unit tests — no Atlas, no torch, no network. Run: pytest tests/ -q"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("EMBEDDER", "fake")
os.environ.setdefault("MONGODB_URI", "mongodb://unused")

from classifier import classify
from embedder import FakeEmbedder
from grading import grade, parse_status
from snapshot import content_hash, render_snapshot


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


# --- fake embedder -----------------------------------------------------------
def test_fake_embedder_deterministic_and_normalized():
    e = FakeEmbedder()
    v1, v2 = e.embed("hello"), e.embed("hello")
    assert v1 == v2 and len(v1) == 384
    assert abs(sum(x * x for x in v1) - 1.0) < 1e-6
    assert e.embed("other") != v1
