"""Central config — all env-driven. Never hardcode credentials.

Restaurant domain: a `service` is a dish; `status` is its availability.
Mechanics are unchanged from the verified build — only the factual-field set
reflects the new domain (a dish's availability and price are the live facts).
"""
import os
from dotenv import load_dotenv

load_dotenv()

MONGODB_URI: str = os.getenv("MONGODB_URI", "")
DB_NAME: str = os.getenv("DB_NAME", "freshness-lab")
EMBEDDER: str = os.getenv("EMBEDDER", "sentence-transformers")
ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
CORS_ORIGINS: list[str] = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

COLLECTION_SERVICES = "services"
COLLECTION_LEDGER = "freshness_ledger"
COLLECTION_LLM_CACHE = "llm_cache"
COLLECTION_BENCH = "benchmark_results"
VECTOR_INDEX_NAME = "runbook_vector_index"

# semantic field (re-embed on change) · the dish description / recipe
SEMANTIC_FIELDS = {"runbook_text"}
# factual fields (refresh value only, NO re-embed) · the dish's live facts
FACTUAL_FIELDS = {"status", "price"}
# pipeline's own writes — changes touching ONLY these are ignored (loop guard)
PIPELINE_FIELDS = {"embedding", "embedding_version", "embedded_at", "content_hash", "snapshot_text", "updated_at"}
