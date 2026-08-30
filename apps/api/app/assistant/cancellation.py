from __future__ import annotations

from contextlib import contextmanager
from threading import Event, Lock
import time
from typing import Iterator


class AssistantRequestCancelled(Exception):
    """Raised when an in-flight assistant provider turn is cancelled."""

    def __init__(self, message: str, *, outcome: str = "interrupted") -> None:
        super().__init__(message)
        self.outcome = outcome


class AssistantSessionBusy(Exception):
    """Raised when another provider turn already owns an assistant session."""


_lock = Lock()
_events: dict[str, Event] = {}
_done_events: dict[str, Event] = {}
_progress: dict[str, dict[str, object]] = {}


@contextmanager
def track_session(session_id: str) -> Iterator[Event]:
    with _lock:
        if session_id in _events:
            raise AssistantSessionBusy(
                "The assistant is already working on this session. Stop it or wait for the current reply."
            )
        event = Event()
        done_event = Event()
        _events[session_id] = event
        _done_events[session_id] = done_event
        _progress[session_id] = {
            "stage": "thinking",
            "label": "Thinking through your request…",
            "started_at": time.monotonic(),
        }
    try:
        yield event
    finally:
        with _lock:
            if _events.get(session_id) is event:
                _events.pop(session_id, None)
            if _done_events.get(session_id) is done_event:
                _done_events.pop(session_id, None)
            _progress.pop(session_id, None)
        done_event.set()


def cancel_session(session_id: str) -> bool:
    with _lock:
        event = _events.get(session_id)
    if not event:
        return False
    event.set()
    return True


def wait_for_session_idle(session_id: str, timeout_seconds: float) -> bool:
    with _lock:
        done_event = _done_events.get(session_id)
    return True if done_event is None else done_event.wait(timeout_seconds)


def is_cancelled(event: Event | None) -> bool:
    return bool(event and event.is_set())


def publish_session_progress(session_id: str, *, stage: str, label: str) -> None:
    with _lock:
        progress = _progress.get(session_id)
        if progress is not None:
            progress.update(stage=stage, label=label)


def session_progress(session_id: str) -> dict[str, object]:
    with _lock:
        progress = dict(_progress.get(session_id) or {})
    if not progress:
        return {"active": False, "stage": "idle", "label": "", "elapsed_seconds": 0}
    return {
        "active": True,
        "stage": progress["stage"],
        "label": progress["label"],
        "elapsed_seconds": max(0, int(time.monotonic() - float(progress["started_at"]))),
    }
