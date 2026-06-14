"""Seed — restaurant menu. Idempotent upsert by name; creates + polls the vector index.

Mechanics identical to the verified build:
  - only runbook_text (the dish description) is embedded
  - snapshot_text is the embed-time blob incl. availability + price (Mechanism B surface)
The dish descriptions are written distinct enough that $vectorSearch can tell them apart.
"""
import sys
import time

import db
from config import VECTOR_INDEX_NAME
from embedder import get_embedder
from pipeline import utcnow
from snapshot import content_hash, render_snapshot

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
    # Clear pending ledger entries so the UI starts with zero staleness.
    # These are synthetic test entries from prior demo runs; wiping them is correct.
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


if __name__ == "__main__":
    main()
