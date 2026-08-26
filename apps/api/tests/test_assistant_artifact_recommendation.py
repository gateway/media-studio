from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest


def _context(
    module,
    stage: str,
    *,
    output: str = "image",
    purpose: str = "",
    current_values=(),
    story_values=(),
    references=(),
):
    return module.ArtifactRecommendationContext(
        stage=stage,
        requested_output=output,
        purpose=purpose,
        current_values=current_values,
        story_values=story_values,
        references=references,
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
        _context(module, "character_sheet", purpose="practical salvage crew character sheet"),
        presets=presets,
        recipes=recipes,
    )
    second = module.recommend_saved_artifacts(
        _context(module, "character_sheet", purpose="practical salvage crew character sheet"),
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
        _context(module, stage, purpose=description),
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
        _context(
            module,
            "character_sheet",
            story_values=(("character_brief", "A practical salvage crew."),),
            references=(("reference-1", "character reference"),),
        ),
        presets=[],
        recipes=[recipe],
    )[0]

    assert missing.required_inputs == ("Character brief", "Reference image")
    assert missing.missing_required_inputs == ("Character brief", "Reference image")
    assert satisfied.required_inputs == ("Character brief", "Reference image")
    assert satisfied.missing_required_inputs == ()


def test_eligibility_uses_hard_structured_test_boundary_without_rejecting_attachment_language(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    deterministic_test = _preset(
        preset_id="preset-deterministic-test",
        key="storyboard_character_sheet_generator_deterministic_test_44285c2f",
        label="Storyboard Character Sheet Generator Deterministic Test 44285c2f",
        description="Deterministic planner test preset.",
        rules_json={"assistant_recommendation_eligible": True},
    )
    legitimate = _recipe(
        key="test-kitchen-environment-sheet",
        label="Test Kitchen Environment Sheet",
        description="Builds a character sheet from a user attachment and a production brief.",
    )

    assert module.artifact_is_recommendation_eligible(deterministic_test) is False
    assert module.artifact_is_recommendation_eligible(legitimate) is True


def test_video_prompt_accepts_video_recipe_when_requested_output_is_prompt(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    result = module.recommend_saved_artifacts(
        _context(
            module,
            "video_prompt",
            output="prompt",
            purpose="turn the approved storyboard into a Seedance video prompt",
        ),
        presets=[],
        recipes=[
            _recipe(
                recipe_id="recipe-seedance",
                key="seedance-storyboard-video-director-v1",
                label="Seedance Storyboard Video Director v1",
                description="Turns a completed storyboard into a Seedance-ready video prompt.",
                category="video",
            )
        ],
    )

    assert [item.identity for item in result] == ["recipe-seedance"]
    assert result[0].missing_required_inputs == ("Character brief",)


def test_storyboard_prompt_requires_actual_story_state_value_not_stage_description(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    recipe = _recipe(
        recipe_id="recipe-seedance-video",
        key="seedance-storyboard-video-director-v1",
        label="Seedance Storyboard Video Director v1",
        description="Turns a storyboard prompt into a Seedance video prompt.",
        category="video",
        input_variables_json=[
            {"key": "source_prompt", "label": "Storyboard Prompt Text", "required": True}
        ],
    )

    described = module.recommend_saved_artifacts(
        _context(
            module,
            "video_prompt",
            output="prompt",
            purpose="turn the approved salvage storyboard into a five-second clip",
        ),
        presets=[],
        recipes=[recipe],
    )[0]
    resolved = module.recommend_saved_artifacts(
        _context(
            module,
            "video_prompt",
            output="prompt",
            purpose="turn the approved salvage storyboard into a five-second clip",
            story_values=(("source_prompt", "Shot 1: the crew enters the flooded drydock."),),
        ),
        presets=[],
        recipes=[recipe],
    )[0]

    assert described.missing_required_inputs == ("Storyboard Prompt Text",)
    assert resolved.missing_required_inputs == ()


def test_defaults_and_compatible_current_purpose_resolve_only_matching_required_inputs(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    recipe = _recipe(
        recipe_id="recipe-environment",
        key="environment-plate-v1",
        label="Environment Plate v1",
        description="Creates an environment plate prompt.",
        input_variables_json=[
            {"key": "environment_brief", "label": "Environment Brief", "required": True},
            {"key": "visual_style", "label": "Visual Style", "required": True},
            {"key": "camera_view", "label": "Camera View", "required": True, "default_value": "Wide"},
        ],
    )

    result = module.recommend_saved_artifacts(
        _context(
            module,
            "environment",
            purpose="a flooded orbital drydock for the salvage crew",
            current_values=(("environment_brief", "a flooded orbital drydock for the salvage crew"),),
        ),
        presets=[],
        recipes=[recipe],
    )[0]

    assert result.missing_required_inputs == ("Visual Style",)
    assert result.resolved_input_bindings == (
        ("environment_brief", "current_request", "a flooded orbital drydock for the salvage crew"),
    )


def test_stage_phrase_in_input_description_does_not_make_storyboard_a_character_producer(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    storyboard = _recipe(
        recipe_id="recipe-storyboard-v2",
        key="storyboard-v2",
        label="Storyboard v2",
        description="Creates a storyboard from an approved character sheet.",
    )

    result = module.recommend_saved_artifacts(
        _context(module, "character_sheet", purpose="practical salvage crew character sheet"),
        presets=[],
        recipes=[_recipe(), storyboard],
    )

    assert [item.identity for item in result] == ["recipe-character-sheet"]


def test_optional_prompt_and_role_specific_references_are_bound_without_reusing_one_reference(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    preset = _preset(
        input_schema_json=[
            {"key": "user_prompt", "label": "User Prompt", "required": False},
        ],
        input_slots_json=[
            {"key": "character_reference", "label": "Character Reference", "required": False},
            {"key": "environment_reference", "label": "Environment Reference", "required": False},
        ],
    )

    result = module.recommend_saved_artifacts(
        _context(
            module,
            "character_sheet",
            purpose="practical salvage crew character sheet",
            current_values=(("user_prompt", "practical salvage crew character sheet"),),
            references=(("ref-character", "character reference"), ("ref-environment", "environment reference")),
        ),
        presets=[preset],
        recipes=[],
    )[0]

    assert result.resolved_input_bindings == (
        ("user_prompt", "current_request", "practical salvage crew character sheet"),
        ("character_reference", "reference", "ref-character"),
        ("environment_reference", "reference", "ref-environment"),
    )


def test_purpose_priority_avoids_niche_storyboard_and_model_catalog_keeps_nano_preset(app_modules) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation")
    generic = _recipe(
        recipe_id="recipe-clean-storyboard",
        key="cleanest_storyboard_director",
        label="Cleanest Storyboard Director",
        description="Transforms a creative brief into a polished storyboard image prompt.",
        priority=650,
    )
    food = _recipe(
        recipe_id="recipe-food",
        key="food-storyboard-host-v1",
        label="Food Storyboard Host v1",
        description="Creates a cooking or food-making storyboard from a food brief.",
        priority=459,
    )
    nano = _preset(
        preset_id="preset-nano-storyboard",
        key="cleanest-storyboard-sheet",
        label="Cleanest Storyboard Sheet",
        description="Reusable storyboard sheet preset.",
        model_key="nano-banana-2",
        applies_to_task_modes_json=[],
        priority=700,
    )

    result = module.recommend_saved_artifacts(
        _context(
            module,
            "storyboard",
            purpose="cinematic salvage crew storyboard",
        ),
        presets=[nano],
        recipes=[food, generic],
        model_task_modes={"nano-banana-2": ("image_edit",)},
    )

    assert [item.identity for item in result] == [
        "preset-nano-storyboard",
        "recipe-clean-storyboard",
    ]


def _tool_context() -> SimpleNamespace:
    return SimpleNamespace(
        session={"assistant_session_id": "asst-recommendation", "summary_json": {}},
        attachments=[],
        user_message_id="message-1",
        user_text="practical salvage crew character sheet",
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
        module.RecommendSavedArtifactsArguments(
            stage="character_sheet",
            stage_instance_id="salvage_crew",
            requested_output="image",
            purpose="practical salvage crew character sheet",
            available_input_keys=["character_brief"],
        ),
        context,
    )
    repeated = module.recommend_saved_artifacts_tool(
        module.RecommendSavedArtifactsArguments(
            stage="character_sheet",
            stage_instance_id="salvage_crew",
            requested_output="image",
            purpose="practical salvage crew character sheet",
            available_input_keys=["character_brief"],
        ),
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
        module.RecommendSavedArtifactsArguments(
            stage="character_sheet",
            stage_instance_id="salvage_crew",
            requested_output="image",
            purpose="practical salvage crew character sheet",
            available_input_keys=["character_brief"],
        ),
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
        module.RecommendSavedArtifactsArguments(
            stage="character_sheet",
            stage_instance_id="salvage_crew",
            requested_output="image",
            purpose="practical salvage crew character sheet",
            available_input_keys=["character_brief"],
        ),
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
    assert selected["missing_required_inputs"] == []
    assert selected["resolved_input_bindings"] == [
        {
            "input_key": "character_brief",
            "source": "current_request",
            "value": "practical salvage crew character sheet",
        }
    ]
    assert selected["provenance"] == {
        "source": "saved_artifact_catalog",
        "artifact_kind": "prompt_recipe",
        "identity": "recipe-character-sheet",
        "key": "character-sheet-prompt-writer",
    }


def test_server_stage_key_ignores_alias_but_changes_with_purpose(app_modules, monkeypatch) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation_tools")
    context = _tool_context()
    calls = {"recipes": 0}
    monkeypatch.setattr(module.store, "list_presets", lambda: [])

    def recipes(*, status):
        calls["recipes"] += 1
        return [_recipe()]

    monkeypatch.setattr(module.store, "list_prompt_recipes", recipes)
    _stub_persistence(monkeypatch, module)
    monkeypatch.setattr(module, "_model_task_modes", lambda: {})

    for instance, purpose in (
        ("salvage_crew", "practical salvage crew character sheet"),
        ("crew_sheet", "practical salvage crew character sheet"),
        ("station_marshal", "station marshal character sheet"),
    ):
        module.recommend_saved_artifacts_tool(
            module.RecommendSavedArtifactsArguments(
                stage="character_sheet",
                stage_instance_id=instance,
                requested_output="image",
                purpose=purpose,
            ),
            context,
        )

    assert calls["recipes"] == 2


def test_alternatives_returns_next_bounded_pair_and_stage_memory_is_pruned(app_modules, monkeypatch) -> None:
    del app_modules
    module = importlib.import_module("app.assistant.artifact_recommendation_tools")
    context = _tool_context()
    recipes = [
        _recipe(
            recipe_id=f"recipe-character-{index}",
            key=f"character-sheet-{index}",
            label=f"Character Sheet {index}",
            priority=priority,
        )
        for index, priority in ((1, 300), (2, 200), (3, 100))
    ]
    monkeypatch.setattr(module.store, "list_presets", lambda: [])
    monkeypatch.setattr(module.store, "list_prompt_recipes", lambda *, status: recipes)
    monkeypatch.setattr(module, "_model_task_modes", lambda: {})
    _stub_persistence(monkeypatch, module)

    first = module.recommend_saved_artifacts_tool(
        module.RecommendSavedArtifactsArguments(
            stage="character_sheet",
            stage_instance_id="crew",
            requested_output="image",
            purpose="practical salvage crew character sheet",
            available_input_keys=["character_brief"],
        ),
        context,
    )
    alternatives = module.record_artifact_recommendation_decision(
        module.RecordArtifactRecommendationDecisionArguments(
            stage="character_sheet",
            stage_instance_id="crew",
            decision="alternatives",
        ),
        context,
    )

    assert [item["identity"] for item in first["candidates"]] == [
        "recipe-character-1",
        "recipe-character-2",
    ]
    assert [item["identity"] for item in alternatives["candidates"]] == [
        "recipe-character-3",
    ]

    for index in range(9):
        module.recommend_saved_artifacts_tool(
            module.RecommendSavedArtifactsArguments(
                stage="character_sheet",
                stage_instance_id=f"character_{index}",
                requested_output="image",
                purpose=f"character sheet purpose {index}",
            ),
            context,
        )
    stages = context.session["summary_json"]["kernel_artifact_recommendation"]["stages"]
    assert len(stages) == 8


def test_kernel_exposes_typed_recommendation_tools_and_exact_name_bypass(app_modules) -> None:
    del app_modules
    tools = importlib.import_module("app.assistant.kernel_tools")
    kernel = importlib.import_module("app.assistant.kernel")

    catalog = {item["name"]: item for item in tools.kernel_tool_catalog("story_builder")}
    instruction = kernel._kernel_instruction()

    assert catalog["recommend_saved_artifacts"]["read_only"] is False
    assert catalog["record_artifact_recommendation_decision"]["read_only"] is False
    assert catalog["recommend_saved_artifacts"]["arguments_schema"]["properties"]["stage"]
    assert "search_prompt_recipes" in catalog
    assert "get_prompt_recipe" in catalog
    assert "Exact-name requests bypass recommendation" in instruction
    assert "continue with direct construction" in instruction

    exact_search = tools.execute_kernel_tool(
        tool_name="search_prompt_recipes",
        arguments={"query": "Storyboard v2", "limit": 5},
        capability="story_builder",
        context=tools.KernelToolContext(workflow=None, canvas_context={}),
    )
    assert exact_search.trace.error is None
    assert any("Storyboard v2" in str(item.get("label") or "") for item in exact_search.result["items"])


def test_invalid_or_stale_decision_returns_typed_tool_error(app_modules) -> None:
    del app_modules
    tools = importlib.import_module("app.assistant.kernel_tools")
    execution = tools.execute_kernel_tool(
        tool_name="record_artifact_recommendation_decision",
        arguments={"stage": "character_sheet", "decision": "direct"},
        capability="story_builder",
        context=tools.KernelToolContext(
            workflow=None,
            canvas_context={},
            session={"assistant_session_id": "asst-stale", "summary_json": {}},
        ),
    )

    assert execution.result is None
    assert execution.trace.error is not None
    assert execution.trace.error.code == "artifact_recommendation_not_pending"
