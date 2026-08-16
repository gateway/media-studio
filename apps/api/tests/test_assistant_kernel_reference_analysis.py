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

OUTPUT_COMPARISON_PAYLOAD = {
    "matches": ["limited warm palette", "screen-print texture"],
    "missing_or_drifting": ["edge details are less dense than the references"],
    "prompt_delta": "Add denser dry-ink edge detail while keeping the existing palette and composition.",
    "preserve_traits": ["limited warm palette", "centered portrait", "screen-print texture"],
    "meaningful_gap": True,
}


def _generated_output_path(tmp_path, name):
    path = tmp_path / "data" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n")
    return path


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
    session = store_assistant.create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                "reference_analysis_cache": {
                    "preset-style": {
                        "analysis_id": "visual-preset-style",
                        "goal": "preset_design",
                        "reference_ids": ["reference-analysis-1"],
                        "analysis": ANALYSIS_PAYLOAD,
                    }
                },
                "kernel_preset_draft": {
                    "rules_json": {"analysis_id": "visual-preset-style"}
                },
            },
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
    assert first_analysis["reference_ids"] == ["reference-analysis-1"]
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


def test_preset_output_comparison_role_tags_session_owned_output_before_style_references(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    output_path = _generated_output_path(tmp_path, "generated-output.png")
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "test_plan_id": "asplan-output-comparison",
        "run_id": "grun-output-comparison",
        "workflow_fingerprint": "workflow-output-comparison",
        "status": "completed",
        "output_asset_ids": ["asset-generated-output"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    monkeypatch.setattr(
        analysis_module,
        "_asset_image_path",
        lambda _asset_id: str(output_path),
    )
    captured_paths = []

    def multimodal_content(*, text, image_paths):
        captured_paths.extend(image_paths)
        return [{"type": "text", "text": text}]

    monkeypatch.setattr(
        analysis_module.enhancement_provider,
        "build_openai_compatible_multimodal_content",
        multimodal_content,
    )
    monkeypatch.setattr(
        analysis_module.enhancement_provider,
        "run_codex_local_chat",
        lambda **_kwargs: {"generated_text": json.dumps(OUTPUT_COMPARISON_PAYLOAD)},
    )

    execution = tools.execute_kernel_tool(
        tool_name="analyze_preset_output",
        arguments={
            "output_asset_id": "asset-generated-output",
            "reference_ids": ["reference-analysis-1"],
            "focus": "compare the paid test with the approved visual language",
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert execution.trace.error is None
    assert captured_paths == [str(output_path), str(tmp_path / "reference.png")]
    assert execution.result["image_roles"] == [
        {"role": "generated_output", "asset_id": "asset-generated-output"},
        {"role": "style_reference", "reference_id": "reference-analysis-1"},
    ]
    assert execution.result["comparison"] == OUTPUT_COMPARISON_PAYLOAD
    assert execution.result["quality_state"] == "reviewed"
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_preset_output_comparison"] == execution.result


def test_recipe_output_comparison_uses_exact_run_output_and_attached_references(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    output_path = _generated_output_path(tmp_path, "recipe-output.png")
    summary = dict(session.get("summary_json") or {})
    summary["kernel_recipe_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-recipe-output",
        "workflow_fingerprint": "workflow-recipe-output",
        "status": "completed",
        "output_asset_ids": ["asset-recipe-output"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    monkeypatch.setattr(analysis_module, "_asset_image_path", lambda _asset_id, _kind="preset": str(output_path))
    captured_paths = []

    def multimodal_content(*, text, image_paths):
        captured_paths.extend(image_paths)
        return [{"type": "text", "text": text}]

    monkeypatch.setattr(
        analysis_module.enhancement_provider,
        "build_openai_compatible_multimodal_content",
        multimodal_content,
    )
    monkeypatch.setattr(
        analysis_module.enhancement_provider,
        "run_codex_local_chat",
        lambda **_kwargs: {"generated_text": json.dumps(OUTPUT_COMPARISON_PAYLOAD)},
    )

    execution = tools.execute_kernel_tool(
        tool_name="analyze_recipe_output",
        arguments={
            "output_asset_id": "asset-recipe-output",
            "reference_ids": ["reference-analysis-1"],
            "focus": "compare the result with the source style",
        },
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert execution.trace.error is None
    assert captured_paths == [str(output_path), str(tmp_path / "reference.png")]
    assert execution.result["image_roles"] == [
        {"role": "generated_output", "asset_id": "asset-recipe-output"},
        {"role": "source_reference", "reference_id": "reference-analysis-1"},
    ]
    assert execution.result["comparison"] == OUTPUT_COMPARISON_PAYLOAD
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_recipe_output_comparison"] == execution.result


def test_recipe_output_comparison_rejects_output_outside_bound_run(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    summary = dict(session.get("summary_json") or {})
    summary["kernel_recipe_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-recipe-output",
        "status": "completed",
        "output_asset_ids": ["asset-owned-recipe-output"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    provider_called = False

    def provider(**_kwargs):
        nonlocal provider_called
        provider_called = True
        return {"generated_text": json.dumps(OUTPUT_COMPARISON_PAYLOAD)}

    monkeypatch.setattr(analysis_module.enhancement_provider, "run_codex_local_chat", provider)

    execution = tools.execute_kernel_tool(
        tool_name="analyze_recipe_output",
        arguments={
            "output_asset_id": "asset-unrelated-output",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "recipe_output_not_session_owned"
    assert provider_called is False


def test_recipe_output_comparison_rejects_evidence_from_a_different_selected_run(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    summary = dict(session.get("summary_json") or {})
    summary["kernel_recipe_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-prior-recipe-output",
        "status": "completed",
        "output_asset_ids": ["asset-prior-recipe-output"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )

    execution = tools.execute_kernel_tool(
        tool_name="analyze_recipe_output",
        arguments={
            "output_asset_id": "asset-prior-recipe-output",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            run_id="grun-new-unreviewable-output",
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "recipe_output_run_mismatch"


def test_recipe_output_comparison_reports_unsupported_provider_for_recipe(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    output_path = _generated_output_path(tmp_path, "unsupported-recipe-output.png")
    summary = dict(session.get("summary_json") or {})
    summary["kernel_recipe_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-unsupported-recipe-output",
        "status": "completed",
        "output_asset_ids": ["asset-unsupported-recipe-output"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    monkeypatch.setattr(
        analysis_module,
        "_asset_image_path",
        lambda _asset_id, _kind="preset": str(output_path),
    )
    monkeypatch.setattr(
        analysis_module,
        "resolve_assistant_provider_runtime",
        lambda _session: type("Runtime", (), {"provider_kind": "openai"})(),
    )

    execution = tools.execute_kernel_tool(
        tool_name="analyze_recipe_output",
        arguments={
            "output_asset_id": "asset-unsupported-recipe-output",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="recipe_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "analysis_provider_unsupported"
    assert "recipe" in execution.trace.error.message
    assert "preset" not in execution.trace.error.message


def test_preset_output_comparison_rejects_output_outside_bound_run(client, monkeypatch, tmp_path) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-output-comparison",
        "status": "completed",
        "output_asset_ids": ["asset-owned-output"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    provider_called = False

    def provider(**_kwargs):
        nonlocal provider_called
        provider_called = True
        return {"generated_text": json.dumps(OUTPUT_COMPARISON_PAYLOAD)}

    monkeypatch.setattr(analysis_module.enhancement_provider, "run_codex_local_chat", provider)
    before = store_assistant.get_assistant_session(session["assistant_session_id"])

    execution = tools.execute_kernel_tool(
        tool_name="analyze_preset_output",
        arguments={
            "output_asset_id": "asset-unrelated-output",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_output_not_session_owned"
    assert provider_called is False
    assert store_assistant.get_assistant_session(session["assistant_session_id"])["summary_json"] == before["summary_json"]


def test_preset_output_comparison_rejects_attached_non_style_reference(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    unrelated = store_assistant.create_assistant_attachment(
        {
            "assistant_session_id": session["assistant_session_id"],
            "reference_id": "runtime-portrait",
            "kind": "image",
            "label": "Runtime portrait",
        }
    )
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-style-provenance",
        "status": "completed",
        "output_asset_ids": ["asset-style-provenance"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    provider_called = False

    def provider(**_kwargs):
        nonlocal provider_called
        provider_called = True
        return {"generated_text": json.dumps(OUTPUT_COMPARISON_PAYLOAD)}

    monkeypatch.setattr(analysis_module.enhancement_provider, "run_codex_local_chat", provider)

    execution = tools.execute_kernel_tool(
        tool_name="analyze_preset_output",
        arguments={
            "output_asset_id": "asset-style-provenance",
            "reference_ids": ["runtime-portrait"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=[*attachments, unrelated],
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_style_reference_mismatch"
    assert provider_called is False


def test_preset_output_comparison_requires_every_analyzed_style_reference(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    second = store_assistant.create_assistant_attachment(
        {
            "assistant_session_id": session["assistant_session_id"],
            "reference_id": "reference-analysis-2",
            "kind": "image",
            "label": "Second poster reference",
        }
    )
    summary = dict(session.get("summary_json") or {})
    summary["reference_analysis_cache"]["preset-style"]["reference_ids"] = [
        "reference-analysis-1",
        "reference-analysis-2",
    ]
    summary["kernel_preset_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-two-style-refs",
        "status": "completed",
        "output_asset_ids": ["asset-two-style-refs"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )

    execution = tools.execute_kernel_tool(
        tool_name="analyze_preset_output",
        arguments={
            "output_asset_id": "asset-two-style-refs",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=[*attachments, second],
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_style_reference_mismatch"


def test_reference_analysis_binds_draft_and_output_comparison_provenance(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": {}}
    )
    monkeypatch.setattr(
        analysis_module.enhancement_provider,
        "run_codex_local_chat",
        lambda **kwargs: {
            "generated_text": json.dumps(
                OUTPUT_COMPARISON_PAYLOAD
                if kwargs["response_format"]["json_schema"]["name"]
                == "media_assistant_preset_output_comparison"
                else ANALYSIS_PAYLOAD
            )
        },
    )
    analyzed = tools.execute_kernel_tool(
        tool_name="analyze_reference_images",
        arguments={
            "reference_ids": ["reference-analysis-1"],
            "goal": "preset_design",
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )
    session = store_assistant.get_assistant_session(session["assistant_session_id"])
    draft = {
        "key": "analysis_bound_preset",
        "label": "Analysis Bound Preset",
        "description": "A reusable screen-printed portrait with an editable subject.",
        "category": "editorial",
        "status": "active",
        "model_key": "gpt-image-2-text-to-image",
        "applies_to_models": ["gpt-image-2-text-to-image"],
        "applies_to_task_modes": ["text_to_image"],
        "applies_to_input_patterns": ["prompt_only"],
        "prompt_template": "Screen-printed editorial portrait of {{portrait_subject}}.",
        "requires_image": False,
        "input_schema_json": [{
            "key": "portrait_subject",
            "label": "Portrait Subject",
            "placeholder": "e.g. marine researcher",
            "help_text": "Changes the person shown in the central portrait.",
            "required": True,
        }],
        "input_slots_json": [],
        "default_options_json": {"aspect_ratio": "1:1"},
        "rules_json": {
            "preset_lane": "text_to_image",
            "field_evidence": {"portrait_subject": "portrait subject"},
        },
        "source_kind": "custom",
        "priority": 0,
    }
    proposed = tools.execute_kernel_tool(
        tool_name="propose_media_preset_draft",
        arguments={"draft": draft},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            user_text="Make the portrait subject editable.",
            artifact_intent="draft_preset",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )
    session = store_assistant.get_assistant_session(session["assistant_session_id"])
    summary = dict(session["summary_json"])
    summary["kernel_preset_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-analysis-bound",
        "status": "completed",
        "output_asset_ids": ["asset-analysis-bound"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    output_path = _generated_output_path(tmp_path, "analysis-bound.png")
    monkeypatch.setattr(analysis_module, "_asset_image_path", lambda _asset_id: str(output_path))
    compared = tools.execute_kernel_tool(
        tool_name="analyze_preset_output",
        arguments={
            "output_asset_id": "asset-analysis-bound",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert analyzed.trace.error is None
    assert proposed.trace.error is None
    assert proposed.result["draft"]["rules_json"]["analysis_id"] == analyzed.result["analysis_id"]
    assert compared.trace.error is None


def test_preset_output_comparison_rejects_unnecessary_delta_when_no_meaningful_gap(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    output_path = _generated_output_path(tmp_path, "already-good-output.png")
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-already-good",
        "status": "completed",
        "output_asset_ids": ["asset-already-good"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    monkeypatch.setattr(
        analysis_module,
        "_asset_image_path",
        lambda _asset_id: str(output_path),
    )
    monkeypatch.setattr(
        analysis_module.enhancement_provider,
        "run_codex_local_chat",
        lambda **_kwargs: {
            "generated_text": json.dumps(
                {
                    "matches": ["the approved palette and composition are present"],
                    "missing_or_drifting": [],
                    "prompt_delta": "Add another arbitrary texture detail.",
                    "preserve_traits": ["approved palette", "approved composition"],
                    "meaningful_gap": False,
                }
            )
        },
    )

    execution = tools.execute_kernel_tool(
        tool_name="analyze_preset_output",
        arguments={
            "output_asset_id": "asset-already-good",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_output_comparison_failed"
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert "kernel_preset_output_comparison" not in stored["summary_json"]


def test_preset_output_comparison_does_not_overwrite_newer_run_evidence(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    output_path = _generated_output_path(tmp_path, "racing-output.png")
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-original-review",
        "status": "completed",
        "output_asset_ids": ["asset-original-review"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    monkeypatch.setattr(
        analysis_module,
        "_asset_image_path",
        lambda _asset_id: str(output_path),
    )

    def provider(**_kwargs):
        latest = store_assistant.get_assistant_session(session["assistant_session_id"])
        store_assistant.create_or_update_assistant_session(
            {
                **latest,
                "summary_json": {
                    **latest["summary_json"],
                    "kernel_preset_run_evidence": {
                        "assistant_session_id": session["assistant_session_id"],
                        "run_id": "grun-newer-review",
                        "status": "completed",
                        "output_asset_ids": ["asset-newer-review"],
                    },
                },
            }
        )
        return {"generated_text": json.dumps(OUTPUT_COMPARISON_PAYLOAD)}

    monkeypatch.setattr(analysis_module.enhancement_provider, "run_codex_local_chat", provider)

    execution = tools.execute_kernel_tool(
        tool_name="analyze_preset_output",
        arguments={
            "output_asset_id": "asset-original-review",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_output_evidence_changed"
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_preset_run_evidence"]["run_id"] == "grun-newer-review"
    assert "kernel_preset_output_comparison" not in stored["summary_json"]


def test_preset_quality_approval_requires_and_persists_actual_output_review(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    output_path = _generated_output_path(tmp_path, "approved-output.png")
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "test_plan_id": "asplan-approved-output",
        "run_id": "grun-approved-output",
        "workflow_fingerprint": "workflow-approved-output",
        "status": "completed",
        "output_asset_ids": ["asset-approved-output"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    monkeypatch.setattr(
        analysis_module,
        "_asset_image_path",
        lambda _asset_id: str(output_path),
    )
    monkeypatch.setattr(
        analysis_module.enhancement_provider,
        "run_codex_local_chat",
        lambda **_kwargs: {"generated_text": json.dumps(OUTPUT_COMPARISON_PAYLOAD)},
    )
    comparison = tools.execute_kernel_tool(
        tool_name="analyze_preset_output",
        arguments={
            "output_asset_id": "asset-approved-output",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )
    session = store_assistant.get_assistant_session(session["assistant_session_id"])

    approval = tools.execute_kernel_tool(
        tool_name="record_preset_quality_decision",
        arguments={"decision": "approve"},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            user_text="This result is good. I approve it.",
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert comparison.trace.error is None
    assert approval.trace.error is None
    assert approval.result["quality_state"] == "quality_verified"
    assert approval.result["comparison_id"] == comparison.result["comparison_id"]
    assert approval.result["run_id"] == "grun-approved-output"
    assert approval.result["output_asset_id"] == "asset-approved-output"
    assert approval.result["user_approved"] is True
    assert approval.result["user_statement_hash"]
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_preset_quality"] == approval.result


def test_preset_quality_approval_fails_without_output_comparison(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    session = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()

    execution = tools.execute_kernel_tool(
        tool_name="record_preset_quality_decision",
        arguments={"decision": "approve"},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            user_text="I approve it.",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_output_comparison_required"


def test_preset_quality_continue_requires_meaningful_review_gap(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    store_assistant = importlib.import_module("app.store_assistant")
    session = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()
    summary = dict(session.get("summary_json") or {})
    summary.update(
        {
            "kernel_preset_run_evidence": {
                "assistant_session_id": session["assistant_session_id"],
                "run_id": "grun-no-gap",
                "status": "completed",
                "output_asset_ids": ["asset-no-gap"],
            },
            "kernel_preset_output_comparison": {
                "comparison_id": "presetcmp-no-gap",
                "run_id": "grun-no-gap",
                "output_asset_id": "asset-no-gap",
                "comparison": {
                    "matches": ["the approved visual language is present"],
                    "missing_or_drifting": [],
                    "prompt_delta": "",
                    "preserve_traits": ["approved visual language"],
                    "meaningful_gap": False,
                },
                "quality_state": "reviewed",
            },
        }
    )
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})

    execution = tools.execute_kernel_tool(
        tool_name="record_preset_quality_decision",
        arguments={"decision": "continue"},
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            user_text="Try another improvement anyway.",
            session_id=session["assistant_session_id"],
            session=session,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_refinement_delta_missing"
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert "kernel_preset_quality" not in stored["summary_json"]


def test_preset_output_comparison_rejects_asset_path_outside_data_root(
    client,
    monkeypatch,
    tmp_path,
) -> None:
    tools, analysis_module, store_assistant, session, attachments = _analysis_context(
        client,
        monkeypatch,
        tmp_path,
    )
    outside_path = tmp_path / "outside-output.png"
    outside_path.write_bytes(b"\x89PNG\r\n\x1a\n")
    summary = dict(session.get("summary_json") or {})
    summary["kernel_preset_run_evidence"] = {
        "assistant_session_id": session["assistant_session_id"],
        "run_id": "grun-outside-path",
        "status": "completed",
        "output_asset_ids": ["asset-outside-path"],
    }
    session = store_assistant.create_or_update_assistant_session(
        {**session, "summary_json": summary}
    )
    monkeypatch.setattr(
        analysis_module.store,
        "get_asset",
        lambda asset_id: {
            "asset_id": asset_id,
            "generation_kind": "image",
            "hero_original_path": str(outside_path),
        },
    )
    provider_called = False

    def provider(**_kwargs):
        nonlocal provider_called
        provider_called = True
        return {"generated_text": json.dumps(OUTPUT_COMPARISON_PAYLOAD)}

    monkeypatch.setattr(analysis_module.enhancement_provider, "run_codex_local_chat", provider)

    execution = tools.execute_kernel_tool(
        tool_name="analyze_preset_output",
        arguments={
            "output_asset_id": "asset-outside-path",
            "reference_ids": ["reference-analysis-1"],
        },
        capability="preset_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session_id=session["assistant_session_id"],
            session=session,
            attachments=attachments,
        ),
    )

    assert execution.result is None
    assert execution.trace.error.code == "preset_output_inaccessible"
    assert provider_called is False


def test_output_comparison_tools_are_truthfully_classified_as_mutating(client) -> None:
    tools = importlib.import_module("app.assistant.kernel_tools")
    preset_catalog = {
        item["name"]: item
        for item in tools.kernel_tool_catalog("preset_builder")
    }
    recipe_catalog = {
        item["name"]: item
        for item in tools.kernel_tool_catalog("recipe_builder")
    }

    assert preset_catalog["analyze_preset_output"]["read_only"] is False
    assert preset_catalog["record_preset_quality_decision"]["read_only"] is False
    assert recipe_catalog["analyze_recipe_output"]["read_only"] is False


def test_preset_output_path_uses_typed_asset_ref_and_image_constraint(client, monkeypatch, tmp_path) -> None:
    analysis_module = importlib.import_module("app.assistant.reference_analysis")
    output_path = _generated_output_path(tmp_path, "typed-output-ref.png")
    captured = {}

    def safe_path(ref, *, expected_media_type=None):
        captured["ref"] = ref
        captured["expected_media_type"] = expected_media_type
        return output_path

    monkeypatch.setattr(analysis_module, "graph_ref_path", safe_path)

    resolved = analysis_module._asset_image_path("asset-typed-output-ref")

    assert resolved == str(output_path)
    assert captured["ref"].kind == "asset"
    assert captured["ref"].asset_id == "asset-typed-output-ref"
    assert captured["expected_media_type"] == "image"


def test_explicit_quality_decision_can_finish_in_same_validated_tool_step(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    store_assistant = importlib.import_module("app.store_assistant")
    session = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()
    summary = dict(session.get("summary_json") or {})
    summary.update(
        {
            "kernel_preset_run_evidence": {
                "assistant_session_id": session["assistant_session_id"],
                "run_id": "grun-terminal-quality",
                "status": "completed",
                "output_asset_ids": ["asset-terminal-quality"],
            },
            "kernel_preset_output_comparison": {
                "comparison_id": "presetcmp-terminal-quality",
                "run_id": "grun-terminal-quality",
                "output_asset_id": "asset-terminal-quality",
                "comparison": OUTPUT_COMPARISON_PAYLOAD,
                "quality_state": "reviewed",
            },
        }
    )
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    provider_calls = 0
    provider_reply = "provider-quality-decision-reply"

    def provider_step(**_kwargs):
        nonlocal provider_calls
        provider_calls += 1
        return {
            "capability": "preset_builder",
            "reply": provider_reply,
            "tool_call": {
                "name": "record_preset_quality_decision",
                "arguments": {"decision": "approve"},
            },
            "guidance": {
                "suggestion_count": 0,
                "evidence_sources": ["user_request", "session_state"],
                "satisfaction_state": "satisfied",
            },
        }

    monkeypatch.setattr(kernel, "run_kernel_provider_step", provider_step)

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="This is good enough. I approve the result.",
        workflow=None,
        canvas_context={},
        assistant_mode="preset",
    )

    assert provider_calls == 1
    assert result.reply == provider_reply
    assert result.trace.step_count == 1
    assert result.trace.termination == "completed"
    assert result.trace.guidance.satisfaction_state == "satisfied"
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_preset_quality"]["quality_state"] == "quality_verified"


def test_continue_quality_decision_advances_to_bound_prompt_refinement(client, monkeypatch) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    store_assistant = importlib.import_module("app.store_assistant")
    session = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    ).json()
    draft = {
        "key": "kernel_continue_refinement",
        "label": "Continue Refinement",
        "description": "A reusable warm cinematic location treatment.",
        "category": "editorial",
        "status": "active",
        "model_key": "gpt-image-2-text-to-image",
        "applies_to_models": ["gpt-image-2-text-to-image"],
        "applies_to_task_modes": ["text_to_image"],
        "applies_to_input_patterns": ["prompt_only"],
        "prompt_template": "Warm cinematic coverage board for {{location}}.",
        "requires_image": False,
        "input_schema_json": [
            {
                "key": "location",
                "label": "Location",
                "placeholder": "e.g. Kyoto",
                "help_text": "Changes the setting shown in the image.",
                "required": True,
            }
        ],
        "input_slots_json": [],
        "default_options_json": {"aspect_ratio": "1:1"},
        "rules_json": {"output_kind": "image", "preset_lane": "text_to_image"},
        "source_kind": "custom",
        "priority": 0,
    }
    comparison_id = "presetcmp-kernel-continue"
    summary = dict(session.get("summary_json") or {})
    summary.update(
        {
            "kernel_preset_draft": draft,
            "kernel_preset_run_evidence": {
                "assistant_session_id": session["assistant_session_id"],
                "run_id": "grun-kernel-continue",
                "status": "completed",
                "output_asset_ids": ["asset-kernel-continue"],
            },
            "kernel_preset_output_comparison": {
                "comparison_id": comparison_id,
                "run_id": "grun-kernel-continue",
                "output_asset_id": "asset-kernel-continue",
                "comparison": OUTPUT_COMPARISON_PAYLOAD,
                "quality_state": "reviewed",
            },
        }
    )
    session = store_assistant.create_or_update_assistant_session({**session, "summary_json": summary})
    revised = json.loads(json.dumps(draft))
    revised["prompt_template"] += " " + OUTPUT_COMPARISON_PAYLOAD["prompt_delta"]
    steps = iter(
        [
            {
                "capability": "preset_builder",
                "artifact_intent": "revise_preset",
                "reply": "I will apply only that focused improvement.",
                "tool_call": {
                    "name": "record_preset_quality_decision",
                    "arguments": {"decision": "continue"},
                },
            },
            {
                "capability": "preset_builder",
                "artifact_intent": "revise_preset",
                "reply": "The focused prompt refinement is ready for review.",
                "tool_call": {
                    "name": "propose_media_preset_draft",
                    "arguments": {"draft": revised, "comparison_id": comparison_id},
                },
            },
        ]
    )
    monkeypatch.setattr(kernel, "run_kernel_provider_step", lambda **_kwargs: next(steps))

    result = kernel.run_assistant_kernel_turn(
        session=session,
        user_text="Yes, use that one focused improvement.",
        workflow=None,
        canvas_context={},
        assistant_mode="preset",
    )

    assert len(result.trace.tool_calls) == 2
    assert [item.tool_name for item in result.trace.tool_calls] == [
        "record_preset_quality_decision",
        "propose_media_preset_draft",
    ]
    assert all(item.error is None for item in result.trace.tool_calls)
    assert result.reply.strip()
    stored = store_assistant.get_assistant_session(session["assistant_session_id"])
    assert stored["summary_json"]["kernel_preset_draft"]["prompt_template"] == revised["prompt_template"]
    assert stored["summary_json"]["kernel_preset_refinement_history"][-1]["comparison_id"] == comparison_id


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

    user_turn = next(
        message
        for message in captured_messages
        if message["role"] == "user" and "MEDIA_STUDIO_USER_TURN_V1" in message["content"]
    )
    payload = json.loads(user_turn["content"].partition("PAYLOAD_JSON\n")[2])
    manifest = payload["attachment_context"]
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
    first_persisted_trace = first.json()["messages"][-1]["content_json"]["assistant_turn_trace"]
    second_persisted_trace = second.json()["messages"][-1]["content_json"]["assistant_turn_trace"]
    assert first_trace["tool_calls"][0]["cache_status"] == "miss"
    assert second_trace["tool_calls"][0]["cache_status"] == "hit"
    assert first_trace["termination"] == second_trace["termination"] == "completed"
    assert first_trace["step_count"] == second_trace["step_count"] == 1
    assert first_trace["tool_calls"][0]["duration_ms"] >= 0
    assert second_trace["tool_calls"][0]["duration_ms"] >= 0
    assert first_trace["tool_calls"][0]["result_size_bytes"] > 0
    assert second_trace["tool_calls"][0]["result_size_bytes"] > 0
    assert first_persisted_trace["tool_calls"][0]["cache_status"] == "miss"
    assert second_persisted_trace["tool_calls"][0]["cache_status"] == "hit"
    assert second.json()["summary_json"]["reference_analysis_cache"]
    assert analysis_calls == 1
