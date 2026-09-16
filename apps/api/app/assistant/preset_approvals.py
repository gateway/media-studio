"""Bound explicit preset choices to user sources in the existing session summary."""
from __future__ import annotations

import re
from typing import Any

from .. import store_assistant
from .preset_slots import _normalized_phrase as normalize


_UNCONFIRMED = r"\b(?:not|never|no|if|when|unless|maybe|perhaps|could|would|might|should|whether|don t|doesn t|isn t|won t)\b"


def _direct_assertion(change: Any, text: str) -> bool:
    # A conservative evidence grammar, not a natural-language intent router.
    source = change.source_span.strip()
    sentences = re.split(r"(?<=[.!?])\s+|\n+", text)
    sentence = next((s.strip() for s in sentences if source.rstrip(".!?") == s.strip().rstrip(".!?")), "")
    if not sentence or source not in text or sentence.endswith("?") or sentence[:1] in "\"'“‘":
        return False
    phrase = normalize(sentence)
    if change.action == "withdraw":
        target = re.escape(normalize(change.label))
        removal = re.fullmatch(
            rf"(?:please )?(?:remove|drop|withdraw|omit) (?:only |the )?{target}"
            r"(?: field| input| slot| image| approval)?(?: from (?:this|the) (?:draft|preset))?", phrase,
        )
        replacement = re.fullmatch(rf"(?:please )?replace (?:the )?{target}(?: field| input| slot| image)? with (.+)", phrase)
        return bool(removal or replacement and not re.search(_UNCONFIRMED, replacement[1]))
    request = re.fullmatch(
        r"(?:i (?:explicitly )?(?:want|request|approve|choose)|i (?:would|d) like|"
        r"(?:please )?(?:help me (?:create|draft|make)|revise (?:my|the) requirements? to (?:allow|include|use|add)|use|add|keep|include|replace|change|make|create|draft|convert|switch)) (.+)", phrase,
    )
    if change.action == "replace" and not re.match(r"(?:please )?(?:replace|change) ", phrase):
        return False
    return bool(request and not re.search(_UNCONFIRMED, request[1]))


def record_preset_approvals(session: dict, changes: list, text: str, message_id: str | None) -> dict:
    if not changes:
        return session
    message = store_assistant.get_assistant_message(message_id or "") or {}
    if (message.get("role") != "user"
            or message.get("assistant_session_id") != session.get("assistant_session_id")
            or message.get("content_text") != text):
        raise ValueError("Preset approvals require this session's actual current user message.")
    session = store_assistant.get_assistant_session(str(session.get("assistant_session_id") or "")) or session
    summary = dict(session.get("summary_json") or {})
    approvals = dict(summary.get("kernel_preset_approvals") or {})
    for change in changes:
        value = {**change.model_dump(), "action": "withdraw" if change.action == "withdraw" else "approve"}
        target = f"{change.kind}:{change.key}"
        previous = approvals.get(target) or {}
        span = f" {normalize(change.source_span)} "
        label_named = f" {normalize(change.label)} " in span
        role_named = (
            bool(change.role) and f" {normalize(change.role)} " in span
            and normalize(change.label) != normalize(change.role)
            and re.search(r"\b(?:image|photo|portrait|picture|reference)\b", span)
            and re.search(r"\b(?:as|for|to|with role)\b", span)
        )
        if change.action == "withdraw":
            fields = (summary.get("kernel_preset_draft") or {}).get(
                "input_schema_json" if change.kind == "field" else "input_slots_json", [],
            )
            known_label = previous.get("label") or next((f.get("label") for f in fields if f.get("key") == change.key), "")
            label_named = label_named and normalize(change.label) == normalize(known_label)
        if (not _direct_assertion(change, text) or not label_named
                or change.kind == "slot" and change.action != "withdraw" and not role_named):
            raise ValueError(
                f"{target}: copy a complete direct-request sentence naming the target and image role; "
                f"do not quote negative, hypothetical or partial requests. Current source: {text[:800]}"
            )
        if previous.get("user_message_id") == message_id and all(previous.get(k) == v for k, v in value.items()):
            continue
        reaffirmed = (change.action == "approve" and normalize(previous.get("label")) == normalize(change.label)
                      and normalize(previous.get("role")) == normalize(change.role))
        approvals[target] = {
            **(previous if reaffirmed else {}), **value, "user_message_id": message_id,
            "revision": int(previous.get("revision") or 0) + 1,
        }
    if len(approvals) > 24:
        raise ValueError("Too many retained preset targets; clarify the active field and image choices.")
    summary["kernel_preset_approvals"] = approvals
    return store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})


def preset_approval_sources(summary: dict, draft: Any) -> dict[str, str]:
    approvals = {key: dict(value) for key, value in (summary.get("kernel_preset_approvals") or {}).items()}
    sources = {}
    present = set()
    roles = draft.rules_json.get("runtime_image_roles")
    roles = roles if isinstance(roles, dict) else {}
    for kind, fields in (("field", draft.input_schema_json), ("slot", draft.input_slots_json)):
        for field in fields:
            target = f"{kind}:{field.get('key')}"
            present.add(target)
            approval = approvals.get(target)
            if not approval:
                continue
            role = (roles.get(field.get("key")) or {}) if kind == "slot" else {}
            role = role if isinstance(role, dict) else {}
            contract = {"field": field, "role": role.get("role", "")}
            if (approval.get("action") != "approve"
                    or normalize(approval.get("label")) != normalize(field.get("label"))
                    or kind == "slot" and normalize(approval.get("role")) != normalize(role.get("role"))
                    or approval.get("contract", contract) != contract):
                raise ValueError(
                    f"{target}: the retained choice was withdrawn or changed; obtain explicit approval for this target. "
                    f"Eligible source: {approval.get('source_span', '')}"
                )
            sources[target] = str(approval.get("source_span") or "")
            approval["contract"] = contract
    for target, approval in approvals.items():
        if target in present or target.startswith("lane:") or approval.get("action") == "withdraw":
            continue
        lane = approvals.get("lane:preset_lane") or {}
        if (target.startswith("slot:") and draft.rules_json.get("preset_lane") == "text_to_image"
                and lane.get("label") == "text_to_image" and lane.get("action") == "approve"):
            approval["action"] = "withdraw"
        else:
            raise ValueError(f"{target}: preserve this approved target or obtain an explicit withdrawal; draft omission is not consent.")
    if "lane:preset_lane" in approvals:
        approvals["lane:preset_lane"]["action"] = "withdraw"
    summary["kernel_preset_approvals"] = approvals
    return sources
