from __future__ import annotations

from app.assistant import provider_chat
from app.assistant.prompt_assets import assistant_system_prompt, assistant_system_prompt_assembly


def test_media_assistant_provider_prompt_loads_media_preset_skill_asset() -> None:
    system_prompt = assistant_system_prompt("preset_intake")

    assert "# Media Preset Orchestrator" in system_prompt
    assert "# Reference Image Analyzer" in system_prompt
    assert "# Replacement Field Planner" in system_prompt
    assert "# Image Slot Planner" in system_prompt
    assert "# Preset Prompt Compiler" in system_prompt
    assert "REFERENCE_STYLE_BRIEF_JSON_START" in system_prompt
    assert "content inventory" in system_prompt
    assert "Field election gate" in system_prompt
    assert "{{field_key}}" in system_prompt
    assert "[[slot_key]]" in system_prompt
    assert "Do not use `{{choice:*}}`" in system_prompt
    assert "source-specific exclusions" in system_prompt
    assert "preset_kind" in system_prompt
    assert "input_mode" in system_prompt
    assert "test workflow" in system_prompt


def test_media_assistant_prompt_assets_are_route_scoped() -> None:
    intake = assistant_system_prompt_assembly("preset_intake")
    prompt_lookup = assistant_system_prompt_assembly("show_current_prompt")
    output_compare = assistant_system_prompt_assembly("output_comparison")

    assert "skills/media_preset/reference_image_analyzer.md" in intake.loaded_assets
    assert "skills/media_preset/replacement_field_planner.md" in intake.loaded_assets
    assert "skills/media_preset/image_slot_planner.md" in intake.loaded_assets
    assert "skills/media_preset/backend_contract.md" in intake.loaded_assets
    assert "REFERENCE_STYLE_BRIEF_JSON_START" in intake.prompt

    assert "skills/media_preset/prompt_lookup.md" in prompt_lookup.loaded_assets
    assert "REFERENCE_STYLE_BRIEF_JSON_START" not in prompt_lookup.prompt
    assert "# Reference Image Analyzer" not in prompt_lookup.prompt
    assert prompt_lookup.char_count < intake.char_count

    assert "skills/media_preset/output_comparison_judge.md" in output_compare.loaded_assets
    assert "Similarity score" in output_compare.prompt
    assert "REFERENCE_STYLE_BRIEF_JSON_START" not in output_compare.prompt


def test_provider_chat_loads_route_scoped_prompt_assets(app_modules, monkeypatch) -> None:
    del app_modules
    captured: dict[str, object] = {}

    def fake_codex_chat(**kwargs):
        captured["messages"] = kwargs["messages"]
        return {
            "provider_kind": "codex_local",
            "provider_model_id": kwargs["model_id"],
            "provider_response_id": "route-scoped-prompt-test",
            "generated_text": "Here is the current prompt.",
            "usage": {},
            "cost": None,
        }

    monkeypatch.setattr(provider_chat.enhancement_provider, "run_codex_local_chat", fake_codex_chat)
    result = provider_chat.run_assistant_provider_chat(
        session={
            "assistant_session_id": "asst_route_scoped",
            "owner_kind": "graph_workflow",
            "owner_id": "workflow-route-scoped",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "summary_json": {},
        },
        user_text="What prompt did you use?",
        context={"assistant_prompt_route": "show_current_prompt", "workflow": {"workflow_id": "workflow-route-scoped"}},
        messages=[],
        attachments=[],
    )

    system_prompt = captured["messages"][0]["content"]
    assert result["assistant_prompt_route"] == "show_current_prompt"
    assert "skills/media_preset/prompt_lookup.md" in result["loaded_prompt_assets"]
    assert "# Prompt Lookup" in system_prompt
    assert "# Reference Image Analyzer" not in system_prompt
    assert "REFERENCE_STYLE_BRIEF_JSON_START" not in system_prompt
