from __future__ import annotations

import json
import re
from pathlib import Path
from typing import List

from .schemas import AssistantVoiceViolation


BANNED_VOCABULARY = (
    "assistant_prompt_route",
    "capability id",
    "chain-of-thought",
    "codex_local",
    "node_ref",
    "plan card",
    "provider_",
    "reviewable workflow",
    "sandbox",
)
REPLY_POLICY = json.loads(Path(__file__).with_name("reply_policy.json").read_text())
REPLY_WORD_LIMIT = REPLY_POLICY["word_limits"]["default"]


def count_reply_words(reply: str) -> int:
    text = re.sub(REPLY_POLICY["markdown_separator_pattern"], " ", str(reply or ""))
    return len(re.findall(REPLY_POLICY["word_pattern"], text))


def lint_assistant_reply(reply: str, *, capability: str = "general") -> List[AssistantVoiceViolation]:
    lowered = str(reply or "").lower()
    violations: List[AssistantVoiceViolation] = []
    terms = [term for term in BANNED_VOCABULARY if term in lowered]
    if terms:
        violations.append(AssistantVoiceViolation(code="banned_vocabulary", terms=terms))
    word_count = count_reply_words(reply)
    if word_count > REPLY_POLICY["word_limits"].get(capability, REPLY_WORD_LIMIT):
        violations.append(
            AssistantVoiceViolation(
                code="reply_too_long",
                word_count=word_count,
            )
        )
    return violations
