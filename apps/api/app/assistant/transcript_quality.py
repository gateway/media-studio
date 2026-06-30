from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List


MACHINERY_PHRASES = (
    "workflow ready for review",
    "clip assembly not ready yet",
    "plan mode",
    "operation count",
    "template_id",
    "assistantgraphplan",
    "graph plan json",
)
INLINE_LIST_COLLAPSE_PATTERN = re.compile(r":[ \t]+[-*][ \t]+(?:`|\*\*)?[A-Za-z0-9]")


def audit_assistant_transcript(messages: Iterable[Dict[str, Any]]) -> Dict[str, Any]:
    issues: List[Dict[str, Any]] = []
    message_count = 0
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        message_count += 1
        text = str(message.get("content_text") or "")
        lowered = text.lower()
        for phrase in MACHINERY_PHRASES:
            if phrase in lowered:
                issues.append(
                    {
                        "code": "assistant_machinery_phrase",
                        "phrase": phrase,
                        "assistant_message_id": message.get("assistant_message_id"),
                    }
                )
        if len(text) > 520 and "\n" not in text:
            issues.append(
                {
                    "code": "assistant_long_unformatted_reply",
                    "assistant_message_id": message.get("assistant_message_id"),
                    "char_count": len(text),
                }
            )
        if INLINE_LIST_COLLAPSE_PATTERN.search(text):
            issues.append(
                {
                    "code": "assistant_inline_list_collapse",
                    "assistant_message_id": message.get("assistant_message_id"),
                }
            )
    return {
        "passed": not issues,
        "assistant_message_count": message_count,
        "issue_count": len(issues),
        "issues": issues,
    }
