"""Embedder interface + implementations.

Rule (load-bearing): only runbook_text is ever embedded. Factual fields
(status, error_rate, on_call) are never part of the embedded text.
"""
import hashlib
import math
from typing import Protocol, runtime_checkable

from config import EMBEDDER


@runtime_checkable
class Embedder(Protocol):
    @property
    def dimensions(self) -> int: ...
    def embed(self, text: str) -> list[float]: ...


class SentenceTransformerEmbedder:
    """Default: all-MiniLM-L6-v2, 384 dims, local + free. Lazy import so
    environments without torch (CI, unit tests) never pay for it."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        from sentence_transformers import SentenceTransformer  # lazy
        self._model = SentenceTransformer(model_name)
        self._dims = self._model.get_sentence_embedding_dimension()

    @property
    def dimensions(self) -> int:
        return self._dims

    def embed(self, text: str) -> list[float]:
        return self._model.encode(text, normalize_embeddings=True).tolist()


class FakeEmbedder:
    """Deterministic hash-based embedder for tests — no ML deps.
    Similar texts do NOT get similar vectors; tests must not rely on semantics."""

    def __init__(self, dims: int = 384):
        self._dims = dims

    @property
    def dimensions(self) -> int:
        return self._dims

    def embed(self, text: str) -> list[float]:
        vec = []
        for i in range(self._dims):
            h = hashlib.sha256(f"{i}:{text}".encode()).digest()
            vec.append(int.from_bytes(h[:4], "big") / 2**32 - 0.5)
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


class VoyageEmbedder:
    """Stub — config slot reserved. Not implemented in v1 (BRIEF §5)."""

    def __init__(self):
        raise NotImplementedError("Voyage embedder is a v1 stub. Set EMBEDDER=sentence-transformers.")


_instance: Embedder | None = None


def get_embedder() -> Embedder:
    global _instance
    if _instance is None:
        if EMBEDDER == "fake":
            _instance = FakeEmbedder()
        elif EMBEDDER == "voyage":
            _instance = VoyageEmbedder()
        else:
            _instance = SentenceTransformerEmbedder()
    return _instance
