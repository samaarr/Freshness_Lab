"""Agent path — strict-context Claude answers + provenance.

Context composition fork (the critical one, BRIEF §3 Layer 3):
  live mode     -> runbook from the doc + factual fields RE-READ LIVE
  baseline mode -> snapshot_text exactly as captured at embed time
Claude runs strict-context, temperature 0; responses cached by
(question, context) hash so benchmark reruns are free and reproducible.
"""
import hashlib
from datetime import timezone

import db
import mode as mode_state
import pipeline
from config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL, VECTOR_INDEX_NAME
from embedder import get_embedder
from snapshot import render_snapshot

SYSTEM_PROMPT = (
    "You are a restaurant's AI waiter. Answer ONLY from the provided context."
    "Never use outside knowledge. If the context does not contain the answer, say so. "
    "Keep answers to one or two sentences. "
    "End every answer with a final line in exactly this format:\n"
    "STATUS: available|limited|sold_out|unknown\n"
    "where the value is the dish availability as stated in the context."
)


def retrieve(question: str) -> dict | None:
    vec = get_embedder().embed(question)
    pipe = [
        {"$vectorSearch": {"index": VECTOR_INDEX_NAME, "path": "embedding",
                           "queryVector": vec, "numCandidates": 50, "limit": 1}},
        {"$project": {"_id": 0, "embedding": 0}},
    ]
    pipe[1]["$project"] = {"_id": 0, "name": 1, "status": 1, "error_rate": 1, "on_call": 1,
                           "runbook_text": 1, "snapshot_text": 1, "embedding_version": 1,
                           "embedded_at": 1, "updated_at": 1,
                           "similarity_score": {"$meta": "vectorSearchScore"}}
    res = list(db.services().aggregate(pipe))
    return res[0] if res else None


def compose_context(doc: dict, mode: str) -> str:
    if mode == "live":
        live = db.services().find_one({"name": doc["name"]}, {"_id": 0, "embedding": 0})
        return render_snapshot(live)  # rendered from CURRENT fields — the live re-read
    return doc.get("snapshot_text", "")  # the naive pattern: serve the embed-time snapshot


def _cache_key(question: str, context: str) -> str:
    return hashlib.sha256(f"{question}\n---\n{context}".encode()).hexdigest()


def call_claude(question: str, context: str) -> str:
    key = _cache_key(question, context)
    cached = db.llm_cache().find_one({"_id": key})
    if cached:
        return cached["answer"]
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not set — add it to backend/.env")
    import anthropic  # lazy
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    msg = client.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=300,
        temperature=0,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"}],
    )
    answer = "".join(b.text for b in msg.content if b.type == "text")
    db.llm_cache().insert_one({"_id": key, "question": question, "answer": answer})
    return answer


def ask(question: str) -> dict:
    mode = mode_state.get_mode()
    doc = retrieve(question)
    if not doc:
        return {"answer": "Retrieval returned nothing — index may not be ready.", "provenance": None}
    context = compose_context(doc, mode)
    answer = call_claude(question, context)

    embedded_at = doc.get("embedded_at")
    snapshot_age_s = None
    if embedded_at is not None:
        t = embedded_at if embedded_at.tzinfo else embedded_at.replace(tzinfo=timezone.utc)
        snapshot_age_s = int((pipeline.utcnow() - t).total_seconds())

    truth = db.services().find_one({"name": doc["name"]}, {"_id": 0, "status": 1, "embedding_version": 1, "updated_at": 1})
    provenance = {
        "question": question,
        "retrieved_doc": doc["name"],
        "similarity_score": round(float(doc.get("similarity_score", 0.0)), 4),
        "embedding_version_used": doc.get("embedding_version"),
        "snapshot_age_s": snapshot_age_s,
        "live_read": mode == "live",
        "mode": mode,
        "context_status": None,
        "truth_status": truth["status"] if truth else None,
        "truth_version": truth.get("embedding_version") if truth else None,
    }
    # status as stated in the context the model saw (for the inspector compare card)
    for s in ("sold_out", "limited", "available"):
        if f"availability: {s}" in context:
            provenance["context_status"] = s
            break
    return {"answer": answer, "provenance": provenance}
