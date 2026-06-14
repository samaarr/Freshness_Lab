"""Demo mode — in-memory app state. baseline | live."""
import threading

_mode = "baseline"
_lock = threading.Lock()
VALID = {"baseline", "live"}


def get_mode() -> str:
    with _lock:
        return _mode


def set_mode(value: str) -> str:
    global _mode
    if value not in VALID:
        raise ValueError(f"mode must be one of {sorted(VALID)}")
    with _lock:
        _mode = value
    return _mode
