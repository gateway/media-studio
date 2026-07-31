from __future__ import annotations

import json
import time
from threading import Event
from typing import Any, Dict, List, Optional

from .. import enhancement_provider, external_llm_usage, store_assistant
from ..graph.pricing import estimate_graph_workflow
from ..graph.schemas import GraphWorkflow
from ..store_support import new_id
from .cancellation import AssistantRequestCancelled, is_cancelled
from .kernel_tools import KernelToolContext, execute_kernel_tool, kernel_tool_catalog, workflow_fingerprint
from .prompt_assets import assistant_system_prompt_assembly
from .provider_support import AssistantProviderChatError, resolve_assistant_provider_runtime
from .schemas import (
    AssistantKernelArtifact,
    AssistantKernelCapability,
    AssistantKernelProviderStep,
    AssistantKernelProviderTrace,
    AssistantKernelTrace,
    AssistantKernelTurnResult,
    AssistantNextAction,
)


KERNEL_MAX_TOOL_STEPS = 6
KERNEL_MAX_WALL_SECONDS = 90.0
DEBUG_RUN_SIGNALS = ("failed", "failure", "what happened", "fix it", "run error", "why did")
KERNEL_CAPABILITY_PROMPTS: Dict[AssistantKernelCapability, str] = {
    "general": "apps/api/app/assistant/prompts/skills/general_helper.md",
    "graph_builder": "apps/api/app/assistant/prompts/skills/graph_workflow_builder.md",
    "preset_builder": "apps/api/app/assistant/prompts/skills/media_preset_builder.md",
    "recipe_builder": "apps/api/app/assistant/prompts/skills/prompt_recipe_builder.md",
    "story_builder": "apps/api/app/assistant/prompts/skills/story_project.md",
    "run_debugger": "apps/api/app/assistant/prompts/skills/run_debugger.md",
}


def _provider_step_schema() -> Dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "media_assistant_kernel_step",
            "strict": True,
            "schema": AssistantKernelProviderStep.model_json_schema(),
        },
    }


def _kernel_instruction(*, assistant_mode: Optional[str], user_text: str = "", prior_text: str = "") -> str:
    capability_hint = {
        "preset": "preset_builder",
        "recipe": "recipe_builder",
        "graph": "graph_builder",
    }.get(str(assistant_mode or ""))
    current_lowered = str(user_text or "").lower()
    conversation_lowered = f"{prior_text} {current_lowered}".lower()
    story_request = any(
        signal in conversation_lowered
        for signal in (
            "story idea",
            "story premise",
            "storyboard",
            "shot ",
            "shots ",
            "scene ",
            "scenes ",
            "lighthouse keeper",
            "character continuity",
            "same character",
        )
    )
    debug_request = any(signal in current_lowered for signal in DEBUG_RUN_SIGNALS)
    if capability_hint not in {"preset_builder", "recipe_builder"} and debug_request:
        capability_hint = "run_debugger"
    if capability_hint not in {"preset_builder", "recipe_builder"} and story_request:
        capability_hint = "story_builder"
    catalog = kernel_tool_catalog(capability_hint)
    short_clarification = len(current_lowered.split()) <= 8 and any(
        signal in prior_text.lower() for signal in ("which one", "choose one", "another recipe by name")
    )
    recipe_graph_request = any(
        signal in current_lowered for signal in ("graph", "wire", "canvas")
    ) or (
        short_clarification
        and any(signal in prior_text.lower() for signal in ("graph", "wire", "canvas"))
    )
    if capability_hint == "recipe_builder" and not recipe_graph_request:
        recipe_tool_names = {
            "read_current_workflow",
            "search_prompt_recipes",
            "get_prompt_recipe",
            "validate_prompt_recipe_draft",
            "propose_prompt_recipe_draft",
            "analyze_reference_images",
        }
        catalog = [tool for tool in catalog if tool["name"] in recipe_tool_names]
    return (
        "Select exactly one Media Assistant capability based on the user's request. "
        "The UI mode is only a hint and may be ignored. Use only the listed read tools. "
        "For graph building, inspect relevant node types and schemas, read the current workflow, then use "
        "propose_graph_operations; use validate_current_workflow for review-only requests and correct typed "
        "tool errors within the turn. "
        "When attached reference images matter, call analyze_reference_images and ground the reply in its typed evidence. "
        "For Media Presets, keep editable state in propose_media_preset_draft, use real model scope, and never emit a "
        "backend JSON block in the reply. Build and validate a priced test graph before requesting a save. "
        "For Prompt Recipes, use search_prompt_recipes and get_prompt_recipe for saved state, validate and persist the "
        "complete editable contract through propose_prompt_recipe_draft, and request save confirmation only when the user asks. "
        "For story work, keep the premise, characters, world rules, continuity facts, and shots in update_story_state. "
        "Respect exact shot counts. For a one-shot revision, preserve every other shot exactly. For a requested story graph, "
        "build from active_story_state through the shared graph tools and do not update story state merely to create the graph. "
        "When calling propose_graph_operations, include the concise user-facing success reply in the same step; it will be used "
        "only if the server validates the proposal. "
        "Encode the complete tool argument object as JSON in tool_call.arguments. "
        "Return either one tool_call or a user-facing reply. Do not claim facts about Media Studio state "
        "until a tool result provides them. The server owns confirmation actions; never invent one in prose. "
        "If the user explicitly asks to run the current graph, return a concise reply and request run_workflow "
        "with requires_confirmation true; never claim the run started. Do not request save actions because the "
        "server derives those from validated drafts. If the user asks to just talk or not build anything, do not "
        "propose graph operations and leave requested_action as none. "
        "Keep the reply compact and free of internal tool, route, provider, or capability vocabulary.\n\n"
        f"UI mode hint: {assistant_mode or 'none'}\n"
        f"Capabilities: {', '.join(KERNEL_CAPABILITY_PROMPTS)}\n"
        f"Tools: {json.dumps(catalog, separators=(',', ':'))}"
    )


def _kernel_attachment_context(attachments: List[Dict[str, Any]]) -> Dict[str, Any]:
    items = [
        {
            "reference_id": str(item.get("reference_id") or ""),
            "kind": str(item.get("kind") or ""),
            "label": str(item.get("label") or "")[:120],
        }
        for item in attachments
        if str(item.get("reference_id") or "")
    ]
    return {
        "attachment_count": len(items),
        "attachments": items,
    }


def _aligned_capability_hint(
    assistant_mode: Optional[str],
    user_text: str,
    prior_text: str = "",
    *,
    has_active_story: bool = False,
) -> AssistantKernelCapability | None:
    lowered = f"{prior_text} {user_text}".lower()
    if assistant_mode == "recipe" and ("recipe" in lowered or "character sheet" in lowered):
        return "recipe_builder"
    if assistant_mode == "preset" and "preset" in lowered:
        return "preset_builder"
    if any(signal in str(user_text or "").lower() for signal in DEBUG_RUN_SIGNALS):
        return "run_debugger"
    story_signals = (
        "story idea",
        "story premise",
        "storyboard",
        "shot ",
        "shots ",
        "scene ",
        "scenes ",
        "lighthouse keeper",
        "character continuity",
        "same character",
    )
    if any(signal in lowered for signal in story_signals):
        return "story_builder"
    if has_active_story and any(
        signal in lowered
        for signal in ("those", "them", "character", "graph", "canvas", "make it more")
    ):
        return "story_builder"
    return None


def _recent_conversation(session: Dict[str, Any]) -> List[Dict[str, str]]:
    session_id = str(session.get("assistant_session_id") or "")
    if not session_id:
        return []
    messages = [
        message
        for message in store_assistant.list_assistant_messages(session_id)
        if message.get("role") in {"user", "assistant"}
    ][-6:]
    return [
        {
            "role": str(message.get("role") or ""),
            "text": str(message.get("content_text") or "")[:800],
        }
        for message in messages
    ]


def _kernel_session_context(session: Dict[str, Any]) -> Dict[str, Any]:
    summary = session.get("summary_json") if isinstance(session.get("summary_json"), dict) else {}
    preset_draft = summary.get("kernel_preset_draft")
    recipe_draft = summary.get("kernel_recipe_draft")
    story_state = summary.get("kernel_story_state")
    session_id = str(session.get("assistant_session_id") or "")
    latest_applied_test_plan_id = next(
        (
            str(plan.get("assistant_plan_id") or "")
            for plan in store_assistant.list_assistant_plans(session_id)
            if str(plan.get("status") or "") == "applied"
        ),
        None,
    ) if session_id else None
    return {
        "active_preset_draft": preset_draft if isinstance(preset_draft, dict) else None,
        "active_recipe_draft": recipe_draft if isinstance(recipe_draft, dict) else None,
        "active_story_state": story_state if isinstance(story_state, dict) else None,
        "latest_graph_proposal_id": summary.get("kernel_proposal_id"),
        "latest_applied_test_plan_id": latest_applied_test_plan_id,
        "recent_conversation": _recent_conversation(session),
    }


def _preset_draft_required(user_text: str, *, has_active_draft: bool) -> bool:
    lowered = str(user_text or "").lower()
    if has_active_draft and "graph" in lowered and any(signal in lowered for signal in ("create", "build", "make")):
        return False
    draft_signals = (
        "turn",
        "create",
        "build",
        "make",
        "save",
        "field",
        "input image",
        "image input",
        "text-to-image",
        "image-to-image",
        "update",
        "revise",
    )
    return any(signal in lowered for signal in draft_signals)


def _recipe_draft_required(user_text: str, *, has_active_draft: bool) -> bool:
    lowered = str(user_text or "").lower()
    if any(signal in lowered for signal in ("graph", "wire", "canvas")):
        return False
    if "recipe" in lowered or "character sheet" in lowered:
        return True
    return has_active_draft and any(signal in lowered for signal in ("field", "variable", "image", "change", "save"))


def _story_state_update_required(user_text: str, *, has_active_state: bool) -> bool:
    lowered = str(user_text or "").lower()
    if has_active_state and any(signal in lowered for signal in ("graph", "canvas", "workflow")):
        return False
    if any(
        signal in lowered
        for signal in (
            "story idea",
            "story premise",
            "storyboard",
            "shot ",
            "shots ",
            "scene ",
            "scenes ",
            "character continuity",
            "same character",
        )
    ):
        return True
    return has_active_state and any(
        signal in lowered for signal in ("make it more", "revise", "change", "keep", "continuity")
    )


def _next_action_for_artifacts(
    capability: AssistantKernelCapability,
    artifacts: List[AssistantKernelArtifact],
    *,
    requested_action: AssistantNextAction | None = None,
    workflow: GraphWorkflow | None = None,
) -> AssistantNextAction:
    if capability == "preset_builder":
        preset_draft = next(
            (
                artifact.data
                for artifact in reversed(artifacts)
                if artifact.kind == "preset_draft" and artifact.data.get("save_ready")
            ),
            None,
        )
        if preset_draft:
            proposal_id = str(preset_draft.get("proposal_id") or "")
            confirmation_token = str(preset_draft.get("confirmation_token") or "")
            return AssistantNextAction(
                kind="save_media_preset",
                label="Save preset",
                proposal_id=proposal_id,
                confirmation_token=confirmation_token,
                requires_confirmation=True,
                payload={
                    "proposal_id": proposal_id,
                    "confirmation_token": confirmation_token,
                },
            )
    if capability == "recipe_builder":
        recipe_draft = next(
            (
                artifact.data
                for artifact in reversed(artifacts)
                if artifact.kind == "recipe_draft" and artifact.data.get("save_ready")
            ),
            None,
        )
        if recipe_draft:
            proposal_id = str(recipe_draft.get("proposal_id") or "")
            confirmation_token = str(recipe_draft.get("confirmation_token") or "")
            return AssistantNextAction(
                kind="save_prompt_recipe",
                label="Save recipe",
                proposal_id=proposal_id,
                confirmation_token=confirmation_token,
                requires_confirmation=True,
                payload={
                    "proposal_id": proposal_id,
                    "confirmation_token": confirmation_token,
                },
            )
    proposal = next(
        (
            artifact.data
            for artifact in reversed(artifacts)
            if artifact.kind == "graph_proposal"
        ),
        None,
    )
    if not proposal:
        if (
            requested_action
            and requested_action.kind == "run_workflow"
            and requested_action.requires_confirmation
            and capability in {"graph_builder", "preset_builder", "run_debugger"}
            and workflow is not None
        ):
            fingerprint = workflow_fingerprint(workflow)
            confirmation_token = new_id("confirm")
            try:
                price_estimate = estimate_graph_workflow(workflow).model_dump(mode="json")
            except Exception:
                price_estimate = None
            return AssistantNextAction(
                kind="run_workflow",
                label="Review and run",
                confirmation_token=confirmation_token,
                requires_confirmation=True,
                payload={
                    "confirmation_token": confirmation_token,
                    "workflow_fingerprint": fingerprint,
                },
                price_estimate=price_estimate,
            )
        return AssistantNextAction()
    proposal_id = str(proposal.get("proposal_id") or "")
    confirmation_token = str(proposal.get("confirmation_token") or "")
    return AssistantNextAction(
        kind="confirm_graph",
        label="Add to canvas",
        proposal_id=proposal_id,
        confirmation_token=confirmation_token,
        requires_confirmation=True,
        payload={
            "proposal_id": proposal_id,
            "confirmation_token": confirmation_token,
        },
        price_estimate=(
            proposal.get("pricing")
            if isinstance(proposal.get("pricing"), dict)
            else None
        ),
    )


def run_kernel_provider_step(
    *,
    session: Dict[str, Any],
    messages: List[Dict[str, Any]],
    cancel_event: Event | None,
    timeout_seconds: float,
    provider_lifecycle: Optional[List[str]] = None,
    provider_steps: Optional[List[AssistantKernelProviderTrace]] = None,
) -> Dict[str, Any]:
    runtime = resolve_assistant_provider_runtime(session)
    if runtime.provider_kind != "codex_local":
        raise AssistantProviderChatError("The configured provider does not support the Media Assistant kernel.")
    session_id = str(session.get("assistant_session_id") or "").strip()
    if not session_id:
        raise AssistantProviderChatError("The assistant session could not reuse its Codex process.")
    try:
        result = enhancement_provider.run_codex_local_chat(
            model_id=runtime.provider_model_id,
            messages=messages,
            response_format=_provider_step_schema(),
            error_context="media assistant kernel",
            timeout_seconds=timeout_seconds,
            cancel_event=cancel_event,
            codex_session_key=session_id,
            provider_thread_id=session.get("provider_thread_id"),
        )
    except enhancement_provider.EnhancementProviderError as exc:
        if is_cancelled(cancel_event):
            raise AssistantRequestCancelled("Assistant kernel turn was cancelled.") from exc
        raise AssistantProviderChatError(str(exc)) from exc
    thread_id = str(result.get("provider_thread_id") or "").strip()
    if thread_id and thread_id != str(session.get("provider_thread_id") or "").strip():
        session.update(
            store_assistant.create_or_update_assistant_session(
                {**session, "provider_thread_id": thread_id}
            )
        )
    if provider_lifecycle is not None:
        provider_lifecycle.extend(
            str(event)
            for event in result.get("thread_lifecycle") or []
            if str(event)
        )
    if provider_steps is not None:
        provider_steps.append(
            AssistantKernelProviderTrace(
                provider_thread_id=thread_id or None,
                provider_turn_id=str(result.get("provider_turn_id") or "").strip() or None,
                process_lifecycle=result.get("process_lifecycle"),
                reuse_mode=result.get("reuse_mode"),
                usage=dict(result.get("usage") or {}),
                latency_ms=int(result.get("latency_ms") or 0),
                prompt_bytes=int(result.get("prompt_bytes") or 0),
            )
        )
    return json.loads(str(result.get("generated_text") or "{}"))


def run_read_only_provider_turn(
    *,
    session: Dict[str, Any],
    user_text: str,
    cancel_event: Event | None,
) -> AssistantKernelTurnResult:
    runtime = resolve_assistant_provider_runtime(session)
    if runtime.provider_kind == "codex_local":
        raise AssistantProviderChatError("Codex Local should use the tool-capable assistant kernel.")
    history = [
        {"role": item["role"], "content": item["text"]}
        for item in _recent_conversation(session)
    ]
    try:
        result = enhancement_provider.run_openai_compatible_chat(
            provider_kind=runtime.provider_kind,
            base_url=runtime.provider_base_url or "",
            api_key=runtime.api_key,
            model_id=runtime.provider_model_id,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are the Media Assistant in read-only chat mode. You may discuss media workflows, "
                        "but you cannot inspect or change the current canvas, call Media Studio tools, save data, "
                        "or run generation. Say clearly that graph building and Studio actions require Codex Local "
                        "in AI Settings. Never claim an action succeeded."
                    ),
                },
                *history,
            ],
            temperature=runtime.temperature,
            max_tokens=runtime.max_tokens,
            error_context="media assistant read-only chat",
        )
    except enhancement_provider.EnhancementProviderError as exc:
        if is_cancelled(cancel_event):
            raise AssistantRequestCancelled("Assistant request was cancelled.") from exc
        raise AssistantProviderChatError(str(exc)) from exc
    reply = str(result.get("generated_text") or "").strip()
    if not reply:
        raise AssistantProviderChatError("The configured assistant provider returned an empty response. Retry or check AI Settings.")
    external_llm_usage.record_external_llm_usage(
        provider_kind=str(result.get("provider_kind") or runtime.provider_kind),
        provider_model_id=str(result.get("provider_model_id") or runtime.provider_model_id),
        provider_response_id=result.get("provider_response_id"),
        usage=result.get("usage"),
        source_kind="media_assistant_chat",
        metadata_json={
            "assistant_session_id": session.get("assistant_session_id"),
            "capability_mode": "read_only_chat",
            "credential_source": runtime.credential_source,
        },
    )
    return AssistantKernelTurnResult(
        reply=reply,
        capability="general",
        trace=AssistantKernelTrace(
            capability="general",
            tool_calls=[],
            step_count=0,
            termination="read_only_provider",
        ),
        next_action=AssistantNextAction(),
    )


def run_assistant_kernel_turn(
    *,
    session: Dict[str, Any],
    user_text: str,
    workflow: Optional[GraphWorkflow],
    canvas_context: Dict[str, Any],
    assistant_mode: Optional[str],
    run_id: Optional[str] = None,
    attachments: Optional[List[Dict[str, Any]]] = None,
    cancel_event: Event | None = None,
    max_tool_steps: int = KERNEL_MAX_TOOL_STEPS,
    max_wall_seconds: float = KERNEL_MAX_WALL_SECONDS,
) -> AssistantKernelTurnResult:
    started = time.perf_counter()
    runtime = resolve_assistant_provider_runtime(session)
    if runtime.provider_kind != "codex_local":
        return run_read_only_provider_turn(
            session=session,
            user_text=user_text,
            cancel_event=cancel_event,
        )
    recent_conversation = _recent_conversation(session)
    prior_text = "\n".join(item["text"] for item in recent_conversation[:-1][-2:])
    initial_context = _kernel_session_context(session)
    selected_capability = _aligned_capability_hint(
        assistant_mode,
        user_text,
        prior_text,
        has_active_story=isinstance(initial_context.get("active_story_state"), dict),
    )
    base_assembly = assistant_system_prompt_assembly(
        "general",
        capability_prompt_asset=KERNEL_CAPABILITY_PROMPTS[selected_capability or "general"],
    )
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": base_assembly.prompt},
        {
            "role": "system",
            "content": _kernel_instruction(
                assistant_mode=assistant_mode,
                user_text=user_text,
                prior_text=prior_text,
            ),
        },
        {
            "role": "system",
            "content": json.dumps(
                _kernel_attachment_context(list(attachments or [])),
                separators=(",", ":"),
            ),
        },
        {
            "role": "system",
            "content": json.dumps(_kernel_session_context(session), separators=(",", ":")),
        },
        {"role": "user", "content": user_text},
    ]
    loaded_prompt_assets: List[str] = list(base_assembly.loaded_assets)
    provider_lifecycle: List[str] = []
    provider_steps: List[AssistantKernelProviderTrace] = []
    tool_traces = []
    artifacts: List[AssistantKernelArtifact] = []
    tool_steps = 0
    preset_draft_retry_requested = False
    recipe_draft_retry_requested = False
    story_state_retry_requested = False
    run_evidence_retry_requested = False
    while True:
        if is_cancelled(cancel_event):
            raise AssistantRequestCancelled("Assistant kernel turn was cancelled.")
        elapsed = time.perf_counter() - started
        if elapsed >= max_wall_seconds:
            capability = selected_capability or "general"
            return AssistantKernelTurnResult(
                reply="I could not finish that safely within this turn's time limit.",
                capability=capability,
                trace=AssistantKernelTrace(
                    capability=capability,
                    loaded_prompt_assets=loaded_prompt_assets,
                    provider_lifecycle=provider_lifecycle,
                    provider_steps=provider_steps,
                    tool_calls=tool_traces,
                    step_count=tool_steps,
                    duration_ms=int(elapsed * 1000),
                    termination="wall_clock_budget_exhausted",
                ),
                artifacts=artifacts,
                next_action=AssistantNextAction(),
            )
        raw_step = run_kernel_provider_step(
            session=session,
            messages=messages,
            cancel_event=cancel_event,
            # The kernel wall clock owns provider-step timeouts for assistant turns.
            timeout_seconds=max_wall_seconds - elapsed,
            provider_lifecycle=provider_lifecycle,
            provider_steps=provider_steps,
        )
        step = AssistantKernelProviderStep.model_validate(raw_step)
        if selected_capability is None:
            selected_capability = step.capability
            assembly = assistant_system_prompt_assembly(
                "general",
                capability_prompt_asset=KERNEL_CAPABILITY_PROMPTS[selected_capability],
            )
            loaded_prompt_assets = list(assembly.loaded_assets)
            messages[0] = {"role": "system", "content": assembly.prompt}
        elif step.capability != selected_capability:
            messages.append(
                {
                    "role": "system",
                    "content": json.dumps(
                        {
                            "tool_error": {
                                "code": "capability_switch_not_allowed",
                                "message": f"Continue as {selected_capability}.",
                            }
                        }
                    ),
                }
            )
            continue
        if step.tool_call is not None:
            if tool_steps >= max_tool_steps:
                elapsed = time.perf_counter() - started
                return AssistantKernelTurnResult(
                    reply="I could not finish that safely within this turn's tool limit.",
                    capability=selected_capability,
                    trace=AssistantKernelTrace(
                        capability=selected_capability,
                        loaded_prompt_assets=loaded_prompt_assets,
                        provider_lifecycle=provider_lifecycle,
                        provider_steps=provider_steps,
                        tool_calls=tool_traces,
                        step_count=tool_steps,
                        duration_ms=int(elapsed * 1000),
                        termination="step_budget_exhausted",
                    ),
                    artifacts=artifacts,
                    next_action=AssistantNextAction(),
                )
            messages.append(
                {
                    "role": "assistant",
                    "content": step.model_dump_json(exclude_none=True),
                }
            )
            execution = execute_kernel_tool(
                tool_name=step.tool_call.name,
                arguments=step.tool_call.arguments,
                capability=selected_capability,
                context=KernelToolContext(
                    workflow=workflow,
                    canvas_context=canvas_context,
                    user_text=user_text,
                    run_id=run_id,
                    session_id=str(session.get("assistant_session_id") or "") or None,
                    session=session,
                    attachments=list(attachments or []),
                    cancel_event=cancel_event,
                    timeout_seconds=max_wall_seconds - (time.perf_counter() - started),
                ),
            )
            tool_steps += 1
            tool_traces.append(execution.trace)
            artifact_kind = {
                "read_current_workflow": "current_workflow",
                "validate_current_workflow": "graph_validation",
                "propose_graph_operations": "graph_proposal",
                "analyze_reference_images": "reference_analysis",
                "propose_media_preset_draft": "preset_draft",
                "propose_prompt_recipe_draft": "recipe_draft",
                "update_story_state": "story_state",
                "read_run_evidence": "run_evidence",
            }.get(step.tool_call.name)
            if execution.result is not None and artifact_kind:
                artifacts.append(
                    AssistantKernelArtifact(
                        kind=artifact_kind,
                        data=execution.result,
                    )
                )
            if (
                step.tool_call.name == "propose_graph_operations"
                and execution.result is not None
                and execution.trace.error is None
                and str(step.reply or "").strip()
            ):
                elapsed = time.perf_counter() - started
                return AssistantKernelTurnResult(
                    reply=str(step.reply or ""),
                    capability=selected_capability,
                    trace=AssistantKernelTrace(
                        capability=selected_capability,
                        loaded_prompt_assets=loaded_prompt_assets,
                        provider_lifecycle=provider_lifecycle,
                        provider_steps=provider_steps,
                        tool_calls=tool_traces,
                        step_count=tool_steps,
                        duration_ms=int(elapsed * 1000),
                        termination="completed",
                    ),
                    artifacts=artifacts,
                    next_action=_next_action_for_artifacts(
                        selected_capability,
                        artifacts,
                        requested_action=step.requested_action,
                        workflow=workflow,
                    ),
                )
            messages.append(
                {
                    "role": "system",
                    "content": json.dumps(
                        {
                            "tool_name": step.tool_call.name,
                            "result": execution.result,
                            "error": execution.trace.error.model_dump(mode="json") if execution.trace.error else None,
                        },
                        separators=(",", ":"),
                    ),
                }
            )
            continue
        reply = str(step.reply or "")
        if (
            selected_capability == "run_debugger"
            and any(signal in user_text.lower() for signal in DEBUG_RUN_SIGNALS)
            and not any(artifact.kind == "run_evidence" for artifact in artifacts)
            and not run_evidence_retry_requested
        ):
            run_evidence_retry_requested = True
            messages.append(
                {
                    "role": "system",
                    "content": json.dumps(
                        {
                            "tool_error": {
                                "code": "run_evidence_required",
                                "message": (
                                    "Before diagnosing or proposing a fix, call read_run_evidence. "
                                    "Do not infer a run failure from prose or canvas state."
                                ),
                            }
                        },
                        separators=(",", ":"),
                    ),
                }
            )
            continue
        if (
            selected_capability == "story_builder"
            and _story_state_update_required(
                user_text,
                has_active_state=isinstance(initial_context.get("active_story_state"), dict),
            )
            and not any(artifact.kind == "story_state" for artifact in artifacts)
            and not story_state_retry_requested
        ):
            story_state_retry_requested = True
            messages.append(
                {
                    "role": "system",
                    "content": json.dumps(
                        {
                            "tool_error": {
                                "code": "typed_story_state_required",
                                "message": (
                                    "Before replying, call update_story_state with the complete current typed story "
                                    "state. Do not recover story or shot structure from prose."
                                ),
                            }
                        },
                        separators=(",", ":"),
                    ),
                }
            )
            continue
        if (
            selected_capability == "recipe_builder"
            and _recipe_draft_required(
                user_text,
                has_active_draft=isinstance(_kernel_session_context(session).get("active_recipe_draft"), dict),
            )
            and not any(artifact.kind == "recipe_draft" for artifact in artifacts)
            and not recipe_draft_retry_requested
        ):
            recipe_draft_retry_requested = True
            messages.append(
                {
                    "role": "system",
                    "content": json.dumps(
                        {
                            "tool_error": {
                                "code": "typed_prompt_recipe_draft_required",
                                "message": (
                                    "Before replying, call propose_prompt_recipe_draft with the complete current "
                                    "typed draft. Do not reconstruct draft state in prose."
                                ),
                            }
                        },
                        separators=(",", ":"),
                    ),
                }
            )
            continue
        if (
            selected_capability == "preset_builder"
            and _preset_draft_required(
                user_text,
                has_active_draft=isinstance(_kernel_session_context(session).get("active_preset_draft"), dict),
            )
            and not any(artifact.kind == "preset_draft" for artifact in artifacts)
            and not preset_draft_retry_requested
        ):
            preset_draft_retry_requested = True
            messages.append(
                {
                    "role": "system",
                    "content": json.dumps(
                        {
                            "tool_error": {
                                "code": "typed_preset_draft_required",
                                "message": (
                                    "Before replying, call propose_media_preset_draft with the complete current "
                                    "typed draft. Do not reconstruct draft state in prose."
                                ),
                            }
                        },
                        separators=(",", ":"),
                    ),
                }
            )
            continue
        if not reply.strip():
            messages.append(
                {
                    "role": "system",
                    "content": json.dumps(
                        {
                            "tool_error": {
                                "code": "empty_reply",
                                "message": "Return a concise user-facing reply or call a tool.",
                            }
                        }
                    ),
                }
            )
            continue
        elapsed = time.perf_counter() - started
        return AssistantKernelTurnResult(
            reply=reply,
            capability=selected_capability,
            trace=AssistantKernelTrace(
                capability=selected_capability,
                loaded_prompt_assets=loaded_prompt_assets,
                provider_lifecycle=provider_lifecycle,
                provider_steps=provider_steps,
                tool_calls=tool_traces,
                step_count=tool_steps,
                duration_ms=int(elapsed * 1000),
                termination="completed",
            ),
            artifacts=artifacts,
            next_action=_next_action_for_artifacts(
                selected_capability,
                artifacts,
                requested_action=step.requested_action,
                workflow=workflow,
            ),
        )
