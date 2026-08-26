from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest


def _context(module, stage: str, *, output: str = "image", references: int = 0, story: bool = False):
    return module.ArtifactRecommendationContext(
        stage=stage,
        requested_output=output,
        reference_count=references,
        story_context_available=story,
    )


def _preset(**overrides):
    return {
        "preset_id": "preset-character-sheet",
        "key": "cinematic-character-sheet",
        "label": "Cinematic Character Sheet",
        "description": "Creates a reusable production character sheet.",
        "category": "character",
        "status": "active",
        "source_kind": "custom",
        "model_key": "gpt-image-2-text-to-image",
        "applies_to_task_modes_json": ["text_to_image"],
        "input_schema_json": [
            {"key": "character_brief", "label": "Character brief", "required": True}
        ],
        "input_slots_json": [],
        **overrides,
    }


def _recipe(**overrides):
    return {
        "recipe_id": "recipe-character-sheet",
        "key": "character-sheet-prompt-writer",
        "label": "Character Sheet Prompt Writer",
        "description": "Turns a character description into a production-ready character sheet prompt.",
        "category": "image",
        "status": "active",
        "source_kind": "custom",
        "output_format": "single_prompt",
        "input_variables_json": [
            {"key": "character_brief", "label": "Character brief", "required": True}
        ],
        "custom_fields_json": [],
        "image_input_json": {"mode": "none", "required": False, "max_files": 0},
        "rules_json": {"media_generation": {"model_key": "gpt-image-2-text-to-image"}},
        **overrides,
    }


def test_recommender_returns_two_strong_character_matches_and_excludes_internal_artifacts(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    presets = [
        _preset(),
        _preset(
            preset_id="preset-routing-regression",
            key="assistant-character-sheet-routing-test",
            label="Character Sheet Routing Test",
            description="Saved preset button routing regression.",
        ),
    ]
    recipes = [
        _recipe(),
        _recipe(
            recipe_id="recipe-debug",
            key="debug-character-sheet-recipe",
            label="Debug Character Sheet Recipe",
            description="debug fixture",
        ),
    ]

    first = module.recommend_saved_artifacts(
        _context(module, "character_sheet", story=True),
        presets=presets,
        recipes=recipes,
    )
    second = module.recommend_saved_artifacts(
        _context(module, "character_sheet", story=True),
        presets=list(reversed(presets)),
        recipes=list(reversed(recipes)),
    )

    assert [item.identity for item in first] == [
        "recipe-character-sheet",
        "preset-character-sheet",
    ]
    assert first == second
    assert all(item.reason and len(item.reason) < 180 for item in first)
    assert not any("debug" in item.label.lower() or "test" in item.label.lower() for item in first)


@pytest.mark.parametrize(
    ("stage", "label", "description"),
    [
        ("environment", "Environment Sheet v1", "Creates a reusable environment continuity sheet prompt."),
        ("storyboard", "Storyboard v2", "Creates a cinematic storyboard sheet from an approved brief."),
    ],
)
def test_recommender_matches_environment_and_storyboard_purposes(
    app_modules,
    stage: str,
    label: str,
    description: str,
) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    recipe = _recipe(
        recipe_id=f"recipe-{stage}",
        key=f"{stage}-v1",
        label=label,
        description=description,
    )

    result = module.recommend_saved_artifacts(
        _context(module, stage, story=True),
        presets=[],
        recipes=[recipe],
    )

    assert [item.identity for item in result] == [f"recipe-{stage}"]
    assert result[0].artifact_kind == "prompt_recipe"


def test_recommender_falls_back_when_no_candidate_clears_confidence(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")

    result = module.recommend_saved_artifacts(
        _context(module, "character_sheet"),
        presets=[],
        recipes=[
            _recipe(
                recipe_id="recipe-shortener",
                key="prompt-shortener",
                label="Prompt Shortener",
                description="Compresses long text.",
                category="utility",
            )
        ],
    )

    assert result == []


def test_recommender_reports_only_genuinely_missing_required_inputs(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    recipe = _recipe(
        input_variables_json=[
            {"key": "character_brief", "label": "Character brief", "required": True},
            {"key": "wardrobe", "label": "Wardrobe", "required": False},
        ],
        image_input_json={"mode": "direct_reference", "required": True, "max_files": 2},
    )

    missing = module.recommend_saved_artifacts(
        _context(module, "character_sheet"),
        presets=[],
        recipes=[recipe],
    )[0]
    satisfied = module.recommend_saved_artifacts(
        _context(module, "character_sheet", references=1, story=True),
        presets=[],
        recipes=[recipe],
    )[0]

    assert missing.required_inputs == ("Character brief", "Reference image")
    assert missing.missing_required_inputs == ("Character brief", "Reference image")
    assert satisfied.required_inputs == ("Character brief", "Reference image")
    assert satisfied.missing_required_inputs == ()


def _tool_context() -> SimpleNamespace:
    return SimpleNamespace(
        session={"assistant_session_id": "asst-recommendation", "summary_json": {}},
        attachments=[],
        user_message_id="message-1",
    )


def _stub_persistence(monkeypatch, module) -> None:
    monkeypatch.setattr(
        module.store_assistant,
        "create_or_update_assistant_session",
        lambda payload: payload,
    )


def test_tool_searches_once_and_remembers_direct_construction_choice(app_modules, monkeypatch) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation_tools")
    context = _tool_context()
    calls = {"presets": 0, "recipes": 0}

    def presets():
        calls["presets"] += 1
        return [_preset()]

    def recipes(*, status):
        assert status == "active"
        calls["recipes"] += 1
        return [_recipe()]

    monkeypatch.setattr(module.store, "list_presets", presets)
    monkeypatch.setattr(module.store, "list_prompt_recipes", recipes)
    _stub_persistence(monkeypatch, module)

    first = module.recommend_saved_artifacts_tool(
        module.RecommendSavedArtifactsArguments(stage="character_sheet", requested_output="image"),
        context,
    )
    repeated = module.recommend_saved_artifacts_tool(
        module.RecommendSavedArtifactsArguments(stage="character_sheet", requested_output="image"),
        context,
    )
    declined = module.record_artifact_recommendation_decision(
        module.RecordArtifactRecommendationDecisionArguments(
            stage="character_sheet",
            decision="direct",
        ),
        context,
    )
    after_decline = module.recommend_saved_artifacts_tool(
        module.RecommendSavedArtifactsArguments(stage="character_sheet", requested_output="image"),
        context,
    )

    assert first["status"] == "offered"
    assert first["searched"] is True
    assert repeated["searched"] is False
    assert declined["status"] == "declined"
    assert after_decline == {
        "stage": "character_sheet",
        "status": "declined",
        "candidates": [],
        "direct_construction_available": True,
        "searched": False,
    }
    assert calls == {"presets": 1, "recipes": 1}


def test_selection_returns_exact_identity_provenance_and_only_missing_inputs(app_modules, monkeypatch) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation_tools")
    context = _tool_context()
    monkeypatch.setattr(module.store, "list_presets", lambda: [])
    monkeypatch.setattr(module.store, "list_prompt_recipes", lambda *, status: [_recipe()])
    _stub_persistence(monkeypatch, module)

    offered = module.recommend_saved_artifacts_tool(
        module.RecommendSavedArtifactsArguments(stage="character_sheet", requested_output="image"),
        context,
    )
    selected = module.record_artifact_recommendation_decision(
        module.RecordArtifactRecommendationDecisionArguments(
            stage="character_sheet",
            decision="use",
            artifact_kind="prompt_recipe",
            identity="recipe-character-sheet",
        ),
        context,
    )

    assert len(offered["candidates"]) == 1
    assert selected["identity"] == "recipe-character-sheet"
    assert selected["missing_required_inputs"] == ["Character brief"]
    assert selected["provenance"] == {
        "source": "saved_artifact_catalog",
        "artifact_kind": "prompt_recipe",
        "identity": "recipe-character-sheet",
        "key": "character-sheet-prompt-writer",
    }


def test_kernel_exposes_typed_recommendation_tools_and_exact_name_bypass(app_modules) -> None:
    del app_modules
    tools = importlib.import_module("app.assistant.kernel_tools")
    kernel = importlib.import_module("app.assistant.kernel")

    catalog = {item["name"]: item for item in tools.kernel_tool_catalog("story_builder")}
    instruction = kernel._kernel_instruction()

    assert catalog["recommend_saved_artifacts"]["read_only"] is False
    assert catalog["record_artifact_recommendation_decision"]["read_only"] is False
    assert catalog["recommend_saved_artifacts"]["arguments_schema"]["properties"]["stage"]
    assert "Exact-name requests bypass recommendation" in instruction
    assert "continue with direct construction" in instruction
