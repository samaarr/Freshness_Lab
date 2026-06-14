"""Change-stream listener — background thread, resume-token aware.

Watches `services` with full_document="updateLookup", routes every update
through pipeline.handle_change. Reconnects on PyMongoError (Atlas M0 drops
idle connections); resumes from the last token so no events are lost.
"""
import logging
import threading
import time

from pymongo.errors import PyMongoError

import db
import mode as mode_state
import pipeline

log = logging.getLogger("watcher")

_stop = threading.Event()
_thread: threading.Thread | None = None


def _run() -> None:
    resume_token = None
    while not _stop.is_set():
        try:
            kwargs = {"full_document": "updateLookup"}
            if resume_token:
                kwargs["resume_after"] = resume_token
            with db.services().watch(**kwargs) as stream:
                log.info("change stream open")
                for event in stream:
                    resume_token = stream.resume_token
                    if _stop.is_set():
                        return
                    if event.get("operationType") != "update":
                        continue
                    full_doc = event.get("fullDocument")
                    if not full_doc:
                        continue
                    changed = set(event.get("updateDescription", {}).get("updatedFields", {}).keys())
                    removed = set(event.get("updateDescription", {}).get("removedFields", []))
                    changed |= removed
                    # changed_at from the event's cluster time (server clock, honest TTF)
                    cluster_ts = event.get("clusterTime")
                    changed_at = cluster_ts.as_datetime() if cluster_ts else None
                    pipeline.handle_change(
                        doc_name=full_doc["name"],
                        changed_fields=changed,
                        full_doc=full_doc,
                        mode=mode_state.get_mode(),
                        changed_at=changed_at,
                    )
        except PyMongoError as exc:
            log.warning("change stream dropped (%s) — reconnecting in 2s", exc)
            time.sleep(2)
        except Exception:  # never let the thread die silently
            log.exception("watcher crashed — restarting in 5s")
            time.sleep(5)


def start() -> None:
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_run, name="freshness-watcher", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
