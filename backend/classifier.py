"""Field classifier — the crux of the two-mechanism split.

Pure function, unit-tested in isolation. Given the set of field names that
changed in a change-stream event, decide the route:

  "semantic" — runbook_text changed (alone or mixed) -> re-embed (Mechanism A)
  "factual"  — only status/error_rate/on_call changed -> NO re-embed (Mechanism B)
  "ignore"   — only pipeline-written fields changed -> no action (loop guard)
"""
from config import FACTUAL_FIELDS, PIPELINE_FIELDS, SEMANTIC_FIELDS


def classify(changed_fields: set[str]) -> str:
    # Strip subfield paths like "embedding.0" down to the root field name.
    roots = {f.split(".")[0] for f in changed_fields}
    if roots & SEMANTIC_FIELDS:
        return "semantic"
    if roots & FACTUAL_FIELDS:
        return "factual"
    if roots and roots <= PIPELINE_FIELDS:
        return "ignore"
    return "ignore"
