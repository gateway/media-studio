from __future__ import annotations

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
REPLY_WORD_LIMIT = 150


def lint_assistant_reply(reply: str) -> List[AssistantVoiceViolation]:
    lowered = str(reply or "").lower()
    violations: List[AssistantVoiceViolation] = []
    terms = [term for term in BANNED_VOCABULARY if term in lowered]
    if terms:
        violations.append(AssistantVoiceViolation(code="banned_vocabulary", terms=terms))
    word_count = len(str(reply or "").split())
    if word_count > REPLY_WORD_LIMIT:
        violations.append(
            AssistantVoiceViolation(
                code="reply_too_long",
                word_count=word_count,
            )
        )
    return violations
