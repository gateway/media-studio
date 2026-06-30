from __future__ import annotations

from typing import Any, Dict


def build_assistant_turn_trace(content_json: Dict[str, Any] | None, content_text: str = "") -> Dict[str, Any]:
    payload = content_json if isinstance(content_json, dict) else {}
    graph_plan = payload.get("graph_plan") if isinstance(payload.get("graph_plan"), dict) else {}
    diff_summary = payload.get("diff_summary") if isinstance(payload.get("diff_summary"), dict) else {}
    operation_count = payload.get("operation_count")
    if operation_count is None:
        operation_count = diff_summary.get("operation_count")
    if operation_count is None and isinstance(graph_plan.get("operations"), list):
        operation_count = len(graph_plan["operations"])
    questions = payload.get("questions") if isinstance(payload.get("questions"), list) else []
    warnings = payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
    return {
        "response_kind": str(payload.get("assistant_response_kind") or ""),
        "mode": str(payload.get("mode") or ""),
        "assistant_prompt_route": str(payload.get("assistant_prompt_route") or ""),
        "suggested_action": payload.get("suggested_action"),
        "capability": payload.get("capability"),
        "canvas_context_used": bool(payload.get("canvas_context_used")),
        "operation_count": int(operation_count or 0),
        "question_count": len(questions),
        "warning_count": len(warnings),
        "requires_confirmation": payload.get("requires_confirmation"),
        "validation_valid": payload.get("validation_valid"),
        "visible_text_char_count": len(str(content_text or "")),
    }
