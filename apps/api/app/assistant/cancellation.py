from __future__ import annotations

from contextlib import contextmanager
from threading import Event, Lock
from typing import Iterator


class AssistantRequestCancelled(Exception):
    """Raised when an in-flight assistant provider turn is cancelled."""


_lock = Lock()
_events: dict[str, Event] = {}


@contextmanager
def track_session(session_id: str) -> Iterator[Event]:
    with _lock:
        event = _events.get(session_id)
        if event is None or event.is_set():
            event = Event()
            _events[session_id] = event
    try:
        yield event
    finally:
        with _lock:
            if _events.get(session_id) is event:
                _events.pop(session_id, None)


def cancel_session(session_id: str) -> bool:
    with _lock:
        event = _events.get(session_id)
    if not event:
        return False
    event.set()
    return True


def is_cancelled(event: Event | None) -> bool:
    return bool(event and event.is_set())
