"""snapshot_text rendering — the naive serve-the-snapshot pattern, simulated honestly.

The blob includes the FACTUAL fields (availability, price) rendered as text at
embed time. Baseline mode answers from this; the facts being in here — and
potentially stale — is the entire point of Mechanism B (payload drift).
"""
import hashlib


def render_snapshot(doc: dict) -> str:
    return (
        f"{doc['name']} — availability: {doc['status']} · "
        f"price: {doc.get('price', 'n/a')}\n"
        f"{doc['runbook_text']}"
    )


def content_hash(runbook_text: str) -> str:
    """sha256 of the semantic text ONLY — load-bearing for the classifier story."""
    return hashlib.sha256(runbook_text.encode()).hexdigest()
