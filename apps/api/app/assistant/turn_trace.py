from __future__ import annotations

from typing import Any, Dict


def compaction_error_trace(error: BaseException) -> Dict[str, Any]:
    current: BaseException | None = error
    while current is not None:
        trace = getattr(current, "assistant_turn_trace", None) or getattr(current, "compaction_trace", None)
        if isinstance(trace, dict):
            return trace
        current = current.__cause__
    return {}


def build_assistant_turn_trace(content_json: Dict[str, Any] | None, content_text: str = "") -> Dict[str, Any]:
    payload = content_json if isinstance(content_json, dict) else {}
    kernel_turn = payload.get("kernel_turn") if isinstance(payload.get("kernel_turn"), dict) else {}
    kernel_trace = kernel_turn.get("trace") if isinstance(kernel_turn.get("trace"), dict) else {}
    provider_steps = (
        kernel_trace.get("provider_steps")
        if isinstance(kernel_trace.get("provider_steps"), list)
        else []
    )
    graph_plan = payload.get("graph_plan") if isinstance(payload.get("graph_plan"), dict) else {}
    diff_summary = payload.get("diff_summary") if isinstance(payload.get("diff_summary"), dict) else {}
    operation_count = payload.get("operation_count")
    if operation_count is None:
        operation_count = diff_summary.get("operation_count")
    if operation_count is None and isinstance(graph_plan.get("operations"), list):
        operation_count = len(graph_plan["operations"])
    questions = payload.get("questions") if isinstance(payload.get("questions"), list) else []
    warnings = payload.get("warnings") if isinstance(payload.get("warnings"), list) else []
    def total_usage(key, detail=None):
        values = [(step.get("usage") if isinstance(step.get("usage"), dict) else {}).get(key) for step in provider_steps if isinstance(step, dict)]
        if detail:
            values = [value.get(detail) if isinstance(value, dict) else None for value in values]
        return sum(values) if values and all(isinstance(value, (int, float)) for value in values) else None

    def total_step_value(key):
        values = [step.get(key) if isinstance(step, dict) else None for step in provider_steps]
        return sum(values) if values and all(isinstance(value, (int, float)) for value in values) else None

    tool_calls = [call for call in kernel_trace.get("tool_calls", []) if isinstance(call, dict)] if isinstance(kernel_trace.get("tool_calls"), list) else []
    identities = [(call.get("tool_name"), call.get("arguments_hash")) for call in tool_calls]
    return {
        "provider_input_tokens": total_usage("prompt_tokens"),
        "provider_output_tokens": total_usage("completion_tokens"),
        "provider_reasoning_output_tokens": total_usage("completion_tokens_details", "reasoning_tokens"),
        "provider_cached_input_tokens": total_usage("prompt_tokens_details", "cached_tokens"),
        "provider_uncached_input_tokens": total_usage("uncached_input_tokens"),
        "repeated_tool_calls": len(identities) - len(set(identities)),
        "tool_errors": sum(bool(call.get("error")) for call in tool_calls),
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
        "provider_lifecycle": (
            kernel_trace.get("provider_lifecycle")
            if isinstance(kernel_trace.get("provider_lifecycle"), list)
            else []
        ),
        "provider_steps": provider_steps,
        "provider_process_spawns": sum(
            1
            for step in provider_steps
            if isinstance(step, dict) and step.get("process_lifecycle") == "process_spawned"
        ),
        "provider_reuse_modes": [
            str(step.get("reuse_mode"))
            for step in provider_steps
            if isinstance(step, dict) and step.get("reuse_mode")
        ],
        "provider_prompt_bytes": total_step_value("prompt_bytes"),
        "provider_latency_ms": total_step_value("latency_ms"),
        "provider_total_tokens": total_usage("total_tokens"),
        "tool_calls": kernel_trace.get("tool_calls") if isinstance(kernel_trace.get("tool_calls"), list) else [],
        "visible_text_char_count": len(str(content_text or "")),
    }
