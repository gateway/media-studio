from __future__ import annotations

import importlib
import json


ANALYSIS_PAYLOAD = {
    "medium": ["screen-printed editorial poster"],
    "palette": ["warm ochre", "charcoal", "muted teal"],
    "composition": ["centered portrait", "asymmetric text blocks"],
    "subject_treatment": ["simplified silhouette", "high-contrast facial planes"],
    "environment": ["flat graphic backdrop"],
    "texture": ["paper grain", "dry ink edges"],
    "lighting": ["hard side light"],
    "typography": ["condensed sans serif"],
    "mood": ["confident", "cinematic"],
    "fixed_traits": ["limited warm palette", "screen-print texture"],
    "replaceable_elements": ["portrait subject", "headline"],
    "exclusions": ["source logo", "identifying text"],
}


def _analysis_context(client, monkeypatch, tmp_path):
    tools = importlib.import_module("app.assistant.kernel_tools")
    analysis_module = importlib.import_module("app.assistant.reference_analysis")
    store_assistant = importlib.import_module("app.store_assistant")
    image_path = tmp_path / "reference.png"
    image_path.write_bytes(b"\x89PNG\r\n\x1a\n")
    monkeypatch.setattr(
        analysis_module.store,
        "get_reference_media",
        lambda reference_id: {"reference_id": reference_id, "stored_path": str(image_path)},
    )
    session = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()
    attachment = store_assistant.create_assistant_attachment(
        {
            "assistant_session_id": session["assistant_session_id"],
            "reference_id": "reference-analysis-1",
            "kind": "image",
            "label": "Poster reference",
        }
    )
    return tools, analysis_module, store_assistant, session, [attachment]


def test_reference_analysis_is_typed_cached_and_shared_across_capabilities(client, monkeypatch, tmp_path) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(client, monkeypatch, tmp_path)
    kernel = importlib.import_module("app.assistant.kernel")
    provider_calls = 0

    def analyze_provider(**kwargs):
        nonlocal provider_calls
        provider_calls += 1
        assert kwargs["response_format"]["json_schema"]["name"] == "media_assistant_reference_analysis"
        return {"generated_text": json.dumps(ANALYSIS_PAYLOAD)}

    monkeypatch.setattr(analysis_module.enhancement_provider, "run_codex_local_chat", analyze_provider)
    steps = iter(
        [
            {
                "capability": "preset_builder",
                "tool_call": {
                    "name": "analyze_reference_images",
                    "arguments": {
                        "reference_ids": ["reference-analysis-1"],
                        "goal": "style_reference",
                        "focus": "reusable visual language",
                    },
                },
            },
            {"capability": "preset_builder", "reply": "The reference supports a reusable graphic treatment."},
            {
                "capability": "story_builder",
                "tool_call": {
                    "name": "analyze_reference_images",
                    "arguments": {
                        "reference_ids": ["reference-analysis-1"],
                        "goal": "style_reference",
                        "focus": "story continuity",
                    },
                },
            },
            {"capability": "story_builder", "reply": "The same palette and texture can anchor continuity."},
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    first = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Analyze this reference for a preset.",
        workflow=None,
        canvas_context={},
        assistant_mode="preset",
        attachments=attachments,
    )
    refreshed_session = store_assistant.get_assistant_session(session["assistant_session_id"])
    second = kernel.run_assistant_kernel_turn(
        session=refreshed_session,
        user_text="Use the same reference for story continuity.",
        workflow=None,
        canvas_context={},
        assistant_mode="graph",
        attachments=attachments,
    )

    assert provider_calls == 1
    first_analysis = next(item.data for item in first.artifacts if item.kind == "reference_analysis")
    second_analysis = next(item.data for item in second.artifacts if item.kind == "reference_analysis")
    assert first_analysis["analysis"] == second_analysis["analysis"]
    assert first_analysis["analysis"]["fixed_traits"]
    assert first.trace.tool_calls[0].cache_status == "miss"
    assert second.trace.tool_calls[0].cache_status == "hit"
    assert first.capability == "preset_builder"
    assert second.capability == "story_builder"


def test_output_critique_uses_typed_reference_analysis(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    _tools, analysis_module, _store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    kernel = importlib.import_module("app.assistant.kernel")
    monkeypatch.setattr(
        analysis_module.enhancement_provider,
        "run_codex_local_chat",
        lambda **_kwargs: {"generated_text": json.dumps(ANALYSIS_PAYLOAD)},
    )
    steps = iter(
        [
            {
                "capability": "run_debugger",
                "tool_call": {
                    "name": "analyze_reference_images",
                    "arguments": {
                        "reference_ids": ["reference-analysis-1"],
                        "goal": "output_critique",
                        "focus": "compare the generated output with the intended visual contract",
                    },
                },
            },
            {
                "capability": "run_debugger",
                "reply": "The critique separates visible evidence from the changes worth trying next.",
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Critique this generated output and suggest improvements.",
        workflow=None,
        canvas_context={},
        assistant_mode="graph",
        attachments=attachments,
    )

    critique = next(item.data for item in result.artifacts if item.kind == "reference_analysis")
    assert critique["goal"] == "output_critique"
    assert critique["analysis"]["fixed_traits"]
    assert result.trace.tool_calls[0].error is None


def test_reference_analysis_rejects_unattached_reference_without_state_change(client, monkeypatch, tmp_path) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(client, monkeypatch, tmp_path)
    provider_called = False

    def analyze_provider(**_kwargs):
        nonlocal provider_called
        provider_called = True
        return {"generated_text": json.dumps(ANALYSIS_PAYLOAD)}

    monkeypatch.setattr(analysis_module.enhancement_provider, "run_codex_local_chat", analyze_provider)
    before = store_assistant.get_assistant_session(session["assistant_session_id"])
    execution = tools.execute_kernel_tool(
        tool_name="analyze_reference_images",
        arguments=json.dumps(
            {
                "reference_ids": ["not-attached"],
                "goal": "style_reference",
            }
        ),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )
    after = store_assistant.get_assistant_session(session["assistant_session_id"])

    assert execution.result is None
    assert execution.trace.error.code == "reference_not_attached"
    assert provider_called is False
    assert after["summary_json"] == before["summary_json"]


def test_reference_analysis_rejects_inaccessible_reference_without_state_change(client, monkeypatch, tmp_path) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(client, monkeypatch, tmp_path)
    monkeypatch.setattr(analysis_module.store, "get_reference_media", lambda _reference_id: {})
    before = store_assistant.get_assistant_session(session["assistant_session_id"])

    execution = tools.execute_kernel_tool(
        tool_name="analyze_reference_images",
        arguments=json.dumps(
            {
                "reference_ids": ["reference-analysis-1"],
                "goal": "style_reference",
            }
        ),
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )
    after = store_assistant.get_assistant_session(session["assistant_session_id"])

    assert execution.result is None
    assert execution.trace.error.code == "reference_inaccessible"
    assert after["summary_json"] == before["summary_json"]


def test_kernel_planner_receives_path_free_attachment_manifest(client, monkeypatch, tmp_path) -> None:
    _tools, _analysis_module, _store_assistant, session, attachments = _analysis_context(client, monkeypatch, tmp_path)
    kernel = importlib.import_module("app.assistant.kernel")
    captured_messages = []

    def provider_step(**kwargs):
        captured_messages.extend(kwargs["messages"])
        return {"capability": "preset_builder", "reply": "Analysis is ready."}

    monkeypatch.setattr(kernel, "run_kernel_provider_step", provider_step)
    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Analyze the attached reference.",
        workflow=None,
        canvas_context={},
        assistant_mode="preset",
        attachments=attachments,
    )

    manifest = next(
        json.loads(message["content"])
        for message in captured_messages
        if message["role"] == "system" and '"attachment_count"' in message["content"]
    )
    serialized = json.dumps(manifest)
    assert manifest["attachment_count"] == 1
    assert manifest["attachments"][0]["reference_id"] == "reference-analysis-1"
    assert "reference.png" not in serialized
    assert str(tmp_path) not in serialized
    assert result.capability == "preset_builder"


def test_kernel_route_preserves_reference_analysis_cache_between_messages(client, monkeypatch, tmp_path) -> None:
    _tools, analysis_module, _store_assistant, session, _attachments = _analysis_context(client, monkeypatch, tmp_path)
    kernel = importlib.import_module("app.assistant.kernel")
    analysis_calls = 0

    def analyze_provider(**_kwargs):
        nonlocal analysis_calls
        analysis_calls += 1
        return {"generated_text": json.dumps(ANALYSIS_PAYLOAD)}

    provider_steps = iter(
        [
            {
                "capability": "preset_builder",
                "tool_call": {
                    "name": "analyze_reference_images",
                    "arguments": json.dumps(
                        {
                            "reference_ids": ["reference-analysis-1"],
                            "goal": "style_reference",
                        }
                    ),
                },
            },
            {"capability": "preset_builder", "reply": "The analysis is ready."},
            {
                "capability": "preset_builder",
                "tool_call": {
                    "name": "analyze_reference_images",
                    "arguments": json.dumps(
                        {
                            "reference_ids": ["reference-analysis-1"],
                            "goal": "style_reference",
                        }
                    ),
                },
            },
            {"capability": "preset_builder", "reply": "The cached analysis is ready."},
        ]
    )
    monkeypatch.setattr(analysis_module.enhancement_provider, "run_codex_local_chat", analyze_provider)
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(provider_steps))
    endpoint = f"/media/assistant/sessions/{session['assistant_session_id']}/messages"

    first = client.post(endpoint, json={"content_text": "Analyze the attached reference.", "assistant_mode": "preset"})
    second = client.post(endpoint, json={"content_text": "Use the same analysis.", "assistant_mode": "preset"})

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_trace = first.json()["messages"][-1]["content_json"]["kernel_turn"]["trace"]
    second_trace = second.json()["messages"][-1]["content_json"]["kernel_turn"]["trace"]
    assert first_trace["tool_calls"][0]["cache_status"] == "miss"
    assert second_trace["tool_calls"][0]["cache_status"] == "hit"
    assert second.json()["summary_json"]["reference_analysis_cache"]
    assert analysis_calls == 1
