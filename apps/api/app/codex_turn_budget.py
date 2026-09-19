"""Normal-work deadline accounting that excludes observed Codex compaction."""
from __future__ import annotations

import time
from typing import Callable


class CodexTurnBudget:
    def __init__(self, seconds: float, on_compaction: Callable[[bool], None] | None = None) -> None:
        self.started_at = time.monotonic()
        self.seconds = seconds
        self.on_compaction = on_compaction
        self.compaction_started_at: float | None = None
        self.compaction_seconds = 0.0
        self.compaction_count = 0
        self.compaction_item_id: str | None = None
        self.turn_id: str | None = None
        self.compaction_turn_id: str | None = None
        self.compaction_outcome: str | None = None

    @property
    def compacting(self) -> bool:
        return self.compaction_started_at is not None

    @property
    def excluded_seconds(self) -> float:
        active = time.monotonic() - self.compaction_started_at if self.compacting else 0.0
        return self.compaction_seconds + active

    @property
    def remaining_seconds(self) -> float:
        return self.seconds - (time.monotonic() - self.started_at - self.excluded_seconds)

    def start_compaction(self, item_id: str | None = None) -> None:
        if self.turn_id:
            self.compaction_turn_id = self.turn_id
        if not self.compacting:
            self.compaction_outcome = None
            self.compaction_started_at = time.monotonic()
            self.compaction_item_id = item_id
            self.compaction_turn_id = self.turn_id
            self.compaction_count += 1
            if self.on_compaction:
                self.on_compaction(True)

    def finish_compaction(self, outcome: str = "completed") -> None:
        if self.compaction_started_at is not None:
            self.compaction_outcome = outcome
            self.compaction_seconds += time.monotonic() - self.compaction_started_at
            self.compaction_started_at = None
            self.compaction_item_id = None
            if self.on_compaction:
                self.on_compaction(False)

    def observe(self, message: dict, thread_id: str) -> None:
        params = message.get("params") or {}
        if params.get("threadId") != thread_id:
            return
        method = message.get("method")
        turn = params.get("turn") or {}
        event_turn_id = params.get("turnId") or turn.get("id")
        if method == "turn/started" and self.turn_id is None:
            self.turn_id = event_turn_id
        if not self.turn_id or event_turn_id != self.turn_id:
            return
        item = params.get("item") or {}
        if method == "item/started" and item.get("type") == "contextCompaction":
            self.start_compaction(item.get("id"))
        elif method == "item/completed" and item.get("type") == "contextCompaction":
            if item.get("id") == self.compaction_item_id:
                self.finish_compaction()
        elif method == "turn/completed":
            self.finish_compaction("completed" if turn.get("status") == "completed" else "failed")
