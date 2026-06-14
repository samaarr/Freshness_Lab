"""Deterministic enum grading — never LLM-judged.

The waiter is instructed to end every answer with a machine-readable line:
    STATUS: available|limited|sold_out|unknown
The grader parses that line and exact-matches it against ground-truth availability.
"""
import re

STATUS_RE = re.compile(r"STATUS:\s*(available|limited|sold_out|unknown)", re.IGNORECASE)


def parse_status(answer: str) -> str:
    m = STATUS_RE.search(answer or "")
    return m.group(1).lower() if m else "unparsed"


def grade(answer: str, truth_status: str) -> bool:
    return parse_status(answer) == truth_status
