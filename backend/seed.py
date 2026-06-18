"""Seed — restaurant menu. Idempotent upsert by name; creates + polls the vector index.

Mechanics identical to the verified build:
  - only runbook_text (the dish description) is embedded
  - snapshot_text is the embed-time blob incl. availability + price (Mechanism B surface)
The dish descriptions are written distinct enough that $vectorSearch can tell them apart.
"""
import json
import os
import sys
import time
import urllib.request

import db
from config import VECTOR_INDEX_NAME
from embedder import get_embedder
from pipeline import utcnow
from snapshot import content_hash, render_snapshot

_API_URL = os.getenv("FRESHNESS_LAB_URL", "http://localhost:8000")


def _api_get_mode() -> str | None:
    """Return the live server's current mode, or None if the server is unreachable."""
    try:
        with urllib.request.urlopen(f"{_API_URL}/api/mode", timeout=2) as r:
            return json.loads(r.read())["mode"]
    except Exception:
        return None


def _api_set_mode(mode: str) -> None:
    req = urllib.request.Request(
        f"{_API_URL}/api/mode",
        data=json.dumps({"mode": mode}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=5)

# (name, status, price, description)
DISHES = [
    ("risotto", "available", "EUR 24",
     "Risotto — creamy arborio rice slow-cooked with white wine and vegetable stock, finished with "
     "parmesan, saffron, and butter. Served with a drizzle of aged balsamic. Vegetarian."),
    ("carbonara", "available", "EUR 19",
     "Carbonara — spaghetti tossed with guanciale, raw egg yolk, pecorino romano, and cracked "
     "black pepper. No cream. Finished off the heat so the egg stays silky. Contains egg and pork."),
    ("bruschetta", "available", "EUR 11",
     "Bruschetta — grilled sourdough rubbed with raw garlic, topped with marinated San Marzano "
     "tomatoes, fresh basil, sea salt, and extra-virgin olive oil. Vegan. Contains gluten."),
    ("margherita", "available", "EUR 16",
     "Margherita — wood-fired pizza with San Marzano tomato base, fresh fior di latte mozzarella, "
     "basil, and olive oil on a 48-hour fermented dough. Vegetarian. Contains gluten and dairy."),
    ("tiramisu", "available", "EUR 9",
     "Tiramisu — espresso-soaked savoiardi layered with mascarpone cream, dusted with cocoa, "
     "and a touch of marsala. Made fresh daily. Contains egg, dairy, gluten, and alcohol."),
]


def main():
    emb = get_embedder()
    coll = db.services()
    print("=== freshness-lab seed (restaurant menu) ===")

    # If a live server is running, temporarily switch it to live mode so the
    # watcher reconciles seed upserts immediately instead of queuing pending rows.
    # Without this, re-seeding against a baseline-mode server would create 5
    # phantom pending rows even though seed just re-embedded everything.
    prior_mode = _api_get_mode()
    if prior_mode is not None:
        print(f"  server detected (mode={prior_mode}) — switching to live for seed upserts")
        _api_set_mode("live")

    try:
        # Clear pending ledger entries so the UI starts with zero staleness.
        deleted = db.ledger().delete_many({"synced_at": None}).deleted_count
        if deleted:
            print(f"  cleared {deleted} pending ledger entries")
        for name, status, price, desc in DISHES:
            now = utcnow()
            doc = {"name": name, "status": status, "price": price,
                   "updated_at": now, "runbook_text": desc}
            doc["embedding"] = emb.embed(desc)
            doc["embedding_version"] = 1
            doc["embedded_at"] = now
            doc["content_hash"] = content_hash(desc)
            doc["snapshot_text"] = render_snapshot(doc)
            coll.update_one({"name": name}, {"$set": doc}, upsert=True)
            print(f"  upserted {name} ({status}, {price})")

        existing = {i["name"] for i in coll.list_search_indexes()}
        if VECTOR_INDEX_NAME not in existing:
            print(f"Creating vector index '{VECTOR_INDEX_NAME}' ({emb.dimensions} dims)…")
            coll.create_search_index({
                "name": VECTOR_INDEX_NAME, "type": "vectorSearch",
                "definition": {"fields": [{"type": "vector", "path": "embedding",
                                           "numDimensions": emb.dimensions, "similarity": "cosine"}]},
            })
        print("Polling index status until READY…")
        for _ in range(60):
            idx = {i["name"]: i for i in coll.list_search_indexes()}.get(VECTOR_INDEX_NAME, {})
            if idx.get("status") == "READY":
                print("Index READY. Seed complete.")
                return
            time.sleep(5)
        print("Index did not reach READY in 5 minutes — check the Atlas console.", file=sys.stderr)
        sys.exit(1)
    finally:
        if prior_mode is not None and prior_mode != "live":
            print(f"  restoring server mode to {prior_mode}")
            try:
                _api_set_mode(prior_mode)
            except Exception as e:
                print(f"  warning: could not restore mode ({e})", file=sys.stderr)


if __name__ == "__main__":
    main()
