"""In-process SSE broker — watcher/pipeline publish, /api/events streams."""
import asyncio
import json
import queue
import threading

_subscribers: list[queue.Queue] = []
_lock = threading.Lock()


def publish(event_type: str, data: dict) -> None:
    payload = {"type": event_type, **data}
    with _lock:
        for q in list(_subscribers):
            try:
                q.put_nowait(payload)
            except queue.Full:
                pass


def subscribe() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=200)
    with _lock:
        _subscribers.append(q)
    return q


def unsubscribe(q: queue.Queue) -> None:
    with _lock:
        if q in _subscribers:
            _subscribers.remove(q)


async def sse_stream(q: queue.Queue):
    """Async generator bridging the thread-safe queue into an SSE response."""
    try:
        while True:
            try:
                item = q.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.2)
                yield ": keepalive\n\n"
                continue
            yield f"data: {json.dumps(item, default=str)}\n\n"
    finally:
        unsubscribe(q)
