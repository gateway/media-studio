"""Real local-pipe delivery regressions; no subprocess, database or network."""
import io
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class AssistantTransportTests(unittest.TestCase):
    def test_completed_reply_in_one_pipe_burst_is_delivered_without_future_events(self):
        from app.codex_local_provider import _CodexAppServerSession
        from app.codex_turn_budget import CodexTurnBudget

        read_fd, write_fd = os.pipe()
        reader = os.fdopen(read_fd, "r", encoding="utf-8")
        self.addCleanup(reader.close)
        self.addCleanup(os.close, write_fd)
        session = _CodexAppServerSession(temp_root=Path("/private/tmp"), timeout_seconds=1)
        session.proc = SimpleNamespace(stdout=reader, stdin=io.StringIO(), stderr=io.StringIO())
        messages = [
            {"id": 1, "result": {"turn": {"id": "burst-turn"}}},
            {"method": "item/agentMessage/delta", "params": {"threadId": "same-thread", "turnId": "burst-turn", "delta": "Ready: café."}},
            {"method": "turn/completed", "params": {"threadId": "same-thread", "turn": {"id": "burst-turn", "status": "completed"}}},
        ]
        os.write(write_fd, ("\n".join(json.dumps(message) for message in messages) + "\n").encode())
        result = session.run_turn(thread_id="same-thread", input_items=[{"type": "text", "text": "Explain only."}], budget=CodexTurnBudget(0.05))
        self.assertEqual(result["generated_text"], "Ready: café.")
        self.assertEqual(result["provider_turn_id"], "burst-turn")


if __name__ == "__main__":
    unittest.main()
