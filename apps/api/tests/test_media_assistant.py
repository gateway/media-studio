from __future__ import annotations

import importlib
import json
from uuid import uuid4

import pytest

from app.assistant.context import build_assistant_context, redact_context
from app.assistant.graph_plan import _node_layout_size_for_bounds, apply_graph_plan
from app.assistant.intent import is_story_project_request, route_assistant_intent
from app.assistant.limits import ASSISTANT_IMAGE_ATTACHMENT_LIMIT
from app.assistant.preset_fields import infer_explicit_preset_fields
from app.assistant.preset_slots import infer_runtime_image_slots_from_text
from app.assistant import provider_chat
from app.assistant import story_graph as story_graph_module
from app.assistant.canvas_context import compact_canvas_context
from app.assistant.graph_diff import graph_plan_diff_summary, graph_plan_layout_errors
from app.assistant.provider_planner import _catalog_for_prompt
from app.assistant.provider_planner import _build_plan_messages, _validate_plan_payload
from app.assistant.drafts import _saved_prompt_field_instruction, draft_media_preset
from app.assistant.schemas import AssistantGraphOperation, AssistantGraphPlan, MediaPresetBuilderOperation, MediaPresetBuilderSkillInput, MediaPresetBuilderSkillOutput
from app.assistant.skills import assistant_skill_catalog, select_assistant_skill
from app.assistant.skill_kernel import attachment_set_hash
from app.assistant.preset_skill import PROMPT_QUALITY_MIN_SCORE, score_preset_prompt
from app.assistant.planner import _fields_with_sandbox_prompt_values, _graph_preset_sandbox_plan, plan_graph_from_message
from app.assistant.preset_builder import build_preset_builder_proposal, preset_builder_chat_text
from app.assistant.routes import _recipe_save_request, _save_request_is_negated
from app.assistant.graph_templates import (
    AssistantGraphTemplate,
    I2I_SANDBOX_TEMPLATE_ID,
    SAVED_PRESET_TEST_TEMPLATE_ID,
    TEMPLATES,
    T2I_SANDBOX_TEMPLATE_ID,
    instantiate_preset_sandbox_template,
    validate_assistant_graph_templates,
)
from app.assistant.story_graph import story_graph_plan_from_state
from app.assistant.story_state import _story_brief_from_user_request, merge_story_project_state
from app.assistant.transcript_quality import audit_assistant_transcript
from app.assistant.selected_node_edit import selected_node_field_edit_plan_from_context
from app.assistant.style_brief import (
    PROVIDER_BRIEF_JSON_CLOSE,
    PROVIDER_BRIEF_JSON_OPEN,
    REFERENCE_STYLE_PROMPT_MAX_CHARS,
    ReferenceStyleBrief,
    ReferenceStyleImageSlot,
    ReferenceStylePresetContract,
    ReferenceStylePresetDirection,
    ReferenceStylePresetField,
    ReferenceStylePromptBlueprint,
    build_reference_style_brief,
    build_reference_style_output_check,
    compact_style_brief_reply,
    compile_reference_style_i2i_prompt,
    compile_reference_style_i2i_prompt_result,
    compile_reference_style_prompt,
    compile_reference_style_prompt_result,
    compile_reference_style_t2i_prompt,
    compile_reference_style_t2i_prompt_result,
    encode_reference_style_brief_marker,
    extract_reference_style_brief_from_message,
    has_concrete_style_traits,
    repair_reference_style_prompt,
    reference_style_brief_with_alternative_fields,
    strip_provider_reference_style_payload,
    sync_reference_style_brief_with_visible_setup,
    validate_reference_style_preset_contract,
)
from app.graph.schemas import GraphWorkflow
from app.graph.validator import validate_workflow
from app.schemas import PresetUpsertRequest
from app.service import upsert_preset
from app.service_errors import ServiceError
from app.service_preset_validation import validate_preset_payload


PNG_1X1_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_media_assistant_recipe_save_negation_handles_action_lists() -> None:
    message = (
        "Create the actual Storyboard v2 Prompt Recipe draft now. "
        "Do not run, save, submit, upload, delete, import, or export anything."
    )

    assert _save_request_is_negated(message.lower()) is True
    assert _recipe_save_request(message) is False


def test_media_assistant_explicit_named_fields_override_generic_keywords() -> None:
    fields = infer_explicit_preset_fields(
        "Create the actual Media Preset now from this approved sandbox result. "
        "Keep one required runtime person image input and the two fields Headline / Slogan and Wardrobe / Styling Notes."
    )

    assert [(field["key"], field["label"]) for field in fields] == [
        ("headline_slogan", "Headline / Slogan"),
        ("wardrobe_styling_notes", "Wardrobe / Styling Notes"),
    ]


def test_media_assistant_natural_preset_request_sets_preset_intake_prompt_route(client, app_modules, monkeypatch) -> None:
    captured_context: dict[str, object] = {}

    def fake_provider_chat(**kwargs):
        captured_context.update(kwargs["context"])
        payload = {
            "title": "Open World Clone Test",
            "summary": "Detailed image clone planning test.",
            "target_model_mode": "text_to_image",
            "input_mode": "no_image",
            "visual_analysis": {
                "medium": ["editorial mixed-media poster"],
                "palette": ["warm amber and teal contrast"],
                "line_shape_language": ["bold silhouette blocks"],
                "composition": ["central subject with clear lower title zone"],
                "subject_treatment": ["stylized central figure"],
                "environment_props": ["layered background props"],
                "texture_lighting": ["grainy print texture"],
                "typography_text_energy": ["dominant headline zone"],
                "mood": ["cinematic"],
            },
            "fixed_style_traits": ["central figure with layered editorial texture"],
            "replaceable_elements": ["headline", "main subject"],
            "recommended_fields": [{"key": "headline", "label": "Headline", "required": True}],
            "recommended_image_slots": [],
        }
        return {
            "mode": "provider_chat",
            "generated_text": (
                "This looks like `Open World Clone Test`.\n\n"
                "Suggested setup:\n"
                "- Field: Headline\n"
                "- Image input: none\n\n"
                f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "natural-preset-route-test",
            "usage": {},
            "assistant_prompt_route": "preset_intake",
            "loaded_prompt_assets": [
                "skills/media_preset_orchestrator.md",
                "skills/media_preset/reference_image_analyzer.md",
                "skills/media_preset/replacement_field_planner.md",
                "skills/media_preset/image_slot_planner.md",
                "skills/media_preset/prompt_compiler.md",
                "skills/media_preset/backend_contract.md",
            ],
            "system_prompt_char_count": 12345,
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    reference_id = _create_reference_image(app_modules, name="open-world-clone-route.jpg")
    workflow = {"schema_version": 1, "name": "Open world clone route", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-open-world-route", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "open-world-clone-route.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create a media preset from this image.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert captured_context["assistant_prompt_route"] == "preset_intake"
    assert assistant_message["content_json"]["assistant_prompt_route"] == "preset_intake"
    assert "skills/media_preset/reference_image_analyzer.md" in assistant_message["content_json"]["loaded_prompt_assets"]


def test_media_studio_preset_validation_rejects_choice_tokens() -> None:
    with pytest.raises(ServiceError, match="concrete text fields and image slots"):
        validate_preset_payload(
            PresetUpsertRequest(
                key="unsupported_choice_token",
                label="Unsupported Choice Token",
                applies_to_models=["gpt-image-2"],
                prompt_template="Create {{choice:subject_source}}.",
                input_schema_json=[],
                input_slots_json=[],
            )
        )


def test_media_assistant_sandbox_values_keep_companion_character_fields_human_readable() -> None:
    brief = ReferenceStyleBrief(
        brief_id="brief_companion_cast_values",
        preset_direction=ReferenceStylePresetDirection(
            title="Cinematic Anime Collector Loft Portrait",
            target_model_mode="text_to_image",
            input_mode="no_image",
        ),
        visual_analysis={
            "medium": ["hybrid cinematic digital illustration with photoreal central human subject"],
            "subject_treatment": [
                "surrounding characters form a semicircle around the couch",
                "central seated human subject anchors the scene",
            ],
            "environment_props": ["collector shelves filled with anime figures, manga books, and framed art"],
        },
        fixed_style_traits=["surrounding stylized character presences arranged around the subject"],
    )

    fields = _fields_with_sandbox_prompt_values(
        [
            {"key": "main_character", "label": "Main Character", "required": True},
            {"key": "companion_characters", "label": "Companion Characters", "required": False},
            {"key": "character_lineup", "label": "Character Lineup", "required": False},
            {"key": "character_universe", "label": "Character Universe", "required": False},
        ],
        brief,
    )

    assert fields[0]["default_value"] == "central seated human subject"
    assert fields[1]["default_value"] == "invented anime-style companion cast"
    assert fields[2]["default_value"] == "invented anime-style companion cast"
    assert fields[3]["default_value"] == "invented anime-style companion cast"
    assert "golden retriever" not in fields[1]["default_value"]
    assert "recognizable shonen" not in fields[1]["default_value"]


def test_media_assistant_sandbox_values_use_style_specific_companion_creature() -> None:
    brief = ReferenceStyleBrief(
        brief_id="brief_ink_wash_koi_values",
        preset_direction=ReferenceStylePresetDirection(
            title="Ink-Wash Samurai Spirit Poster",
            target_model_mode="text_to_image",
            input_mode="no_image",
        ),
        visual_analysis={
            "subject_treatment": ["stoic swordsman with layered robes rendered as abstract ink masses"],
            "environment_props": ["spirit koi used as the main symbolic secondary object"],
            "composition": [
                "full-body standing figure placed slightly left of center",
                "large open negative space around the subject",
                "koi-like spirit mass sweeping over the upper right shoulder",
            ],
        },
        fixed_style_traits=["monochrome sumi-e ink wash poster with red koi accent"],
    )

    fields = _fields_with_sandbox_prompt_values(
        [
            {"key": "main_subject", "label": "Main Subject", "required": True},
            {"key": "companion_creature", "label": "Companion Creature", "required": False},
        ],
        brief,
    )

    assert fields[0]["default_value"] == "full-body standing figure"
    assert fields[1]["default_value"] == "spirit koi"
    assert "negative space" not in fields[0]["default_value"]
    assert "golden retriever" not in fields[1]["default_value"]


def test_reference_style_prompt_treats_universe_field_as_original_non_franchise() -> None:
    brief = ReferenceStyleBrief(
        brief_id="brief_character_universe_prompt",
        preset_direction=ReferenceStylePresetDirection(
            title="Cinematic Anime Collector Loft Portrait",
            target_model_mode="image_edit",
            input_mode="image_required",
        ),
        visual_analysis={
            "medium": ["cinematic photo-illustration blend with a realistic central human subject"],
            "palette": ["warm amber sunset light with deep brown room shadows"],
            "line_shape_language": ["rounded collectible silhouettes and layered shelf rectangles"],
            "composition": ["center seated portrait surrounded by display figures and room props"],
            "subject_treatment": ["real person remains natural while the supporting cast is stylized"],
            "environment_props": ["collector shelves filled with anime-style figures, books, mugs, and framed art"],
            "texture_lighting": ["soft cinematic haze and polished entertainment-poster finish"],
            "mood": ["cozy fan-world energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(
                    key="character_universe",
                    label="Character Universe",
                    default_value="invented anime-style companion cast",
                )
            ],
            image_slots=[ReferenceStyleImageSlot(key="face_reference", label="Face Reference", required=True)],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=["warm collector-room portrait", "original stylized companion figures"],
            negative_guidance=["avoid existing franchise names and logos"],
        ),
    )

    prompt = compile_reference_style_i2i_prompt(brief)

    assert "invented anime-style companion cast as the Character Universe" in prompt
    assert "original non-franchise fan world" in prompt
    assert "avoid existing character names, logos, or recognizable franchise designs" in prompt.lower()


def test_reference_style_prompt_rewrites_positive_brand_text_traits() -> None:
    brief = ReferenceStyleBrief(
        brief_id="brief_rewrite_positive_brand_text",
        preset_direction=ReferenceStylePresetDirection(
            title="Collector Lounge Portrait",
            target_model_mode="image_edit",
            input_mode="image_required",
        ),
        visual_analysis={
            "medium": ["cinematic photo-illustration hybrid portrait"],
            "palette": ["warm amber window light and deep charcoal shadows"],
            "composition": ["central seated portrait surrounded by layered shelves and foreground props"],
            "environment_props": ["visible branded book spines and graphic merchandise text in the foreground"],
            "texture_lighting": ["premium editorial finish with soft golden haze"],
            "mood": ["cozy collector-room fandom energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            image_slots=[ReferenceStyleImageSlot(key="face_reference", label="Face Reference", required=True)],
        ),
    )

    prompt = compile_reference_style_i2i_prompt(brief)

    lowered = prompt.lower()
    assert "visible branded" not in lowered
    assert "merchandise text" not in lowered
    assert "invented collectible book spines" in lowered
    assert "decorative graphic set dressing with no real brands" in lowered


def test_media_assistant_preset_builder_accepts_input_image_role_phrasing() -> None:
    proposal = build_preset_builder_proposal(
        "Create both a text-to-image and image-to-image media preset from this reference image. "
        "For image-to-image use one input image for the main character or subject.",
        [{"reference_id": "ref-style10", "kind": "image", "label": "style10.jpg"}],
    )

    slots = proposal["preset_contract"]["image_slots"]
    assert [(slot["key"], slot["label"]) for slot in slots] == [("main_character_subject", "Main Character / Subject")]
    assert proposal["preset_contract"]["model_hint"] == "image_edit"


def test_media_assistant_preset_builder_recommends_shape_before_mode_question() -> None:
    proposal = build_preset_builder_proposal(
        "I want a gothic sci-fi portrait Media Preset from a reference image. Recommend the useful fields.",
        [],
    )

    assert proposal["recommended_preset_shape"] == "text_to_image"
    assert len(proposal["preset_contract"]["fields"]) <= 3
    assert proposal["preset_contract"]["image_slots"] == []
    text = preset_builder_chat_text(proposal)
    lowered = text.lower()
    assert "i recommend text-to-image" in lowered
    assert "useful fields:" in lowered
    assert "style sources only" in lowered
    assert "text-to-image, image-to-image, or both" not in lowered
    assert "test workflow" not in lowered
    assert "no extra fields" not in lowered


def test_media_assistant_both_request_with_ask_before_does_not_auto_plan_and_preserves_slot(
    client,
    app_modules,
    monkeypatch,
) -> None:
    reference_id = _create_reference_image(app_modules, name="style10.jpg")
    workflow = {"schema_version": 1, "name": "Style10 confirmation first", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style10-confirm-first", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style10.jpg"})

    def fake_provider_chat(**_kwargs):
        style_payload = {
            "title": "Whimsical Giant-Perspective Sunny Adventure",
            "summary": "Low-angle playful poster with oversized foreground perspective and toy-like companions.",
            "target_model_mode": "text_to_image",
            "visual_analysis": {
                "medium": ["stylized photo-illustration with near-photoreal human rendering"],
                "palette": ["high-saturation cobalt blue sky", "warm peach pavement", "bright flower accents"],
                "line_shape_language": ["oversized foreground sneaker scale", "rounded toy-like animal shapes"],
                "composition": ["extreme low-angle vertical poster framing", "giant-perspective foreground foot"],
                "subject_treatment": ["playful adventurous human pose", "tiny wide-eyed companion creatures"],
                "environment_props": ["sunny alley", "blue flowers", "watermelon slice prop"],
                "texture_lighting": ["crisp sunlit shadows", "glossy storybook realism"],
                "typography_text_energy": ["no visible typography"],
                "mood": ["whimsical", "bright", "adventurous"],
            },
            "recommended_fields": [
                {"key": "sidekick_animal", "label": "Sidekick Animal", "required": True},
                {"key": "featured_treat_prop", "label": "Featured Treat or Prop", "required": False},
            ],
            "recommended_image_slots": [],
        }
        return {
            "mode": "provider_chat",
            "generated_text": (
                "This looks like `Whimsical Giant-Perspective Sunny Adventure`. "
                "Style read: stylized photo-illustration with near-photoreal human rendering, giant low-angle foreground sneaker, "
                "tiny toy-like animal companions, high-saturation cobalt sky, bright flowers, sunny alley, watermelon prop, and crisp playful lighting. "
                "Suggested fields: Sidekick Animal and Featured Treat or Prop. Image input: none. "
                f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(style_payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "style10-confirm-first",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create both a text-to-image and image-to-image media preset from this reference image. "
                "For image-to-image use one input image for the main character or subject. "
                "Suggest only 1-3 style-specific form fields that a normal user would understand, then ask before creating the test workflow."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["suggested_action"] is None
    assert "Image slot: Main Character / Subject" in assistant_message["content_text"]
    style_brief = response.json()["summary_json"]["reference_style_brief"]
    assert [(slot["key"], slot["label"]) for slot in style_brief["preset_contract"]["image_slots"]] == [
        ("main_character_subject", "Main Character / Subject")
    ]


def test_assistant_provider_chat_passes_reusable_codex_thread_for_same_workflow(app_modules, monkeypatch) -> None:
    del app_modules
    attachments = [
        {
            "assistant_attachment_id": "asatt_same_loop",
            "reference_id": "ref_same_loop",
            "kind": "image",
            "label": "style.jpg",
        }
    ]
    stored_hash = attachment_set_hash(attachments)
    captured_calls: list[dict] = []

    def fake_codex_chat(**kwargs):
        captured_calls.append(kwargs)
        return {
            "provider_kind": "codex_local",
            "provider_model_id": kwargs["model_id"],
            "provider_thread_id": "thread-existing",
            "provider_session_id": "thread-existing",
            "provider_turn_id": f"turn-{len(captured_calls)}",
            "provider_thread_reused": bool(kwargs.get("provider_thread_id")),
            "provider_response_id": f"thread-existing:turn-{len(captured_calls)}",
            "generated_text": "This looks like a test style. Do you want me to create a test workflow?",
            "usage": {},
            "cost": None,
        }

    monkeypatch.setattr(provider_chat.enhancement_provider, "run_codex_local_chat", fake_codex_chat)
    session = {
        "assistant_session_id": "asst_same_loop",
        "owner_kind": "graph_workflow",
        "owner_id": "workflow-a",
        "provider_kind": "codex_local",
        "provider_model_id": "gpt-5.4",
        "provider_thread_id": "thread-existing",
        "summary_json": {
            "media_preset_builder": {
                "attachment_set_hash": stored_hash,
                "provider_thread_id": "thread-existing",
                "workflow_tab_id": "workflow-a",
                "lane": "image_to_image",
            }
        },
    }

    provider_chat.run_assistant_provider_chat(
        session=session,
        user_text="Try again.",
        context={"workflow": {"workflow_id": "workflow-a"}},
        messages=[],
        attachments=attachments,
    )
    changed_attachments = [{**attachments[0], "reference_id": "ref_changed"}]
    provider_chat.run_assistant_provider_chat(
        session=session,
        user_text="Analyze this new reference.",
        context={"workflow": {"workflow_id": "workflow-a"}},
        messages=[],
        attachments=changed_attachments,
    )
    changed_workflow_session = {**session, "owner_id": "workflow-b"}
    provider_chat.run_assistant_provider_chat(
        session=changed_workflow_session,
        user_text="Continue in another workflow.",
        context={"workflow": {"workflow_id": "workflow-b"}},
        messages=[],
        attachments=attachments,
    )
    provider_chat.run_assistant_provider_chat(
        session=session,
        user_text="Start fresh with this workflow.",
        context={"workflow": {"workflow_id": "workflow-a"}},
        messages=[],
        attachments=attachments,
    )

    assert captured_calls[0]["provider_thread_id"] == "thread-existing"
    assert "workflow|workflow-a" in captured_calls[0]["codex_session_key"]
    assert f"attachments|{stored_hash}" in captured_calls[0]["codex_session_key"]
    assert captured_calls[1]["provider_thread_id"] is None
    assert f"attachments|{attachment_set_hash(changed_attachments)}" in captured_calls[1]["codex_session_key"]
    assert captured_calls[2]["provider_thread_id"] is None
    assert "workflow|workflow-b" in captured_calls[2]["codex_session_key"]
    assert captured_calls[3]["provider_thread_id"] is None
    assert captured_calls[3]["force_new_codex_session"] is True


def test_media_assistant_prompt_recall_returns_current_workflow_prompt(client, monkeypatch) -> None:
    prompt_text = (
        "Use the provided Portrait as the identity and likeness source. Transform the image into a polished "
        "reference-style poster with strong composition, clear lighting, detailed texture, and specific visual mechanics. "
        "Keep the generated prompt concrete enough to reproduce the style without relying on hidden chat context."
    )
    workflow = {
        "schema_version": 1,
        "name": "Prompt recall graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": prompt_text},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-prompt-recall", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fail_provider(**_kwargs):
        raise AssertionError("Prompt recall should not call the provider")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Can you give me the prompt that you used?",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_prompt_recall"
    assert assistant_message["content_json"]["prompt_found"] is True
    assert "Here is the current graph prompt from `Draft preset prompt`" in assistant_message["content_text"]
    assert prompt_text in assistant_message["content_text"]


def test_media_assistant_show_full_prompt_exact_phrase_uses_current_workflow(client, monkeypatch) -> None:
    prompt_text = "Create a moonlit noir perfume campaign with mirrored chrome typography, violet rim light, and rain on black glass."
    workflow = {
        "schema_version": 1,
        "name": "Created prompt graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": prompt_text},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-created-prompt-recall", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]

    def fail_provider(**_kwargs):
        raise AssertionError("Exact current-prompt recall should not call the provider")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Show me the full prompt.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_prompt_recall"
    assert assistant_message["content_json"]["prompt_found"] is True
    assert "Here is the current graph prompt from `Draft preset prompt`" in assistant_message["content_text"]
    assert prompt_text in assistant_message["content_text"]


def test_media_assistant_show_full_prompt_allows_negated_apply_wording(client, monkeypatch) -> None:
    prompt_text = (
        "Create a clean white Character Sheet prompt with face identity locked to image reference 1, "
        "body shape locked to image reference 2, readable panels, and production-board labels."
    )
    workflow = {
        "schema_version": 1,
        "name": "Character Sheet prompt recall graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": prompt_text},
                "metadata": {"ui": {"customTitle": "Character Sheet Prompt - Clean White 7"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-negated-apply-prompt-recall", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fail_provider(**_kwargs):
        raise AssertionError("Negated apply wording should still use deterministic prompt recall")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Show me the full prompt. Do not create, add, apply, run, or save anything.",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_prompt_recall"
    assert assistant_message["content_json"]["prompt_found"] is True
    assert "Character Sheet Prompt - Clean White 7" in assistant_message["content_text"]
    assert prompt_text in assistant_message["content_text"]


def test_media_preset_builder_skill_contracts_validate_operation_payloads() -> None:
    skill_input = MediaPresetBuilderSkillInput(
        user_message="Create a preset out of this image with one product image input.",
        assistant_mode="preset",
        workflow_tab_id="workflow-tab-1",
        requested_lane="image_to_image",
        attachment_set_hash="hash-1",
        reference_ids=["ref-1"],
        approved_fields=[{"key": "location", "label": "Location"}],
        approved_image_slots=[{"key": "product_image", "label": "Product Image"}],
    )
    operation = MediaPresetBuilderOperation(
        name="create_test_workflow",
        payload={"template_id": "preset_style_i2i_sandbox_v1"},
    )
    skill_output = MediaPresetBuilderSkillOutput(
        next_state="sandbox_plan",
        user_reply="This looks like a poster style. Create a test workflow with this setup?",
        operations=[operation],
        prompt_quality_score=9,
        prompt_quality_issues=[],
        provider_called=True,
    )

    assert skill_input.requested_lane == "image_to_image"
    assert skill_output.operations[0].name == "create_test_workflow"
    assert skill_output.prompt_quality_score == 9


def test_reference_style_brief_payload_normalizes_contract_and_preset_shape() -> None:
    payload = {
        "title": "Editorial Product Poster System",
        "summary": "A flexible product poster style with graphic overlays.",
        "description": "Creates graphic editorial posters around a user-provided product or typed product idea.",
        "key": "Editorial Product Poster System",
        "workflow_key": "media_preset.editorial.product.poster.v1",
        "target_model_mode": "image_edit",
        "preset_kind": "image_transform",
        "input_mode": "image_optional",
        "visual_analysis": {
            "medium": ["editorial product poster collage", "commercial graphic design layout"],
            "palette": ["limited two-tone palette with one bright accent", "matte neutral background"],
            "line_shape_language": ["bold geometric framing blocks", "clean product silhouette emphasis"],
            "composition": ["center product hero", "large margin title zone", "layered graphic callouts"],
            "subject_treatment": ["product is treated as the main hero object"],
            "environment_props": ["abstract studio surface", "small label stickers", "simple shadow base"],
            "texture_lighting": ["softbox lighting", "subtle paper grain", "crisp shadow edge"],
            "typography_text_energy": ["large condensed headline", "small technical microtype"],
            "mood": ["premium editorial retail energy"],
        },
        "fixed_style_traits": [
            "centered hero product poster",
            "geometric editorial callout system",
            "limited palette with one bright accent",
        ],
        "recommended_fields": [
            {"key": "Product Name", "label": "Product Name", "required": True},
            {"key": "Headline Copy", "label": "Headline Copy", "required": False},
        ],
        "recommended_image_slots": [
            {"key": "Product Image", "label": "Product Image", "required": False}
        ],
        "source_specific_exclusions": ["exact source product logo", "exact source label text"],
        "negative_guidance": ["avoid copying exact source branding", "avoid generic flat lay"],
    }
    brief = build_reference_style_brief(
        user_text="Create a media preset from this reference. Product can be text or image.",
        assistant_text=f"Looks like an editorial product poster.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={
            "title": "Reference Style Preset",
            "preset_contract": {},
        },
        attachments=[],
    )

    assert brief.preset_direction.title == "Editorial Product Poster System"
    assert brief.preset_direction.key == "editorial_product_poster_system"
    assert brief.preset_direction.workflow_key == "media_preset.editorial.product.poster.v1"
    assert brief.preset_direction.preset_kind == "image_transform"
    assert brief.preset_direction.input_mode == "image_optional"
    assert [field.key for field in brief.preset_contract.fields] == [
        "product_name",
        "headline_copy",
    ]
    assert [slot.key for slot in brief.preset_contract.image_slots] == ["product_image"]
    assert has_concrete_style_traits(brief)


def test_reference_style_brief_normalizes_provider_field_synonyms() -> None:
    payload = {
        "title": "Collector Loft Character Poster",
        "summary": "Warm cinematic fan-room portrait with collectibles and character styling.",
        "target_model_mode": "image_edit",
        "input_mode": "image_required",
        "visual_analysis": {
            "medium": ["photo-hybrid character poster", "cinematic collector-room key art"],
            "palette": ["amber window light", "warm tan upholstery", "dark wood shelves"],
            "line_shape_language": ["layered shelf rectangles", "rounded collectible silhouettes"],
            "composition": ["center seated portrait", "surrounding companion cast", "dense room backdrop"],
            "subject_treatment": ["realistic face blended with stylized character-world details"],
            "environment_props": ["bookshelves", "posters", "figures", "couch", "desk props"],
            "texture_lighting": ["golden-hour rim light", "soft interior haze", "polished poster finish"],
            "typography_text_energy": ["subtle poster labels", "collector display signage"],
            "mood": ["cozy fan-world energy", "cinematic nostalgia"],
        },
        "recommended_fields": [
            {"key": "fandom_mix", "label": "Fandom Mix", "required": True},
            {"key": "room_style", "label": "Room Style", "required": False},
        ],
        "recommended_image_slots": [{"key": "face_reference", "label": "Face Reference", "required": True}],
        "fixed_style_traits": ["photo-hybrid collector portrait", "warm amber palette", "dense room composition"],
    }
    brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this style with one face input.",
        assistant_text=f"Suggested setup.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={},
        attachments=[],
    )

    assert [(field.key, field.label) for field in brief.preset_contract.fields] == [
        ("companion_characters", "Companion Characters"),
        ("room_decor", "Room Decor"),
    ]
    result = compile_reference_style_i2i_prompt_result(brief)
    assert result.prompt_quality_passed
    assert "Set the Companion Characters as" in result.prompt
    assert "Set the Room Decor as" in result.prompt

    wardrobe_payload = {
        **payload,
        "recommended_fields": [{"key": "wardrobe_theme", "label": "Wardrobe Theme", "required": True}],
    }
    wardrobe_brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this style with one face input.",
        assistant_text=f"Suggested setup.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(wardrobe_payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={},
        attachments=[],
    )
    wardrobe_result = compile_reference_style_i2i_prompt_result(wardrobe_brief)
    assert [(field.key, field.label) for field in wardrobe_brief.preset_contract.fields] == [
        ("outfit_wardrobe", "Outfit / Wardrobe"),
    ]
    assert wardrobe_result.prompt_quality_passed
    assert "Set the Outfit / Wardrobe as" in wardrobe_result.prompt

    text_payload = {
        **payload,
        "recommended_fields": [
            {"key": "character_ensemble_theme", "label": "Character Ensemble Theme", "required": True},
            {"key": "side_quote", "label": "Side Quote", "required": False},
        ],
    }
    text_brief = build_reference_style_brief(
        user_text="Create a text-to-image media preset from this style.",
        assistant_text=f"Suggested setup.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(text_payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={},
        attachments=[],
    )
    text_result = compile_reference_style_t2i_prompt_result(text_brief)
    assert [(field.key, field.label) for field in text_brief.preset_contract.fields] == [
        ("companion_characters", "Companion Characters"),
        ("side_text", "Side Text"),
    ]
    assert text_result.prompt_quality_passed
    assert "Set the Companion Characters as" in text_result.prompt
    assert "Set the Side Text as" in text_result.prompt


def test_reference_style_brief_normalizes_descriptive_figure_and_environment_fields() -> None:
    payload = {
        "title": "Celestial Anime Character Chronicle Poster",
        "summary": "Vertical fantasy character poster with a large portrait, small full-body figure, and ruin backdrop.",
        "target_model_mode": "text_to_image",
        "input_mode": "no_image",
        "recommended_fields": [
            {"key": "full_body_figure", "label": "Full-Body Figure", "required": True},
            {"key": "ruined_arcade_environment", "label": "Ruined-Arcade Environment", "required": False},
        ],
        "recommended_image_slots": [],
        "visual_analysis": {
            "medium": ["polished anime illustration", "editorial poster design"],
            "palette": ["silver-lilac hair tones", "deep indigo night sky"],
            "line_shape_language": ["ornamental circular glyph motifs"],
            "composition": ["large side-profile portrait dominating upper frame", "full-body figure centered in foreground"],
            "subject_treatment": ["ethereal youthful fantasy character", "staff-bearing wanderer silhouette"],
            "environment_props": ["broken stone arches", "shallow reflective water", "moon backdrop"],
            "texture_lighting": ["moonlit white highlights"],
            "typography_text_energy": ["vertical text columns framing the artwork"],
            "mood": ["serene celestial fantasy"],
        },
    }
    brief = build_reference_style_brief(
        user_text="Create a text-to-image Media Preset from this reference image.",
        assistant_text=f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={"title": "Reference Style Preset", "preset_contract": {}},
        attachments=[],
    )

    assert [(field.key, field.label) for field in brief.preset_contract.fields] == [
        ("main_character", "Main Character"),
        ("scene_setting", "Scene / Setting"),
    ]


def test_reference_style_brief_discards_control_phrase_and_palette_fields() -> None:
    payload = {
        "title": "Celestial Ember Mythic Collage",
        "summary": "Painterly dragon eclipse fantasy collage.",
        "target_model_mode": "image_edit",
        "input_mode": "image_required",
        "recommended_fields": [
            {"key": "palette_bias", "label": "Palette Bias", "required": False},
            {
                "key": "i_can_turn_this_into_the_first_prompt_draft_next",
                "label": "I can turn this into the first prompt draft next",
                "required": False,
            },
        ],
        "recommended_image_slots": [{"key": "main_subject", "label": "Main Subject", "required": True}],
        "replaceable_elements": ["main subject", "mythic symbol", "celestial disc"],
        "visual_analysis": {
            "medium": ["digital painterly illustration", "layered abstract collage textures"],
            "palette": ["dominant cool blue sky tones", "intense orange-red ember tones"],
            "line_shape_language": ["sweeping smoke-like curves", "organic flame-edged contours"],
            "composition": ["large centered circular disc behind the subject", "subject rising diagonally through the right half"],
            "subject_treatment": ["semi-abstract silhouette built from textured fragments", "dragon-like mythic subject"],
            "environment_props": ["large sun disc", "cloud bands", "dark landform base"],
            "texture_lighting": ["metallic foil-like detailing", "glowing backlit disc"],
            "typography_text_energy": ["no readable typography"],
            "mood": ["mythic and atmospheric"],
        },
    }
    brief = build_reference_style_brief(
        user_text="Create an image-to-image Media Preset from this reference image.",
        assistant_text=f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={"title": "Reference Style Preset", "preset_contract": {}},
        attachments=[{"reference_id": "ref", "kind": "image"}],
    )

    assert [(field.key, field.label) for field in brief.preset_contract.fields] == [
        ("mythic_symbol", "Mythic Symbol"),
    ]


def test_media_assistant_explicit_named_fields_allow_counted_as_clause() -> None:
    fields = infer_explicit_preset_fields(
        "Keep it text-to-image only. No runtime image input. "
        "Use Scene / Subject and Headline / Slogan as the two fields. "
        "Create the temporary text-to-image sandbox now."
    )

    assert [(field["key"], field["label"]) for field in fields] == [
        ("scene_subject", "Scene / Subject"),
        ("headline_slogan", "Headline / Slogan"),
    ]


def _unique_test_suffix() -> str:
    return uuid4().hex[:8]


def _create_reference_image(app_modules, *, name: str = "assistant-ref.png") -> str:
    data_root = app_modules["main"].settings.data_root
    target = data_root / "reference-media" / "images" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(PNG_1X1_BYTES)
    record = app_modules["store"].create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": name,
            "stored_path": f"reference-media/images/{name}",
            "mime_type": "image/png",
            "file_size_bytes": len(PNG_1X1_BYTES),
            "sha256": f"sha-{name}",
            "width": 1,
            "height": 1,
            "metadata_json": {},
        },
        increment_usage=False,
    )
    return record["reference_id"]


def test_media_assistant_graph_template_registry_is_valid() -> None:
    assert validate_assistant_graph_templates() == []


def test_media_assistant_preset_loop_lane_start_persists_summary(client, app_modules, monkeypatch) -> None:
    def fail_provider(**_kwargs):
        raise AssertionError("Preset loop lane start should be deterministic.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider)
    workflow = {"schema_version": 1, "name": "Guided preset lane", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-guided-lane-start", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Can you create a text-to-image media preset from these reference images?",
            "workflow": workflow,
            "assistant_mode": "preset",
            "metadata": {"preset_loop_lane": "text_to_image", "source": "guided_loop_ui"},
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["summary_json"]["preset_loop"] == {
        "lane": "text_to_image",
        "locked": True,
        "source": "guided_loop_ui",
    }
    assistant_message = payload["messages"][-1]
    user_message = payload["messages"][-2]
    assert "Start preset loop" not in user_message["content_text"]
    assert user_message["content_json"]["metadata"]["preset_loop_lane"] == "text_to_image"
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_loop_start"
    assert assistant_message["content_json"]["preset_loop_lane"] == "text_to_image"
    assert "Locked to Text-to-Image" in assistant_message["content_text"]
    assert "no image input" in assistant_message["content_text"]


def test_media_assistant_text_lane_accepts_no_runtime_image_sandbox_followup(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style-text-lane-followup.jpg")
    workflow = {"schema_version": 1, "name": "Guided text lane follow-up", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-guided-text-lane-followup", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style-text-lane-followup.jpg"})

    start_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Can you create a text-to-image media preset from these reference images?",
            "workflow": workflow,
            "assistant_mode": "preset",
            "metadata": {"preset_loop_lane": "text_to_image", "source": "guided_loop_ui"},
        },
    )
    assert start_response.status_code == 200, start_response.text

    def style_provider(**_kwargs):
        return {
            "generated_text": (
                "This looks like `Double-Exposure Travel Poster`. "
                "Style read: warm cream travel-poster palette, double-exposure portrait silhouette, mountain landscape, temple architecture, "
                "bold destination typography, soft matte paper texture, and golden-hour haze. "
                "Suggested fields: Scene / Subject and Style Notes. Input: keep it text-only."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    followup_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create the temporary text-to-image sandbox now. Do not use any runtime image input. "
                "Keep Scene / Subject and Style Notes as editable fields. Treat attached reference images as style sources only and compile the style into the prompt."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert followup_response.status_code == 200, followup_response.text
    assistant_message = followup_response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] != "deterministic_preset_loop_lane_guard"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert assistant_message["content_json"]["reference_style_brief"]["preset_direction"]["title"] == "Double-Exposure Travel Poster"


def _set_guided_lane_style_brief(app_modules, session_id: str, *, lane: str, title: str = "Ochre Ink Poster Room") -> None:
    session_record = app_modules["store_assistant"].get_assistant_session(session_id)
    payload = {
        "title": title,
        "summary": "Warm grunge cartoon poster room with hand-lettered wall text and cluttered props.",
        "target_model_mode": "text_to_image" if lane == "text_to_image" else "image_edit",
        "visual_analysis": {
            "medium": ["warm ochre and black illustrated poster"],
            "palette": ["warm ochre paper palette with black ink contrast"],
            "line_shape_language": ["heavy hand-drawn ink outlines"],
            "composition": ["cluttered room composition with wall typography as focal graphic"],
            "subject_treatment": ["cartoon character proportions"],
            "environment_props": ["sticker-like props", "messy room clutter"],
            "texture_lighting": ["grungy paper texture"],
            "typography_text_energy": ["hand-lettered wall typography"],
            "mood": ["chaotic optimistic mood"],
        },
        "replaceable_elements": ["headline message"],
        "recommended_fields": [
            {"key": "headline_message", "label": "Headline Message", "default_value": "Too Much Thinking", "required": True}
        ],
        "recommended_image_slots": (
            [{"key": "person_reference", "label": "Person Reference", "required": True}]
            if lane == "image_to_image"
            else []
        ),
    }
    brief = build_reference_style_brief(
        user_text="Create a reusable preset from this attached reference style.",
        assistant_text=(
            f"This looks like `{title}`. Style read: warm ochre and black illustrated poster, "
            "heavy hand-drawn ink outlines, cluttered room composition, grungy paper texture, hand-lettered wall typography, "
            "cartoon character proportions, sticker-like props, and chaotic optimistic mood."
            f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={"title": title},
        attachments=[],
    )
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session_record,
            "summary_json": {
                "preset_loop": {"lane": lane, "locked": True, "source": "guided_loop_ui"},
                "reference_style_brief": brief.model_dump(mode="json"),
            },
        }
    )


def test_media_assistant_guided_text_lane_forces_t2i_template(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Guided text lane", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-guided-text-lane", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    _set_guided_lane_style_brief(app_modules, session_id, lane="text_to_image")

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the temporary sandbox now.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["graph_plan"]["metadata"]["template_id"] == T2I_SANDBOX_TEMPLATE_ID
    assert payload["graph_plan"]["metadata"]["template_slot_count"] == 0
    assert not any(node["type"] == "media.load_image" for node in payload["workflow"]["nodes"])
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    usage_json = usage_rows[-1]["usage_json"]
    assert usage_json["prompt_quality_passed"] is True, json.dumps(usage_json, indent=2, sort_keys=True)
    assert usage_json["prompt_quality_score"] >= PROMPT_QUALITY_MIN_SCORE
    assert usage_json["prompt_image_slot_keys"] == []


def test_media_assistant_guided_image_lane_forces_i2i_template(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Guided image lane", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-guided-image-lane", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    _set_guided_lane_style_brief(app_modules, session_id, lane="image_to_image")

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the temporary sandbox now.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["graph_plan"]["metadata"]["template_id"] == I2I_SANDBOX_TEMPLATE_ID
    assert payload["graph_plan"]["metadata"]["template_slot_count"] == 1
    assert payload["graph_plan"]["metadata"]["prompt_quality_gate_required"] is True
    assert payload["graph_plan"]["metadata"]["prompt_quality_passed"] is True
    assert payload["graph_plan"]["metadata"]["prompt_quality_score"] >= PROMPT_QUALITY_MIN_SCORE
    assert len([node for node in payload["workflow"]["nodes"] if node["type"] == "media.load_image"]) == 1
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    workflow_for_run = GraphWorkflow(**payload["workflow"])
    run_validation = validate_workflow(workflow_for_run)
    assert not any(error.code.startswith("preset_prompt_quality_") for error in run_validation.errors)
    tampered = workflow_for_run.model_copy(deep=True)
    tampered_prompt = next(node for node in tampered.nodes if node.id == prompt_node["id"])
    tampered_prompt.fields["text"] = "Create a Media Preset from prior chat."
    tampered_validation = validate_workflow(tampered)
    assert tampered_validation.valid is False
    assert any(error.code == "preset_prompt_quality_stale" for error in tampered_validation.errors)
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    usage_json = usage_rows[-1]["usage_json"]
    assert usage_json["prompt_quality_passed"] is True, json.dumps(
        {"usage_json": usage_json, "prompt": prompt_node["fields"]["text"]},
        indent=2,
        sort_keys=True,
    )
    assert usage_json["prompt_quality_score"] >= PROMPT_QUALITY_MIN_SCORE
    assert usage_json["prompt_image_slot_keys"] == ["person_reference"]


def test_media_assistant_prompt_quality_uses_current_brief_contract_over_stale_summary_contract(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Stale contract guard", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-stale-contract-guard", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    _set_guided_lane_style_brief(app_modules, session_id, lane="image_to_image")
    session_record = app_modules["store_assistant"].get_assistant_session(session_id)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session_record,
            "summary_json": {
                **session_record["summary_json"],
                "reference_style_contract": {
                    "title": "Stale fallback contract",
                    "fields": [
                        {"key": "pose_framing", "label": "Pose / Framing", "required": False},
                        {"key": "legacy_style_notes", "label": "Legacy Style Notes", "required": False},
                    ],
                    "image_slots": [{"key": "personal_reference", "label": "Personal Reference", "required": True}],
                },
            },
        }
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the temporary sandbox now.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["graph_plan"]["metadata"]["template_id"] == I2I_SANDBOX_TEMPLATE_ID
    assert payload["graph_plan"]["metadata"]["prompt_quality_passed"] is True
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    usage_json = usage_rows[-1]["usage_json"]
    assert usage_json["prompt_quality_passed"] is True, json.dumps(usage_json, indent=2, sort_keys=True)
    assert usage_json["prompt_field_keys"] == ["headline_message"]
    assert usage_json["prompt_image_slot_keys"] == ["person_reference"]
    assert "pose_framing" not in usage_json["prompt_field_keys"]


def test_media_assistant_blocks_reference_style_plan_when_prompt_quality_fails(client, app_modules, monkeypatch) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Weak prompt quality gate",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "Create a polished media image using the attached references as fixed style inspiration."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-weak-prompt-quality-gate", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    _set_guided_lane_style_brief(app_modules, session_id, lane="text_to_image")

    weak_plan = AssistantGraphPlan(
        summary="Set a weak prompt.",
        operations=[
            AssistantGraphOperation(
                op="set_node_field",
                node_id="prompt",
                fields={"text": "Create a Media Preset from prior chat."},
            )
        ],
    )
    monkeypatch.setattr("app.assistant.routes.plan_graph_from_message", lambda *_args, **_kwargs: weak_plan)

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Update the draft preset prompt.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["validation"]["valid"] is False
    error_codes = [error["code"] for error in payload["validation"]["errors"]]
    assert "preset_prompt_quality_failed" in error_codes
    usage_json = app_modules["store_assistant"].list_assistant_turn_usage(session_id)[-1]["usage_json"]
    assert usage_json["prompt_quality_passed"] is False
    assert usage_json["prompt_quality_score"] < PROMPT_QUALITY_MIN_SCORE


def test_media_assistant_prompt_quality_gate_blocks_failed_workflow_before_paid_run() -> None:
    workflow = GraphWorkflow(
        name="Failed preset prompt gate",
        metadata={
            "assistant_plan": {
                "template_id": I2I_SANDBOX_TEMPLATE_ID,
                "prompt_quality_gate_required": True,
                "prompt_quality_passed": False,
                "prompt_quality_score": PROMPT_QUALITY_MIN_SCORE - 1,
                "prompt_quality_prompt_hash": "failed-quality",
            }
        },
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "Create a Media Preset from prior chat."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        edges=[],
    )

    validation = validate_workflow(workflow)

    assert validation.valid is False
    assert any(error.code == "preset_prompt_quality_failed" for error in validation.errors)


def test_media_assistant_sandbox_request_beats_saved_preset_name_collision(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Guided saved-name collision", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-guided-saved-name-collision", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    _set_guided_lane_style_brief(app_modules, session_id, lane="image_to_image", title="Single-Image Reference Preset")

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the temporary image-to-image sandbox now.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["graph_plan"]["metadata"]["template_id"] == I2I_SANDBOX_TEMPLATE_ID
    assert payload["graph_plan"]["metadata"]["template_id"] != SAVED_PRESET_TEST_TEMPLATE_ID


def test_media_assistant_guided_sandbox_request_runs_style_intake_without_repeating_preset(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style7.jpg")
    workflow = {"schema_version": 1, "name": "Guided both lane style7", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-guided-style7-lane", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style7.jpg"})

    def fake_provider_chat(**_kwargs):
        style_payload = {
            "title": "Double Exposure Travel Poster",
            "summary": "Travel-poster portrait with scenery composited inside the subject silhouette.",
            "target_model_mode": "image_edit",
            "visual_analysis": {
                "medium": ["cinematic travel-poster portrait", "double-exposure scenic composite"],
                "palette": ["warm sunrise haze", "cream paper grain"],
                "line_shape_language": ["soft silhouette mask"],
                "composition": ["side-profile portrait silhouette", "landscape contained inside the subject", "poster layout with editorial margins"],
                "subject_treatment": ["subject image becomes the portrait silhouette"],
                "environment_props": ["Mount Fuji horizon", "cherry blossoms", "temple architecture"],
                "texture_lighting": ["cream paper grain", "warm golden-hour haze"],
                "typography_text_energy": ["sparse editorial microtype", "bold destination title typography"],
                "mood": ["cinematic wanderlust"],
            },
        }
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Likely preset: `Double Exposure Travel Poster`. "
                "Style read: cinematic travel-poster portrait silhouette, double-exposure scenic landscape inside the subject, "
                "Mount Fuji horizon, cherry blossoms, temple architecture, warm sunrise haze, cream paper grain, sparse editorial microtype, "
                "and bold destination title typography; not the attached reference. If that input shape works, I’ll draft the sandbox recipe next. "
                "Create the image-to-image sandbox first. Suggested fields: `Destination / Theme` and `Poster Text`. "
                "Input: use one separate user-provided Subject Image for the person or object silhouette. "
                "Question: should the destination text be editable? "
                f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(style_payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "guided-style7-intake",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    start_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Can you create both image-to-image and text-to-image media presets from these reference images?",
            "workflow": workflow,
            "assistant_mode": "preset",
            "metadata": {"preset_loop_lane": "both", "source": "guided_loop_ui"},
        },
    )
    assert start_response.status_code == 200, start_response.text
    start_brief = start_response.json()["summary_json"]["reference_style_brief"]
    assert start_brief["preset_direction"]["title"] == "Double Exposure Travel Poster"

    intake_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create the image-to-image sandbox first. Use the attached style reference only as the style source. "
                "I want one user image input for the person or subject, plus a couple of simple fields if they make sense."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert intake_response.status_code == 200, intake_response.text
    assistant_message = intake_response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_sandbox_request"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    style_brief = intake_response.json()["summary_json"]["reference_style_brief"]
    assert style_brief["preset_direction"]["title"] == "Double Exposure Travel Poster"

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the temporary image-to-image sandbox now.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["graph_plan"]["metadata"]["template_id"] == I2I_SANDBOX_TEMPLATE_ID
    assert payload["graph_plan"]["metadata"]["template_slot_count"] == 1
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    assert "Double Exposure Travel Poster" in prompt_text
    assert "Set the Destination / Theme as" in prompt_text
    assert "Set the Poster Text as" in prompt_text
    assert "{{destination_theme}}" not in prompt_text
    assert "{{poster_text}}" not in prompt_text
    assert "Mount Fuji horizon" not in prompt_text
    assert "temporary sandbox" not in prompt_text
    assert "attached reference" not in prompt_text
    assert "sandbox recipe" not in prompt_text
    assert "Create the image-to-image sandbox" not in prompt_text


def test_media_assistant_structured_style_brief_compiles_concrete_style_prompt() -> None:
    payload = {
        "title": "Double Exposure Travel Poster",
        "summary": "Editorial travel poster portrait with scenic landscape blended through the subject silhouette.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["cinematic editorial travel poster", "double-exposure portrait composite"],
            "palette": ["warm sunrise amber haze", "cream archival paper background", "muted travel-magazine neutrals"],
            "line_shape_language": ["soft silhouette mask edges", "clean poster geometry"],
            "composition": [
                "large side-profile portrait dominates left and center",
                "destination landscape nested inside the head and torso silhouette",
                "poster margins with balanced top, side, and footer microtype",
            ],
            "subject_treatment": ["profile subject becomes a transparent scenic silhouette", "identity preserved through glasses, beard, and head shape"],
            "environment_props": ["Mount Fuji horizon", "Japanese temple architecture", "red torii gate", "cherry blossoms", "small lone traveler on path"],
            "texture_lighting": ["paper grain", "soft film texture", "backlit golden-hour haze"],
            "typography_text_energy": ["bold condensed destination title", "handwritten subtitle accent", "small uppercase editorial labels", "bottom icon row"],
            "mood": ["premium adventure magazine cover", "wanderlust", "quiet cinematic discovery"],
        },
        "fixed_style_ingredients": [
            "double-exposure travel poster portrait",
            "destination landscape contained inside a subject silhouette",
            "bold condensed travel title and small editorial microtype",
        ],
        "negative_guidance": ["do not copy source text or logos", "avoid generic portrait realism"],
        "verification_targets": {
            "must_match": ["double exposure", "travel poster layout", "landscape inside silhouette", "paper grain", "bold title typography"],
            "may_vary": ["destination", "title text", "subject identity"],
            "must_not_copy": ["exact readable source text", "exact reference layout"],
        },
    }
    assistant_text = (
        "This looks like `Double Exposure Travel Poster`.\n"
        "One image input makes sense for the person or subject.\n"
        f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"
    )
    proposal = {
        "title": "Single-Image Reference Preset",
        "description": "Create a reusable Media Preset with one runtime image input.",
        "preset_contract": {
            "model_hint": "image_edit",
            "fields": [
                {"key": "destination_theme", "label": "Destination / Theme", "required": True},
                {"key": "poster_text", "label": "Poster Text", "required": False},
            ],
            "image_slots": [{"key": "personal_reference", "label": "Personal Reference", "required": True}],
        },
    }

    brief = build_reference_style_brief(
        user_text="Create the image-to-image sandbox first.",
        assistant_text=assistant_text,
        proposal=proposal,
        attachments=[],
    )
    prompt = compile_reference_style_prompt(brief, saved_template=True)

    assert strip_provider_reference_style_payload(assistant_text).endswith("One image input makes sense for the person or subject.")
    assert brief.preset_direction.title == "Double Exposure Travel Poster"
    assert "double-exposure portrait composite" in prompt
    assert "large side-profile portrait dominates left and center" in prompt
    assert "destination landscape nested inside the head and torso silhouette" in prompt
    assert "{{destination_theme}}" in prompt
    assert "{{poster_text}}" in prompt
    assert "Mount Fuji horizon" not in prompt
    assert "bold condensed destination title" in prompt
    assert PROVIDER_BRIEF_JSON_OPEN not in prompt
    assert "media preset" not in prompt.lower()


def test_media_assistant_visible_setup_fields_override_hidden_contract_fields() -> None:
    payload = {
        "title": "Double Exposure Travel Poster",
        "summary": "Editorial travel poster portrait with scenic landscape blended through the subject silhouette.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["digital photo collage poster", "double-exposure portrait composite"],
            "palette": ["warm peach sunrise", "soft cream paper background"],
            "composition": ["large side-profile portrait", "destination landscape nested inside the silhouette"],
            "texture_lighting": ["soft atmospheric haze", "subtle paper grain"],
            "typography_text_energy": ["bold condensed travel title", "script subtitle accent"],
            "mood": ["wanderlust", "reflective"],
        },
        "recommended_fields": [
            {"key": "destination_theme", "label": "Destination Theme", "required": True},
            {"key": "headline_title", "label": "Headline Title", "required": False},
            {"key": "tagline", "label": "Tagline", "required": False},
        ],
        "recommended_image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
        "fixed_style_traits": ["double-exposure portrait poster", "warm travel-poster texture"],
    }
    assistant_text = (
        "This looks like `Double Exposure Travel Poster`.\n"
        "Suggested setup:\n"
        "- Field: Destination Theme\n"
        "- Field: Headline Title\n"
        "- Image input: Subject Image\n"
        "Create a test workflow with this setup?\n"
        f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"
    )
    brief = build_reference_style_brief(
        user_text="Create a media preset from this style as image-to-image.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    field_labels = [field.label for field in brief.preset_contract.fields]
    prompt = compile_reference_style_prompt(brief)

    assert field_labels == ["Destination Theme", "Headline Title"]
    assert "Tagline" not in field_labels
    assert "Set the Destination Theme as" in prompt
    assert "Set the Headline Title as" in prompt
    assert "Set the Tagline as" not in prompt


def test_media_assistant_visible_follow_up_setup_updates_style_brief_contract() -> None:
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this cyber poster style.",
        assistant_text=(
            "This looks like `Cyber-Fairy Industrial Poster`.\n"
            "Suggested setup:\n"
            "- Field: Top Title\n"
            "- Image input: Subject Photo\n"
            "Create a test workflow with this setup?\n"
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Cyber-Fairy Industrial Poster",
                    "summary": "Cold blue experimental music poster with cyber-fairy fashion subject.",
                    "target_model_mode": "image_edit",
                    "visual_analysis": {
                        "medium": ["photo-based experimental music poster", "editorial fashion cover treatment"],
                        "palette": ["icy blue and steel gray monochrome", "soft white bloom"],
                        "composition": ["low-angle vertical poster framing", "subject perched among utility poles"],
                        "line_shape_language": ["translucent insect wing veins", "dense utility cables and HUD rules"],
                        "texture_lighting": ["diffused daylight haze", "dream-focus glow"],
                        "typography_text_energy": ["large top masthead", "bold vertical side title", "tracklist microtype"],
                        "mood": ["melancholic cyber-fantasy", "fragile industrial dream"],
                    },
                    "recommended_fields": [{"key": "top_title", "label": "Top Title", "required": True}],
                    "recommended_image_slots": [{"key": "subject_photo", "label": "Subject Photo", "required": True}],
                    "fixed_style_traits": ["icy industrial cyber-fairy poster", "dense editorial typography"],
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={},
        attachments=[],
    )

    updated = sync_reference_style_brief_with_visible_setup(
        brief,
        (
            "This looks like `Cyber-Fairy Industrial Music Poster`. Suggested setup: "
            "- Field: Top Title - Field: Vertical Side Title - Image input: Subject Photo "
            "Create a test workflow with this setup?"
        ),
    )

    assert updated is not None
    assert [field.label for field in updated.preset_contract.fields] == ["Top Title", "Vertical Side Title"]
    assert [slot.label for slot in updated.preset_contract.image_slots] == ["Subject Photo"]
    prompt = compile_reference_style_prompt(updated)
    assert "Set the Top Title as" in prompt
    assert "Set the Vertical Side Title as" in prompt


def test_media_assistant_visible_setup_fields_are_not_replaced_by_derived_location() -> None:
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this whimsical travel portrait style.",
        assistant_text=(
            "This looks like `Whimsical Giant-Step Travel Portrait`.\n"
            "Suggested setup:\n"
            "- Field: Location\n"
            "- Field: Scene / Setting\n"
            "- Image input: Subject Image\n"
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Whimsical Giant-Step Travel Portrait",
                    "summary": "Low-angle whimsical travel portrait with forced perspective and cute companion props.",
                    "target_model_mode": "image_edit",
                    "visual_analysis": {
                        "medium": ["stylized cinematic photo-illustration", "polished fantasy realism"],
                        "palette": ["saturated azure sky", "warm sunlit skin tones"],
                        "line_shape_language": ["round oversized foreground forms", "soft curved silhouettes"],
                        "composition": [
                            "extreme worm's-eye camera angle",
                            "massive sneaker sole dominates the near foreground",
                            "narrow sunlit alley frame",
                        ],
                        "subject_treatment": ["fashion-styled everyday subject rendered larger-than-life by forced perspective"],
                        "environment_props": ["storybook travel alley", "flowers", "cute companion animal", "playful foreground prop"],
                        "texture_lighting": ["strong clear midday sunlight", "clean glossy finish"],
                        "typography_text_energy": ["no visible typography"],
                        "mood": ["joyful", "playful", "summery"],
                    },
                    "recommended_fields": [
                        {"key": "location", "label": "Location", "required": True},
                        {"key": "scene_setting", "label": "Scene / Setting", "required": False},
                    ],
                    "recommended_image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
                    "fixed_style_traits": [
                        "extreme ground-level forced perspective",
                        "oversized foreground element",
                        "bright blue-sky daylight",
                    ],
                    "negative_guidance": ["avoid flat eye-level composition"],
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={},
        attachments=[],
    )

    updated = sync_reference_style_brief_with_visible_setup(
        brief,
        (
            "This looks like `Whimsical Giant-Step Travel Portrait`.\n"
            "Suggested setup:\n"
            "- Field: Scene / Setting\n"
            "- Field: Featured Prop\n"
            "- Image input: Subject Image\n"
            "Create a test workflow with this setup?"
        ),
    )

    assert updated is not None
    assert [field.label for field in updated.preset_contract.fields] == ["Scene / Setting", "Featured Prop"]
    prompt = compile_reference_style_prompt(updated)
    assert "Set the Scene / Setting as" in prompt
    assert "Set the Featured Prop as" in prompt
    assert "Set the Location as" not in prompt
    assert "weak typography hierarchy" not in prompt


def test_media_assistant_user_can_reject_fields_and_use_style_specific_alternatives() -> None:
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this cyber fairy poster style.",
        assistant_text=(
            "This looks like `Cyber Fairy Techno Poster Portrait`.\n"
            "Suggested setup:\n"
            "- Field: Poster Title\n"
            "- Field: Track List / Subtitle\n"
            "- Image input: Main Subject\n"
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Cyber Fairy Techno Poster Portrait",
                    "summary": "Icy blue industrial cyber-fairy editorial poster with wing filigree and dense music-poster typography.",
                    "target_model_mode": "image_edit",
                    "visual_analysis": {
                        "medium": ["photo-based fashion editorial poster", "album-cover techno flyer"],
                        "palette": ["icy blue-gray monochrome", "silver-white bloom"],
                        "composition": ["low-angle crouched subject on utility equipment", "large wings spanning the frame"],
                        "environment_props": ["utility poles", "power cables", "warning labels", "barcode graphics"],
                        "texture_lighting": ["misty bloom", "foggy diffusion"],
                        "typography_text_energy": ["large top masthead", "vertical side title", "track-list microtype"],
                        "mood": ["melancholic futuristic romance"],
                    },
                    "recommended_fields": [
                        {"key": "poster_title", "label": "Poster Title", "required": False},
                        {"key": "track_list_subtitle", "label": "Track List / Subtitle", "required": False},
                    ],
                    "recommended_image_slots": [{"key": "main_subject", "label": "Main Subject", "required": True}],
                    "replaceable_elements": ["poster title", "track list", "warning label text"],
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={},
        attachments=[],
    )

    updated = sync_reference_style_brief_with_visible_setup(
        brief,
        (
            "I do not like those fields. Use these instead:\n"
            "- Field: Top Masthead\n"
            "- Field: Warning Label Text\n"
            "- Image input: Main Subject\n"
            "Create a test workflow with this setup."
        ),
    )

    assert updated is not None
    assert [field.label for field in updated.preset_contract.fields] == ["Top Masthead", "Warning Label Text"]
    assert [slot.label for slot in updated.preset_contract.image_slots] == ["Main Subject"]
    prompt = compile_reference_style_i2i_prompt(updated)
    assert "Set the Top Masthead as" in prompt
    assert "Set the Warning Label Text as" in prompt
    assert "Set the Poster Title as" not in prompt
    assert "Set the Track List / Subtitle as" not in prompt


def test_reference_style_brief_can_suggest_alternative_fields_from_analysis() -> None:
    brief = build_reference_style_brief(
        user_text="Create a media preset from this image with one input image.",
        assistant_text=(
            "This looks like `Cinematic Double-Exposure Travel Poster`.\n"
            "Suggested setup:\n"
            "- Field: Destination\n"
            "- Field: Poster Title\n"
            "- Image input: Face Reference\n"
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Cinematic Double-Exposure Travel Poster",
                    "summary": "Double-exposure travel poster portrait with scenic destination imagery and poster typography.",
                    "target_model_mode": "image_edit",
                    "visual_analysis": {
                        "medium": ["photo-illustration travel poster composite"],
                        "palette": ["warm peach and gold sunrise light"],
                        "composition": ["large side-profile portrait with landscape nested inside the head and torso"],
                        "environment_props": ["mountain path", "landmark architecture", "small traveler figure"],
                        "texture_lighting": ["paper grain", "soft haze"],
                        "typography_text_energy": ["large lower headline", "small top tagline", "supporting subtitle"],
                        "mood": ["reflective wanderlust"],
                    },
                    "replaceable_elements": [
                        "destination landmarks",
                        "poster title",
                        "subtitle tagline",
                        "small traveler detail",
                    ],
                    "recommended_fields": [
                        {"key": "destination", "label": "Destination", "required": True},
                        {"key": "poster_title", "label": "Poster Title", "required": False},
                    ],
                    "recommended_image_slots": [{"key": "face_reference", "label": "Face Reference", "required": True}],
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={},
        attachments=[],
    )

    updated = reference_style_brief_with_alternative_fields(brief)

    assert updated is not None
    labels = [field.label for field in updated.preset_contract.fields]
    assert labels
    assert "Destination" not in labels
    assert "Poster Title" not in labels
    assert any(label in labels for label in ("Landmark / Scene Details", "Subtitle / Tagline", "Traveler Detail"))
    assert [slot.label for slot in updated.preset_contract.image_slots] == ["Face Reference"]


def test_media_assistant_plan_uses_latest_visible_setup_contract(client, app_modules, monkeypatch) -> None:
    def fail_provider_plan(**_kwargs):
        raise AssertionError("Reference-style setup planning should use deterministic template path.")

    monkeypatch.setattr("app.assistant.routes.run_provider_graph_plan", fail_provider_plan)
    reference_id = _create_reference_image(app_modules, name="style9-follow-up-contract.png")
    workflow = {"schema_version": 1, "name": "Style9 contract update", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style9-contract-update", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]
    attachment_response = client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "style9-follow-up-contract.png"},
    )
    assert attachment_response.status_code == 200, attachment_response.text
    attachments = app_modules["store_assistant"].list_assistant_attachments(session_id)
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this reference.",
        assistant_text=(
            "This looks like `Cyber-Fairy Industrial Poster`.\n"
            "Suggested setup:\n"
            "- Field: Top Title\n"
            "- Image input: Subject Photo\n"
            "Create a test workflow with this setup?\n"
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Cyber-Fairy Industrial Poster",
                    "summary": "Cold blue experimental music poster with cyber-fairy fashion subject.",
                    "target_model_mode": "image_edit",
                    "visual_analysis": {
                        "medium": ["photo-based experimental music poster", "editorial fashion cover treatment"],
                        "palette": ["icy blue and steel gray monochrome", "soft white bloom"],
                        "composition": ["low-angle vertical poster framing", "subject perched among utility poles"],
                        "line_shape_language": ["translucent insect wing veins", "dense utility cables and HUD rules"],
                        "texture_lighting": ["diffused daylight haze", "dream-focus glow"],
                        "typography_text_energy": ["large top masthead", "bold vertical side title", "tracklist microtype"],
                        "mood": ["melancholic cyber-fantasy", "fragile industrial dream"],
                    },
                    "recommended_fields": [{"key": "top_title", "label": "Top Title", "required": True}],
                    "recommended_image_slots": [{"key": "subject_photo", "label": "Subject Photo", "required": True}],
                    "fixed_style_traits": ["icy industrial cyber-fairy poster", "dense editorial typography"],
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={},
        attachments=attachments,
    )
    assert has_concrete_style_traits(brief)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **app_modules["store_assistant"].get_assistant_session(session_id),
            "summary_json": {
                "reference_style_brief": brief.model_dump(mode="json"),
                "media_preset_builder": {"attachment_set_hash": attachment_set_hash(attachments)},
            },
        }
    )
    app_modules["store_assistant"].create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "assistant",
            "content_text": "Suggested setup:\n- Field: Top Title\n- Image input: Subject Photo\nCreate a test workflow with this setup?",
            "content_json": {},
        }
    )
    app_modules["store_assistant"].create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "assistant",
            "content_text": (
                "This looks like `Cyber-Fairy Industrial Music Poster`. Suggested setup: "
                "- Field: Top Title - Field: Vertical Side Title - Image input: Subject Photo "
                "Create a test workflow with this setup?"
            ),
            "content_json": {},
        }
    )

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create test workflow",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    note_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Test Workflow Guide")
    prompt_text = prompt_node["fields"]["text"]
    assert "Set the Top Title as" in prompt_text
    assert "Set the Vertical Side Title as" in prompt_text
    assert "Fields: 2" in note_node["fields"]["body"]
    stored_session = app_modules["store_assistant"].get_assistant_session(session_id)
    stored_brief = stored_session["summary_json"]["reference_style_brief"]
    assert [field["label"] for field in stored_brief["preset_contract"]["fields"]] == ["Top Title", "Vertical Side Title"]


def test_media_assistant_t2i_plan_uses_latest_visible_text_only_fields(client, app_modules, monkeypatch) -> None:
    def fail_provider_plan(**_kwargs):
        raise AssertionError("Reference-style setup planning should use deterministic template path.")

    monkeypatch.setattr("app.assistant.routes.run_provider_graph_plan", fail_provider_plan)
    reference_id = _create_reference_image(app_modules, name="style10-text-only-contract.png")
    workflow = {"schema_version": 1, "name": "Style10 text-only contract update", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style10-contract-update", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]
    attachment_response = client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "style10-text-only-contract.png"},
    )
    assert attachment_response.status_code == 200, attachment_response.text
    attachments = app_modules["store_assistant"].list_assistant_attachments(session_id)
    brief = build_reference_style_brief(
        user_text="Create a text-to-image preset from this whimsical giant-step style.",
        assistant_text=(
            "This looks like `Whimsical Giant-Step Summer Adventure`.\n"
            "Suggested setup:\n"
            "- Field: Location\n"
            "- Field: Main Character\n"
            "- Image input: none\n"
            "Create a text-only test workflow with these fields?\n"
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Whimsical Giant-Step Summer Adventure",
                    "summary": "Low-angle sunny vacation illustration with giant foreground step and cute companion energy.",
                    "target_model_mode": "text_to_image",
                    "input_mode": "no_image",
                    "visual_analysis": {
                        "medium": ["stylized cinematic illustration", "polished semi-real 3D character rendering"],
                        "palette": ["intense azure blue sky", "warm sunlit tans and golds"],
                        "composition": [
                            "extreme worm's-eye perspective from ground level",
                            "oversized sneaker sole dominates the lower frame",
                            "narrow stone alley creates vertical frame edges",
                        ],
                        "line_shape_language": ["round glossy oversized eyes", "exaggerated foreground scale"],
                        "subject_treatment": ["towering cheerful figure above the viewer", "cute companion as emotional focal point"],
                        "environment_props": ["coastal water glimpse", "flowers", "sunlit stone passage"],
                        "texture_lighting": ["hard bright midday sunlight", "crisp high-contrast shadows"],
                        "typography_text_energy": ["no typography present"],
                        "mood": ["playful", "cheerful", "summer vacation energy"],
                    },
                    "recommended_fields": [
                        {"key": "location", "label": "Location", "required": True},
                        {"key": "main_character", "label": "Main Character", "required": False},
                    ],
                    "recommended_image_slots": [],
                    "fixed_style_traits": [
                        "extreme low-angle giant-step perspective",
                        "cute cinematic storybook realism",
                        "foreground companion as emotional focal point",
                    ],
                    "negative_guidance": ["avoid flat eye-level framing", "avoid generic pet portrait composition"],
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={},
        attachments=attachments,
    )
    assert has_concrete_style_traits(brief)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **app_modules["store_assistant"].get_assistant_session(session_id),
            "summary_json": {
                "reference_style_brief": brief.model_dump(mode="json"),
                "media_preset_builder": {"attachment_set_hash": attachment_set_hash(attachments)},
                "preset_loop_lane": "text_to_image",
            },
        }
    )
    app_modules["store_assistant"].create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "assistant",
            "content_text": (
                "This looks like `Whimsical Giant-Step Summer Adventure`; I would lock the style around: "
                "stylized cinematic illustration with polished semi-real 3D character rendering.\n\n"
                "Suggested setup:\n"
                "- Field: Main Character\n"
                "- Field: Animal Companion\n"
                "- Image input: none\n\n"
                "Create a text-only test workflow with these fields?"
            ),
            "content_json": {},
        }
    )

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create test workflow",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    note_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Test Workflow Guide")
    prompt_text = prompt_node["fields"]["text"]
    assert "Set the Main Character as" in prompt_text
    assert "Set the Animal Companion as" in prompt_text
    assert "species, personality, expression, and scale relationship" in prompt_text
    assert "Set the Location as" not in prompt_text
    assert "weak typography hierarchy" not in prompt_text
    assert "Image inputs: 0. Fields: 2." in note_node["fields"]["body"]
    stored_session = app_modules["store_assistant"].get_assistant_session(session_id)
    stored_brief = stored_session["summary_json"]["reference_style_brief"]
    assert [field["label"] for field in stored_brief["preset_contract"]["fields"]] == ["Main Character", "Animal Companion"]


def test_reference_style_sandbox_plan_does_not_replace_approved_fields_with_location() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_style11_approved_fields",
        preset_direction=ReferenceStylePresetDirection(
            title="Cinematic Collector Room Fandom Portrait",
            target_model_mode="text_to_image",
            input_mode="no_image",
        ),
        visual_analysis={
            "medium": ["cinematic digital illustration", "editorial character-poster portrait"],
            "palette": ["warm golden window light", "deep blue and amber room shadows"],
            "line_shape_language": ["layered character silhouettes", "dense shelf and poster geometry"],
            "composition": [
                "central human subject framed by a fan collector room",
                "supporting character lineup surrounds the main portrait",
                "depth built from shelves, posters, figures, and glowing window light",
            ],
            "subject_treatment": ["realistic central person blended with stylized anime-inspired companions"],
            "environment_props": [
                "collector room full of manga, figurines, game boxes, plush toys, and wall art",
                "nostalgic bedroom studio atmosphere rather than an outdoor destination",
            ],
            "texture_lighting": ["soft cinematic rim light", "glossy collectible surfaces"],
            "typography_text_energy": [
                "no dominant title block",
                "text appears as environmental object detail on book spines and collectibles",
                "text presence feels incidental and collectible rather than poster-headline driven",
                "text functions as collectible clutter rather than headline design",
                "no formal poster title zone",
                "visible book spines and printed pages contribute graphic energy without becoming the main focus",
                "graphic reading materials used as prop texture rather than dominant poster typography",
                "small readable text appears only on props, not as a designed title system",
            ],
            "mood": ["cozy fandom shrine energy", "cinematic nostalgia"],
        },
        replaceable_elements=["main subject", "character lineup"],
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(
                    key="main_subject",
                    label="Main Subject",
                    purpose="The person, fan, or lead character staged at the center of the collector-room portrait.",
                    required=True,
                    default_value="retro anime fan portrait",
                ),
                ReferenceStylePresetField(
                    key="character_lineup",
                    label="Character Lineup",
                    purpose="Supporting characters, mascots, posters, or collectibles that define the fandom mix around the subject.",
                    required=True,
                    default_value="robot mascots, magical girls, trading-card creatures",
                ),
            ],
            image_slots=[],
        ),
        recommended_fields=[
            ReferenceStylePresetField(
                key="main_subject",
                label="Main Subject",
                purpose="The person, fan, or lead character staged at the center of the collector-room portrait.",
                required=True,
                default_value="retro anime fan portrait",
            ),
            ReferenceStylePresetField(
                key="character_lineup",
                label="Character Lineup",
                purpose="Supporting characters, mascots, posters, or collectibles that define the fandom mix around the subject.",
                required=True,
                default_value="robot mascots, magical girls, trading-card creatures",
            ),
        ],
    )
    message = (
        "Create test workflow for this text-to-image media preset.\n\n"
        "Latest visible assistant setup:\n"
        "This looks like `Cinematic Collector Room Fandom Portrait`.\n\n"
        "Suggested setup:\n"
        "- Field: Main Subject\n"
        "- Field: Character Lineup\n"
        "- Image input: none\n\n"
        "Create a text-only test workflow with this setup?\n\n"
        f"{encode_reference_style_brief_marker(brief)}"
    )

    plan = _graph_preset_sandbox_plan(
        message,
        GraphWorkflow(schema_version=1, name="Style11 approved fields", nodes=[], edges=[], metadata={}),
        [],
    )

    prompt_op = next(operation for operation in plan.operations if operation.title == "Draft preset prompt")
    prompt_text = prompt_op.fields["text"]
    assert "Set the Main Subject as" in prompt_text
    assert "central person, character, object, or idea" in prompt_text
    assert "Set the Character Lineup as" in prompt_text
    assert "supporting characters, creatures, collectibles, or secondary subjects" in prompt_text
    assert "Set the Location as" not in prompt_text
    assert "specific destination, route, landmark set" not in prompt_text
    assert "weak typography hierarchy" not in prompt_text


def test_reference_style_prompt_uses_specific_character_theme_field_guidance() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_character_theme_field",
        preset_direction=ReferenceStylePresetDirection(
            title="Collector Lounge Ensemble Portrait",
            target_model_mode="text_to_image",
            input_mode="no_image",
        ),
        visual_analysis={
            "medium": ["cinematic digital illustration with semi-real portrait rendering"],
            "palette": ["warm amber and honey sunlight"],
            "composition": ["central seated subject surrounded by multiple supporting figures"],
            "subject_treatment": ["semi-real central portrait contrasted with iconic stylized companions"],
            "environment_props": ["collector shelves packed with figures, books, and display pieces"],
            "texture_lighting": ["golden-hour backlight with subtle haze"],
            "typography_text_energy": ["visual text presence is incidental environmental detail"],
            "mood": ["celebratory fandom immersion"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="main_subject", label="Main Subject", required=True),
                ReferenceStylePresetField(key="character_theme", label="Character Theme", required=True),
            ]
        ),
    )

    prompt = compile_reference_style_t2i_prompt(
        brief,
        fields=[
            {"key": "main_subject", "label": "Main Subject", "required": True},
            {"key": "character_theme", "label": "Character Theme", "required": True},
        ],
    )

    assert "Set the Character Theme as" in prompt
    assert "original non-franchise fan world, genre cues, invented supporting characters" in prompt
    assert "main character, subject, or scene idea" not in prompt
    assert "original non-franchise stylized companion figures" in prompt
    assert "iconic stylized companions" not in prompt

    fandom_prompt = compile_reference_style_t2i_prompt(
        brief,
        fields=[
            {"key": "main_subject", "label": "Main Subject", "required": True},
            {"key": "fandom_theme", "label": "Fandom Theme", "required": True},
        ],
    )

    assert "Set the Companion Characters as" in fandom_prompt
    assert "original non-franchise fan world, genre cues, invented supporting characters" in fandom_prompt
    assert "existing franchise names" in fandom_prompt
    assert "recognizable copyrighted characters" in fandom_prompt
    assert "recognizable character silhouettes, costumes, powers, or hairstyles from known media" in fandom_prompt
    assert "main character, subject, or scene idea" not in fandom_prompt
    assert "iconic stylized companions" not in fandom_prompt


def test_reference_style_prompt_uses_specific_pet_and_treat_field_guidance() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_pet_treat_fields",
        preset_direction=ReferenceStylePresetDirection(
            title="Whimsical Giant-Perspective Pet Adventure",
            target_model_mode="text_to_image",
        ),
        visual_analysis={
            "medium": ["stylized photo-illustration with polished realism"],
            "palette": ["intense cobalt-blue sky with bright summer color"],
            "line_shape_language": ["rounded pet silhouettes and exaggerated foreground scale shapes"],
            "composition": ["extreme worm's-eye viewpoint with tiny pet hero closest to camera"],
            "subject_treatment": ["pet is the emotional focal point with playful adventure energy"],
            "environment_props": ["sunny outdoor passage with oversized flowers and playful props"],
            "texture_lighting": ["strong midday sunlight with crisp highlights"],
            "mood": ["joyful and mischievous summer adventure"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="main_pet", label="Main Pet", required=True),
                ReferenceStylePresetField(key="featured_treat", label="Featured Treat", required=True),
            ],
            image_slots=[],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=[
                "extreme worm's-eye perspective",
                "tiny pet hero in closest foreground",
                "bright saturated summer daylight",
            ],
            negative_guidance=["avoid generic eye-level pet portraits"],
        ),
        fixed_style_traits=[
            "extreme worm's-eye perspective",
            "tiny pet hero in closest foreground",
            "bright saturated summer daylight",
        ],
    )

    prompt = compile_reference_style_t2i_prompt(
        brief,
        fields=[
            {"key": "main_pet", "label": "Main Pet", "required": True},
            {"key": "featured_treat", "label": "Featured Treat", "required": True},
        ],
    )

    assert "Set the Main Pet as the main animal subject, species, personality, expression, and scale relationship" in prompt
    assert "Set the Featured Treat as the featured food, treat, or playful prop" in prompt
    assert "concise value that fits this field" not in prompt


def test_reference_style_brief_marker_preserves_concrete_two_field_contract() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_pet_treat_marker",
        preset_direction=ReferenceStylePresetDirection(
            title="Whimsical Giant-Perspective Pet Adventure",
            target_model_mode="text_to_image",
        ),
        visual_analysis={
            "medium": ["stylized photo-illustration with polished realism"],
            "palette": ["intense cobalt-blue sky with bright summer color"],
            "line_shape_language": ["rounded pet silhouettes and exaggerated foreground scale shapes"],
            "composition": ["extreme worm's-eye viewpoint with tiny pet hero closest to camera"],
            "subject_treatment": ["pet is the emotional focal point with playful adventure energy"],
            "environment_props": ["sunny outdoor passage with oversized flowers and playful props"],
            "texture_lighting": ["strong midday sunlight with crisp highlights"],
            "mood": ["joyful and mischievous summer adventure"],
        },
        replaceable_elements=["pet", "snack prop"],
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="pet", label="Pet", required=True),
                ReferenceStylePresetField(key="snack_prop", label="Snack / Prop", required=True),
            ],
            image_slots=[],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=[
                "extreme worm's-eye perspective",
                "tiny pet hero in closest foreground",
                "bright saturated summer daylight",
            ],
            negative_guidance=["avoid generic eye-level pet portraits"],
        ),
        fixed_style_traits=[
            "extreme worm's-eye perspective",
            "tiny pet hero in closest foreground",
            "bright saturated summer daylight",
        ],
    )

    extracted = extract_reference_style_brief_from_message(
        "Create the text-to-image test workflow now with the suggested fields.\n\n"
        f"{encode_reference_style_brief_marker(brief)}"
    )

    assert extracted is not None
    assert [field.label for field in extracted.preset_contract.fields] == ["Pet", "Snack / Prop"]
    prompt = compile_reference_style_t2i_prompt(extracted)
    assert "Set the Pet as" in prompt
    assert "Set the Snack / Prop as" in prompt
    assert "Set the Location as" not in prompt


def test_reference_style_prompt_does_not_treat_prop_field_as_animal_subject() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_companion_prop_field",
        preset_direction=ReferenceStylePresetDirection(
            title="Whimsical Giant-Perspective Sunny Companion Portrait",
            target_model_mode="image_to_image",
        ),
        visual_analysis={
            "medium": ["hyper-stylized digital photo illustration with polished cinematic realism"],
            "palette": ["high-saturation cobalt blue sky and warm tan stone walls"],
            "line_shape_language": ["rounded animal forms and exaggerated foreground scale"],
            "composition": ["extreme low-angle worm's-eye view with giant perspective"],
            "subject_treatment": ["main subject restyled into a whimsical companion portrait"],
            "environment_props": ["sunny outdoor passage with flowers, tiny creature, and playful prop"],
            "texture_lighting": ["crisp bright sunlight and polished toy-like surface detail"],
            "mood": ["playful oversized summer adventure"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="animal_companion", label="Animal Companion", required=True),
                ReferenceStylePresetField(key="companion_prop", label="Companion Prop", required=True),
            ],
            image_slots=[ReferenceStyleImageSlot(key="main_subject_photo", label="Main Subject Photo", required=True)],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=["extreme worm's-eye perspective", "polished sunny storybook realism"],
            negative_guidance=["avoid generic pet portraits"],
        ),
        fixed_style_traits=["extreme worm's-eye perspective", "polished sunny storybook realism"],
    )

    prompt = compile_reference_style_i2i_prompt(
        brief,
        fields=[
            {"key": "animal_companion", "label": "Animal Companion", "required": True},
            {"key": "companion_prop", "label": "Companion Prop", "required": True},
        ],
        image_slots=[{"key": "main_subject_photo", "label": "Main Subject Photo", "required": True}],
    )

    assert "Set the Animal Companion as the main animal subject" in prompt
    assert "Set the Companion Prop as the featured prop, accessory, object, or playful detail" in prompt
    assert "Set the Companion Prop as the main animal subject" not in prompt


def test_reference_style_prompt_treats_companion_cast_as_supporting_characters() -> None:
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset with one portrait input.",
        assistant_text=(
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Collector Room Hero Portrait",
                    "summary": "Collector room hero portrait with supporting companion characters.",
                    "target_model_mode": "image_edit",
                    "recommended_fields": [
                        {"key": "companion_cast_theme", "label": "Companion Cast Theme", "purpose": "Supporting cast theme."},
                        {"key": "room_setting", "label": "Room Setting", "purpose": "Room setting."},
                    ],
                    "recommended_image_slots": [{"key": "portrait", "label": "Portrait", "purpose": "Portrait subject.", "required": True}],
                    "visual_analysis": {
                        "medium": ["hybrid photo-illustration collector room poster"],
                        "palette": ["warm amber interior light"],
                        "line_shape_language": ["layered character silhouettes"],
                        "composition": ["central seated person surrounded by supporting companion characters"],
                        "subject_treatment": ["realistic human subject with stylized animated companions"],
                        "environment_props": ["collector shelves, figures, posters, tabletop props"],
                        "texture_lighting": ["cinematic window glow"],
                        "typography_text_energy": ["premium fan poster layout"],
                        "mood": ["cozy collector-room energy"],
                    },
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal=build_preset_builder_proposal(
            "Create an image-to-image Media Preset with one portrait input.",
            [{"reference_id": "ref", "kind": "image"}],
        ),
        attachments=[{"reference_id": "ref", "kind": "image"}],
    )

    assert [field.label for field in brief.preset_contract.fields] == ["Companion Characters", "Room Setting"]
    prompt = compile_reference_style_i2i_prompt(brief)
    assert "invented supporting characters" in prompt
    assert "main animal subject" not in prompt


def test_saved_preset_prompt_field_instruction_treats_companion_characters_as_cast() -> None:
    instruction = _saved_prompt_field_instruction(
        {
            "key": "companion_characters",
            "label": "Companion Characters",
            "placeholder": "Companion Characters.",
        }
    )

    assert "invented supporting characters" in instruction
    assert "non-franchise" in instruction
    assert "animal subject" not in instruction


def test_reference_style_prompt_repairs_celestial_disc_and_generic_subject_slot() -> None:
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset with one subject image.",
        assistant_text=(
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Mythic Eclipse Ink Aura",
                    "summary": "Abstract dragon eclipse fantasy painting.",
                    "target_model_mode": "image_edit",
                    "recommended_fields": [
                        {"key": "celestial_form", "label": "Celestial Form", "purpose": "Celestial form."},
                        {"key": "elemental_theme", "label": "Elemental Theme", "purpose": "Elemental theme."},
                    ],
                    "recommended_image_slots": [
                        {"key": "source_image", "label": "Source Image", "purpose": "Source image.", "required": True}
                    ],
                    "visual_analysis": {
                        "medium": ["abstract fantasy digital painting"],
                        "palette": ["cerulean blue mist", "warm gold eclipse glow"],
                        "line_shape_language": ["serpentine dragon silhouette", "large circular disc"],
                        "composition": ["dragon curls around a glowing eclipse disc"],
                        "subject_treatment": ["dragon-like creature subject"],
                        "environment_props": ["moon disc, mountain mass, smoke forms"],
                        "texture_lighting": ["ink wash texture and gilded haze"],
                        "typography_text_energy": ["ornamental etched markings"],
                        "mood": ["mythic and atmospheric"],
                    },
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal=build_preset_builder_proposal(
            "Create an image-to-image Media Preset with one subject image.",
            [{"reference_id": "ref", "kind": "image"}],
        ),
        attachments=[{"reference_id": "ref", "kind": "image"}],
    )

    assert [field.label for field in brief.preset_contract.fields] == ["Moon / Sky Element", "Color Contrast"]
    assert [slot.label for slot in brief.preset_contract.image_slots] == ["Creature / Main Subject"]
    prompt = compile_reference_style_i2i_prompt(brief)
    assert "Moon / Sky Element" in prompt
    assert "Color Contrast" in prompt
    assert "Creature / Main Subject" in prompt


def test_reference_style_prompt_repairs_sky_motif_field() -> None:
    brief = build_reference_style_brief(
        user_text="Create a text-to-image preset from this celestial image.",
        assistant_text=(
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Celestial Ink Moon Myth",
                    "summary": "Painterly moon and dragon fantasy tableau.",
                    "target_model_mode": "text_to_image",
                    "recommended_fields": [
                        {"key": "main_subject", "label": "Main Subject", "purpose": "Main subject."},
                        {"key": "celestial_event", "label": "Celestial Event", "purpose": "Celestial event."},
                    ],
                    "visual_analysis": {
                        "medium": ["digital painterly fantasy illustration"],
                        "palette": ["cerulean blue sky", "gold moon glow"],
                        "line_shape_language": ["serpentine dragon silhouette", "large circular moon"],
                        "composition": ["moon fills the upper frame with creature crossing it"],
                        "subject_treatment": ["mythic creature subject"],
                        "environment_props": ["moon, stars, clouds, smoke, mountain ridge"],
                        "texture_lighting": ["ink bloom and gilded haze"],
                        "typography_text_energy": ["ornamental markings"],
                        "mood": ["mythic"],
                    },
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal=build_preset_builder_proposal(
            "Create a text-to-image Media Preset.",
            [{"reference_id": "ref", "kind": "image"}],
        ),
        attachments=[{"reference_id": "ref", "kind": "image"}],
    )

    assert [field.label for field in brief.preset_contract.fields] == ["Main Subject", "Moon / Sky Element"]
    prompt = compile_reference_style_t2i_prompt(brief)
    assert "Moon / Sky Element" in prompt


def test_reference_style_prompt_repairs_main_motif_field() -> None:
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset with one source image.",
        assistant_text=(
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Celestial Ink Eclipse",
                    "summary": "Painterly mythic creature wrapped around a glowing disc.",
                    "target_model_mode": "image_edit",
                    "recommended_fields": [
                        {"key": "main_motif", "label": "Main Motif", "purpose": "Main motif."},
                        {"key": "foreground_setting", "label": "Foreground Setting", "purpose": "Foreground setting."},
                    ],
                    "recommended_image_slots": [
                        {"key": "source_image", "label": "Source Image", "purpose": "Source image.", "required": True}
                    ],
                    "visual_analysis": {
                        "medium": ["digital fantasy painting"],
                        "palette": ["cerulean sky tones", "ember orange glow"],
                        "line_shape_language": ["serpentine dragon silhouette", "ornamental motif shapes"],
                        "composition": ["huge circular moon disc behind creature"],
                        "subject_treatment": ["dragon-like creature subject"],
                        "environment_props": ["foreground ridge, moon disc, smoke plumes"],
                        "texture_lighting": ["ink diffusion and glowing haze"],
                        "typography_text_energy": ["etched ornamental marks"],
                        "mood": ["mythic and atmospheric"],
                    },
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal=build_preset_builder_proposal(
            "Create an image-to-image Media Preset with one source image.",
            [{"reference_id": "ref", "kind": "image"}],
        ),
        attachments=[{"reference_id": "ref", "kind": "image"}],
    )

    assert [field.label for field in brief.preset_contract.fields] == ["Graphic Symbol", "Foreground Setting"]
    assert [slot.label for slot in brief.preset_contract.image_slots] == ["Creature / Main Subject"]
    prompt = compile_reference_style_i2i_prompt(brief)
    assert "Graphic Symbol" in prompt
    assert "Foreground Setting" in prompt


def test_reference_style_prompt_uses_weapon_field_guidance() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_weapon_field",
        preset_direction=ReferenceStylePresetDirection(
            title="Ink-Wash Warrior Spirit Poster",
            target_model_mode="image_edit",
            input_mode="image_required",
        ),
        visual_analysis={
            "medium": ["digital sumi-e ink illustration"],
            "palette": ["black ink with coral red accent"],
            "line_shape_language": ["dry-brush blade arcs and splatter clouds"],
            "composition": ["full-body warrior with weapon diagonals"],
            "subject_treatment": ["warrior subject becomes painterly ink silhouette"],
            "environment_props": ["koi spirit, smoke, calligraphy, blade"],
            "texture_lighting": ["paper grain and ink wash texture"],
            "typography_text_energy": ["vertical calligraphy marks"],
            "mood": ["mythic martial energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="main_weapon", label="Main Weapon", required=True),
            ],
            image_slots=[
                ReferenceStyleImageSlot(key="character_reference", label="Character Reference", required=True),
            ],
        ),
    )

    prompt = compile_reference_style_i2i_prompt(brief)
    assert "Set the Main Weapon as the weapon, blade, staff, shield, or held combat prop" in prompt


def test_reference_style_prompt_update_recompiles_approved_field_guidance() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_pet_treat_update",
        preset_direction=ReferenceStylePresetDirection(
            title="Whimsical Giant-Perspective Pet Adventure",
            target_model_mode="text_to_image",
        ),
        visual_analysis={
            "medium": ["stylized photo-illustration with polished realism"],
            "palette": ["intense cobalt-blue sky with bright summer color"],
            "line_shape_language": ["rounded pet silhouettes and exaggerated foreground scale shapes"],
            "composition": ["extreme worm's-eye viewpoint with tiny pet hero closest to camera"],
            "subject_treatment": ["pet is the emotional focal point with playful adventure energy"],
            "environment_props": ["sunny outdoor passage with oversized flowers and playful props"],
            "texture_lighting": ["strong midday sunlight with crisp highlights"],
            "mood": ["joyful and mischievous summer adventure"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="main_pet", label="Main Pet", required=True),
                ReferenceStylePresetField(key="featured_treat", label="Featured Treat", required=True),
            ],
            image_slots=[],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=["extreme worm's-eye perspective", "tiny pet hero in closest foreground"],
            negative_guidance=["avoid generic eye-level pet portraits"],
        ),
        fixed_style_traits=["extreme worm's-eye perspective", "tiny pet hero in closest foreground"],
    )
    workflow = GraphWorkflow(
        name="Pet prompt update",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": "Whimsical Giant-Perspective Pet Adventure: Set the Main Pet as a concise value that fits this field and the fixed style. Set the Featured Treat as a concise value that fits this field and the fixed style."
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Update the Draft preset prompt for this text-to-image test workflow. "
        "Keep the approved fields Main Pet and Featured Treat, do not add Location, "
        "and make each field instruction specific to what it controls in the generated image. "
        "Use Main Pet: playful golden retriever puppy; Featured Treat: oversized watermelon slice.\n\n"
        f"{encode_reference_style_brief_marker(brief)}"
    )

    plan = plan_graph_from_message(message, workflow, [])
    assert plan.operations[0].op == "set_node_field"
    next_prompt = plan.operations[0].fields["text"]
    assert "Use playful golden retriever puppy as the Main Pet" in next_prompt
    assert "Use oversized watermelon slice as the Featured Treat" in next_prompt
    assert "Set the Location as" not in next_prompt
    assert "concise value that fits this field" not in next_prompt


def test_media_assistant_save_draft_uses_workflow_prompt_fields_over_stale_brief() -> None:
    stale_brief = ReferenceStyleBrief(
        brief_id="rsb_stale_location_save",
        preset_direction=ReferenceStylePresetDirection(
            title="Whimsical Giant-Perspective Pet Adventure",
            target_model_mode="text_to_image",
        ),
        visual_analysis={
            "medium": ["stylized photo-illustration with polished realism"],
            "palette": ["intense cobalt-blue sky with bright summer color"],
            "line_shape_language": ["rounded pet silhouettes and exaggerated foreground scale shapes"],
            "composition": ["extreme worm's-eye viewpoint with tiny pet hero closest to camera"],
            "subject_treatment": ["pet is the emotional focal point with playful adventure energy"],
            "environment_props": ["sunny outdoor passage with oversized flowers and playful props"],
            "texture_lighting": ["strong midday sunlight with crisp highlights"],
            "mood": ["joyful and mischievous summer adventure"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="location", label="Location", required=True),
                ReferenceStylePresetField(key="main_pet", label="Main Pet", required=False),
            ],
            image_slots=[],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=["extreme worm's-eye perspective", "tiny pet hero in closest foreground"],
            negative_guidance=["avoid generic eye-level pet portraits"],
        ),
        fixed_style_traits=["extreme worm's-eye perspective", "tiny pet hero in closest foreground"],
    )
    workflow = GraphWorkflow(
        name="Approved pet workflow",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": "Whimsical Giant-Perspective Pet Adventure: Use playful golden retriever puppy as the Main Pet to define the animal subject. Use oversized watermelon slice as the Featured Treat to define the featured food."
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        edges=[],
    )

    result = draft_media_preset(
        "Create the official Media Preset now from this approved workflow result.",
        [],
        workflow=workflow,
        style_brief=stale_brief.model_dump(mode="json"),
    )
    draft = result["draft"]

    assert [field["key"] for field in draft.input_schema_json] == ["main_pet", "featured_treat"]
    assert "Use {{main_pet}} as the Main Pet to define the animal subject" in draft.prompt_template
    assert "Use {{featured_treat}} as the Featured Treat to define the featured food" in draft.prompt_template
    assert "only when provided" not in draft.prompt_template
    assert "{{location}}" not in draft.prompt_template


def test_media_assistant_save_reconciles_stale_frontend_draft_with_workflow_prompt(client) -> None:
    workflow = {
        "schema_version": 1,
        "workflow_id": f"workflow-save-reconcile-{uuid4().hex[:8]}",
        "name": "Approved pet workflow",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Whimsical Giant-Perspective Pet Adventure: "
                        "Use playful golden retriever puppy as the Main Pet to define the animal subject. "
                        "Use oversized watermelon slice as the Featured Treat to define the featured food."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": workflow["workflow_id"], "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]
    stale_draft = PresetUpsertRequest(
        key=f"assistant_stale_frontend_draft_{uuid4().hex[:8]}",
        label="Whimsical Giant-Perspective Pet Adventure",
        description="Stale draft from the frontend should be reconciled before save.",
        status="active",
        model_key="gpt-image-2-text-to-image",
        applies_to_models=["gpt-image-2-text-to-image"],
        prompt_template="Old stale draft. Use {{location}} only when provided. Use {{main_pet}} only when provided.",
        input_schema_json=[
            {"key": "location", "label": "Location", "placeholder": "Location.", "default_value": "", "required": True},
            {"key": "main_pet", "label": "Main Pet", "placeholder": "Main Pet.", "default_value": "", "required": False},
        ],
        input_slots_json=[],
        source_kind="custom",
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": "Save this approved text-to-image test workflow as a media preset.",
            "workflow": workflow,
            "assistant_mode": "preset",
            "draft": stale_draft.model_dump(mode="json"),
        },
    )

    assert response.status_code == 200, response.text
    record = response.json()["record"]
    assert record["key"] == stale_draft.key
    assert [field["key"] for field in record["input_schema_json"]] == ["main_pet", "featured_treat"]
    assert "Use {{main_pet}} as the Main Pet to define the animal subject" in record["prompt_template"]
    assert "Use {{featured_treat}} as the Featured Treat to define the featured food" in record["prompt_template"]
    assert "{{location}}" not in record["prompt_template"]


def test_media_assistant_save_uses_latest_applied_plan_when_request_workflow_is_stale(client, app_modules) -> None:
    applied_workflow = {
        "schema_version": 1,
        "workflow_id": f"workflow-applied-save-{uuid4().hex[:8]}",
        "name": "Applied pet workflow",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Whimsical Giant-Perspective Pet Adventure: "
                        "Use playful golden retriever puppy as the Main Pet to define the animal subject. "
                        "Use oversized watermelon slice as the Featured Treat to define the featured food."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    stale_workflow = {"schema_version": 1, "workflow_id": f"workflow-stale-save-{uuid4().hex[:8]}", "name": "Stale", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": stale_workflow["workflow_id"], "workflow": stale_workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]
    app_modules["store_assistant"].create_or_update_assistant_plan(
        {
            "assistant_session_id": session_id,
            "status": "applied",
            "capability": "plan_graph",
            "plan_json": {},
            "validation_json": {},
            "pricing_json": {},
            "workflow_json": applied_workflow,
        }
    )
    stale_draft = PresetUpsertRequest(
        key=f"assistant_stale_request_workflow_{uuid4().hex[:8]}",
        label="Whimsical Giant-Perspective Pet Adventure",
        status="active",
        model_key="gpt-image-2-text-to-image",
        applies_to_models=["gpt-image-2-text-to-image"],
        prompt_template="Old stale draft. Use {{location}} only when provided. Use {{main_pet}} only when provided.",
        input_schema_json=[
            {"key": "location", "label": "Location", "placeholder": "Location.", "default_value": "", "required": True},
            {"key": "main_pet", "label": "Main Pet", "placeholder": "Main Pet.", "default_value": "", "required": False},
        ],
        input_slots_json=[],
        source_kind="custom",
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": "Save this approved text-to-image test workflow as a media preset.",
            "workflow": stale_workflow,
            "assistant_mode": "preset",
            "draft": stale_draft.model_dump(mode="json"),
        },
    )

    assert response.status_code == 200, response.text
    record = response.json()["record"]
    assert [field["key"] for field in record["input_schema_json"]] == ["main_pet", "featured_treat"]
    assert "Use {{main_pet}} as the Main Pet to define the animal subject" in record["prompt_template"]
    assert "Use {{featured_treat}} as the Featured Treat to define the featured food" in record["prompt_template"]
    assert "{{location}}" not in record["prompt_template"]


def test_media_assistant_save_updates_same_label_canonical_preset_instead_of_suffixing(client, app_modules) -> None:
    unique_suffix = uuid4().hex[:8]
    canonical_key = f"assistant_whimsical_giant_perspective_pet_adventure_{unique_suffix}"
    canonical_label = f"Whimsical Giant-Perspective Pet Adventure {unique_suffix}"
    existing = app_modules["service"].upsert_preset(
        PresetUpsertRequest(
            key=canonical_key,
            label=canonical_label,
            status="active",
            model_key="gpt-image-2-text-to-image",
            applies_to_models=["gpt-image-2-text-to-image"],
            prompt_template="Old stale draft. Use {{location}} only when provided.",
            input_schema_json=[
                {"key": "location", "label": "Location", "placeholder": "Location.", "default_value": "", "required": True}
            ],
            input_slots_json=[],
            source_kind="custom",
        )
    )
    duplicate = app_modules["service"].upsert_preset(
        PresetUpsertRequest(
            key=f"{canonical_key}_2",
            label=canonical_label,
            status="active",
            model_key="gpt-image-2-text-to-image",
            applies_to_models=["gpt-image-2-text-to-image"],
            prompt_template="Duplicate stale draft. Use {{location}} only when provided.",
            input_schema_json=[
                {"key": "location", "label": "Location", "placeholder": "Location.", "default_value": "", "required": True}
            ],
            input_slots_json=[],
            source_kind="custom",
        )
    )
    applied_workflow = {
        "schema_version": 1,
        "workflow_id": f"workflow-canonical-save-{uuid4().hex[:8]}",
        "name": "Applied pet workflow",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Whimsical Giant-Perspective Pet Adventure: "
                        "Use playful golden retriever puppy as the Main Pet to define the animal subject. "
                        "Use oversized watermelon slice as the Featured Treat to define the featured food."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    from app.assistant.routes import _saved_preset_matches_workflow_fields

    assert _saved_preset_matches_workflow_fields(duplicate, GraphWorkflow(**applied_workflow)) is False
    degraded_record = {
        **existing,
        "input_schema_json": [
            {"key": "main_pet", "label": "Main Pet", "placeholder": "Main Pet.", "default_value": "", "required": True},
            {"key": "featured_treat", "label": "Featured Treat", "placeholder": "Featured Treat.", "default_value": "", "required": False},
        ],
        "prompt_template": "Use {{featured_treat}} as the Featured Treat to define the featured food. Use {{main_pet}} only when provided.",
    }
    assert _saved_preset_matches_workflow_fields(degraded_record, GraphWorkflow(**applied_workflow)) is False
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": applied_workflow["workflow_id"], "workflow": {"schema_version": 1, "nodes": [], "edges": [], "metadata": {}}},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]
    app_modules["store_assistant"].create_or_update_assistant_plan(
        {
            "assistant_session_id": session_id,
            "status": "applied",
            "capability": "plan_graph",
            "plan_json": {},
            "validation_json": {},
            "pricing_json": {},
            "workflow_json": applied_workflow,
        }
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": f"Create a Media Preset called {canonical_label} from the approved workflow.",
            "workflow": {"schema_version": 1, "nodes": [], "edges": [], "metadata": {}},
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    record = response.json()["record"]
    assert response.json()["created"] is False, {
        "record_key": record["key"],
        "record_label": record["label"],
        "canonical_key": canonical_key,
        "canonical_label": canonical_label,
    }
    assert record["preset_id"] == existing["preset_id"]
    assert record["key"] == canonical_key
    assert [field["key"] for field in record["input_schema_json"]] == ["main_pet", "featured_treat"]
    assert "Use {{main_pet}} as the Main Pet to define the animal subject" in record["prompt_template"]
    assert "Use {{featured_treat}} as the Featured Treat to define the featured food" in record["prompt_template"]
    assert "{{location}}" not in record["prompt_template"]


def test_media_assistant_workflow_followup_does_not_resuggest_setup(client, app_modules, monkeypatch) -> None:
    def fail_provider_chat(**_kwargs):
        raise AssertionError("Workflow creation follow-up with an existing style brief should not re-run provider chat.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    reference_id = _create_reference_image(app_modules, name="style10-followup-no-resuggest.png")
    workflow = {"schema_version": 1, "name": "Style10 follow-up no resuggest", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style10-followup", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]
    attachment_response = client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "style10-followup-no-resuggest.png"},
    )
    assert attachment_response.status_code == 200, attachment_response.text
    attachments = app_modules["store_assistant"].list_assistant_attachments(session_id)
    brief = build_reference_style_brief(
        user_text="Create a text-to-image preset from this whimsical giant-step style.",
        assistant_text=(
            "This looks like `Whimsical Giant-Perspective Pet Adventure`.\n"
            "Suggested setup:\n"
            "- Field: Main Pet\n"
            "- Field: Featured Treat\n"
            "- Image input: none\n"
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Whimsical Giant-Perspective Pet Adventure",
                    "summary": "Sunny stylized pet adventure with giant foreground scale.",
                    "target_model_mode": "text_to_image",
                    "input_mode": "no_image",
                    "visual_analysis": {
                        "medium": ["stylized photo-illustration look", "polished realism and fantasy scale exaggeration"],
                        "palette": ["intense cobalt-blue sky", "bright white cloud masses"],
                        "composition": ["extreme ground-level angle", "oversized foreground object dominates the frame"],
                        "line_shape_language": ["round glossy pet eyes", "large curved foreground shapes"],
                        "subject_treatment": ["high-detail animal rendering", "playful larger-than-life adventure subject"],
                        "environment_props": ["sunlit passage", "playful prop near the camera"],
                        "texture_lighting": ["hard bright midday sunlight", "crisp glossy finish"],
                        "typography_text_energy": ["no typography present"],
                        "mood": ["cheerful", "whimsical", "summer adventure"],
                    },
                    "recommended_fields": [
                        {"key": "main_pet", "label": "Main Pet", "required": True},
                        {"key": "featured_treat", "label": "Featured Treat", "required": False},
                    ],
                    "recommended_image_slots": [],
                    "fixed_style_traits": ["giant low-angle perspective", "cute pet focal point", "sunny polished adventure"],
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={},
        attachments=attachments,
    )
    assert has_concrete_style_traits(brief)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **app_modules["store_assistant"].get_assistant_session(session_id),
            "summary_json": {
                "reference_style_brief": brief.model_dump(mode="json"),
                "media_preset_builder": {"attachment_set_hash": attachment_set_hash(attachments)},
                "preset_loop": {"lane": "text_to_image", "locked": True},
            },
        }
    )
    app_modules["store_assistant"].create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "assistant",
            "content_text": (
                "This looks like `Whimsical Giant-Perspective Pet Adventure`.\n\n"
                "Suggested setup:\n"
                "- Field: Main Pet\n"
                "- Field: Featured Treat\n"
                "- Image input: none\n\n"
                "Create a text-only test workflow with these fields?"
            ),
            "content_json": {"reference_style_brief": brief.model_dump(mode="json")},
        }
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create the text-only test workflow with these fields.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_sandbox_request"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert "I will create the test graph now." in assistant_message["content_text"]
    assert "Suggested setup" not in assistant_message["content_text"]
    assert "Field: Location" not in assistant_message["content_text"]


def test_media_assistant_travel_style_recovers_missing_destination_field_from_analysis() -> None:
    payload = {
        "title": "Cinematic Double-Exposure Travel Poster",
        "summary": "Photo-based travel poster portrait with scenic double exposure.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["photo-based poster composite", "double-exposure montage inside the subject silhouette"],
            "palette": ["warm cream parchment background", "peach and amber sunrise tones"],
            "composition": ["large side-profile portrait", "mountain landscape nested inside the head and torso"],
            "environment_props": ["destination landmarks", "mountain path", "small traveler figure"],
            "texture_lighting": ["soft atmospheric haze", "paper grain"],
            "typography_text_energy": ["bold condensed headline", "poster subtitle microcopy"],
            "mood": ["wanderlust", "reflective"],
        },
        "recommended_fields": [{"key": "tagline", "label": "tagline` for the poster subtitle or cover line", "required": False}],
        "recommended_image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
    }
    assistant_text = (
        "This looks like `Cinematic Double-Exposure Travel Poster`.\n"
        "Suggested setup:\n"
        "- Field: tagline` for the poster subtitle or cover line\n"
        "- Image input: Subject Image\n"
        "Create a test workflow with this setup?\n"
        f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"
    )
    brief = build_reference_style_brief(
        user_text="Create a media preset from this style as image-to-image.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )
    reply = compact_style_brief_reply(brief, proposal={})

    field_labels = [field.label for field in brief.preset_contract.fields]
    assert field_labels[:2] == ["Location", "Tagline"]
    assert all("`" not in label for label in field_labels)
    assert "Useful fields: Location and Tagline" in reply
    assert "Suggested setup" not in reply


def test_media_assistant_field_labels_do_not_leak_snake_case_to_reply() -> None:
    payload = {
        "title": "Editorial Travel Poster",
        "summary": "Travel poster with destination imagery and headline typography.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["editorial poster composite"],
            "palette": ["warm sunrise palette"],
            "composition": ["large portrait with destination landscape"],
            "environment_props": ["destination landmarks"],
            "typography_text_energy": ["bold headline typography"],
            "mood": ["aspirational"],
        },
        "recommended_fields": [
            {"key": "headline_title", "label": "Headline_Title", "required": True},
        ],
        "recommended_image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
    }
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset.",
        assistant_text=f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={},
        attachments=[],
    )
    reply = compact_style_brief_reply(brief, proposal={})

    assert "Headline_Title" not in reply
    assert "Useful fields:" in reply
    assert "Headline Title" in reply
    assert "Suggested setup" not in reply


def test_media_assistant_reference_style_prompt_does_not_cut_mid_word() -> None:
    payload = {
        "title": "Cinematic Double-Exposure Travel Poster",
        "summary": "A tall editorial travel poster portrait with scenic double exposure.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": [
                "photo-based double-exposure poster composition with a premium editorial campaign finish, realistic portrait masking, and layered scenic depth",
                "editorial travel advertisement treatment with a polished destination-poster layout, restrained graphic ornaments, and print-ready hierarchy",
            ],
            "palette": [
                "warm sunrise peach and amber highlights concentrated around the horizon glow and reflected across the subject silhouette",
                "muted cream paper background with lightly aged travel-brochure texture and generous negative space",
                "dusky blue shadow detail across the portrait edge to keep the profile readable against the scenic overlay",
            ],
            "line_shape_language": [
                "clean side-profile silhouette used as the main mask with a crisp outer edge and softly blended interior exposure",
                "fine vertical condensed typography arranged as quiet editorial labels around the portrait frame",
                "layered natural forms including mountain peaks, trees, temple roofs, sky gradients, birds, lanterns, and path details",
            ],
            "composition": [
                "tall poster aspect with a single dominant portrait on the left-center and breathing room along the top and right edges",
                "landscape scenes nested inside the head and torso silhouette with foreground, midground, and background layers clearly separated",
                "small text zones along the upper and side margins that feel like a designed travel campaign rather than random labels",
                "large title block anchored across the lower third with the strongest weight, clean alignment, and enough blank space to remain readable",
            ],
            "subject_treatment": [
                "adult subject shown in thoughtful side profile",
                "subject acts as a framing vessel for the destination story",
                "calm introspective expression rather than action pose",
            ],
            "environment_props": [
                "iconic mountain backdrop",
                "temple and shrine architecture",
                "stone path with a lone traveler figure",
                "cherry blossoms, lanterns, and forest path details",
                "flying birds near the upper sky",
            ],
            "texture_lighting": [
                "golden-hour backlight and sky glow",
                "soft haze and mist through the scenery",
                "subtle paper-like poster texture",
            ],
            "typography_text_energy": [
                "bold condensed uppercase main title",
                "flowing script subtitle layered over the title",
                "small uppercase tagline at the top",
                "thin vertical editorial labels and destination list",
            ],
            "mood": ["reflective and aspirational", "cinematic travel discovery energy"],
        },
        "fixed_style_traits": [
            "side-profile portrait used as a double-exposure silhouette mask",
            "multiple destination scenes layered inside the face and torso",
            "warm sunrise lighting with soft atmospheric haze",
            "editorial travel-poster layout with generous negative space",
            "large condensed title near the bottom with smaller supporting typography",
            "cinematic scenic depth with one small traveler figure to suggest journey",
        ],
        "negative_guidance": [
            "avoid generic plain portrait overlays without layered scenic storytelling",
            "avoid flat modern ad layouts with no poster texture",
            "avoid neon cyberpunk color drift",
            "avoid cartoon rendering or painterly brushwork",
            "avoid copying the exact source text, destination, or silhouette details",
            "avoid clutter that removes the clear title zone and focal hierarchy",
        ],
        "recommended_fields": [
            {"key": "destination_theme", "label": "Destination Theme", "required": True},
            {"key": "headline_title", "label": "Headline Title", "required": False},
        ],
        "recommended_image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"
    brief = build_reference_style_brief(
        user_text="Create a media preset from this style as image-to-image.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    prompt = compile_reference_style_prompt(brief)

    assert 3200 < len(prompt) <= REFERENCE_STYLE_PROMPT_MAX_CHARS
    assert prompt[-1] in ".!?"
    assert not prompt.endswith("chara")
    assert "Avoid generic style drift" in prompt
    assert "copy exact source" not in prompt.lower()


def test_media_assistant_dense_poster_style_prompt_preserves_layout_mechanics() -> None:
    payload = {
        "title": "Double-Exposure Travel Poster Portrait",
        "summary": "A vertical editorial travel poster portrait with scenic double exposure and destination typography.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["digital photo collage poster", "double-exposure portrait composite", "editorial travel advertisement layout"],
            "palette": ["warm peach sunrise", "soft cream paper background", "dusky blue shadows"],
            "line_shape_language": ["clean side-profile silhouette", "arched sky opening inside the head shape", "soft mask blend between portrait edge and landscape"],
            "composition": [
                "tall vertical poster framing",
                "large left-facing portrait dominates the frame",
                "landmark scenery embedded inside the face and torso",
                "central mountain peak near eye level",
            ],
            "subject_treatment": [
                "serious contemplative side-profile portrait",
                "portrait used as a scenic mask",
                "provided subject identity should stay recognizable in image-to-image mode",
            ],
            "environment_props": [
                "snow-capped mountain",
                "pagoda and temple architecture",
                "red torii gate",
                "cherry blossoms",
                "small lone traveler on a path",
            ],
            "texture_lighting": ["soft atmospheric haze", "golden-hour backlight", "paper-poster grain"],
            "typography_text_energy": [
                "bold condensed uppercase bottom headline",
                "handwritten script subtitle",
                "small spaced uppercase supporting copy",
                "red circular travel seal",
            ],
            "mood": ["wanderlust", "reflective", "romantic travel editorial"],
        },
        "fixed_style_traits": [
            "vertical double-exposure travel poster",
            "portrait silhouette filled with destination scenery",
            "large bottom destination title with script subtitle",
            "paper-grain editorial travel typography",
        ],
        "recommended_fields": [
            {"key": "location", "label": "Location", "required": True},
            {"key": "poster_title", "label": "Poster Title", "required": True},
        ],
        "recommended_image_slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
        "replaceable_elements": ["Location", "Poster Title", "Person Reference"],
        "source_specific_exclusions": ["exact source face", "exact readable source title", "exact landmark arrangement"],
        "negative_guidance": [
            "avoid flat single-scene portraits without double exposure",
            "avoid generic vacation snapshots",
            "avoid weak typography hierarchy",
        ],
    }
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this reference with a person image and useful fields.",
        assistant_text=f"Looks like a travel poster.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={
            "title": "Double-Exposure Travel Poster Portrait",
            "preset_contract": {
                "fields": [
                    {"key": "location", "label": "Location", "required": True},
                    {"key": "poster_title", "label": "Poster Title", "required": True},
                ],
                "image_slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
            },
        },
        attachments=[],
    )

    prompt = compile_reference_style_i2i_prompt(
        brief,
        fields=[
            {"key": "location", "label": "Location", "required": True},
            {"key": "poster_title", "label": "Poster Title", "required": True},
        ],
        image_slots=[{"key": "person_reference", "label": "Person Reference", "required": True}],
        saved_template=True,
    )

    assert prompt.startswith("Use [[person_reference]] as the identity and likeness source.")
    assert "Transform the provided visual input into Double-Exposure Travel Poster Portrait" in prompt
    assert "Render it as" not in prompt
    assert "Keep " in prompt
    assert "{{location}}" in prompt
    assert "{{poster_title}}" in prompt
    assert "[[person_reference]]" in prompt
    assert "tall vertical poster framing" in prompt
    assert "arched sky opening inside the head shape" in prompt
    assert "central mountain peak near eye level" in prompt
    assert "small lone traveler on a path" in prompt
    assert "bold condensed uppercase bottom headline" in prompt
    assert "handwritten script subtitle" in prompt
    assert "red circular travel seal" in prompt
    assert "Preserve the recognizable identity" in prompt
    assert "exact source face" not in prompt
    assert "Create an original image with the fixed visual style" not in prompt
    assert "Visual direction:" not in prompt
    assert "Visual mechanics:" not in prompt
    assert "Image input:" not in prompt
    assert "Use these fixed style mechanics:" not in prompt
    assert "Keep these traits locked:" not in prompt


def test_media_assistant_dense_cyber_poster_prompt_preserves_mechanics_without_source_identity() -> None:
    payload = {
        "title": "Cybernetic Warrior Poster",
        "summary": "A vertical cyberpunk action poster with extreme foreshortening, mechanical limbs, and technical Japanese graphic systems.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["painted-photoreal sci-fi poster illustration", "cyberpunk editorial character poster"],
            "palette": ["deep teal industrial background", "burnt orange hazard accents", "weathered cream label blocks"],
            "line_shape_language": ["sharp angular mech parts", "thick vertical typography blocks", "fragmented industrial border geometry"],
            "composition": [
                "tall vertical poster crop",
                "extreme low-angle foreshortened figure",
                "single hero centered on a diagonal leap",
                "oversized boot and cybernetic hand pushed toward camera",
            ],
            "subject_treatment": [
                "serious confrontational expression",
                "athletic cyber-warrior pose",
                "detailed prosthetic arm and leg mechanics",
            ],
            "environment_props": [
                "distressed industrial backdrop",
                "barcode graphic",
                "QR-style technical label",
                "warning label blocks",
                "small unit-code annotations",
            ],
            "texture_lighting": ["scratched metal", "weathered paint", "gritty contrast", "rim-lit mechanical reflections"],
            "typography_text_energy": [
                "large vertical Japanese headline",
                "small technical annotations",
                "bold unit-code typography",
                "warning-sign graphic labels",
            ],
            "mood": ["intense", "rebellious", "high-voltage cyberpunk action"],
        },
        "fixed_style_traits": [
            "low-angle cybernetic hero poster",
            "dense Japanese technical poster graphics",
            "teal-and-orange industrial palette",
            "intricate mechanical limb detail",
        ],
        "recommended_fields": [
            {"key": "character_role", "label": "Character Role", "required": True},
            {"key": "unit_code", "label": "Unit Code", "required": False},
        ],
        "recommended_image_slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
        "source_specific_exclusions": ["exact source character identity", "exact Japanese source text", "exact QR code"],
        "negative_guidance": [
            "avoid clean minimal backgrounds",
            "avoid generic superhero spandex",
            "avoid low-detail prosthetics",
        ],
    }
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset with a person image.",
        assistant_text=f"Looks like a cyber poster.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={
            "title": "Cybernetic Warrior Poster",
            "preset_contract": {
                "fields": [
                    {"key": "character_role", "label": "Character Role", "required": True},
                    {"key": "unit_code", "label": "Unit Code", "required": False},
                ],
                "image_slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
            },
        },
        attachments=[],
    )

    prompt = compile_reference_style_i2i_prompt(
        brief,
        fields=[
            {"key": "character_role", "label": "Character Role", "required": True},
            {"key": "unit_code", "label": "Unit Code", "required": False},
        ],
        image_slots=[{"key": "person_reference", "label": "Person Reference", "required": True}],
        saved_template=True,
    )

    assert "{{character_role}}" in prompt
    assert "{{unit_code}}" in prompt
    assert "[[person_reference]]" in prompt
    assert "extreme low-angle foreshortened figure" in prompt
    assert "oversized boot and cybernetic hand pushed toward camera" in prompt
    assert "barcode graphic" in prompt
    assert "warning label blocks" in prompt
    assert "large vertical Japanese headline" in prompt
    assert "intricate mechanical limb detail" in prompt
    assert "exact source character identity" not in prompt
    assert "exact QR code" not in prompt


def test_media_assistant_dense_punk_poster_prompt_preserves_banner_and_texture_system() -> None:
    payload = {
        "title": "Punk Grunge Portrait Poster",
        "summary": "A rebellious punk portrait poster with ripped banners, neon hair, checkerboard wall texture, and loud grunge typography.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["photoreal punk portrait poster", "grunge collage editorial"],
            "palette": ["hot magenta paint", "electric teal accents", "black checkerboard shadows", "aged cream banner paper"],
            "line_shape_language": ["arched torn-paper banner shapes", "paint-drip hearts", "rough distressed border edges"],
            "composition": [
                "vertical centered portrait",
                "subject framed by top and bottom ribbon banners",
                "checkerboard wall fills the background",
                "hands raised into rebellious gesture near face",
            ],
            "subject_treatment": [
                "confident punk attitude",
                "bright two-tone hair",
                "sunglasses with reflected city scene",
                "layered jewelry and bracelets",
            ],
            "environment_props": [
                "checkerboard graffiti wall",
                "dripping heart graphics",
                "skull rings",
                "spiked bracelets",
                "distressed poster grit",
            ],
            "texture_lighting": ["dirty paper grain", "scratched ink", "paint splatter", "high-contrast flash portrait lighting"],
            "typography_text_energy": [
                "huge distressed uppercase banner text",
                "curved ribbon headline",
                "bold rebellious slogan treatment",
                "grimy punk zine lettering",
            ],
            "mood": ["defiant", "chaotic", "punk zine attitude"],
        },
        "fixed_style_traits": [
            "punk grunge portrait poster",
            "top and bottom torn ribbon banners",
            "hot magenta and teal paint-splatter system",
            "distressed checkerboard graffiti background",
        ],
        "recommended_fields": [
            {"key": "banner_text", "label": "Banner Text", "required": True},
            {"key": "accent_color", "label": "Accent Color", "required": False},
        ],
        "recommended_image_slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
        "source_specific_exclusions": ["exact rude source phrase", "exact source jewelry text", "exact source sunglasses reflection"],
        "negative_guidance": [
            "avoid clean beauty portrait lighting",
            "avoid minimalist backgrounds",
            "avoid copying exact source text",
        ],
    }
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset with a person image.",
        assistant_text=f"Looks like a punk poster.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={
            "title": "Punk Grunge Portrait Poster",
            "preset_contract": {
                "fields": [
                    {"key": "banner_text", "label": "Banner Text", "required": True},
                    {"key": "accent_color", "label": "Accent Color", "required": False},
                ],
                "image_slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
            },
        },
        attachments=[],
    )

    prompt = compile_reference_style_i2i_prompt(
        brief,
        fields=[
            {"key": "banner_text", "label": "Banner Text", "required": True},
            {"key": "accent_color", "label": "Accent Color", "required": False},
        ],
        image_slots=[{"key": "person_reference", "label": "Person Reference", "required": True}],
        saved_template=True,
    )

    assert "{{banner_text}}" in prompt
    assert "{{accent_color}}" in prompt
    assert "[[person_reference]]" in prompt
    assert "arched torn-paper banner shapes" in prompt
    assert "subject framed by top and bottom ribbon banners" in prompt
    assert "checkerboard wall fills the background" in prompt
    assert "huge distressed uppercase banner text" in prompt
    assert "hot magenta and teal paint-splatter system" in prompt
    assert "exact rude source phrase" not in prompt
    assert "exact source sunglasses reflection" not in prompt


def test_reference_style_prompt_uses_concrete_fields_and_slots() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_concrete_product",
        preset_direction=ReferenceStylePresetDirection(
            title="Editorial Product Poster System",
            target_model_mode="image_edit",
        ),
        visual_analysis={
            "medium": ["editorial product poster collage", "commercial graphic design layout"],
            "palette": ["limited two-tone palette with one bright accent", "matte neutral background"],
            "line_shape_language": ["bold geometric framing blocks", "clean product silhouette emphasis"],
            "composition": ["center product hero", "large margin title zone", "layered graphic callouts"],
            "subject_treatment": ["product is treated as the main hero object"],
            "environment_props": ["abstract studio surface", "small label stickers", "simple shadow base"],
            "texture_lighting": ["softbox lighting", "subtle paper grain", "crisp shadow edge"],
            "typography_text_energy": ["large condensed headline", "small technical microtype"],
            "mood": ["premium editorial retail energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="product_name", label="Product Name", required=False),
                ReferenceStylePresetField(key="headline_copy", label="Headline Copy", required=False),
            ],
            image_slots=[
                ReferenceStyleImageSlot(key="product_image", label="Product Image", required=False)
            ],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=[
                "centered hero product poster",
                "geometric editorial callout system",
                "limited palette with one bright accent",
            ],
            negative_guidance=["avoid copying exact source branding", "avoid generic flat lay"],
        ),
        fixed_style_traits=[
            "centered hero product poster",
            "geometric editorial callout system",
            "limited palette with one bright accent",
        ],
        source_specific_exclusions=["exact source product logo", "exact source label text"],
    )

    result = compile_reference_style_prompt_result(brief, saved_template=True)

    assert result.prompt_quality_passed
    assert "{{choice:product_source}}" not in result.prompt
    assert "{{product_name}}" in result.prompt
    assert "{{headline_copy}}" in result.prompt
    assert "[[product_image]]" in result.prompt
    assert result.field_keys == ["product_name", "headline_copy"]
    assert result.image_slot_keys == ["product_image"]
    assert "exact source product logo" not in result.prompt


def _generic_contract_validation_brief() -> ReferenceStyleBrief:
    return ReferenceStyleBrief(
        brief_id="rsb_contract_validation",
        preset_direction=ReferenceStylePresetDirection(
            title="Generic Editorial Poster",
            target_model_mode="image_edit",
            input_mode="image_required",
        ),
        visual_analysis={
            "medium": ["editorial poster illustration", "graphic collage layout"],
            "palette": ["warm neutral background", "single bright accent color"],
            "line_shape_language": ["bold geometric framing blocks", "clean silhouette emphasis"],
            "composition": ["center hero subject", "large title margin", "layered callout zones"],
            "subject_treatment": ["subject becomes the main poster hero"],
            "environment_props": ["abstract studio surface", "small label stickers"],
            "texture_lighting": ["softbox lighting", "subtle paper grain"],
            "typography_text_energy": ["large condensed headline", "small technical microtype"],
            "mood": ["premium editorial energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="headline", label="Headline", required=True),
                ReferenceStylePresetField(key="subject_text", label="Subject Text"),
            ],
            image_slots=[
                ReferenceStyleImageSlot(key="subject_image", label="Subject Image", required=True),
                ReferenceStyleImageSlot(key="subject_photo", label="Subject Photo"),
            ],
        ),
        fixed_style_traits=["editorial poster collage", "geometric callout system", "paper grain"],
        source_specific_exclusions=["exact source logo", "exact source text"],
    )


def test_reference_style_preset_contract_validation_passes_valid_prompt_template() -> None:
    brief = _generic_contract_validation_brief()

    result = validate_reference_style_preset_contract(
        brief,
        prompt_template="Create {{headline}} and {{subject_text}} using [[subject_image]] and [[subject_photo]].",
    )

    assert result.status == "valid"
    assert result.issues == []
    assert result.field_keys == ["headline", "subject_text"]
    assert result.image_slot_keys == ["subject_image", "subject_photo"]


def test_reference_style_preset_contract_validation_reports_all_failure_classes() -> None:
    brief = _generic_contract_validation_brief()
    over_limit_slots = [
        {"key": f"slot_{index}", "label": f"Slot {index}", "required": False}
        for index in range(15)
    ]

    result = validate_reference_style_preset_contract(
        brief,
        prompt_template=(
            "Create {{undefined_field}} using [[undefined_slot]] plus {{choice:undefined_choice}} "
            "and direct {{subject_text}} [[subject_photo]]."
        ),
        fields=[
            {"key": "headline", "label": "Headline"},
            {"key": "subject_text", "label": "Subject Text"},
        ],
        image_slots=over_limit_slots + [
            {"key": "subject_photo", "label": "Subject Photo"}
        ],
        input_mode="no_image",
    )

    issues = "\n".join(result.issues)
    assert result.status == "invalid"
    assert "configured field missing from prompt_template: headline" in issues
    assert "undefined field placeholder in prompt_template: undefined_field" in issues
    assert "undefined image slot placeholder in prompt_template: undefined_slot" in issues
    assert "unsupported choice placeholder in prompt_template: undefined_choice" in issues
    assert "configured image slot unused by prompt_template: slot_0" in issues
    assert "no_image presets cannot define image slots" in issues
    assert "image input count exceeds max of 14" in issues


def test_media_assistant_reference_style_stress_pack_compiles_distinct_visual_systems() -> None:
    fixtures = [
        {
            "title": "Grunge Cartoon Overthinker Room",
            "visual_analysis": {
                "medium": ["rough cartoon poster illustration", "grungy editorial room scene"],
                "palette": ["mustard yellow room palette", "dirty ochre paper tones", "heavy black ink contrast"],
                "line_shape_language": ["brushy hand-drawn outlines", "scribbled wall doodles", "exaggerated cartoon proportions"],
                "composition": ["wide cluttered bedroom composition", "large wall slogan dominates upper background", "foreground oversized sneakers anchor the frame"],
                "subject_treatment": ["expressive cartoon human character", "animal sidekick with matching attitude", "slouchy streetwear styling"],
                "environment_props": ["poster-covered bedroom wall", "vinyl record", "cassette equipment", "desk clutter", "lamp glow"],
                "texture_lighting": ["dirty paper grain", "warm lamp light", "scuffed poster texture"],
                "typography_text_energy": ["large brush-lettered wall slogan", "small taped note typography", "doodle-like caption energy"],
                "mood": ["anxious but funny", "chaotic optimism", "messy bedroom humor"],
            },
            "fields": [{"key": "main_message", "label": "Main Message", "required": True}],
            "slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
            "must": ["rough cartoon poster illustration", "large wall slogan dominates upper background", "poster-covered bedroom wall", "animal sidekick with matching attitude"],
            "must_not": ["exact source wall phrase", "exact source shirt name"],
        },
        {
            "title": "Spray Paint Streetwear Magazine Poster",
            "visual_analysis": {
                "medium": ["photoreal streetwear magazine poster", "graffiti sticker collage"],
                "palette": ["hot pink spray paint", "cyan street-label accents", "black and white wall contrast"],
                "line_shape_language": ["comic burst shapes", "paint splatter strokes", "sticker-label blocks"],
                "composition": ["tall vertical fashion-poster crop", "seated subject framed by huge graffiti headline", "dense poster graphics around the body"],
                "subject_treatment": ["streetwear model pose", "headphones around neck", "baggy pants and sneakers emphasized"],
                "environment_props": ["barcode label", "spray-paint wall", "comic sticker icons", "urban slogan labels"],
                "texture_lighting": ["glossy fashion lighting", "wet paint splatter", "rough wall texture"],
                "typography_text_energy": ["oversized graffiti headline", "comic-book exclamation typography", "barcode magazine label"],
                "mood": ["rebellious", "young street culture", "loud urban energy"],
            },
            "fields": [{"key": "headline", "label": "Headline", "required": True}],
            "slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
            "must": ["oversized graffiti headline", "barcode label", "hot pink spray paint", "dense poster graphics around the body"],
            "must_not": ["exact source model identity", "exact readable source slogans"],
        },
        {
            "title": "Neon Street-Art Product Mascot Poster",
            "visual_analysis": {
                "medium": ["bold street-art product poster", "surreal mascot illustration"],
                "palette": ["electric orange background", "hot magenta paint field", "glossy black shadows"],
                "line_shape_language": ["ink splatter silhouettes", "spiky character shapes", "chunky product forms"],
                "composition": ["centered product-and-mascot display", "oversized sneakers in foreground", "large abstract backdrop letters"],
                "subject_treatment": ["surreal skull or bug-eyed mascot", "streetwear character attitude", "product treated as hero object"],
                "environment_props": ["boombox prop", "paint puddle reflection", "oversized sneakers", "spray-paint burst"],
                "texture_lighting": ["glossy black reflection", "wet paint shine", "hard graphic highlights"],
                "typography_text_energy": ["large abstract poster lettering", "streetwear shirt text energy", "graffiti mark rhythm"],
                "mood": ["loud", "surreal", "street-art product launch"],
            },
            "fields": [{"key": "product_type", "label": "Product Type", "required": True}],
            "slots": [{"key": "product_reference", "label": "Product Reference", "required": False}],
            "must": ["electric orange background", "hot magenta paint field", "oversized sneakers in foreground", "boombox prop"],
            "must_not": ["exact source mascot", "exact shoe logo"],
        },
        {
            "title": "Studio Skate Streetwear Portrait",
            "visual_analysis": {
                "medium": ["clean stylized studio fashion portrait", "toy-like streetwear character render"],
                "palette": ["neutral gray seamless background", "black hoodie contrast", "washed denim blue"],
                "line_shape_language": ["rounded stylized proportions", "soft hair curls", "oversized clothing silhouette"],
                "composition": ["full-body centered studio pose", "skateboard directly under the feet", "large negative space around subject"],
                "subject_treatment": ["fashionable skater character", "oversized hoodie and baggy jeans", "headphones and sunglasses"],
                "environment_props": ["skateboard", "patched backpack", "smiley patches", "chain accessory"],
                "texture_lighting": ["soft studio lighting", "clean floor shadow", "smooth product-render finish"],
                "typography_text_energy": ["minimal or no typography", "graphic patches on clothing"],
                "mood": ["cool", "casual", "streetwear catalog"],
            },
            "fields": [{"key": "outfit_theme", "label": "Outfit Theme", "required": True}],
            "slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
            "must": ["clean stylized studio fashion portrait", "skateboard directly under the feet", "large negative space around subject", "soft studio lighting"],
            "must_not": ["graffiti poster background", "dense typography wall"],
        },
        {
            "title": "Retro Year Neon Room",
            "visual_analysis": {
                "medium": ["cinematic chibi character scene", "retro room product-photo composite"],
                "palette": ["warm amber neon glow", "dark wood shadows", "red-orange highlights"],
                "line_shape_language": ["large rounded neon numerals", "chibi big-head small-body proportions", "rectangular stereo equipment stack"],
                "composition": ["wide cinematic room layout", "giant glowing year sign dominates right side", "character stands beside stereo stack"],
                "subject_treatment": ["smiling chibi character", "fashion doll proportions", "era-styled outfit"],
                "environment_props": ["vintage stereo stack", "cassette tapes", "vinyl record foreground", "music posters"],
                "texture_lighting": ["neon tube glow", "glossy floor reflections", "warm nostalgic haze"],
                "typography_text_energy": ["giant readable neon year numerals", "background band-poster typography", "cassette label details"],
                "mood": ["nostalgic", "playful", "late-night retro music room"],
            },
            "fields": [{"key": "year", "label": "Year", "required": True}],
            "slots": [{"key": "person_reference", "label": "Person Reference", "required": False}],
            "must": ["giant glowing year sign dominates right side", "vintage stereo stack", "vinyl record foreground", "neon tube glow"],
            "must_not": ["exact source year", "exact source band poster text"],
        },
        {
            "title": "Vintage Coastal Muscle Car Ad",
            "visual_analysis": {
                "medium": ["distressed vintage automotive print advertisement", "illustrated magazine car poster"],
                "palette": ["faded sky blue car paint", "sun-baked cream paper", "rust orange coastal cliffs"],
                "line_shape_language": ["bold car grille geometry", "curving coastal road lines", "worn print border"],
                "composition": ["car lunges toward viewer on diagonal road", "coastal highway recedes into background", "large ad headline block at bottom"],
                "subject_treatment": ["classic muscle car hero angle", "front grille and wheels emphasized", "driver visible through windshield"],
                "environment_props": ["ocean coastline", "rock cliffs", "road spray", "brand badge box", "license plate"],
                "texture_lighting": ["aged paper grain", "halftone print wear", "sunlit road dust"],
                "typography_text_energy": ["large bold bottom ad headline", "smaller slogan line", "script model signature"],
                "mood": ["nostalgic", "speed", "coastal road freedom"],
            },
            "fields": [{"key": "route", "label": "Route", "required": True}, {"key": "headline", "label": "Headline", "required": False}],
            "slots": [{"key": "vehicle_reference", "label": "Vehicle Reference", "required": False}],
            "must": ["distressed vintage automotive print advertisement", "car lunges toward viewer on diagonal road", "large ad headline block at bottom", "aged paper grain"],
            "must_not": ["exact car badge", "exact license plate", "exact source headline"],
        },
        {
            "title": "Cinematic Worn Cyborg Soldier Portrait",
            "visual_analysis": {
                "medium": ["photoreal cinematic sci-fi portrait", "worn armor character concept art"],
                "palette": ["dusty gray sky", "muted red armor plates", "desert beige atmosphere"],
                "line_shape_language": ["layered armor panel seams", "exposed neck cabling", "mechanical gauntlet shapes"],
                "composition": ["close side-profile portrait crop", "background drops into shallow focus", "large spacecraft shape blurred behind subject"],
                "subject_treatment": ["serious cyborg soldier", "human face integrated with mechanical neck", "arms crossed in defensive stance"],
                "environment_props": ["desert staging ground", "blurred spacecraft", "distant crew silhouettes"],
                "texture_lighting": ["scratched worn armor", "soft overcast cinematic light", "shallow depth of field"],
                "typography_text_energy": ["no typography", "cinematic still rather than poster layout"],
                "mood": ["serious", "battle-worn", "quiet sci-fi tension"],
            },
            "fields": [{"key": "setting", "label": "Setting", "required": True}],
            "slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
            "must": ["photoreal cinematic sci-fi portrait", "exposed neck cabling", "large spacecraft shape blurred behind subject", "shallow depth of field"],
            "must_not": ["poster typography", "comic sticker graphics"],
        },
    ]

    for fixture in fixtures:
        payload = {
            "title": fixture["title"],
            "summary": f"Reusable style brief for {fixture['title']}.",
            "target_model_mode": "image_edit" if fixture["slots"] else "text_to_image",
            "visual_analysis": fixture["visual_analysis"],
            "fixed_style_traits": fixture["must"][:4],
            "recommended_fields": fixture["fields"],
            "recommended_image_slots": fixture["slots"],
            "source_specific_exclusions": fixture["must_not"],
            "negative_guidance": ["avoid copying exact source text, logos, identities, or one-off layout details"],
        }
        brief = build_reference_style_brief(
            user_text="Create a media preset from this reference.",
            assistant_text=f"Looks like a style.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
            proposal={
                "title": fixture["title"],
                "preset_contract": {
                    "fields": fixture["fields"],
                    "image_slots": fixture["slots"],
                },
            },
            attachments=[],
        )
        prompt = compile_reference_style_prompt(
            brief,
            fields=fixture["fields"],
            image_slots=fixture["slots"],
            saved_template=True,
        )

        assert prompt, fixture["title"]
        if fixture["slots"]:
            assert prompt.startswith("Use [["), fixture["title"]
            assert f"Transform the provided visual input into {fixture['title']}" in prompt, fixture["title"]
        else:
            assert prompt.startswith(f"{fixture['title']}:"), fixture["title"]
        assert "Render it as" not in prompt, fixture["title"]
        assert "Keep " in prompt, fixture["title"]
        assert "Visual direction:" not in prompt, fixture["title"]
        assert "Visual mechanics:" not in prompt, fixture["title"]
        assert "Image input:" not in prompt, fixture["title"]
        assert "Use these fixed style mechanics:" not in prompt, fixture["title"]
        assert "Keep these traits locked:" not in prompt, fixture["title"]
        for field in fixture["fields"]:
            assert f"{{{{{field['key']}}}}}" in prompt, fixture["title"]
        for slot in fixture["slots"]:
            assert f"[[{slot['key']}]]" in prompt, fixture["title"]
        for expected in fixture["must"]:
            assert expected in prompt, fixture["title"]
        for excluded in fixture["must_not"]:
            assert excluded not in prompt, fixture["title"]


def test_media_assistant_style_brief_keeps_source_specific_traits_out_of_prompt() -> None:
    payload = {
        "title": "Layered Travel Poster Portrait",
        "summary": "A double-exposure poster portrait with destination scenery inside the subject silhouette.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["cinematic illustrated travel poster", "double-exposure portrait composite"],
            "palette": ["warm amber paper palette", "soft cream background"],
            "line_shape_language": ["soft silhouette mask edges", "clean poster geometry"],
            "composition": ["large side-profile portrait", "landscape contained inside the silhouette"],
            "subject_treatment": ["recognizable portrait silhouette with source glasses and beard"],
            "environment_props": ["Mount Fuji horizon", "small temple structures"],
            "texture_lighting": ["paper grain texture", "golden backlit haze"],
            "typography_text_energy": ["bold condensed destination title", "small editorial microtype"],
            "mood": ["premium wanderlust poster"],
        },
        "fixed_style_traits": [
            "double-exposure portrait composite",
            "destination scenery contained inside a subject silhouette",
            "warm archival travel poster texture",
        ],
        "replaceable_elements": ["Subject Image", "Location", "Poster Title"],
        "source_specific_exclusions": ["source glasses and beard", "Mount Fuji horizon"],
        "negative_guidance": ["avoid generic portrait realism"],
    }
    proposal = {
        "title": "Single-Image Reference Preset",
        "preset_contract": {
            "fields": [{"key": "location", "label": "Location", "required": True}],
            "image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
        },
    }
    assistant_text = f"Looks like a travel poster.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this reference.",
        assistant_text=assistant_text,
        proposal=proposal,
        attachments=[],
    )

    prompt = compile_reference_style_prompt(
        brief,
        fields=[{"key": "location", "label": "Location", "required": True}],
        image_slots=[{"key": "subject_image", "label": "Subject Image", "required": True}],
        saved_template=True,
    )

    assert prompt
    assert "[[subject_image]]" in prompt
    assert "{{location}}" in prompt
    assert "Mount Fuji horizon" not in prompt
    assert "source glasses and beard" not in prompt
    assert "source-specific" not in prompt.lower()
    assert "copy exact source" not in prompt.lower()
    assert "Preserve the recognizable identity" in prompt
    quality = score_preset_prompt(
        prompt,
        style_traits=brief.fixed_style_traits,
        field_keys=["location"],
        image_slot_keys=["subject_image"],
        source_specific_exclusions=brief.source_specific_exclusions,
        saved_template=True,
    )
    assert quality.passed
    assert quality.score >= PROMPT_QUALITY_MIN_SCORE


def test_media_assistant_dedicated_t2i_and_i2i_compilers_separate_slots() -> None:
    payload = {
        "title": "Layered Travel Poster Portrait",
        "summary": "A double-exposure poster portrait with destination scenery inside the subject silhouette.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["cinematic illustrated travel poster", "double-exposure portrait composite"],
            "palette": ["warm amber paper palette", "soft cream background"],
            "line_shape_language": ["soft silhouette mask edges", "clean poster geometry"],
            "composition": ["large side-profile portrait", "landscape contained inside the silhouette"],
            "subject_treatment": ["stylized portrait silhouette treatment"],
            "environment_props": ["replaceable destination landmarks", "small scenic structures"],
            "texture_lighting": ["paper grain texture", "golden backlit haze"],
            "typography_text_energy": ["bold condensed destination title", "small editorial microtype"],
            "mood": ["premium wanderlust poster"],
        },
        "fixed_style_traits": [
            "double-exposure portrait composite",
            "destination scenery contained inside a subject silhouette",
            "warm archival travel poster texture",
        ],
        "replaceable_elements": ["Subject Image", "Location", "Poster Title"],
        "source_specific_exclusions": ["source glasses and beard", "Mount Fuji horizon"],
        "negative_guidance": ["avoid generic portrait realism"],
    }
    proposal = {
        "title": "Layered Travel Poster Portrait",
        "preset_contract": {
            "fields": [{"key": "location", "label": "Location", "required": True}],
            "image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
        },
    }
    brief = build_reference_style_brief(
        user_text="Create both text-to-image and image-to-image presets.",
        assistant_text=f"Looks like a travel poster.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal=proposal,
        attachments=[],
    )

    t2i_prompt = compile_reference_style_t2i_prompt(
        brief,
        fields=[{"key": "location", "label": "Location", "required": True}],
        saved_template=True,
    )
    i2i_prompt = compile_reference_style_i2i_prompt(
        brief,
        fields=[{"key": "location", "label": "Location", "required": True}],
        image_slots=[{"key": "subject_image", "label": "Subject Image", "required": True}],
        saved_template=True,
    )

    assert t2i_prompt
    assert "{{location}}" in t2i_prompt
    assert "[[subject_image]]" not in t2i_prompt
    assert t2i_prompt.startswith("Layered Travel Poster Portrait:")
    assert "Generate the full style as a standalone text prompt." not in t2i_prompt
    assert i2i_prompt
    assert "{{location}}" in i2i_prompt
    assert "[[subject_image]]" in i2i_prompt
    assert "Preserve the recognizable identity" in i2i_prompt
    assert "Mount Fuji horizon" not in i2i_prompt


def test_media_assistant_prompt_compiler_result_reports_quality_and_contract_keys() -> None:
    payload = {
        "title": "Layered Travel Poster Portrait",
        "summary": "A double-exposure poster portrait with destination scenery inside the subject silhouette.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["cinematic illustrated travel poster", "double-exposure portrait composite"],
            "palette": ["warm amber paper palette", "soft cream background"],
            "line_shape_language": ["soft silhouette mask edges", "clean poster geometry"],
            "composition": ["large side-profile portrait", "landscape contained inside the silhouette"],
            "subject_treatment": ["stylized portrait silhouette treatment"],
            "environment_props": ["replaceable destination landmarks", "small scenic structures"],
            "texture_lighting": ["paper grain texture", "golden backlit haze"],
            "typography_text_energy": ["bold condensed destination title", "small editorial microtype"],
            "mood": ["premium wanderlust poster"],
        },
        "fixed_style_traits": [
            "double-exposure portrait composite",
            "destination scenery contained inside a subject silhouette",
            "warm archival travel poster texture",
        ],
        "replaceable_elements": ["Subject Image", "Location", "Poster Title"],
        "source_specific_exclusions": ["source glasses and beard", "Mount Fuji horizon"],
        "negative_guidance": ["avoid generic portrait realism"],
    }
    brief = build_reference_style_brief(
        user_text="Create both text-to-image and image-to-image presets.",
        assistant_text=f"Looks like a travel poster.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={
            "title": "Layered Travel Poster Portrait",
            "preset_contract": {
                "fields": [{"key": "location", "label": "Location", "required": True}],
                "image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
            },
        },
        attachments=[],
    )

    t2i_result = compile_reference_style_t2i_prompt_result(
        brief,
        fields=[{"key": "location", "label": "Location", "required": True}],
        saved_template=True,
    )
    i2i_result = compile_reference_style_i2i_prompt_result(
        brief,
        fields=[{"key": "location", "label": "Location", "required": True}],
        image_slots=[{"key": "subject_image", "label": "Subject Image", "required": True}],
        saved_template=True,
    )

    assert t2i_result.prompt_quality_passed is True
    assert t2i_result.prompt_quality_score >= PROMPT_QUALITY_MIN_SCORE
    assert t2i_result.field_keys == ["location"]
    assert t2i_result.image_slot_keys == []
    assert "[[subject_image]]" not in t2i_result.prompt
    assert i2i_result.prompt_quality_passed is True
    assert i2i_result.prompt_quality_score >= PROMPT_QUALITY_MIN_SCORE
    assert i2i_result.field_keys == ["location"]
    assert i2i_result.image_slot_keys == ["subject_image"]
    assert "[[subject_image]]" in i2i_result.prompt


def test_media_assistant_prompt_repair_lifts_low_quality_prompt_above_threshold() -> None:
    proposal = {
        "title": "Poster Style",
        "preset_contract": {
            "fields": [{"key": "location", "label": "Location", "required": True}],
            "image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
        },
    }
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset.",
        assistant_text=(
            "Reusable direction: illustrated double-exposure travel poster with warm amber paper palette; "
            "clean silhouette mask edges; destination landscape nested inside the subject; bold condensed travel typography; "
            "grainy paper texture; soft sunrise haze; premium wanderlust mood."
        ),
        proposal=proposal,
        attachments=[],
    )
    weak_prompt = "Make a nice poster."

    repaired = repair_reference_style_prompt(
        weak_prompt,
        brief,
        fields=[{"key": "location", "label": "Location", "required": True}],
        image_slots=[{"key": "subject_image", "label": "Subject Image", "required": True}],
        saved_template=True,
    )
    quality = score_preset_prompt(
        repaired,
        style_traits=brief.fixed_style_traits,
        field_keys=["location"],
        image_slot_keys=["subject_image"],
        source_specific_exclusions=brief.source_specific_exclusions,
        saved_template=True,
    )

    assert "Render it as" not in repaired
    assert "Style quality lock" not in repaired
    assert "{{location}}" in repaired
    assert "[[subject_image]]" in repaired
    assert quality.passed
    assert quality.score >= PROMPT_QUALITY_MIN_SCORE


def test_media_assistant_i2i_prompt_scrubs_legacy_identity_traits_without_explicit_exclusions() -> None:
    payload = {
        "title": "Cinematic Double-Exposure Travel Poster",
        "summary": "A poster portrait with destination scenery inside the subject silhouette.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["digital photo-illustration poster", "double-exposure composite", "editorial travel advertisement layout"],
            "palette": ["warm cream parchment background", "peach and gold sunrise highlights"],
            "line_shape_language": ["clean side-profile silhouette", "layered mountain contours"],
            "composition": ["dominant left-facing portrait filling most of frame", "landscape scenes embedded inside head and torso silhouette"],
            "subject_treatment": ["realistic male portrait with glasses and beard", "young male cyber warrior", "calm reflective expression"],
            "environment_props": ["destination landmark silhouettes", "stone path"],
            "texture_lighting": ["soft atmospheric haze", "gentle paper grain backdrop"],
            "typography_text_energy": ["bold condensed all-caps destination title"],
            "mood": ["aspirational", "reflective"],
        },
        "fixed_style_traits": [
            "double-exposure portrait composite",
            "destination scenery embedded inside a subject silhouette",
            "warm travel-poster paper texture",
        ],
        "replaceable_elements": ["Subject Image", "Location"],
        "negative_guidance": ["avoid flat plain portrait"],
    }
    proposal = {
        "title": "Cinematic Double-Exposure Travel Poster",
        "preset_contract": {
            "fields": [{"key": "location", "label": "Location", "required": True}],
            "image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
        },
    }
    assistant_text = f"Looks like a travel poster.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this reference.",
        assistant_text=assistant_text,
        proposal=proposal,
        attachments=[],
    )

    prompt = compile_reference_style_prompt(
        brief,
        fields=[{"key": "location", "label": "Location", "required": True}],
        image_slots=[{"key": "subject_image", "label": "Subject Image", "required": True}],
        saved_template=True,
    )

    assert prompt
    assert "double-exposure" in prompt
    assert "glasses" not in prompt
    assert "beard" not in prompt
    assert "young male" not in prompt
    assert "male portrait" not in prompt
    assert "Preserve the recognizable identity" in prompt


def test_media_assistant_t2i_prompt_scrubs_source_identity_traits_from_reference_style() -> None:
    payload = {
        "title": "Cybernetic Manga-Tech Character Poster",
        "summary": "A gritty cybernetic poster with manga-tech composition and dense typography.",
        "target_model_mode": "text_to_image",
        "visual_analysis": {
            "medium": ["digital manga-tech poster illustration", "painted-photoreal cyberpunk character art"],
            "palette": ["deep teal industrial background", "burnt orange typography accents", "grimy black shadow blocks"],
            "line_shape_language": ["angular mech limb geometry", "vertical technical label blocks", "sharp cybernetic silhouette"],
            "composition": ["tall poster crop with one central cybernetic hero", "extreme low-angle foreshortened figure"],
            "subject_treatment": [
                "cybernetic figure with visible face and focused expression",
                "glasses, dreadlocked hair, and asymmetrical pose add identity emphasis",
                "mechanical arms and reinforced torso dominate the body language",
            ],
            "environment_props": ["distressed industrial backdrop", "barcode blocks", "technical annotation panels"],
            "texture_lighting": ["scratched metal surfaces", "weathered poster grain", "hard rim lighting"],
            "typography_text_energy": ["oversized vertical headline characters", "small alphanumeric callouts"],
            "mood": ["intense", "rebellious", "near-future combat energy"],
        },
        "fixed_style_traits": [
            "teal-orange cybernetic manga poster palette",
            "dense vertical typography system",
            "grimy industrial poster texture",
        ],
        "recommended_fields": [
            {"key": "subject_brief", "label": "Subject Brief", "required": True},
            {"key": "unit_code", "label": "Unit Code", "required": False},
        ],
        "source_specific_exclusions": [
            "exact person's face, hairstyle, glasses, and expression",
            "exact source character identity",
            "exact source text",
        ],
        "negative_guidance": ["avoid clean minimalist sci-fi layouts"],
    }
    brief = build_reference_style_brief(
        user_text="Create a text-to-image preset from this reference.",
        assistant_text=f"Looks like a cyber poster.\n{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={
            "title": "Cybernetic Manga-Tech Character Poster",
            "preset_contract": {
                "fields": [
                    {"key": "subject_brief", "label": "Subject Brief", "required": True},
                    {"key": "unit_code", "label": "Unit Code", "required": False},
                ],
                "image_slots": [],
            },
        },
        attachments=[],
    )

    prompt = compile_reference_style_t2i_prompt(
        brief,
        fields=[
            {"key": "subject_brief", "label": "Subject Brief", "required": True},
            {"key": "unit_code", "label": "Unit Code", "required": False},
        ],
        saved_template=True,
    )

    assert prompt
    assert "{{subject_brief}}" in prompt
    assert "{{unit_code}}" in prompt
    assert "angular mech limb geometry" in prompt
    assert "mechanical arms and reinforced torso dominate the body language" in prompt
    assert "oversized vertical headline characters" in prompt
    assert "glasses" not in prompt
    assert "dread" not in prompt.lower()
    assert "exact person's face" not in prompt
    assert "Generate the full style as a standalone text prompt" not in prompt


def test_media_assistant_drops_location_field_when_style_has_no_destination_semantics() -> None:
    payload = {
        "title": "Neo-Cybernetic Mech Poster",
        "summary": "A cybernetic manga-tech poster with industrial graphics.",
        "target_model_mode": "text_to_image",
        "visual_analysis": {
            "medium": ["illustrated sci-fi character poster", "editorial poster treatment"],
            "palette": ["dark teal and oxidized green background", "burnt orange graphic labels"],
            "line_shape_language": ["angular mech limb geometry", "embedded interface graphics"],
            "composition": ["central cybernetic hero", "dense poster labels around the figure"],
            "subject_treatment": ["cybernetic warrior with reinforced mechanical torso"],
            "environment_props": ["industrial warning labels", "barcode blocks", "code markings"],
            "texture_lighting": ["scratched metal", "weathered poster grain"],
            "typography_text_energy": ["oversized vertical headline characters", "small alphanumeric callouts"],
            "mood": ["intense", "rebellious"],
        },
        "recommended_fields": [
            {"key": "location", "label": "Location", "required": True},
            {"key": "hero_brief", "label": "Hero Brief", "required": True},
        ],
        "source_specific_exclusions": ["exact source character identity", "exact source text"],
    }
    brief = build_reference_style_brief(
        user_text="Create me a text-to-image media preset from this image.",
        assistant_text=(
            "This looks like a cyber poster.\n"
            "Suggested setup:\n- Field: Location\n- Field: Hero Brief\n"
            f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={
            "title": "Neo-Cybernetic Mech Poster",
            "preset_contract": {
                "fields": [
                    {"key": "location", "label": "Location", "required": True},
                    {"key": "hero_brief", "label": "Hero Brief", "required": True},
                ],
                "image_slots": [],
            },
        },
        attachments=[],
    )

    field_keys = [field.key for field in brief.preset_contract.fields]

    assert "location" not in field_keys
    assert "main_character" in field_keys


def test_media_assistant_rejects_shallow_repeated_style_brief_as_not_concrete() -> None:
    proposal = {
        "title": "Single-Image Reference Preset",
        "description": "Create a reusable Media Preset with one runtime image input.",
        "preset_contract": {
            "model_hint": "image_edit",
            "fields": [{"key": "style_notes", "label": "Style Notes", "required": False}],
            "image_slots": [{"key": "personal_reference", "label": "Personal Reference", "required": True}],
        },
    }
    brief = build_reference_style_brief(
        user_text="Create an image-to-image sandbox from this reference.",
        assistant_text=(
            "This looks like `Editorial Portrait Silhouette Blended`. "
            "I would lock the style around: editorial portrait silhouette blended with scenic landmarks, "
            "warm sunrise haze, layered depth, and bold poster typography. "
            "Suggested fields: Pose / Framing, Style Notes. Image input: Personal Reference."
        ),
        proposal=proposal,
        attachments=[],
    )

    assert not has_concrete_style_traits(brief)
    assert compile_reference_style_prompt(brief) == ""


def test_media_assistant_provider_style_brief_marker_is_hidden_and_drives_sandbox_prompt(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style7.jpg")
    workflow = {"schema_version": 1, "name": "Structured style marker graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-structured-style-marker", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style7.jpg"})
    payload = {
        "title": "Double Exposure Travel Poster",
        "summary": "Poster portrait with destination scenery composited inside the subject silhouette.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["cinematic editorial travel poster", "double-exposure portrait composite"],
            "palette": ["cream paper background", "warm sunrise amber haze"],
            "line_shape_language": ["soft silhouette mask edges"],
            "composition": ["side-profile portrait silhouette", "landscape contained inside head and torso", "poster margins with footer icon row"],
            "subject_treatment": ["personal likeness becomes a scenic silhouette portrait"],
            "environment_props": ["Mount Fuji horizon", "temple architecture", "red torii gate", "cherry blossoms", "small traveler figure"],
            "texture_lighting": ["archival paper grain", "golden-hour backlight"],
            "typography_text_energy": ["large condensed destination title", "handwritten subtitle accent", "small uppercase travel labels"],
            "mood": ["premium wanderlust adventure poster"],
        },
    }

    def structured_provider_chat(**_kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "This looks like `Double Exposure Travel Poster`.\n"
                "I would use one Subject Image plus Destination / Theme and Poster Text.\n"
                "Create the sandbox with this contract?\n"
                f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "structured-style-marker-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", structured_provider_chat)
    client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Can you create an image-to-image media preset from these reference images?",
            "workflow": workflow,
            "assistant_mode": "preset",
            "metadata": {"preset_loop_lane": "image_to_image", "source": "guided_loop_ui"},
        },
    )
    intake_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create the image-to-image sandbox first. Use the attached style reference only as the style source. "
                "I want one user image input for the person or subject."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert intake_response.status_code == 200, intake_response.text
    assistant_message = intake_response.json()["messages"][-1]
    assert PROVIDER_BRIEF_JSON_OPEN not in assistant_message["content_text"]
    style_brief = intake_response.json()["summary_json"]["reference_style_brief"]
    assert style_brief["preset_direction"]["title"] == "Double Exposure Travel Poster"

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the temporary image-to-image sandbox now.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    prompt_node = next(node for node in plan_response.json()["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    assert "Double Exposure Travel Poster" in prompt_text
    assert "double-exposure portrait composite" in prompt_text
    assert "landscape contained inside head and torso" in prompt_text
    assert "Set the Destination / Theme as" in prompt_text
    assert "{{destination_theme}}" not in prompt_text
    assert "Set the Poster Text as" in prompt_text
    assert "{{poster_text}}" not in prompt_text
    assert "Mount Fuji horizon" not in prompt_text
    assert "large condensed destination title" in prompt_text


def test_media_assistant_graph_template_validation_reports_missing_contract(monkeypatch) -> None:
    bad_template_id = "bad_template_contract_test"
    monkeypatch.setitem(
        TEMPLATES,
        bad_template_id,
        AssistantGraphTemplate(
            template_id=bad_template_id,
            mode="text_to_image",
            purpose="Invalid template contract test",
            node_types=["utility.note", "missing.node_type", "prompt.text", "preview.image"],
            connections=[("prompt", "missing_output", "preview", "image")],
        ),
    )

    errors = validate_assistant_graph_templates([bad_template_id])

    assert any("missing node type missing.node_type" in error for error in errors)
    assert any("missing output port prompt.text.missing_output" in error for error in errors)


def test_media_assistant_image_sandbox_template_expands_runtime_image_inputs() -> None:
    plan = instantiate_preset_sandbox_template(
        template_id=I2I_SANDBOX_TEMPLATE_ID,
        base_x=120,
        title="Generic Product Style",
        prompt="Create an original stylized product scene.",
        model_type="model.kie.gpt_image_2_image_to_image",
        model_label="GPT Image 2 Image to Image",
        image_slots=[
            {"key": "subject_image", "label": "Subject Image"},
            {"key": "product_image", "label": "Product Image"},
            {"key": "background_image", "label": "Background Image"},
        ],
        text_fields=[{"key": "scene_brief", "label": "Scene Brief"}],
        warnings=[],
        style_reference_text_only=False,
    )

    loader_nodes = [operation for operation in plan.operations if operation.op == "add_node" and operation.node_type == "media.load_image"]
    image_connections = [operation for operation in plan.operations if operation.op == "connect_nodes" and operation.target_port == "image_refs"]
    assert plan.metadata["template_id"] == I2I_SANDBOX_TEMPLATE_ID
    assert plan.metadata["template_slot_count"] == 3
    assert [node.title for node in loader_nodes] == ["Subject Image", "Product Image", "Background Image"]
    assert len(image_connections) == 3


def test_media_assistant_new_sandbox_request_wins_over_existing_prompt_refinement() -> None:
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset with multiple runtime inputs.",
        assistant_text=(
            "Reusable direction: warm ochre palette, thick black ink outlines, hand-lettered wall typography, "
            "gritty paper texture, exaggerated cartoon character design, cluttered poster-room composition."
        ),
        proposal={
            "title": "Ink Poster Generator",
            "preset_contract": {
                "fields": [{"key": "scene_brief", "label": "Scene Brief", "required": True}],
                "image_slots": [{"key": "personal_reference", "label": "Personal Reference", "required": True}],
            },
        },
        attachments=[{"reference_id": "style-reference", "kind": "image"}],
    )
    workflow = GraphWorkflow(
        name="Existing sandbox prompt",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "old prompt"},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}, "assistant": {"semantic_ref": "prompt"}},
            }
        ],
        edges=[],
    )

    plan = plan_graph_from_message(
        (
            "Create a temporary sandbox image-to-image Media Preset with three runtime image inputs named "
            "Subject Image Product Image Background Image.\n\n"
            f"{encode_reference_style_brief_marker(brief)}"
        ),
        workflow,
        [{"reference_id": "style-reference", "kind": "image"}],
    )

    loader_nodes = [operation for operation in plan.operations if operation.op == "add_node" and operation.node_type == "media.load_image"]
    assert plan.metadata["template_id"] == I2I_SANDBOX_TEMPLATE_ID
    assert plan.metadata["template_slot_count"] == 3
    assert [node.title for node in loader_nodes] == ["Subject Image", "Product Image", "Background Image"]
    assert not any(operation.op == "set_node_field" for operation in plan.operations)


def _create_graph_output_asset(app_modules, *, run_id: str = "run-output-test", workflow_id: str = "workflow-output-test") -> tuple[str, str]:
    app_modules["store"].bootstrap_schema()
    data_root = app_modules["main"].settings.data_root
    target = data_root / "outputs" / f"{run_id}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(PNG_1X1_BYTES)
    app_modules["store"].create_graph_run(
        {
            "run_id": run_id,
            "workflow_id": workflow_id,
            "status": "completed",
            "workflow_json": {"schema_version": 1, "workflow_id": workflow_id, "name": "Output test", "nodes": [], "edges": []},
        },
        node_payloads=[
            {
                "node_id": "image-model",
                "node_type": "model.kie.nano_banana",
                "status": "completed",
            }
        ],
    )
    asset = app_modules["store"].create_or_update_asset(
        {
            "asset_id": f"asset-{run_id}",
            "job_id": f"job-{run_id}",
            "run_id": run_id,
            "model_key": "gpt-image-2",
            "generation_kind": "image",
            "status": "completed",
            "hero_original_path": f"outputs/{run_id}.png",
            "prompt_summary": "stylized character test output",
            "payload_json": {},
        }
    )
    app_modules["store"].create_graph_artifact(
        {
            "workflow_id": workflow_id,
            "run_id": run_id,
            "node_id": "image-model",
            "node_type": "model.kie.nano_banana",
            "output_port": "image",
            "kind": "image",
            "media_type": "image",
            "asset_id": asset["asset_id"],
        }
    )
    return run_id, str(target)


def test_media_assistant_provider_image_paths_prefer_generated_output_over_runtime_source(app_modules) -> None:
    app_modules["store"].bootstrap_schema()
    run_id = "run-output-source-order-test"
    workflow_id = "workflow-output-source-order-test"
    data_root = app_modules["main"].settings.data_root
    output_path = data_root / "outputs" / f"{run_id}.png"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(PNG_1X1_BYTES)
    source_reference_id = _create_reference_image(app_modules, name="runtime-source.jpg")
    style_reference_id = _create_reference_image(app_modules, name="style-reference.jpg")
    app_modules["store"].create_graph_run(
        {
            "run_id": run_id,
            "workflow_id": workflow_id,
            "status": "completed",
            "workflow_json": {"schema_version": 1, "workflow_id": workflow_id, "name": "Output source order", "nodes": [], "edges": []},
        },
        node_payloads=[
            {"node_id": "aaa-source", "node_type": "media.load_image", "status": "completed"},
            {"node_id": "image-model", "node_type": "model.kie.gpt_image_2_image_to_image", "status": "completed"},
        ],
    )
    app_modules["store"].create_graph_artifact(
        {
            "workflow_id": workflow_id,
            "run_id": run_id,
            "node_id": "aaa-source",
            "node_type": "media.load_image",
            "output_port": "image",
            "kind": "image",
            "media_type": "image",
            "reference_id": source_reference_id,
        }
    )
    asset = app_modules["store"].create_or_update_asset(
        {
            "asset_id": f"asset-{run_id}",
            "job_id": f"job-{run_id}",
            "run_id": run_id,
            "model_key": "gpt-image-2",
            "generation_kind": "image",
            "status": "completed",
            "hero_original_path": f"outputs/{run_id}.png",
            "prompt_summary": "generated stylized output",
            "payload_json": {},
        }
    )
    app_modules["store"].create_graph_artifact(
        {
            "workflow_id": workflow_id,
            "run_id": run_id,
            "node_id": "image-model",
            "node_type": "model.kie.gpt_image_2_image_to_image",
            "output_port": "image",
            "kind": "image",
            "media_type": "image",
            "asset_id": asset["asset_id"],
        }
    )
    assistant_context = importlib.import_module("app.assistant.context")
    assistant_provider_chat = importlib.import_module("app.assistant.provider_chat")
    context = assistant_context.build_assistant_context(None, [], run_id=run_id)
    style_reference = app_modules["store"].get_reference_media(style_reference_id)
    image_paths = assistant_provider_chat._assistant_image_paths(context, [{"reference_id": style_reference_id, "kind": "image", "label": "style ref"}])

    assert image_paths[0] == str(output_path)
    assert "runtime-source" not in image_paths[0]
    assert str(data_root / style_reference["stored_path"]) in image_paths[1:]


def test_media_assistant_creates_validated_graph_plan_and_applies_it(client, app_modules, monkeypatch) -> None:
    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": "I can build that as a reviewable image workflow plan.",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-thread-route",
            "usage": {"prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30},
            "prompt_tokens": 20,
            "completion_tokens": 10,
            "total_tokens": 30,
            "cost": None,
            "latency_ms": 12,
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    monkeypatch.setattr(
        "app.assistant.routes.run_provider_graph_plan",
        lambda **_kwargs: (_ for _ in ()).throw(provider_chat.AssistantProviderChatError("Codex planner unavailable.")),
    )
    reference_id = _create_reference_image(app_modules)
    workflow = {"schema_version": 1, "name": "Assistant scratch graph", "nodes": [], "edges": [], "metadata": {}}

    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-assistant-test", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]

    attachment_response = client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "Source portrait"},
    )
    assert attachment_response.status_code == 200, attachment_response.text
    assert attachment_response.json()["kind"] == "image"
    inspection_response = client.get(f"/media/assistant/sessions/{session_id}/media-inspection")
    assert inspection_response.status_code == 200, inspection_response.text
    assert inspection_response.json()["attachment_counts"]["image"] == 1
    assert inspection_response.json()["media_summary"][0]["reference_id"] == reference_id

    message_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "Create an image-to-image workflow using the source image.", "workflow": workflow},
    )
    assert message_response.status_code == 200, message_response.text
    assert [message["role"] for message in message_response.json()["messages"]] == ["user", "assistant"]
    assert message_response.json()["messages"][1]["content_text"] == "I can build that as a reviewable image workflow plan."
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    assert usage_rows[0]["provider_kind"] == "codex_local"
    assert usage_rows[0]["provider_response_id"] == "assistant-thread-route"
    assert usage_rows[0]["image_count"] == 1
    assert usage_rows[0]["token_input_count"] == 20
    assert usage_rows[0]["token_output_count"] == 10
    assert usage_rows[0]["usage_json"]["mode"] == "provider_chat"
    assert usage_rows[0]["usage_json"]["attachment_counts"] == {"image": 1, "video": 0, "audio": 0, "other": 0}
    skill_trace = usage_rows[0]["usage_json"]["skill_trace"]
    assert skill_trace["skill"] == "graph_workflow_builder"
    assert skill_trace["legacy_skill"] == "create_workflow"
    assert skill_trace["provider_called"] is True
    assert skill_trace["provider_response_id"] == "assistant-thread-route"
    assert skill_trace["input_image_count"] == 1
    assert skill_trace["intent_capability"] == "plan_graph"
    assert skill_trace["intent_confidence"] >= 0.8
    assert skill_trace["contract_validation"]["status"] == "not_applicable"

    debug_trace_response = client.get(f"/media/assistant/sessions/{session_id}/debug-trace")
    assert debug_trace_response.status_code == 200, debug_trace_response.text
    debug_trace_payload = debug_trace_response.json()
    assert debug_trace_payload["assistant_session_id"] == session_id
    assert any(item["skill_id"] == "media_preset_builder" for item in debug_trace_payload["skill_manifests"])
    assert debug_trace_payload["trace"][0]["skill"] == "graph_workflow_builder"
    assert debug_trace_payload["trace"][0]["provider_called"] is True
    assert debug_trace_payload["trace"][0]["intent_capability"] == "plan_graph"
    assert debug_trace_payload["trace"][0]["contract_validation"]["status"] == "not_applicable"
    assert "redacted_transcript" in debug_trace_payload

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={"message": "Create an image-to-image workflow using the source image.", "workflow": workflow},
    )
    assert plan_response.status_code == 200, plan_response.text
    plan_payload = plan_response.json()
    assert plan_payload["validation"]["valid"] is True
    assert plan_payload["plan"]["status"] == "validated"
    assert plan_payload["graph_plan"]["requires_confirmation"] is True
    node_types = {node["type"] for node in plan_payload["workflow"]["nodes"]}
    assert {"media.load_image", "prompt.text", "preview.image", "media.save_image"}.issubset(node_types)
    assert any(node["type"].startswith("model.kie.") for node in plan_payload["workflow"]["nodes"])
    source_node = next(node for node in plan_payload["workflow"]["nodes"] if node["type"] == "media.load_image")
    assert source_node["fields"]["reference_id"] == reference_id
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    assert usage_rows[0]["usage_json"]["mode"] == "deterministic_graph_plan"
    assert usage_rows[0]["usage_json"]["attachment_counts"]["image"] == 1

    current_workflow = {
        **workflow,
        "nodes": [
            {
                "id": "existing-note",
                "type": "utility.note",
                "position": {"x": -420, "y": 0},
                "fields": {"body": "Keep this existing work."},
                "metadata": {"ui": {"customTitle": "Existing note"}},
            }
        ],
    }
    apply_response = client.post(
        f"/media/assistant/plans/{plan_payload['plan']['assistant_plan_id']}/apply",
        json={"workflow": current_workflow},
    )
    assert apply_response.status_code == 200, apply_response.text
    assert apply_response.json()["validation"]["valid"] is True
    returned_nodes = apply_response.json()["workflow"]["nodes"]
    assert len(returned_nodes) == len(plan_payload["workflow"]["nodes"]) + 1
    assert any(node["id"] == "existing-note" for node in returned_nodes)
    applied_session = client.get(f"/media/assistant/sessions/{session_id}").json()
    assert [item["role"] for item in applied_session["messages"]] == ["user", "assistant", "system_summary"]
    assert applied_session["messages"][-1]["content_json"]["activity_kind"] == "graph_plan_applied"


def test_media_assistant_provider_chat_sends_reference_images_and_records_usage(client, app_modules, monkeypatch) -> None:
    del client
    reference_id = _create_reference_image(app_modules, name="provider-chat-reference.png")
    attachments = [
        {
            "assistant_attachment_id": "asatt_provider",
            "assistant_session_id": "asst_provider",
            "reference_id": reference_id,
            "kind": "image",
            "label": "Reference",
            "metadata_json": {},
        }
    ]
    captured = {}
    recorded_usage = {}

    def fake_codex_chat(**kwargs):
        captured["messages"] = kwargs["messages"]
        return {
            "provider_kind": "codex_local",
            "provider_model_id": kwargs["model_id"],
            "provider_base_url": "codex://app-server",
            "provider_response_id": "assistant-thread-native",
            "usage": {"prompt_tokens": 41, "completion_tokens": 9, "total_tokens": 50},
            "prompt_tokens": 41,
            "completion_tokens": 9,
            "total_tokens": 50,
            "cost": None,
            "generated_text": "The reference image is available for visual planning.",
            "warnings": [],
        }

    monkeypatch.setattr(provider_chat.enhancement_provider, "run_codex_local_chat", fake_codex_chat)
    monkeypatch.setattr(provider_chat.external_llm_usage, "record_external_llm_usage", lambda **kwargs: recorded_usage.update(kwargs))
    image_path = app_modules["main"].settings.data_root / "reference-media" / "images" / "provider-chat-reference.png"
    monkeypatch.setattr(provider_chat, "_attachment_image_paths", lambda _attachments: [str(image_path)])
    result = provider_chat.run_assistant_provider_chat(
        session={
            "assistant_session_id": "asst_provider",
            "owner_kind": "graph_workflow",
            "owner_id": "workflow-provider-chat",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
        },
        user_text="Describe the attached image for a graph plan.",
        context=build_assistant_context(GraphWorkflow(name="Provider chat", nodes=[], edges=[]), attachments),
        messages=[],
        attachments=attachments,
    )

    assert result["generated_text"] == "The reference image is available for visual planning."
    assert result["image_count"] == 1
    assert result["provider_image_path_count"] == 1
    assert result["provider_image_path_basenames"] == ["provider-chat-reference.png"]
    assert len(result["provider_image_path_hashes"]) == 1
    user_message = captured["messages"][-1]
    assert isinstance(user_message["content"], list)
    assert any(item.get("type") == "image_url" for item in user_message["content"])
    assert recorded_usage["provider_kind"] == "codex_local"
    assert recorded_usage["provider_response_id"] == "assistant-thread-native"
    assert recorded_usage["source_kind"] == "media_assistant_chat"
    assert recorded_usage["metadata_json"]["provider_image_path_count"] == 1
    assert recorded_usage["metadata_json"]["provider_image_path_basenames"] == ["provider-chat-reference.png"]
    assert recorded_usage["metadata_json"]["provider_image_path_hashes"] == result["provider_image_path_hashes"]


def test_media_assistant_message_falls_back_when_provider_chat_is_unavailable(client, monkeypatch) -> None:
    def unavailable_provider(**kwargs):
        raise provider_chat.AssistantProviderChatError("Codex Local is not logged in.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", unavailable_provider)
    workflow = {"schema_version": 1, "name": "Fallback graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-fallback-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "Can you help with this graph?", "workflow": workflow},
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert "into a workflow" in assistant_message["content_text"]
    assert "I need:" in assistant_message["content_text"]
    assert "built-in Media Studio workflow rules" in assistant_message["content_text"]
    assert "Native chat" not in assistant_message["content_text"]
    assert "Codex Local" not in assistant_message["content_text"]
    assert assistant_message["content_json"]["mode"] == "deterministic_fallback"
    assert assistant_message["content_json"]["intent_route"]["skill_id"] == "create_workflow"


def test_media_assistant_routes_corrected_contract_save_to_direct_preset_save(client) -> None:
    workflow = {"schema_version": 1, "name": "Corrected preset save routing", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-corrected-save-routing-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Save it again using the corrected image to image contract with one runtime person image "
                "and use the generated output as thumbnail."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_save_request"
    assert assistant_message["content_json"]["suggested_action"] == "save_media_preset"


def test_media_assistant_routes_temporary_sandbox_away_from_direct_preset_save(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Sandbox routing", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-sandbox-routing-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fake_provider_chat(**_kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": "I can create the temporary sandbox graph for review.",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "sandbox-routing-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Yes keep the person image required and create the temporary image to image sandbox now.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_sandbox_request"
    assert assistant_message["content_json"].get("suggested_action") == "create_graph_plan"
    assert "save the approved Media Preset" not in assistant_message["content_text"]


def test_media_assistant_build_from_refs_starter_stays_in_intake(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style-intake.jpg")
    workflow = {"schema_version": 1, "name": "Preset intake routing", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-preset-intake-routing-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style-intake.jpg"})

    def fake_provider_chat(**_kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Likely preset: `Cyberpunk Poster Restyle`. "
                "Style read: teal-and-orange cyberpunk poster with distressed print texture, vertical Japanese typography, and gritty HUD labels. "
                "Suggested fields: `Poster Theme` and `Overlay Text`. "
                "Question: should this use one Source Image input?"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "preset-intake-routing-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "I attached reference images and want to turn their visual style into a reusable Media Preset. I am not sure what image inputs or editable fields I need. Guide me with short questions first before creating a test graph.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "provider_chat"
    assert assistant_message["content_json"].get("suggested_action") is None
    assert "prepare the reviewable sandbox plan" not in assistant_message["content_text"]


def test_media_assistant_general_creative_question_uses_provider_chat_without_auto_action(client, monkeypatch) -> None:
    captured_context: dict[str, object] = {}
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-general-creative-question",
        "name": "General creative question",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Create a cinematic double-exposure travel poster portrait."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-general-creative-question", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fake_provider_chat(**kwargs):
        captured_context.update(kwargs["context"])
        return {
            "mode": "provider_chat",
            "generated_text": (
                "For this preset, I would make the mood more cinematic by deepening the background contrast, "
                "keeping the portrait silhouette clean, and letting the typography stay secondary instead of adding more fields."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "general-creative-question",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "What mood would make this preset feel more cinematic without changing the core style?",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert captured_context["assistant_prompt_route"] == "general"
    assert assistant_message["content_json"]["mode"] == "provider_chat"
    assert assistant_message["content_json"]["assistant_prompt_route"] == "general"
    assert assistant_message["content_json"].get("suggested_action") is None
    assert assistant_message["content_json"].get("preset_builder_proposal") is None
    assert "more cinematic" in assistant_message["content_text"]
    assert "reviewable test workflow" not in assistant_message["content_text"]
    assert "save the approved Media Preset" not in assistant_message["content_text"]


def test_media_assistant_try_again_create_preset_does_not_route_to_save(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style-retry-intake.jpg")
    workflow = {"schema_version": 1, "name": "Preset retry intake routing", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-preset-retry-intake-routing-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "style-retry-intake.jpg"},
    )
    called = {"provider": False}

    def fake_provider_chat(**_kwargs):
        called["provider"] = True
        return {
            "mode": "provider_chat",
            "generated_text": (
                "This looks like `Layered Editorial Poster`. "
                "I would use one Subject Image input and one Location field. Create a test workflow?"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "preset-retry-intake-routing-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Try again: create a media preset from this reference image as image-to-image. Use one useful input image and only the fields that actually help.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert called["provider"] is True, assistant_message
    assert assistant_message["content_json"].get("suggested_action") != "save_media_preset"
    assert "save the approved Media Preset" not in assistant_message["content_text"]
    assert "test workflow" in assistant_message["content_text"]


def test_media_assistant_context_redacts_sensitive_paths() -> None:
    workflow = GraphWorkflow(
        name="Redaction",
        nodes=[
            {
                "id": "node-1",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "text": "safe",
                    "api_key": "secret-value",
                    "local_path": "/Users/person/private/image.png",
                },
            }
        ],
        edges=[],
    )

    context = build_assistant_context(workflow, [{"reference_id": "ref_1", "metadata_json": {"source_path": "/Users/person/private.png"}}])
    redacted = redact_context(
        {
            "api_key": "secret-value",
            "nested": {"local_path": "/Users/person/private/image.png"},
            "items": [{"access_token": "hidden"}],
        }
    )

    assert context["workflow"]["node_count"] == 1
    assert redacted["api_key"] == "[redacted]"
    assert redacted["nested"]["local_path"] == "[local-path-redacted]"
    assert redacted["items"][0]["access_token"] == "[redacted]"


def test_media_assistant_context_includes_compact_canvas_snapshot() -> None:
    workflow = GraphWorkflow(name="Canvas aware", nodes=[], edges=[])
    context = build_assistant_context(
        workflow,
        [],
        canvas_context={
            "workflow_name": "Sadis Adventures",
            "node_count": 2,
            "edge_count": 1,
            "nodes": [
                {
                    "id": "character",
                    "type": "media.load_image",
                    "title": "Character Sheet Ref",
                    "position": {"x": 100, "y": 50},
                    "field_keys": ["image", "api_key"],
                    "prompt_summaries": [],
                    "media_refs": [{"field": "image", "reference_id": "ref-character"}],
                }
            ],
            "edges": [{"id": "edge-1", "source": "character", "source_port": "image", "target": "recipe", "target_port": "reference_image"}],
            "groups": [{"id": "group-1", "title": "Storyboard 1", "node_ids": ["character"], "bounds": {"x": 60, "y": 0, "width": 820, "height": 420}}],
            "layout": {"next_section_hint": {"x": 1260, "y": 0}},
        },
    )

    canvas_context = context["canvas_context"]
    assert canvas_context["workflow_name"] == "Sadis Adventures"
    assert canvas_context["node_count"] == 2
    assert canvas_context["nodes"][0]["title"] == "Character Sheet Ref"
    assert canvas_context["nodes"][0]["media_refs"][0]["reference_id"] == "ref-character"
    assert canvas_context["groups"][0]["title"] == "Storyboard 1"
    assert canvas_context["layout"]["next_section_hint"] == {"x": 1260.0, "y": 0.0}


def test_media_assistant_canvas_inventory_reply_uses_canvas_snapshot() -> None:
    reply = compact_canvas_context(
        {
            "workflow_name": "Sadis Adventures",
            "node_count": 2,
            "edge_count": 1,
            "nodes": [
                {"id": "character", "type": "media.load_image", "title": "Character Sheet Ref", "position": {"x": 0, "y": 0}},
                {"id": "recipe", "type": "prompt.recipe", "title": "Storyboard 1 Recipe", "position": {"x": 420, "y": 0}},
            ],
            "groups": [{"id": "group-storyboard-1", "title": "Storyboard 1", "node_ids": ["character", "recipe"]}],
        }
    )

    from app.assistant.canvas_context import canvas_inventory_reply

    text, metadata = canvas_inventory_reply("Chat text only: what exact node titles are on the current canvas?", reply)

    assert "Sadis Adventures" in text
    assert "Character Sheet Ref" in text
    assert "Storyboard 1 Recipe" in text
    assert metadata["canvas_context_used"] is True
    assert metadata["mode"] == "deterministic_canvas_inventory"


def test_media_assistant_canvas_inventory_reply_handles_concise_storyboard_question() -> None:
    reply = compact_canvas_context(
        {
            "workflow_name": "Sadis Adventures",
            "node_count": 5,
            "edge_count": 3,
            "nodes": [
                {"id": "character", "type": "media.load_image", "title": "Character Sheet Ref", "position": {"x": 0, "y": 0}},
                {"id": "recipe", "type": "prompt.recipe", "title": "Storyboard 1 Recipe", "position": {"x": 420, "y": 0}},
                {"id": "gpt", "type": "image.gpt", "title": "Storyboard 1 GPT", "position": {"x": 840, "y": 0}},
                {"id": "save", "type": "media.save_image", "title": "Storyboard 1 Save", "position": {"x": 1260, "y": 0}},
                {"id": "preview", "type": "preview.image", "title": "Storyboard 1 Preview", "position": {"x": 1680, "y": 0}},
            ],
            "groups": [{"id": "group-storyboard-1", "title": "Story Board 1", "node_ids": ["recipe", "gpt", "save", "preview"]}],
        }
    )

    from app.assistant.canvas_context import canvas_inventory_reply

    result = canvas_inventory_reply(
        "After the tab switch fix, final graph-mode check: what graph and storyboard nodes do you see? Keep it short.",
        reply,
    )

    assert result is not None
    text, metadata = result
    assert "I see `Sadis Adventures` with 5 nodes and 3 edges." in text
    assert "Character/reference anchor:\n- Character Sheet Ref" in text
    assert "Storyboard groups:\n- Story Board 1: 4 nodes" in text
    assert "Storyboard nodes:\n- Storyboard 1: Recipe, GPT, Save, Preview" in text
    assert "I can give the full node list if you want it." in text
    assert metadata["reply_style"] == "concise"
    assert metadata["mode"] == "deterministic_canvas_inventory"


def test_media_assistant_context_can_include_latest_run_output(app_modules) -> None:
    run_id, output_path = _create_graph_output_asset(app_modules)
    workflow = GraphWorkflow(name="Output aware", nodes=[], edges=[])
    context_module = importlib.import_module("app.assistant.context")
    provider_chat_module = importlib.import_module("app.assistant.provider_chat")

    context = context_module.build_assistant_context(workflow, [], run_id=run_id)
    image_paths = provider_chat_module._assistant_image_paths(context, [])

    assert context["latest_graph_run"]["run_id"] == run_id
    assert context["latest_graph_run"]["status"] == "completed"
    assert context["latest_graph_run"]["artifacts"][0]["asset_id"] == f"asset-{run_id}"
    assert output_path in image_paths


def test_media_assistant_message_passes_latest_run_context(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(app_modules, run_id="run-assistant-chat-output", workflow_id="workflow-assistant-chat-output")
    captured: dict = {}

    def fake_provider_chat(**kwargs):
        captured["context"] = kwargs["context"]
        return {
            "mode": "provider_chat",
            "generated_text": "I can compare the latest output against the attached references and suggest a tighter preset test.",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-output-context",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    workflow = {"schema_version": 1, "workflow_id": "workflow-assistant-chat-output", "name": "Output chat graph", "nodes": [], "edges": []}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-assistant-chat-output", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "This did not turn out as well. What should we adjust?", "workflow": workflow, "run_id": run_id},
    )

    assert response.status_code == 200, response.text
    assert captured["context"]["latest_graph_run"]["run_id"] == run_id
    assert captured["context"]["latest_graph_run"]["artifacts"][0]["prompt_summary"] == "stylized character test output"


def test_media_assistant_message_answers_canvas_inventory_without_provider(client, monkeypatch) -> None:
    def fail_provider_chat(**_kwargs):
        raise AssertionError("Canvas inventory should be answered from the supplied canvas snapshot.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-canvas-inventory",
        "name": "Sadis Adventures",
        "nodes": [],
        "edges": [],
        "metadata": {},
    }
    canvas_context = {
        "workflow_id": "workflow-canvas-inventory",
        "workflow_name": "Sadis Adventures",
        "node_count": 2,
        "edge_count": 1,
        "nodes": [
            {"id": "character", "type": "media.load_image", "title": "Character Sheet Ref", "position": {"x": 0, "y": 0}},
            {"id": "recipe", "type": "prompt.recipe", "title": "Storyboard 1 Recipe", "position": {"x": 420, "y": 0}},
        ],
        "groups": [{"id": "group-storyboard-1", "title": "Storyboard 1", "node_ids": ["character", "recipe"]}],
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-canvas-inventory", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Chat text only: what exact node titles are on the current canvas?",
            "workflow": workflow,
            "canvas_context": canvas_context,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_canvas_inventory"
    assert assistant_message["content_json"]["assistant_response_kind"] == "answer"
    assert "Character Sheet Ref" in assistant_message["content_text"]
    assert "Storyboard 1 Recipe" in assistant_message["content_text"]


def test_media_assistant_reviews_current_workflow_without_creating_variants(client, monkeypatch) -> None:
    def fail_provider_chat(**_kwargs):
        raise AssertionError("Workflow review should be answered from the supplied canvas snapshot.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-character-sheet-v3-review",
        "name": "Character Sheet v3 RPG Acceptance",
        "nodes": [],
        "edges": [],
        "metadata": {},
    }
    canvas_context = {
        "workflow_id": "workflow-character-sheet-v3-review",
        "workflow_name": "Character Sheet v3 RPG Acceptance",
        "node_count": 4,
        "edge_count": 3,
        "nodes": [
            {"id": "sadi_recipe", "type": "prompt.recipe", "title": "Character Sheet v3 - Sadi RPG Fantasy"},
            {"id": "sadi_model", "type": "model.kie.gpt_image_2_image_to_image", "title": "Sadi GPT Image 2"},
            {"id": "steve_recipe", "type": "prompt.recipe", "title": "Character Sheet v3 - Steve RPG Fantasy"},
            {"id": "steve_model", "type": "model.kie.gpt_image_2_image_to_image", "title": "Steve GPT Image 2"},
        ],
        "groups": [
            {"id": "sadi", "title": "Sadi Character Sheet v3", "node_ids": ["sadi_recipe", "sadi_model"]},
            {"id": "steve", "title": "Steve Character Sheet v3", "node_ids": ["steve_recipe", "steve_model"]},
        ],
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-v3-review", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Review this workflow before I run it. Confirm the Character Sheet v3 branches.",
            "workflow": workflow,
            "canvas_context": canvas_context,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_canvas_inventory"
    assert assistant_message["content_json"]["assistant_response_kind"] == "answer"
    assert "Character Sheet v3 - Sadi RPG Fantasy" in assistant_message["content_text"]
    assert "Character Sheet v3 - Steve RPG Fantasy" in assistant_message["content_text"]
    assert "I can build Character Sheet variants" not in assistant_message["content_text"]


def test_media_assistant_persists_compact_reference_style_contract(client, app_modules, monkeypatch) -> None:
    def fake_provider_chat(**_kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": "I can turn these into a compact preset proposal.",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-style-contract",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    first_reference_id = _create_reference_image(app_modules, name="skater-style-face.jpg")
    second_reference_id = _create_reference_image(app_modules, name="skater-style-body.jpg")
    workflow = {"schema_version": 1, "workflow_id": "workflow-style-contract", "name": "Style contract", "nodes": [], "edges": []}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style-contract", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    for reference_id in (first_reference_id, second_reference_id):
        attach_response = client.post(
            f"/media/assistant/sessions/{session_id}/attachments",
            json={"reference_id": reference_id, "label": "skater reference"},
        )
        assert attach_response.status_code == 200, attach_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Turn these skater references into a Media Preset with two input images, face and body.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    contract = payload["summary_json"]["reference_style_contract"]
    assert contract["title"] == "Multi-Image Reference Preset"
    assert contract["style"] == "Reference-driven visual preset"
    assert [slot["key"] for slot in contract["image_slots"]] == ["face_reference", "body_reference"]
    assert [slot["label"] for slot in contract["image_slots"]] == ["Face Reference", "Body Reference"]
    assert len(contract["attachment_refs"]) == 2
    assert payload["messages"][-1]["content_json"]["reference_style_contract"]["title"] == "Multi-Image Reference Preset"


def test_media_assistant_infers_human_named_face_body_image_slots() -> None:
    slots = infer_runtime_image_slots_from_text(
        "Create a preset from this image with two input images, one as a face and one as a body."
    )
    assert [slot["key"] for slot in slots] == ["face_reference", "body_reference"]
    assert [slot["label"] for slot in slots] == ["Face Reference", "Body Reference"]

    shorthand_slots = infer_runtime_image_slots_from_text(
        "Create this as a Media Preset with face and body inputs."
    )
    assert [slot["key"] for slot in shorthand_slots] == ["face_reference", "body_reference"]


def test_media_assistant_enforces_image_attachment_limit(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Assistant limits", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-assistant-limit-test", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]

    for index in range(ASSISTANT_IMAGE_ATTACHMENT_LIMIT):
        reference_id = _create_reference_image(app_modules, name=f"assistant-ref-{index}.png")
        response = client.post(
            f"/media/assistant/sessions/{session_id}/attachments",
            json={"reference_id": reference_id, "label": f"Reference {index + 1}"},
        )
        assert response.status_code == 200, response.text

    overflow_reference_id = _create_reference_image(app_modules, name="assistant-ref-overflow.png")
    overflow_response = client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": overflow_reference_id, "label": "Overflow"},
    )
    assert overflow_response.status_code == 400
    assert f"at most {ASSISTANT_IMAGE_ATTACHMENT_LIMIT} image reference" in overflow_response.json()["detail"]


def test_media_assistant_drafts_prompt_recipe_without_saving(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules, name="recipe-reference.png")
    workflow = {"schema_version": 1, "name": "Recipe draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-recipe-draft-test", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "Reference"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/recipe-drafts",
        json={"message": "Create a cinematic portrait prompt recipe from this image."},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["capability"] == "draft_prompt_recipe"
    assert payload["review_url"].startswith(f"/presets/prompt-recipes/new?assistantSession={session_id}&assistantMessage=")
    assert payload["draft"]["status"] == "active"
    assert payload["draft"]["image_input_json"]["enabled"] is True
    assert payload["media_summary"][0]["reference_id"] == reference_id
    session_payload = client.get(f"/media/assistant/sessions/{session_id}").json()
    assert session_payload["messages"][0]["role"] == "user"
    assert session_payload["messages"][0]["content_text"] == "Create a cinematic portrait prompt recipe from this image."
    review_message = next(
        item for item in session_payload["messages"] if item["assistant_message_id"] == payload["review_url"].split("assistantMessage=", 1)[1]
    )
    assert review_message["role"] == "system_summary"
    assert review_message["content_json"]["review_draft"]["kind"] == "prompt_recipe"
    assert review_message["content_json"]["review_draft"]["draft"]["key"] == payload["draft"]["key"]
    assert app_modules["store"].get_prompt_recipe_by_key(payload["draft"]["key"]) is None


def test_media_assistant_drafts_storyboard_recipe_with_review_fields(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Storyboard draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-storyboard-draft-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/recipe-drafts",
        json={"message": "Build a storyboard generator recipe from this image style."},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["image_input_json"]["enabled"] is True
    assert [field["key"] for field in payload["draft"]["custom_fields_json"]] == ["layout_notes", "detail_notes"]


def test_media_assistant_drafts_storyboard_v2_prompt_shell_contract(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Storyboard v2 draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-storyboard-v2-draft-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    message = (
        "Create the actual Storyboard v2 Prompt Recipe draft now. Do not run, save, submit, upload, delete, import, or export anything.\n\n"
        "Base prompt shell:\n"
        "Create a high-quality 3x2 cinematic storyboard sheet from the creative direction in {user_prompt}. "
        "Use [image reference 1] as the facial lock / identity reference and [image reference 2] as the character sheet / body, outfit, and style reference.\n\n"
        "CAMERA / DIRECTOR LANGUAGE:\n"
        "Each cell must include SHOT, CAMERA, FRAMING, ACTION, MOTION, DIALOG, and NOTES.\n\n"
        "OUTPUT FORMAT:\n"
        "A single 4K-quality 3x2 cinematic storyboard sheet."
    )

    response = client.post(f"/media/assistant/sessions/{session_id}/recipe-drafts", json={"message": message})

    assert response.status_code == 200, response.text
    payload = response.json()
    draft = payload["draft"]
    assert draft["label"] == "Storyboard v2"
    assert draft["category"] == "image"
    assert draft["output_format"] == "single_prompt"
    assert draft["image_input_json"] == {
        "enabled": True,
        "required": True,
        "mode": "direct_reference",
        "analysis_variable": "image_analysis",
        "max_files": 4,
    }
    assert [item["key"] for item in draft["input_variables_json"]] == ["user_prompt", "style_direction", "previous_output"]
    assert draft["custom_fields_json"] == []
    assert "{{user_prompt}}" in draft["system_prompt_template"]
    assert "{{{user_prompt}}}" not in draft["system_prompt_template"]
    assert "3x2 cinematic storyboard sheet" in draft["system_prompt_template"]
    assert "[image reference 1] is face / identity lock" in draft["system_prompt_template"]
    assert "[image reference 2] is character sheet / body / outfit / design lock" in draft["system_prompt_template"]
    assert "additional references" in draft["system_prompt_template"].lower()
    assert "one compact story segment" in draft["system_prompt_template"]
    assert "readable below-image metadata strip" in draft["system_prompt_template"]
    assert "SHOT, CAMERA, FRAMING, ACTION, MOTION, DIALOG" in draft["system_prompt_template"]
    assert "what the character, important item, prop, creature, vehicle, or scene element is doing" in draft["system_prompt_template"]
    assert "DIALOG should stay blank after the colon when no spoken line is needed" in draft["system_prompt_template"]
    assert "Do not jump from a problem state to a solved state" in draft["system_prompt_template"]
    assert "reserve one panel or a clear ACTION/MOTION/NOTES bridge" in draft["system_prompt_template"]
    assert draft["version"] == "2.3"
    assert app_modules["store"].get_prompt_recipe_by_key(draft["key"]) is None


def test_media_assistant_drafts_character_sheet_recipe_contract(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Character Sheet recipe draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-recipe-draft-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/recipe-drafts",
        json={"message": "Create the Character Sheet v1 prompt recipe for face/body/extras refs."},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["key"] == "character_sheet_reference_v1"
    assert payload["draft"]["label"] == "Character Sheet v1"
    assert payload["draft"]["image_input_json"]["mode"] == "direct_reference"
    assert payload["draft"]["image_input_json"]["max_files"] == 4
    assert "{{reference_role_block}}" in payload["draft"]["system_prompt_template"]
    assert [field["key"] for field in payload["draft"]["custom_fields_json"]] == ["background_mode"]
    assert app_modules["store"].get_prompt_recipe_by_key("character_sheet_reference_v1") is None


def test_media_assistant_drafts_prompt_recipe_with_explicit_fields(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Recipe explicit fields", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-recipe-explicit-fields-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/recipe-drafts",
        json={"message": "Create a text-only prompt recipe. Fields: Scene / Subject and Headline / Slogan."},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["image_input_json"]["enabled"] is False
    assert [field["key"] for field in payload["draft"]["custom_fields_json"]] == ["scene_subject", "headline_slogan"]
    assert "{{scene_subject}}" in payload["draft"]["system_prompt_template"]
    assert "{{headline_slogan}}" in payload["draft"]["system_prompt_template"]


def test_media_assistant_drafts_prompt_recipe_respects_no_runtime_image_with_attachment(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules, name="recipe-style-ref.png")
    workflow = {"schema_version": 1, "name": "Recipe no runtime image", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-recipe-no-runtime-image-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "Style reference"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/recipe-drafts",
        json={
            "message": (
                "Create a text-only prompt recipe from this attached style reference. "
                "No runtime image input. Fields: Scene / Subject and Headline / Slogan."
            )
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["image_input_json"]["enabled"] is False
    assert "{{image_analysis}}" not in payload["draft"]["system_prompt_template"]
    assert [field["key"] for field in payload["draft"]["custom_fields_json"]] == ["scene_subject", "headline_slogan"]


def test_media_assistant_drafts_media_preset_without_saving(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Preset draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-preset-draft-test", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-drafts",
        json={"message": "Create a neon editorial poster preset."},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["capability"] == "draft_media_preset"
    assert payload["review_url"].startswith(f"/presets/new?assistantSession={session_id}&assistantMessage=")
    assert payload["draft"]["status"] == "active"
    assert payload["draft"]["input_schema_json"][0]["key"] == "creative_brief"
    assert payload["draft"]["applies_to_models"]
    session_payload = client.get(f"/media/assistant/sessions/{session_id}").json()
    assert session_payload["messages"][0]["role"] == "user"
    assert session_payload["messages"][0]["content_text"] == "Create a neon editorial poster preset."
    review_message = next(
        item for item in session_payload["messages"] if item["assistant_message_id"] == payload["review_url"].split("assistantMessage=", 1)[1]
    )
    assert review_message["role"] == "system_summary"
    assert review_message["content_json"]["review_draft"]["kind"] == "media_preset"
    assert review_message["content_json"]["review_draft"]["draft"]["key"] == payload["draft"]["key"]
    assert app_modules["store"].get_preset_by_key(payload["draft"]["key"]) is None


def test_media_assistant_drafts_product_preset_with_requested_fields(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Product preset draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-product-preset-draft-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-drafts",
        json={
            "message": (
                "Draft a Media Preset called Neon Product Poster. It should create a polished neon cyberpunk product poster "
                "from a product name, product details, and one optional reference image."
            )
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["label"] == "Neon Product Poster"
    assert payload["draft"]["model_key"] == "nano-banana-2"
    assert payload["draft"]["applies_to_models"] == ["nano-banana-2"]
    assert [field["key"] for field in payload["draft"]["input_schema_json"]] == ["product_name", "product_details"]
    assert payload["draft"]["input_slots_json"][0]["key"] == "reference_image"
    assert payload["draft"]["input_slots_json"][0]["required"] is False
    assert "{{product_name}}" in payload["draft"]["prompt_template"]
    assert "{{product_details}}" in payload["draft"]["prompt_template"]
    assert "[[reference_image]]" in payload["draft"]["prompt_template"]


def test_media_assistant_drafts_reference_car_ad_preset_with_one_field(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules, name="car-ad-reference.png")
    workflow = {"schema_version": 1, "name": "Car poster preset draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-car-preset-draft-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "Car ad"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-drafts",
        json={
            "message": (
                "Create a reusable Media Preset from the attached vintage car advertisement reference. "
                "Recreate the full poster system one-for-one with different cars. "
                "Keep the preset simple: expose only one field named car name."
            )
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["label"].startswith("Create a reusable Media Preset")
    assert payload["draft"]["input_schema_json"] == [
        {
            "key": "car_name",
            "label": "Car Name",
            "placeholder": "Car Name.",
            "default_value": "",
            "required": True,
        }
    ]
    assert payload["draft"]["input_slots_json"] == []
    assert "{{car_name}}" in payload["draft"]["prompt_template"]


def test_media_assistant_drafts_character_sheet_preset_from_attached_reference(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules, name="character-sheet-reference.png")
    workflow = {"schema_version": 1, "name": "Character sheet preset draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-preset-draft-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "Character sheet"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-drafts",
        json={
            "message": (
                "Use the attached character sheet image as the style reference. Build a storyboard-style Media Preset "
                "for our own characters. It should accept two optional grounding images: image 1 is a face reference, "
                "image 2 is a full-body reference. Add fields for clothing or outfit, background or environment, and "
                "panel story notes."
            )
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["label"] == "Multi-Image Reference Preset"
    assert [field["key"] for field in payload["draft"]["input_schema_json"]] == [
        "clothing_or_outfit",
        "background_or_environment",
        "panel_story_notes",
    ]
    assert [slot["key"] for slot in payload["draft"]["input_slots_json"]] == [
        "image_input_1",
        "image_input_2",
    ]
    assert all(slot["required"] is True for slot in payload["draft"]["input_slots_json"])
    assert "[[image_input_1]]" in payload["draft"]["prompt_template"]
    assert "[[image_input_2]]" in payload["draft"]["prompt_template"]
    assert "{{clothing_or_outfit}}" in payload["draft"]["prompt_template"]
    assert "{{background_or_environment}}" in payload["draft"]["prompt_template"]
    assert "{{panel_story_notes}}" in payload["draft"]["prompt_template"]
    assert "[[reference_image]]" not in payload["draft"]["prompt_template"]
    assert "baked-in extracted style direction" not in payload["draft"]["prompt_template"]


def test_media_assistant_preset_builder_chat_stays_compact_for_reference_images(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="skate1.jpg")
    workflow = {"schema_version": 1, "name": "Skate preset chat graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-skate-preset-chat-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "skate1.jpg"})

    def verbose_provider(**kwargs):
        return {
            "generated_text": "Prompt Template:\n```text\n" + ("large prompt details " * 90) + "\n```",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "compact-preset-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", verbose_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "Turn these uploaded skater references into a Media Preset with two input images.", "workflow": workflow},
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["role"] == "assistant"
    assert len(assistant_message["content_text"]) < 700
    assert "full prompt" not in assistant_message["content_text"].lower()
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    assert proposal["title"] == "Multi-Image Reference Preset"
    assert [slot["key"] for slot in proposal["preset_contract"]["image_slots"]] == ["image_input_1", "image_input_2"]
    assert assistant_message["content_json"]["provider_reply_suppressed"] is True


def test_media_assistant_compacts_preset_builder_model_selection_drift(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="skate-model-drift.jpg")
    workflow = {"schema_version": 1, "name": "Skate preset model drift graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-skate-model-drift-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "skate-model-drift.jpg"})

    def model_first_provider(**kwargs):
        return {
            "generated_text": "Use nano-banana-2 as the target model? Then I can make the preset.",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "compact-model-drift-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", model_first_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "Turn these skater references into a Media Preset with face and body inputs.", "workflow": workflow},
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert "nano" not in assistant_message["content_text"].lower()
    assert "target model" not in assistant_message["content_text"].lower()
    assert assistant_message["content_json"]["provider_reply_suppressed"] is True


def test_media_assistant_reference_style_contract_defaults_to_text_only_style_extraction(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style1.jpg")
    workflow = {"schema_version": 1, "name": "Reference style preset chat graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-reference-style-contract-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style1.jpg"})

    def verbose_provider(**kwargs):
        return {
            "generated_text": "Prompt Template:\n```text\n" + ("large prompt details " * 90) + "\n```",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "reference-style-contract-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", verbose_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Turn this attached reference style into a reusable Media Preset for future images. "
                "Recommend minimal useful image input and form fields."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    contract = proposal["preset_contract"]
    assert proposal["title"] == "Reference Style Preset"
    assert contract["image_slots"] == []
    assert contract["fields"] == []
    assert "style sources only" in assistant_message["content_text"]
    assert "Subject Reference" not in assistant_message["content_text"]


def test_media_assistant_reference_style_uses_high_signal_location_field(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style7-double-exposure.jpg")
    workflow = {"schema_version": 1, "name": "Location field reference style graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style7-location-field-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style7.jpg"})

    provider_payload = {
        "title": "Double-Exposure Travel Poster Portrait",
        "summary": "A portrait-led travel poster style with destination imagery blended through the subject.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["cinematic travel poster photo-composite"],
            "palette": ["warm peach sunrise gradients with soft teal shadows"],
            "line_shape_language": ["soft double-exposure silhouettes and clean poster geometry"],
            "composition": ["large centered portrait with landmarks layered inside the head and torso"],
            "subject_treatment": ["recognizable personal portrait adapted into editorial poster art"],
            "environment_props": ["destination landmarks, map-like overlays, and atmospheric travel details"],
            "texture_lighting": ["glowing sunrise haze, film grain, and polished magazine finish"],
            "typography_text_energy": ["minimal destination poster typography energy"],
            "mood": ["aspirational cinematic travel mood"],
        },
        "fixed_style_traits": [
            "double-exposure portrait composite",
            "destination landmarks blended through the subject",
            "warm sunrise travel-poster palette",
            "polished editorial poster finish",
        ],
        "replaceable_elements": ["person reference image", "destination location"],
        "source_specific_exclusions": ["exact landmark arrangement", "exact source face", "readable source text"],
        "recommended_fields": [
            {
                "key": "location",
                "label": "Location",
                "purpose": "Destination, city, or landmark that controls the double-exposure travel imagery.",
                "required": True,
            }
        ],
        "recommended_image_slots": [
            {
                "key": "person_reference",
                "label": "Person Reference",
                "purpose": "User-provided person image to preserve as the poster subject.",
                "required": True,
            }
        ],
        "verification_targets": {
            "must_match": ["double-exposure portrait", "travel-poster composition", "warm sunrise palette"],
            "may_vary": ["exact destination", "exact typography"],
            "must_not_copy": ["source text", "exact source layout"],
        },
    }

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "This looks like `Double-Exposure Travel Poster Portrait`. "
                "I would use one person image and a Location field. Create the sandbox?"
                f"\n{PROVIDER_BRIEF_JSON_OPEN} {json.dumps(provider_payload)} {PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "style7-location-field-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Can you create an image-to-image media preset from this reference image?",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    contract = proposal["preset_contract"]
    assert [field["key"] for field in contract["fields"]] == ["location"]
    assert [slot["key"] for slot in contract["image_slots"]] == ["person_reference"]
    assert "Useful fields: Location" in assistant_message["content_text"]
    assert "Scene Brief" not in assistant_message["content_text"]
    assert "Optional Detail Notes" not in assistant_message["content_text"]

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the test workflow now with the suggested setup. Treat attached reference images as style sources only and compile the style into the prompt.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    plan_payload = plan_response.json()
    prompt_node = next(node for node in plan_payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    loader_titles = {node["metadata"]["ui"]["customTitle"] for node in plan_payload["workflow"]["nodes"] if node["type"] == "media.load_image"}
    assert "Person Reference" in loader_titles
    assert "Set the Location as" in prompt_text
    assert "{{location}}" not in prompt_text
    assert "destination, route, landmark set, or scenic theme" in prompt_text
    assert "Pose / Framing" not in prompt_text
    assert "Style Notes" not in prompt_text
    assert "Scene Brief" not in prompt_text
    assert "Optional Detail Notes" not in prompt_text


def test_reference_style_prompt_tokenizes_location_fields_without_locking_source_landmarks() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_style7_generic_location",
        preset_direction=ReferenceStylePresetDirection(
            title="Cinematic Double-Exposure Travel Poster",
            target_model_mode="image_edit",
        ),
        visual_analysis={
            "medium": ["photo-based double-exposure poster composition", "editorial travel advertisement treatment"],
            "palette": ["warm sunrise peach and amber highlights", "muted cream paper background"],
            "line_shape_language": ["clean side-profile silhouette used as the main mask"],
            "composition": [
                "tall poster aspect with a single dominant portrait",
                "landscape scenes nested inside the head and torso silhouette",
                "large title block anchored across the lower third",
            ],
            "subject_treatment": ["adult subject shown in thoughtful side profile"],
            "environment_props": [
                "snow-capped mountain resembling Mount Fuji",
                "traditional Japanese temple structures",
                "red torii gate",
                "cherry blossoms and lanterns",
                "stone path with a lone traveler figure",
            ],
            "texture_lighting": ["golden-hour backlight and sky glow", "soft haze and subtle paper-poster grain"],
            "typography_text_energy": ["bold condensed uppercase main title", "flowing script subtitle"],
            "mood": ["reflective and aspirational cinematic travel discovery energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="poster_title", label="Poster Title", required=True),
                ReferenceStylePresetField(key="destination_landmark_set", label="Destination / Landmark Set", required=True),
                ReferenceStylePresetField(key="tagline_mood", label="Tagline / Mood", required=False),
            ],
            image_slots=[ReferenceStyleImageSlot(key="portrait", label="Portrait", required=True)],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=[
                "side-profile portrait used as a double-exposure silhouette mask",
                "multiple destination scenes layered inside the face and torso",
                "warm sunrise lighting with soft atmospheric haze",
                "editorial travel-poster layout with generous negative space",
            ],
            negative_guidance=[
                "avoid generic plain portrait overlays without layered scenic storytelling",
                "avoid copying the exact source text, destination, or silhouette details",
            ],
        ),
        fixed_style_traits=[
            "double-exposure portrait composite",
            "editorial travel poster layout",
            "warm sunrise palette",
        ],
        source_specific_exclusions=["exact source text", "exact landmark arrangement"],
    )

    prompt = compile_reference_style_prompt(brief, saved_template=True)

    assert "{{poster_title}}" in prompt
    assert "{{destination_landmark_set}}" in prompt
    assert "{{tagline_mood}}" in prompt
    assert "double-exposure" in prompt
    assert "travel-poster layout" in prompt
    assert "Mount Fuji" not in prompt
    assert "torii" not in prompt.lower()
    assert "Japanese temple" not in prompt
    assert "cherry blossom" not in prompt.lower()
    assert "an original value that fits this style" not in prompt


def test_reference_style_prompt_treats_character_world_brief_as_subject_field() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_style5_character_world",
        preset_direction=ReferenceStylePresetDirection(
            title="Neo-Cybernetic Manga Poster",
            target_model_mode="image_edit",
        ),
        visual_analysis={
            "medium": ["digital illustration with polished concept-art rendering", "poster composition with embedded graphic panels"],
            "palette": ["deep teal and oxidized green background wash", "burnt orange typography accents"],
            "line_shape_language": ["angular armor plates and exposed piston geometry"],
            "composition": ["tall poster aspect with full-body figure filling most of the frame"],
            "subject_treatment": ["cybernetic figure with visible face and focused expression"],
            "environment_props": ["technical labels, barcode, and warning blocks"],
            "texture_lighting": ["grimy printed-poster texture with scratches and wear"],
            "typography_text_energy": ["oversized vertical headline characters and boxed alphanumeric callouts"],
            "mood": ["intense defiant near-future manga cover energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="character_world_brief", label="Character / World Brief", required=True),
                ReferenceStylePresetField(key="title_unit_code", label="Title / Unit Code", required=False),
            ],
            image_slots=[ReferenceStyleImageSlot(key="subject_image", label="Subject Image", required=True)],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=[
                "teal-orange cyberpunk poster palette",
                "distressed editorial border system",
                "dense cybernetic body augmentation",
            ],
            negative_guidance=["avoid clean minimalist sci-fi layouts"],
        ),
        fixed_style_traits=["cybernetic manga poster", "technical label system", "grimy poster texture"],
    )

    prompt = compile_reference_style_prompt(brief, saved_template=True)

    assert "{{character_world_brief}}" in prompt
    assert "main character, subject type, or scene idea" in prompt
    assert "destination, landmarks" not in prompt
    assert "[[subject_image]] as the identity and likeness source" in prompt


def test_reference_style_prompt_treats_hero_headline_as_text_field() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_hero_headline_text_field",
        preset_direction=ReferenceStylePresetDirection(
            title="Graffiti Streetwear Editorial Poster",
            target_model_mode="image_edit",
        ),
        visual_analysis={
            "medium": ["fashion editorial poster built as a digital collage"],
            "palette": ["hot pink sprayed across a black background"],
            "composition": ["vertical poster layout with a full-body subject dominating the center frame"],
            "typography_text_energy": ["giant expressive main title in sprayed brush script"],
            "mood": ["rebellious youth-culture energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[ReferenceStylePresetField(key="hero_headline", label="Hero Headline", default_value="REBEL")],
            image_slots=[ReferenceStyleImageSlot(key="subject_image", label="Subject Image", required=True)],
        ),
    )

    prompt = compile_reference_style_prompt(brief)

    assert "Use REBEL as the Hero Headline, preserving the typography hierarchy and graphic layout." in prompt
    assert "Hero Headline to define the subject role" not in prompt


def test_reference_style_prompt_treats_transit_type_as_transportation_field() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_transit_type_transport_field",
        preset_direction=ReferenceStylePresetDirection(
            title="Vintage Scrapbook City Transit Poster",
            target_model_mode="text_to_image",
        ),
        visual_analysis={
            "medium": ["mixed-media travel poster with city photography and ink sketches"],
            "palette": ["warm beige paper and sepia city tones"],
            "composition": ["foreground transit pass with skyline behind it"],
            "typography_text_energy": ["handwritten city title and transit-style fare text"],
            "mood": ["nostalgic tourist postcard energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(
                    key="transit_type",
                    label="Transit Type",
                    default_value="elevated train day pass",
                ),
                ReferenceStylePresetField(
                    key="transit_pass_title",
                    label="Transit Pass Title",
                ),
            ],
        ),
    )

    prompt = compile_reference_style_prompt(brief)

    assert "ticket/pass object, route cues, and transit details" in prompt
    assert "Set the Transit Pass Title as short visible copy" in prompt
    assert "main character, subject type, or scene idea" not in prompt


def test_reference_style_prompt_drops_unsupported_location_field_for_punk_poster() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_punk_no_location_field",
        preset_direction=ReferenceStylePresetDirection(
            title="Punk Glam Rebel Poster Portrait",
            target_model_mode="text_to_image",
        ),
        visual_analysis={
            "medium": ["mixed-media glam portrait photography with distressed print-poster treatment"],
            "palette": ["hot pink splashes against black and dirty off-white"],
            "line_shape_language": ["curved ribbon banners, checkerboard blocks, paint drips, and splatter bursts"],
            "composition": ["vertical portrait crop with a centered subject and top and bottom slogan banners"],
            "subject_treatment": ["anti-polite icon with confrontational punk attitude"],
            "environment_props": ["checkerboard wall backdrop with broken-heart graffiti and distressed graphic tee"],
            "typography_text_energy": ["big uppercase serif slogan text printed on aged ribbon banners"],
            "mood": ["rebellious and unapologetic"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(
                    key="location",
                    label="Location",
                    purpose="Location, landmark set, or destination that drives the scene details.",
                    default_value="distressed graphic tee with oversized broken-heart emblem",
                ),
                ReferenceStylePresetField(
                    key="banner_phrase",
                    label="Banner Phrase",
                    purpose="Short visible slogan text for the ribbon banners.",
                    default_value="NO RULES JUST NOISE",
                ),
            ],
        ),
    )

    prompt = compile_reference_style_prompt(brief)

    assert "Use NO RULES JUST NOISE as the Banner Phrase, preserving the typography hierarchy and graphic layout." in prompt
    assert "as the Location" not in prompt
    assert "destination, landmarks" not in prompt
    assert "distressed graphic tee with oversized broken-heart emblem as the Location" not in prompt


def test_reference_style_prompt_treats_location_backdrop_value_as_environment() -> None:
    brief = ReferenceStyleBrief(
        brief_id="rsb_punk_location_backdrop_field",
        preset_direction=ReferenceStylePresetDirection(
            title="Neon Grunge Punk Banner Poster",
            target_model_mode="text_to_image",
        ),
        visual_analysis={
            "medium": ["stylized poster-like portrait photography blended with graphic grunge collage treatment"],
            "palette": ["hot pink and teal accents against black charcoal and dirty cream"],
            "composition": ["vertical punk road trip poster with curved distressed banner headline zones at top and bottom"],
            "environment_props": ["checkerboard grunge backdrop with splatters, drips, cracks, and worn print texture"],
            "typography_text_energy": ["distressed black serif banner lettering with strong slogan energy"],
            "mood": ["defiant and irreverent"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(
                    key="location",
                    label="Location",
                    purpose="Location, landmark set, or destination that drives the scene details.",
                    default_value="distressed black-and-white checkerboard wall as the main backdrop",
                ),
                ReferenceStylePresetField(
                    key="hero_brief",
                    label="Hero Brief",
                    purpose="Props, wardrobe, gear, or accessory details that fit the style.",
                    default_value="fierce roller-derby vocalist with neon pink hair",
                ),
            ],
        ),
    )

    prompt = compile_reference_style_prompt(brief)

    assert "distressed black-and-white checkerboard wall as the main backdrop to define the backdrop" in prompt
    assert "as the Location" not in prompt
    assert "destination, landmarks" not in prompt


def test_media_assistant_reference_style_text_only_intake_does_not_reask_runtime_image(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style-no-runtime.jpg")
    workflow = {"schema_version": 1, "name": "Text-only reference style preset chat graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-reference-style-no-runtime-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style-no-runtime.jpg"})

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "This looks like `Neon Ink Character Poster`. "
                "Reusable direction: saturated orange and magenta palette, glossy black ink shapes, splattered graffiti texture, "
                "bold poster composition, exaggerated cartoon character proportions, oversized streetwear props, and punchy studio shadows. "
                "Useful fields: Scene Brief and Detail Notes."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "reference-style-no-runtime-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Use this reference as a text-to-image Media Preset with no runtime image inputs. "
                "Suggest two useful fields and ask one short question."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    text = assistant_message["content_text"]
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    assert proposal["explicit_text_only"] is True
    assert proposal["preset_contract"]["image_slots"] == []
    assert "Image slot: none" in text
    assert "Should this stay text-only" not in text
    assert "accept one runtime image input" not in text
    assert "Should the preset stay minimal" in text

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Use fields scene brief and detail notes, then create the temporary sandbox "
                "with scene brief neon alley character poster and detail notes oversized sneakers splatter."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["graph_plan"]["operations"]
    node_titles = [node["metadata"]["ui"]["customTitle"] for node in payload["workflow"]["nodes"]]
    assert "Draft preset prompt" in node_titles
    assert "Preview" in node_titles
    assert not any(node["type"] == "media.load_image" for node in payload["workflow"]["nodes"])
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    assert "Neon Ink Character Poster" in prompt_node["fields"]["text"]
    assert "For Scene Brief" not in prompt_node["fields"]["text"]
    assert "Detail Notes" not in prompt_node["fields"]["text"]
    assert "{{scene_brief}}" not in prompt_node["fields"]["text"]
    assert "{{detail_notes}}" not in prompt_node["fields"]["text"]
    assert "runtime image input" not in prompt_node["fields"]["text"].lower()

    quick_reply_plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Extract the attached reference images into a reusable text style prompt. "
                "Do not use the style reference image as a runtime image input. "
                "Keep this text-driven with one or two editable fields, then create a temporary text-to-image test graph for this preset."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert quick_reply_plan_response.status_code == 200, quick_reply_plan_response.text
    quick_reply_payload = quick_reply_plan_response.json()
    quick_reply_prompt = next(
        node
        for node in quick_reply_payload["workflow"]["nodes"]
        if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt"
    )["fields"]["text"]
    assert "Neon Ink Character Poster" in quick_reply_prompt
    assert "{{" not in quick_reply_prompt
    assert "}}" not in quick_reply_prompt
    assert "{{scene_brief}}" not in quick_reply_prompt
    assert "one or two editable fields" not in quick_reply_prompt
    assert "temporary" not in quick_reply_prompt.lower()
    assert "test graph" not in quick_reply_prompt.lower()

    compact_button_plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create test workflow",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert compact_button_plan_response.status_code == 200, compact_button_plan_response.text
    compact_payload = compact_button_plan_response.json()
    assert compact_payload["graph_plan"]["metadata"]["template_id"] == T2I_SANDBOX_TEMPLATE_ID
    assert not any(node["type"] == "media.load_image" for node in compact_payload["workflow"]["nodes"])
    compact_prompt = next(
        node
        for node in compact_payload["workflow"]["nodes"]
        if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt"
    )["fields"]["text"]
    assert "runtime image input" not in compact_prompt.lower()


def test_media_assistant_style_setup_bullet_fields_drive_t2i_prompt(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style5.jpg")
    workflow = {"schema_version": 1, "name": "Style5 text-only setup field graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style5-setup-field-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style5.jpg"})

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "This looks like `Cybernetic Hero Poster`; I would lock the style around: digital sci-fi poster illustration "
                "with painted-photoreal hybrid rendering; deep teal background; burnt orange accents; charcoal black framing; "
                "sharp angular mech parts; thick bold vertical typography blocks; extreme low-angle foreshortened figure; "
                "distressed industrial backdrop; scratched metal; weathered paint; intense rebellious mood.\n\n"
                "Suggested setup:\n"
                "- Field: Character Role\n"
                "- Field: Unit Code / Callsign\n"
                "- Image input: none\n\n"
                "Create a text-only test workflow with these fields?"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "style5-setup-field-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Can you create me a media preset out of this image? I am not sure if it should be "
                "image-to-image, text-to-image, or both, so guide me with short questions."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert "Useful fields: Main Character and Unit Code / Callsign" in assistant_message["content_text"]
    assert "Image slot: Person / Character" in assistant_message["content_text"]
    assert "Should this stay text-only" not in assistant_message["content_text"]

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the text-to-image test workflow now with the suggested editable fields.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    prompt_text = next(
        node
        for node in plan_response.json()["workflow"]["nodes"]
        if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt"
    )["fields"]["text"]
    assert "{{character_role}}" not in prompt_text
    assert "{{unit_code_callsign}}" not in prompt_text
    assert "{{" not in prompt_text
    assert "}}" not in prompt_text
    assert "main character, subject, or scene idea" in prompt_text
    assert "cybernetic" in prompt_text.lower()
    assert "poster" in prompt_text.lower()
    assert "Scene Brief" not in prompt_text
    assert "Optional Detail Notes" not in prompt_text
    assert "runtime image input" not in prompt_text.lower()


def test_media_assistant_ambiguous_text_only_or_image_input_keeps_image_question(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style-ambiguous-input.jpg")
    workflow = {"schema_version": 1, "name": "Ambiguous reference style preset graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-reference-style-ambiguous-input-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style-ambiguous-input.jpg"})

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "This looks like `Rebel Punk Portrait Poster`. "
                "Reusable direction: gritty glam-punk portrait with hot pink and teal accents, distressed poster textures, "
                "tattoo-shop energy, checkerboard wall details, and bold banner typography. "
                "Useful fields: Scene Brief and Banner Text."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "reference-style-ambiguous-input-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "I added a reference image and want to turn this look into a reusable Media Preset. "
                "I am not sure whether it should be text-only or use an image input. "
                "Give me a short style read, suggest one or two useful fields, and ask one question before creating the sandbox."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    text = assistant_message["content_text"]
    assert proposal["explicit_text_only"] is False
    assert proposal["preset_contract"]["image_slots"] == []
    assert "Image slot:" in text
    assert "Do you want an image input" in text
    assert "Create the text-only sandbox" not in text


def test_media_assistant_provider_image_input_recommendation_updates_contract(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style-provider-image-input.jpg")
    workflow = {"schema_version": 1, "name": "Provider image input recommendation graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-provider-image-input-recommendation-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style-provider-image-input.jpg"})

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "This reads as a rebellious punk-glam poster look: hot pink and teal accents, distressed grunge textures, "
                "tattoo-and-jewelry styling, and bold slogan-banner framing with a loud attitude. "
                "I’d make this a preset that accepts a separate user-provided image, not text-only, because the look depends on portrait styling."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "provider-image-input-recommendation-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "I added a reference image and want to turn this look into a reusable Media Preset. "
                "I am not sure whether it should be text-only or use an image input."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    style_brief = assistant_message["content_json"]["reference_style_brief"]
    text = assistant_message["content_text"]
    assert [slot["key"] for slot in proposal["preset_contract"]["image_slots"]] == ["personal_reference"]
    assert [slot["key"] for slot in style_brief["preset_contract"]["image_slots"]] == ["personal_reference"]
    assert "Image slot: Personal Reference" in text
    assert "I recommend image-to-image for this preset." in text
    assert "Should this image input be required every time, or optional?" in text
    assert "Suggested setup" not in text
    assert "I’d make this" not in " ".join(style_brief["prompt_blueprint"]["fixed_style_ingredients"])


def test_media_assistant_preset_builder_keeps_style_refs_separate_from_runtime_image(client, app_modules, monkeypatch) -> None:
    first_reference_id = _create_reference_image(app_modules, name="1978.jpg")
    second_reference_id = _create_reference_image(app_modules, name="1989.jpg")
    workflow = {"schema_version": 1, "name": "Year preset chat graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-year-preset-chat-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": first_reference_id, "label": "1978.jpg"})
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": second_reference_id, "label": "1989.jpg"})

    def verbose_provider(**kwargs):
        return {
            "generated_text": "Prompt Template:\n```text\n" + ("large prompt details " * 90) + "\n```",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "year-preset-contract-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", verbose_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Use the attached style references to build a Media Preset with a year field "
                "and one personal reference image of me."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    assert proposal["title"] == "Single-Image Reference Preset"
    assert [slot["key"] for slot in proposal["preset_contract"]["image_slots"]] == ["personal_reference"]
    assert [field["key"] for field in proposal["preset_contract"]["fields"]] == ["year"]
    assert "Face Reference" not in assistant_message["content_text"]
    assert "Body Reference" not in assistant_message["content_text"]


def test_media_assistant_preset_builder_suggests_generic_fields_for_runtime_image_style(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style2.jpg")
    workflow = {"schema_version": 1, "name": "Runtime image style preset chat graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-runtime-image-style-fields-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style2.jpg"})

    def verbose_provider(**kwargs):
        return {
            "generated_text": "Prompt Template:\n```text\n" + ("large prompt details " * 90) + "\n```",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "runtime-image-style-fields-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", verbose_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Use attached image as style source. Create image to image Media Preset. "
                "It needs one required runtime image input of a person. "
                "Suggest two useful fields and ask one short question before sandbox."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    contract = proposal["preset_contract"]
    assert [slot["key"] for slot in contract["image_slots"]] == ["personal_reference"]
    assert [field["key"] for field in contract["fields"]] == ["pose_framing"]
    assert "skate" not in str(contract).lower()
    assert "Pose / Framing" in assistant_message["content_text"]
    assert "Style Notes" not in assistant_message["content_text"]


def test_media_assistant_image_to_image_source_image_request_uses_runtime_slot(client, app_modules, monkeypatch) -> None:
    reference_id_1 = _create_reference_image(app_modules, name="style3.jpg")
    reference_id_2 = _create_reference_image(app_modules, name="style4.jpg")
    workflow = {"schema_version": 1, "name": "Source image preset chat graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-source-image-style-fields-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id_1, "label": "style3.jpg"})
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id_2, "label": "style4.jpg"})

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "This looks like Neon Street Poster Illustration. "
                "Reusable direction: acid orange and hot magenta palette, graphic drips, black ink splatter, "
                "bold illustrated silhouettes, exaggerated character proportions, and gritty wall-poster texture. "
                "Useful fields: Scene Brief and Optional Detail Notes."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "source-image-style-fields-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "I want to create a Media Preset from these two reference images. "
                "I want to start with an image-to-image version where I can attach a source image "
                "and have it transformed into this style. Suggest the best image input type and one or two useful form fields, "
                "then ask me one short question before creating a temporary sandbox."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    contract = proposal["preset_contract"]
    assert [slot["key"] for slot in contract["image_slots"]] == ["personal_reference"]
    assert contract["model_hint"] == "image_edit"
    assert "Image slot:" in assistant_message["content_text"]
    assert "Runtime image input:" not in assistant_message["content_text"]
    assert "No image input yet" not in assistant_message["content_text"]
    assert "Should this stay text-only" not in assistant_message["content_text"]


def test_media_assistant_style_prompt_filters_input_planning_language() -> None:
    proposal = {
        "title": "Single-Image Reference Preset",
        "description": "Create a reusable Media Preset with one runtime image input.",
        "preset_contract": {
            "model_hint": "image_edit",
            "fields": [
                {"key": "pose_framing", "label": "Pose / Framing", "required": False},
                {"key": "style_notes", "label": "Style Notes", "required": False},
            ],
            "image_slots": [
                {"key": "personal_reference", "label": "Personal Reference", "required": True},
            ],
        },
    }
    brief = build_reference_style_brief(
        user_text=(
            "I want an image-to-image version where I can attach a source image. "
            "Suggest the best image input type and one or two useful form fields."
        ),
        assistant_text=(
            "Reusable direction: bold neon street-art illustration with acid orange and hot magenta palette; "
            "poster-like composition; heavy black ink shapes; spiky exaggerated character treatment; "
            "For the actual preset, the best image input type is one general Source Image slot; "
            "paint splatter texture; chaotic punk energy. "
            "Suggested preset shape: - Media slot: Main Subject Image required; layered jewelry; or attitude. "
            "Image inputs: Personal Reference. Suggested fields: Pose / Framing, Style Notes."
        ),
        proposal=proposal,
        attachments=[],
    )

    prompt = compile_reference_style_prompt(brief)
    assert prompt.startswith("Use the provided Personal Reference as the identity and likeness source.")
    assert "best image input type" not in prompt.lower()
    assert "source image slot" not in prompt.lower()
    assert "actual preset" not in prompt.lower()
    assert "suggested preset shape" not in prompt.lower()
    assert "media slot" not in prompt.lower()
    assert "image inputs" not in prompt.lower()
    assert "suggested fields" not in prompt.lower()
    assert "media preset" not in prompt.lower()
    assert "runtime image input" not in prompt.lower()
    assert "reusable style" not in prompt.lower()
    assert "bold neon street-art illustration" in prompt
    assert "paint splatter texture" in prompt


def test_media_assistant_saved_style_prompt_uses_placeholders_without_runtime_language() -> None:
    proposal = {
        "title": "Single-Image Reference Preset",
        "preset_contract": {
            "fields": [{"key": "scene_brief", "label": "Scene Brief", "required": True}],
            "image_slots": [{"key": "personal_reference", "label": "Personal Reference", "required": True}],
        },
    }
    brief = build_reference_style_brief(
        user_text="Create a preset from these references with one image input and a scene field.",
        assistant_text=(
            "Reusable direction: rough comic poster illustration with mustard yellow and black palette; "
            "thick brushy ink linework; crowded bedroom-wall composition; paper grain texture; "
            "hand-lettered typography energy; expressive cartoon character treatment; chaotic anxious-but-funny mood."
        ),
        proposal=proposal,
        attachments=[],
    )

    prompt = compile_reference_style_prompt(
        brief,
        fields=[{"key": "scene_brief", "label": "Scene Brief", "required": True}],
        image_slots=[{"key": "personal_reference", "label": "Personal Reference", "required": True}],
        saved_template=True,
    )

    assert "{{scene_brief}}" in prompt
    assert "[[personal_reference]]" in prompt
    assert "runtime image input" not in prompt.lower()
    assert "media preset" not in prompt.lower()
    assert "chat context" not in prompt.lower()


def test_media_assistant_negated_runtime_image_input_stays_text_only(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style1.jpg")
    workflow = {"schema_version": 1, "name": "Text-only style extraction", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-text-only-style-extraction-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style1.jpg"})

    def verbose_provider(**kwargs):
        return {
            "generated_text": "Prompt Template:\n```text\n" + ("large prompt details " * 90) + "\n```",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "text-only-style-extraction-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", verbose_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Extract the attached reference images into a reusable text style prompt. "
                "Do not use the style reference image as a runtime image input. "
                "Keep this text-driven with one or two editable fields for this preset."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    proposal = assistant_message["content_json"]["preset_builder_proposal"]
    assert proposal["title"] == "Reference Style Preset"
    assert proposal["preset_contract"]["image_slots"] == []
    assert "Personal Reference" not in assistant_message["content_text"]


def test_media_assistant_drafts_skateboard_character_preset_with_face_body_slots(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules, name="skate2.jpg")
    workflow = {"schema_version": 1, "name": "Skate preset draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-skate-preset-draft-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "skate2.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-drafts",
        json={
            "message": (
                "Create a Media Preset from the two skater style references with two input images: "
                "image 1 is face reference and image 2 is body reference. Keep fields minimal."
            )
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["label"] == "Multi-Image Reference Preset"
    assert [slot["key"] for slot in payload["draft"]["input_slots_json"]] == ["face_reference", "body_reference"]
    assert [slot["label"] for slot in payload["draft"]["input_slots_json"]] == ["Face Reference", "Body Reference"]
    assert all(slot["required"] is True for slot in payload["draft"]["input_slots_json"])
    assert [field["key"] for field in payload["draft"]["input_schema_json"]] == ["pose_framing"]
    assert "[[face_reference]]" in payload["draft"]["prompt_template"]
    assert "[[body_reference]]" in payload["draft"]["prompt_template"]
    assert "{{pose_framing}}" in payload["draft"]["prompt_template"]


def test_media_assistant_drafts_year_personal_reference_preset(client, app_modules) -> None:
    first_reference_id = _create_reference_image(app_modules, name="1978.jpg")
    second_reference_id = _create_reference_image(app_modules, name="1989.jpg")
    workflow = {"schema_version": 1, "name": "Year preset draft graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-year-preset-draft-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": first_reference_id, "label": "1978.jpg"})
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": second_reference_id, "label": "1989.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-drafts",
        json={
            "message": (
                "Use the attached style references to create a Media Preset with a year field "
                "and one personal reference image of me."
            )
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["label"] == "Single-Image Reference Preset"
    assert [slot["key"] for slot in payload["draft"]["input_slots_json"]] == ["personal_reference"]
    assert payload["draft"]["input_slots_json"][0]["required"] is True
    assert [field["key"] for field in payload["draft"]["input_schema_json"]] == ["year"]
    assert "[[personal_reference]]" in payload["draft"]["prompt_template"]
    assert "{{year}}" in payload["draft"]["prompt_template"]
    assert "[[face_reference]]" not in payload["draft"]["prompt_template"]
    assert "[[body_reference]]" not in payload["draft"]["prompt_template"]


def test_media_assistant_drafts_skateboard_preset_from_sandbox_prompt_and_latest_output(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-skate-preset-draft-output",
        workflow_id="workflow-skate-preset-draft-output",
    )
    first_reference_id = _create_reference_image(app_modules, name="skate1.jpg")
    second_reference_id = _create_reference_image(app_modules, name="skate2.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-skate-preset-draft-output",
        "name": "Skate preset approved sandbox",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create a polished media output that follows the currently attached references. "
                        "Use image reference 1 for the first runtime input. Use image reference 2 for the second runtime input. "
                        "Preserve the inferred composition, color, line, texture, and mood."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-skate-preset-draft-output", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": first_reference_id, "label": "skate1.jpg"})
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": second_reference_id, "label": "skate2.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-drafts",
        json={
            "message": "Create the media preset now from this approved result with two runtime image inputs.",
            "workflow": workflow,
            "run_id": run_id,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["label"] == "Multi-Image Reference Preset"
    assert [slot["key"] for slot in payload["draft"]["input_slots_json"]] == ["image_input_1", "image_input_2"]
    assert "[[image_input_1]]" in payload["draft"]["prompt_template"]
    assert "[[image_input_2]]" in payload["draft"]["prompt_template"]
    assert "image reference 1" not in payload["draft"]["prompt_template"].lower()
    assert "currently attached references" in payload["draft"]["prompt_template"]
    assert payload["draft"]["thumbnail_path"]
    assert payload["draft"]["thumbnail_url"].startswith("/api/control/files/")


def test_media_assistant_preset_draft_uses_session_latest_output_run_for_thumbnail(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-session-latest-output-thumbnail",
        workflow_id="workflow-session-latest-output-thumbnail",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-session-latest-output-thumbnail",
        "name": "Latest output thumbnail fallback",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Cyber Fairy Techno Poster: Set the Main Subject as the central person, character, object, or idea the composition is built around. "
                        "Set the Poster Title as short visible copy that fits the typography hierarchy and graphic layout. "
                        "cold blue monochrome palette; translucent insect wings; low-angle utility-pole poster framing."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-session-latest-output-thumbnail", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    session = app_modules["store_assistant"].get_assistant_session(session_id)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session,
            "summary_json": {
                "media_preset_builder": {
                    "latest_output_run_id": run_id,
                    "latest_output_asset_id": "asset-session-latest-output-thumbnail",
                }
            },
        }
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-drafts",
        json={
            "message": "Create the official Media Preset now from this approved workflow result. Use the latest generated output as the thumbnail.",
            "workflow": workflow,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["thumbnail_path"]
    assert payload["draft"]["thumbnail_url"].startswith("/api/control/files/")


def test_media_assistant_returns_current_draft_preset_prompt_on_request(client) -> None:
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-full-prompt-request",
        "name": "Full prompt request graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Create a cinematic double-exposure travel poster with a portrait silhouette and mountain scenery."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-full-prompt-request", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "What is the full prompt you created?",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["role"] == "assistant"
    assert "Here is the current graph prompt" in assistant_message["content_text"]
    assert "```text" in assistant_message["content_text"]
    assert "Create a cinematic double-exposure travel poster" in assistant_message["content_text"]
    assert "This looks like" not in assistant_message["content_text"]


def test_media_assistant_prompt_only_request_uses_reference_analysis_without_auto_plan(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="prompt-only-style.jpg")
    workflow = {"schema_version": 1, "workflow_id": "workflow-prompt-only-style", "name": "Prompt only style", "nodes": [], "edges": []}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-prompt-only-style", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "prompt-only-style.jpg"})

    provider_payload = {
        "title": "Retro Monster Snack Poster",
        "summary": "Playful snack-ad poster with a mascot creature and oversized treat prop.",
        "target_model_mode": "text_to_image",
        "recommended_fields": [
            {"key": "creature_type", "label": "Creature Type", "purpose": "Main mascot creature to feature.", "required": True},
            {"key": "featured_snack", "label": "Featured Snack", "purpose": "Oversized snack or treat prop.", "required": False},
        ],
        "visual_analysis": {
            "medium": ["screen-printed character poster", "playful commercial illustration"],
            "palette": ["cream paper base", "tomato red accents", "mustard yellow highlights"],
            "line_shape_language": ["chunky rounded monster silhouette", "bold sticker-like outlines"],
            "composition": ["single mascot centered", "oversized snack held near the face", "tight square crop"],
            "subject_treatment": ["goofy creature mascot with expressive eyes"],
            "environment_props": ["crumbs and tiny starburst graphics", "large snack wrapper shape"],
            "texture_lighting": ["risograph grain", "flat poster lighting"],
            "typography_text_energy": ["short playful headline", "small badge labels"],
            "mood": ["funny", "snackable", "bright"],
        },
        "fixed_style_traits": [
            "screen-printed character poster",
            "chunky rounded monster silhouette",
            "oversized snack held near the face",
            "cream paper base with red and mustard accents",
            "risograph grain",
        ],
        "negative_guidance": ["avoid realistic food photography", "avoid clean corporate packaging ads"],
    }

    def prompt_only_provider(**_kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "This looks like `Retro Monster Snack Poster`.\n"
                "Suggested setup:\n"
                "- Field: Creature Type\n"
                "- Field: Featured Snack\n"
                f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(provider_payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "prompt-only-style-analysis",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", prompt_only_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Give me a full prompt from this image.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assistant_message = payload["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "reference_style_prompt_only"
    assert assistant_message["content_json"]["suggested_action"] is None
    assert assistant_message["content_json"]["preset_builder_proposal"] is None
    assert assistant_message["content_json"]["media_preset_builder"] is None
    assert "Here is a full prompt from the attached reference style" in assistant_message["content_text"]
    assert "```text" in assistant_message["content_text"]
    assert "Retro Monster Snack Poster" in assistant_message["content_text"]
    assert "Creature Type" in assistant_message["content_text"]
    assert "Featured Snack" in assistant_message["content_text"]
    assert "Create a test workflow" not in assistant_message["content_text"]
    assert payload["summary_json"]["reference_style_brief"]["preset_direction"]["title"] == "Retro Monster Snack Poster"


def test_media_assistant_saves_media_preset_directly_from_graph(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-skate-preset-save-output",
        workflow_id="workflow-skate-preset-save-output",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-skate-preset-save-output",
        "name": "Skate preset save graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Create a polished media image using the subject reference and the approved reference style."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-skate-preset-save-output", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": "Create the media preset now from this approved result with one required subject reference image input.",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["capability"] == "save_media_preset"
    assert payload["artifact_kind"] == "media_preset"
    assert payload["created"] is True
    assert payload["record"]["label"] == "Single-Image Reference Preset"
    assert app_modules["store"].get_preset_by_key(payload["record"]["key"])["preset_id"] == payload["record"]["preset_id"]
    assert payload["assistant_session"]["messages"][-1]["content_json"]["activity_kind"] == "media_preset_saved"

    repeated = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": "Create the media preset now from this approved result with one required subject reference image input.",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["created"] is False
    assert repeated.json()["record"]["preset_id"] == payload["record"]["preset_id"]


def test_media_assistant_quick_save_preserves_workflow_image_input_contract(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-quick-save-image-input-contract",
        workflow_id="workflow-quick-save-image-input-contract",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-quick-save-image-input-contract",
        "name": "Approved image input sandbox",
        "nodes": [
            {
                "id": "personal_reference",
                "type": "media.load_image",
                "position": {"x": 120, "y": 260},
                "fields": {},
                "metadata": {"ui": {"customTitle": "Personal Reference"}},
            },
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create a cinematic double-exposure travel poster using the Personal Reference image as the subject. "
                        "Blend the subject silhouette with a mountain horizon, vintage paper texture, warm peach lighting, "
                        "editorial travel-poster typography, and layered scenic collage details."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            },
            {
                "id": "model",
                "type": "model.kie.gpt_image_2_image_to_image",
                "position": {"x": 520, "y": 360},
                "fields": {},
                "metadata": {"ui": {"customTitle": "GPT Image 2 Image to Image"}},
            },
        ],
        "edges": [
            {
                "id": "edge-personal-reference-model",
                "source": "personal_reference",
                "source_port": "image",
                "target": "model",
                "target_port": "image_refs",
                "metadata": {},
            },
            {
                "id": "edge-prompt-model",
                "source": "prompt",
                "source_port": "text",
                "target": "model",
                "target_port": "prompt",
                "metadata": {},
            },
        ],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-quick-save-image-input-contract", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": (
                "This result is close enough. Create the official Media Preset now from this approved sandbox. "
                "Use the latest generated image as the thumbnail when available."
            ),
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    record = app_modules["store"].get_preset_by_key(payload["record"]["key"])
    assert record["requires_image"] is True
    assert [slot["key"] for slot in record["input_slots_json"]] == ["personal_reference"]
    assert [slot["label"] for slot in record["input_slots_json"]] == ["Personal Reference"]
    assert "[[personal_reference]]" in record["prompt_template"]
    assert "Personal Reference image" not in record["prompt_template"]
    assert record["model_key"] == "gpt-image-2-image-to-image"
    assert "gpt-image-2-image-to-image" in record["applies_to_models_json"]
    assert payload["record"]["thumbnail_url"].startswith("/api/control/files/")


def test_media_assistant_quick_save_strips_output_compare_scaffolding_from_prompt(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-quick-save-review-scaffold-strip",
        workflow_id="workflow-quick-save-review-scaffold-strip",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-quick-save-review-scaffold-strip",
        "name": "Approved refined image input workflow",
        "nodes": [
            {
                "id": "portrait",
                "type": "media.load_image",
                "position": {"x": 120, "y": 260},
                "fields": {},
                "metadata": {"ui": {"customTitle": "Portrait"}},
            },
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Use [[portrait]] as the identity and likeness source for a cinematic double-exposure travel poster. "
                        "Warm sunrise palette, cream paper texture, editorial travel typography, mountain scenery inside the silhouette. "
                        "Strengthen the next version by adding more of Improve: denser cultural/location storytelling and layered microtype. "
                        "Prompt tweak: add fine destination labels, tiny map marks, and extra atmospheric haze. "
                        "Recommendation: refine once, then save the preset if the user approves."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            },
            {
                "id": "model",
                "type": "model.kie.gpt_image_2_image_to_image",
                "position": {"x": 520, "y": 360},
                "fields": {},
                "metadata": {"ui": {"customTitle": "GPT Image 2 Image to Image"}},
            },
        ],
        "edges": [
            {
                "id": "edge-portrait-model",
                "source": "portrait",
                "source_port": "image",
                "target": "model",
                "target_port": "image_refs",
                "metadata": {},
            },
            {
                "id": "edge-prompt-model",
                "source": "prompt",
                "source_port": "text",
                "target": "model",
                "target_port": "prompt",
                "metadata": {},
            },
        ],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-quick-save-review-scaffold-strip", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": "Create the official Media Preset now from this approved workflow result.",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    record = app_modules["store"].get_preset_by_key(response.json()["record"]["key"])
    prompt_template = record["prompt_template"]
    assert "[[portrait]]" in prompt_template
    assert "double-exposure travel poster" in prompt_template
    assert "Improve:" not in prompt_template
    assert "Prompt tweak:" not in prompt_template
    assert "Recommendation:" not in prompt_template
    assert "Strengthen the next version" not in prompt_template
    assert "this output" not in prompt_template
    assert "save the preset" not in prompt_template.lower()


def test_media_assistant_quick_save_preserves_style_brief_text_fields(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-style-brief-field-save-output",
        workflow_id="workflow-style-brief-field-save-output",
    )
    reference_id = _create_reference_image(app_modules, name="style5.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-style-brief-field-save-output",
        "name": "Style brief contract save graph",
        "nodes": [
            {
                "id": "person_reference",
                "type": "media.load_image",
                "position": {"x": 120, "y": 260},
                "fields": {},
                "metadata": {"ui": {"customTitle": "Person Reference"}},
            },
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create an original cybernetic warrior poster using [[person_reference]] as the subject. "
                        "Use the approved Character Role and Unit Code fields while preserving the teal-orange "
                        "industrial poster style."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            },
            {
                "id": "model",
                "type": "model.kie.gpt_image_2_image_to_image",
                "position": {"x": 520, "y": 360},
                "fields": {},
                "metadata": {"ui": {"customTitle": "GPT Image 2 Image to Image"}},
            },
        ],
        "edges": [
            {
                "id": "edge-person-reference-model",
                "source": "person_reference",
                "source_port": "image",
                "target": "model",
                "target_port": "image_refs",
                "metadata": {},
            },
            {
                "id": "edge-prompt-model",
                "source": "prompt",
                "source_port": "text",
                "target": "model",
                "target_port": "prompt",
                "metadata": {},
            },
        ],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style-brief-field-save-output", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style5.jpg"})

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "This looks like `Cybernetic Warrior Poster`; I would lock the style around: digital concept art poster; "
                "anime-influenced sci-fi key art; editorial game-poster layout; deep teal background; burnt orange accents; "
                "vertical Japanese headline blocks; technical annotations; distressed industrial texture.\n\n"
                "Suggested setup:\n"
                "- Field: Character Role\n"
                "- Field: Unit Code\n"
                "- Image input: Person Reference\n\n"
                "Create a test workflow with this setup?"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "style5-save-field-contract-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    chat_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Can you create me a media preset out of this image and guide me with short questions?",
            "workflow": {"schema_version": 1, "name": "Reference style intake", "nodes": [], "edges": [], "metadata": {}},
            "assistant_mode": "preset",
        },
    )
    assert chat_response.status_code == 200, chat_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": (
                "Create the official Media Preset called Cybernetic Warrior Poster I2I from this approved workflow. "
                "Use the latest generated image as the thumbnail when available."
            ),
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    record = app_modules["store"].get_preset_by_key(response.json()["record"]["key"])
    assert record["label"] == "Cybernetic Warrior Poster I2I"
    assert [field["key"] for field in record["input_schema_json"]] == ["main_character", "unit_code"]
    assert [slot["key"] for slot in record["input_slots_json"]] == ["person_reference"]
    assert "{{main_character}}" in record["prompt_template"]
    assert "{{unit_code}}" in record["prompt_template"]
    assert "[[person_reference]]" in record["prompt_template"]
    assert "Character Role" not in record["prompt_template"]
    assert "Scene Brief" not in str(record["input_schema_json"])
    assert "Optional Detail Notes" not in str(record["input_schema_json"])


def test_media_assistant_save_confirmation_uses_prior_reference_style_title(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-reference-style-save-output",
        workflow_id="workflow-reference-style-save-output",
    )
    reference_id = _create_reference_image(app_modules, name="style1.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-reference-style-save-output",
        "name": "Reference style save graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Create a chaotic graffiti bedroom caricature using the subject reference."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-reference-style-save-output", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style1.jpg"})

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "Likely preset: `Chaotic Graffiti Bedroom Caricature`. "
                "Use Subject Reference plus Scene Brief and keep the style baked into the preset."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "style-title-save-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    chat_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Turn this attached reference style into a reusable Media Preset.",
            "workflow": {"schema_version": 1, "name": "Reference style intake", "nodes": [], "edges": [], "metadata": {}},
            "assistant_mode": "preset",
        },
    )
    assert chat_response.status_code == 200, chat_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": "This result is good. Create the actual media preset now using the approved sandbox result.",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["record"]["label"] == "Chaotic Graffiti Bedroom Caricature"
    assert "This result is good" not in payload["record"]["label"]


def test_media_assistant_save_preserves_refined_image_to_image_contract(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-refined-image-contract-save-output",
        workflow_id="workflow-refined-image-contract-save-output",
    )
    reference_id = _create_reference_image(app_modules, name="style2.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-refined-image-contract-save-output",
        "name": "Refined image preset save graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create a glossy neon street-graffiti fashion poster using the runtime Personal Reference image. "
                        "Include the requested scene brief, color accent, and text or slogan when provided."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-refined-image-contract-save-output", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style2.jpg"})

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "Likely preset: `Neon Street Graffiti Fashion Poster`. "
                "Use a runtime person image plus Scene Brief, Color Accent, and Text or Slogan."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "refined-image-contract-save-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    chat_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Use the attached reference image as the style source for an image-to-image preset with a runtime image of a person.",
            "workflow": {"schema_version": 1, "name": "Reference style intake", "nodes": [], "edges": [], "metadata": {}},
            "assistant_mode": "preset",
        },
    )
    assert chat_response.status_code == 200, chat_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": (
                "Create the actual media preset now using this image to image setup. Keep the runtime input person image "
                "and the three fields scene brief, color accent, and text or slogan."
            ),
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["record"]["label"] == "Neon Street Graffiti Fashion Poster"
    record = app_modules["store"].get_preset_by_key(payload["record"]["key"])
    assert [slot["key"] for slot in record["input_slots_json"]] == ["personal_reference"]
    assert record["requires_image"] is True
    assert [field["key"] for field in record["input_schema_json"]] == ["scene_brief", "color_accent", "text_or_slogan"]
    assert "[[personal_reference]]" in record["prompt_template"]
    assert "{{scene_brief}}" in record["prompt_template"]
    assert "{{color_accent}}" in record["prompt_template"]
    assert "{{text_or_slogan}}" in record["prompt_template"]
    assert "Optional Detail Notes" not in str(record["input_schema_json"])


def test_media_assistant_save_preserves_text_only_contract_with_attached_style_reference(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-text-only-style-save-output",
        workflow_id="workflow-text-only-style-save-output",
    )
    reference_id = _create_reference_image(app_modules, name="text-only-style2.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-text-only-style-save-output",
        "name": "Text-only preset save graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create an original image in the High-Energy Street-Fashion Poster reusable style. "
                        "User-editable direction: Scene / Subject: use a fresh original value that fits the style; "
                        "Headline / Slogan: use a fresh original value that fits the style. "
                        "The original style reference image is not required at generation time."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-text-only-style-save-output", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style2.jpg"})

    def style_provider(**kwargs):
        return {
            "generated_text": (
                "Likely preset: `*High-Energy Street-Fashion Poster`. "
                "No runtime image input. Fields: Scene / Subject and Headline / Slogan."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "text-only-contract-save-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    chat_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Use the attached reference image as the style source for a text-to-image preset with no runtime image input.",
            "workflow": {"schema_version": 1, "name": "Reference style intake", "nodes": [], "edges": [], "metadata": {}},
            "assistant_mode": "preset",
        },
    )
    assert chat_response.status_code == 200, chat_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": (
                "Create the actual Media Preset now from this approved sandbox result. "
                "No runtime image input. Fields: Scene / Subject and Headline / Slogan. "
                "Save it now with these exact fields."
            ),
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    record = app_modules["store"].get_preset_by_key(payload["record"]["key"])
    assert record["label"] == "High-Energy Street-Fashion Poster"
    assert record["requires_image"] is False
    assert record["input_slots_json"] == []
    assert [field["key"] for field in record["input_schema_json"]] == ["scene_subject", "headline_slogan"]
    assert "{{scene_subject}}" in record["prompt_template"]
    assert "{{headline_slogan}}" in record["prompt_template"]
    assert "[[reference_image]]" not in record["prompt_template"]
    assert "`*High-Energy Street-Fashion Poster`" not in record["prompt_template"]
    assert ": *high-energy street-fashion" not in record["prompt_template"]


def test_media_assistant_saves_year_personal_reference_preset_from_refined_sandbox(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-year-era-preset-save-output",
        workflow_id="workflow-year-era-preset-save-output",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-year-era-preset-save-output",
        "name": "Year era preset save graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create a highly stylized toy-like/chibi portrait of the person in the personal reference image, "
                        "set inside a cinematic visual world inspired by the year 1978. Add a dominant giant glowing 1978 sign."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-year-era-preset-save-output", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": "Create the actual media preset now with one required year field and one required personal reference image input.",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["created"] is True
    assert payload["record"]["label"] == "Single-Image Reference Preset"
    record = app_modules["store"].get_preset_by_key(payload["record"]["key"])
    assert [field["key"] for field in record["input_schema_json"]] == ["year"]
    assert [slot["key"] for slot in record["input_slots_json"]] == ["personal_reference"]
    assert "{{year}}" in record["prompt_template"]
    assert "[[personal_reference]]" in record["prompt_template"]
    assert "1978" not in record["prompt_template"]
    assert "[[face_reference]]" not in record["prompt_template"]
    assert "[[body_reference]]" not in record["prompt_template"]
    assert payload["record"]["thumbnail_url"].startswith("/api/control/files/")

    graph_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Use Single-Image Reference Preset in this graph.",
            "workflow": {"schema_version": 1, "name": "Use saved Single-Image Reference Preset", "nodes": [], "edges": [], "metadata": {}},
            "capability": "plan_graph",
        },
    )

    assert graph_response.status_code == 200, graph_response.text
    graph_payload = graph_response.json()
    guide_node = next(node for node in graph_payload["workflow"]["nodes"] if node["type"] == "utility.note")
    guide_body = guide_node["fields"]["body"]
    assert "Personal Reference" in guide_body
    assert "face and full-body" not in guide_body
    assert "character-sheet" not in guide_body


def test_media_assistant_preset_capability_registry_owns_phase11_templates() -> None:
    from app.assistant.preset_capabilities import match_preset_capability, preset_builder_capabilities

    capabilities = {capability["id"]: capability for capability in preset_builder_capabilities()}
    assert "single_image_reference_preset" in capabilities
    assert "multi_image_reference_preset" in capabilities
    assert "reference_style_preset" in capabilities
    assert capabilities["single_image_reference_preset"]["save_prompt_template"] == ""
    assert capabilities["multi_image_reference_preset"]["save_prompt_template"] == ""
    assert capabilities["reference_style_preset"]["save_prompt_template"] == ""

    year_match = match_preset_capability(
        "Create a media preset where I can enter the year and attach one personal reference image.",
        [{"label": "1978.jpg", "kind": "image"}],
    )
    browser_wording_year_match = match_preset_capability(
        "Create a media preset where I can enter a year and attach one picture of me.",
        [{"label": "1978.jpg", "kind": "image"}],
    )
    runtime_person_image_match = match_preset_capability(
        "Build an image-to-image preset that accepts a runtime image of a person later.",
        [{"label": "style2.jpg", "kind": "image"}],
    )
    multi_image_match = match_preset_capability(
        "Create an example test graph for this Media Preset with two input images.",
        [{"label": "style-a.jpg", "kind": "image"}, {"label": "style-b.jpg", "kind": "image"}],
    )
    assert year_match["id"] == "single_image_reference_preset"
    assert browser_wording_year_match["id"] == "single_image_reference_preset"
    assert runtime_person_image_match["id"] == "single_image_reference_preset"
    assert multi_image_match["id"] == "multi_image_reference_preset"


def test_media_assistant_saves_prompt_recipe_directly_from_graph(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Recipe direct save graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-recipe-direct-save-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/recipe-saves",
        json={
            "message": "Save this approved cinematic portrait prompt recipe now.",
            "workflow": workflow,
            "assistant_mode": "recipe",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["capability"] == "save_prompt_recipe"
    assert payload["artifact_kind"] == "prompt_recipe"
    assert payload["created"] is True
    assert payload["record"]["label"] == "Cinematic Portrait Prompt Recipe"
    assert app_modules["store"].get_prompt_recipe_by_key(payload["record"]["key"])["recipe_id"] == payload["record"]["recipe_id"]
    assert payload["assistant_session"]["messages"][-1]["content_json"]["activity_kind"] == "prompt_recipe_saved"


def test_media_assistant_saves_character_sheet_prompt_recipe_once(client, app_modules, monkeypatch) -> None:
    registry_module = importlib.import_module("app.graph.registry")
    invalidations: list[bool] = []
    monkeypatch.setattr(registry_module.registry, "invalidate", lambda: invalidations.append(True))
    workflow = {"schema_version": 1, "name": "Character Sheet recipe save graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-recipe-save-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    first_response = client.post(
        f"/media/assistant/sessions/{session_id}/recipe-saves",
        json={
            "message": "Save this approved Character Sheet v1 prompt recipe now.",
            "workflow": workflow,
            "assistant_mode": "recipe",
        },
    )
    second_response = client.post(
        f"/media/assistant/sessions/{session_id}/recipe-saves",
        json={
            "message": "Save this approved Character Sheet v1 prompt recipe now.",
            "workflow": workflow,
            "assistant_mode": "recipe",
        },
    )

    assert first_response.status_code == 200, first_response.text
    assert second_response.status_code == 200, second_response.text
    first_payload = first_response.json()
    second_payload = second_response.json()
    assert first_payload["created"] is True
    assert second_payload["created"] is False
    assert first_payload["record"]["key"] == "character_sheet_reference_v1"
    assert second_payload["record"]["recipe_id"] == first_payload["record"]["recipe_id"]
    assert app_modules["store"].get_prompt_recipe_by_key("character_sheet_reference_v1")["recipe_id"] == first_payload["record"]["recipe_id"]
    assert len(invalidations) == 1


def test_media_assistant_sanitizes_recipe_title_when_saving_from_graph(client, app_modules) -> None:
    workflow = {"schema_version": 1, "name": "Recipe title sanitize graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-recipe-title-sanitize-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/recipe-saves",
        json={
            "message": "Save this approved *cinematic portrait prompt recipe now.",
            "workflow": workflow,
            "assistant_mode": "recipe",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["record"]["label"] == "Cinematic Portrait Prompt Recipe"
    assert not payload["record"]["label"].startswith("*")


def test_media_assistant_creates_preset_sandbox_graph_before_saving(client, app_modules, monkeypatch) -> None:
    first_reference_id = _create_reference_image(app_modules, name="style-reference-a.jpg")
    second_reference_id = _create_reference_image(app_modules, name="style-reference-b.jpg")
    workflow = {"schema_version": 1, "name": "Style preset sandbox graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style-preset-sandbox-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": first_reference_id, "label": "style-reference-a.jpg"})
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": second_reference_id, "label": "style-reference-b.jpg"})

    def style_provider(**_kwargs):
        return {
            "generated_text": (
                "This looks like `Graphic Character Scene Builder`. "
                "Reusable direction: saturated hand-drawn poster illustration, thick black ink outlines, warm amber palette, "
                "dense wall props and stickers, expressive cartoon proportions, gritty paper texture, bold hand-lettered typography, "
                "wide character-scene composition, playful chaotic room mood. "
                "Use two runtime image inputs named Image Input 1 and Image Input 2."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "style-preset-sandbox",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    intake_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Turn these references into a Media Preset with two input images.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert intake_response.status_code == 200, intake_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create an example test graph for this Media Preset with two input images, face reference and body reference.",
            "workflow": workflow,
            "capability": "plan_graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert payload["validation"]["valid"] is False
    assert payload["graph_plan"]["metadata"]["template_id"] == I2I_SANDBOX_TEMPLATE_ID
    assert payload["graph_plan"]["metadata"]["template_slot_count"] == 2
    node_titles = [node["metadata"]["ui"]["customTitle"] for node in payload["workflow"]["nodes"]]
    assert "Test Workflow Guide" in node_titles
    assert "Face Reference" in node_titles
    assert "Body Reference" in node_titles
    assert "Draft preset prompt" in node_titles
    assert "Preview" in node_titles
    assert "Save image" in node_titles
    assert not any(node["type"] == "preset.render" for node in payload["workflow"]["nodes"])
    load_nodes = [node for node in payload["workflow"]["nodes"] if node["type"] == "media.load_image"]
    assert len(load_nodes) == 2
    assert all("reference_id" not in node["fields"] for node in load_nodes)
    body_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Body Reference")
    face_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Face Reference")
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    preview_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Preview")
    save_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Save image")
    assert body_node["position"]["y"] - face_node["position"]["y"] >= 320
    assert prompt_node["position"]["y"] - body_node["position"]["y"] >= 320
    assert prompt_node["position"]["x"] > body_node["position"]["x"]
    assert save_node["position"]["y"] - preview_node["position"]["y"] >= 500
    prompt_text = prompt_node["fields"]["text"]
    assert "Graphic Character Scene Builder" in prompt_text
    assert "thick black ink outlines" in prompt_text
    assert "warm amber palette" in prompt_text
    assert "provided Face Reference as the identity and likeness source" in prompt_text
    assert "provided Body Reference as the body pose, proportions, wardrobe, and silhouette source" in prompt_text
    assert "baked-in extracted style direction" not in prompt_text
    assert "Media Preset test image" not in prompt_text
    assert any("actual Face Reference image" in warning for warning in payload["graph_plan"]["warnings"])
    assert any("actual Body Reference image" in warning for warning in payload["graph_plan"]["warnings"])
    assert app_modules["store"].get_preset_by_key("assistant_multi_image_reference_preset") is None

    apply_response = client.post(
        f"/media/assistant/plans/{payload['plan']['assistant_plan_id']}/apply",
        json={"workflow": workflow},
    )

    assert apply_response.status_code == 200, apply_response.text
    assert apply_response.json()["validation"]["valid"] is False
    applied_workflow = apply_response.json()["workflow"]
    assert [node["metadata"]["ui"]["customTitle"] for node in applied_workflow["nodes"]].count("Face Reference") == 1
    group = applied_workflow["metadata"]["groups"][0]
    assert set(group["node_ids"]) == {node["id"] for node in applied_workflow["nodes"]}
    guide_node = next(node for node in applied_workflow["nodes"] if node["metadata"]["ui"]["customTitle"] == "Test Workflow Guide")
    assert guide_node["id"] in group["node_ids"]
    bounds = group["bounds"]
    for node in applied_workflow["nodes"]:
        if node["id"] not in group["node_ids"]:
            continue
        assert bounds["x"] < node["position"]["x"]
        assert bounds["y"] < node["position"]["y"]


def test_media_assistant_reference_style_sandbox_requires_concrete_style_analysis(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules, name="style1.jpg")
    workflow = {"schema_version": 1, "name": "Reference style sandbox graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-reference-style-sandbox-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style1.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create a test sandbox for this reference style Media Preset.",
            "workflow": workflow,
            "capability": "plan_graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["workflow"]["nodes"] == []
    assert payload["graph_plan"]["operations"] == []
    assert payload["graph_plan"]["questions"]
    assert "concrete style read" in payload["graph_plan"]["summary"]
    assert any("placeholder graph" in warning for warning in payload["graph_plan"]["warnings"])


def test_media_assistant_reference_style_sandbox_extracts_style_to_text_prompt(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules, name="style1.jpg")
    workflow = {"schema_version": 1, "name": "Reference style runnable sandbox graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-reference-style-runnable-sandbox-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style1.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Create a Graph Studio temporary test graph workflow plan now using an extracted text style prompt "
                "from the prior assistant style analysis. Do not connect or require the attached style reference image "
                "as a runtime input. Add a Prompt node with a real image-generation prompt for the extracted style, "
                "a GPT text-to-image generator node, a Preview Image node, and a Save Image node.\n\n"
                "Prior assistant reference-style analysis:\n"
                "I can shape this into a `Reference Style Preset` preset. I would extract the look into the prompt, "
                "treat the attached references as analysis-only style sources, with no runtime image input yet. "
                "Do you want a runtime image input, such as a face, product, object, or background? "
                "Likely preset: a reusable `Illustrated Poster / Character Scene` style preset for grungy cartoon scenes "
                "with bold hand-drawn typography, warm ochre palette, messy doodle walls, and exaggerated character design. "
                "Should this preset generate original characters/scenes, or should it accept a `Person` image input?"
            ),
            "workflow": workflow,
            "capability": "plan_graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    node_titles = [node["metadata"]["ui"]["customTitle"] for node in payload["workflow"]["nodes"]]
    assert payload["graph_plan"]["metadata"]["template_id"] == T2I_SANDBOX_TEMPLATE_ID
    assert payload["graph_plan"]["metadata"]["template_slot_count"] == 0
    assert "Style Reference" not in node_titles
    assert "Subject Reference" not in node_titles
    assert not any(node["type"] == "media.load_image" for node in payload["workflow"]["nodes"])
    assert any(str(node["type"]).startswith("model.") for node in payload["workflow"]["nodes"])
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    assert "Create a new original image from text only" in prompt_text
    assert "without using the original reference image as an input" in prompt_text
    assert "Do you want a runtime image input" not in prompt_text
    assert "Should this preset" not in prompt_text
    assert "I can shape this into" not in prompt_text
    assert "warm ochre palette" in prompt_text
    assert "Extract the reusable visual style from the prior attached references" not in prompt_text
    assert "Create a Graph Studio" not in prompt_text
    assert payload["validation"]["valid"] is False
    assert any(error["code"] == "preset_prompt_quality_failed" for error in payload["validation"]["errors"])


def test_media_assistant_reference_style_sandbox_uses_provider_style_notes(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style1.jpg")
    workflow = {"schema_version": 1, "name": "Reference style provider sandbox graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-reference-style-provider-sandbox-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style1.jpg"})

    def style_provider(**kwargs):
        payload = {
            "title": "Grunge Cartoon Room Poster",
            "summary": "Grunge cartoon room poster with hand-lettered wall typography.",
            "target_model_mode": "text_to_image",
            "input_mode": "no_image",
            "visual_analysis": {
                "medium": ["grunge cartoon poster illustration"],
                "palette": ["mustard and dirty ochre palette"],
                "line_shape_language": ["thick black ink outlines"],
                "composition": ["messy bedroom clutter arranged as a poster scene"],
                "subject_treatment": ["expressive cartoon caricature proportions"],
                "environment_props": ["sticker-covered props", "graffiti doodles"],
                "texture_lighting": ["gritty paper texture"],
                "typography_text_energy": ["hand-lettered wall typography"],
                "mood": ["chaotic playful room mood"],
            },
            "replaceable_elements": ["headline slogan", "wardrobe styling"],
            "recommended_fields": [
                {"key": "headline", "label": "Headline", "default_value": "No Bad Days", "required": True},
                {"key": "wardrobe_styling", "label": "Wardrobe / Styling", "default_value": "oversized yellow tee and loose black pants", "required": False},
            ],
            "recommended_image_slots": [],
        }
        return {
            "generated_text": (
                "This looks like a good fit for a new style-driven Media Preset, something like `Grunge Cartoon Room Poster`. "
                "The attached image should be treated as a style reference, not a required runtime input. "
                "Reusable direction: mustard and dirty ochre palette, thick black ink outlines, hand-lettered wall typography, "
                "messy bedroom clutter, sticker-covered props, graffiti doodles, expressive cartoon caricature proportions, and gritty paper texture. "
                "The runtime media would be one required `Person` image slot. "
                "Useful fields: `Headline / Slogan` and `Wardrobe / Styling Notes`. "
                "One short question before sandbox: should typography stay prominent? "
                "Do you want this to stay text-only or accept a subject image too?"
                f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "reference-style-provider-sandbox-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    chat_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Turn this attached reference style into a reusable Media Preset.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert chat_response.status_code == 200, chat_response.text
    assistant_message = chat_response.json()["messages"][-1]
    style_brief = assistant_message["content_json"]["reference_style_brief"]
    assert style_brief["status"] == "draft"
    assert style_brief["preset_direction"]["title"] == "Grunge Cartoon Room Poster"
    assert "mustard and dirty ochre palette" in " ".join(style_brief["visual_analysis"]["palette"])
    assert "Useful fields: Headline / Slogan and Wardrobe / Styling Notes" in assistant_message["content_text"]
    assert "Do you want an image input" in assistant_message["content_text"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create a temporary test sandbox with the extracted text style prompt.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert not any(node["type"] == "media.load_image" for node in payload["workflow"]["nodes"])
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    assert "Grunge Cartoon Room Poster" in prompt_text
    assert "mustard and dirty ochre palette" in prompt_text
    assert "thick black ink outlines" in prompt_text
    assert "hand-lettered wall typography" in prompt_text
    assert "Avoid generic style drift" in prompt_text
    assert "copy exact source" not in prompt_text.lower()
    assert "runtime input" not in prompt_text
    assert "Do you want" not in prompt_text
    assert "runtime media" not in prompt_text.lower()
    assert "image slot" not in prompt_text.lower()
    assert "Useful fields" not in prompt_text
    assert "One short question" not in prompt_text
    assert "Extract the reusable visual style from the prior attached references" not in prompt_text

    draft_response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-drafts",
        json={
            "message": "Create the approved Media Preset from this style.",
            "workflow": payload["workflow"],
            "assistant_mode": "preset",
        },
    )
    assert draft_response.status_code == 200, draft_response.text
    prompt_template = draft_response.json()["draft"]["prompt_template"]
    assert "Grunge Cartoon Room Poster" in prompt_template
    assert "mustard and dirty ochre palette" in prompt_template
    assert "Avoid generic style drift" in prompt_template
    assert "copy exact source" not in prompt_template.lower()
    assert "Extract the reusable visual style from the prior attached references" not in prompt_template


def test_media_assistant_reference_style_brief_persists_without_provider_response_id(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style-no-response-id.jpg")
    workflow = {"schema_version": 1, "name": "Reference style no response id graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-reference-style-no-response-id", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style-no-response-id.jpg"})

    def style_provider(**_kwargs):
        payload = {
            "title": "Cyberpunk Poster Restyle",
            "summary": "Cyberpunk anime poster with distressed type, barcode panels, and chrome cybernetic details.",
            "target_model_mode": "image_edit",
            "input_mode": "image_required",
            "visual_analysis": {
                "medium": ["cyberpunk anime poster illustration"],
                "palette": ["teal-and-orange cyberpunk palette"],
                "line_shape_language": ["chrome cybernetic limbs", "technical UI labels"],
                "composition": ["dramatic foreshortened action pose", "dense Japanese editorial typography"],
                "subject_treatment": ["poster hero with cybernetic details"],
                "environment_props": ["barcode and warning sticker details", "gritty industrial background"],
                "texture_lighting": ["cinematic rim lighting", "worn ink edges", "distressed print texture"],
                "typography_text_energy": ["dense Japanese editorial typography", "overlay text panels"],
                "mood": ["rebellious cyberpunk poster energy"],
            },
            "replaceable_elements": ["poster theme", "overlay text", "person image"],
            "recommended_fields": [
                {"key": "poster_theme", "label": "Poster Theme", "default_value": "underground mech courier", "required": True},
                {"key": "overlay_text", "label": "Overlay Text", "default_value": "Signal Breaker", "required": False},
            ],
            "recommended_image_slots": [{"key": "person_reference", "label": "Person Reference", "required": True}],
        }
        return {
            "generated_text": (
                "Likely preset: `Cyberpunk Poster Restyle`. "
                "Style read: teal-and-orange cyberpunk anime poster, distressed print texture, dense Japanese editorial typography, "
                "technical UI labels, barcode and warning sticker details, dramatic foreshortened action pose, chrome cybernetic limbs, "
                "gritty industrial background, cinematic rim lighting, and worn ink edges. "
                "Useful fields: `Poster Theme` and `Overlay Text`. "
                "Image input: one required `Source Image`. "
                "If not, it can stay text-only and focus on style reproduction. "
                "If this is mainly for generating new characters in the same style, it can stay mostly text-driven with no required image. "
                "The preset should create an original poster in this style without copying exact slogan text. "
                "This should be an image-to-image preset with one required Person input. "
                "Question: preserve source pose closely or allow a stronger poster reinterpretation?"
                f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    chat_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create an image-to-image Media Preset from the attached cyberpunk poster style.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert chat_response.status_code == 200, chat_response.text
    assistant_message = chat_response.json()["messages"][-1]
    style_brief = assistant_message["content_json"]["reference_style_brief"]
    assert style_brief["status"] == "draft"
    assert style_brief["preset_direction"]["title"] == "Cyberpunk Poster Restyle"
    all_traits = " ".join(item for items in style_brief["visual_analysis"].values() for item in items)
    assert "teal-and-orange cyberpunk palette" in all_traits

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Use a required Source Image, fields Poster Theme and Overlay Text, and create the sandbox so we can test it.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert payload["graph_plan"]["metadata"]["template_id"] == I2I_SANDBOX_TEMPLATE_ID
    assert payload["graph_plan"]["metadata"]["template_slot_count"] == 1
    assert payload["graph_plan"]["operations"]
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    assert "Cyberpunk Poster Restyle" in prompt_text
    assert "teal-and-orange cyberpunk palette" in prompt_text
    assert "If not" not in prompt_text
    assert "If this is mainly" not in prompt_text
    assert "no required image" not in prompt_text
    assert "The preset should" not in prompt_text
    assert "This should be" not in prompt_text
    assert "one required Person input" not in prompt_text
    assert "Style read:" not in prompt_text
    assert "Graph Studio" not in prompt_text
    assert "temporary sandbox" not in prompt_text


def test_media_assistant_direct_text_only_sandbox_request_runs_style_intake_first(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style-direct-text-only.jpg")
    workflow = {"schema_version": 1, "name": "Direct text-only style sandbox graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-direct-text-only-style", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style-direct-text-only.jpg"})

    def style_provider(**_kwargs):
        return {
            "generated_text": (
                "This looks like `Cyberpunk Editorial Poster`. "
                "Style read: teal-and-orange cyberpunk anime poster, distressed print texture, dense Japanese typography, "
                "technical UI labels, barcode panels, dramatic foreshortened hero pose, chrome cybernetic details, and gritty industrial haze. "
                "Runnable sandbox draft: Output: vertical poster. Prompt: `A high-impact cyberpunk poster of [Character Brief]`. "
                "Useful fields: `Scene Brief` and `Poster Text`. "
                "Input: keep it text-only. "
                "Question: should the generated subject be a character, vehicle, or object?"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    chat_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create a text-to-image Media Preset from the attached reference style. "
                "Do not use any runtime image input. Suggest one or two editable fields, make a runnable sandbox, "
                "and keep the prompt concrete and self-contained."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert chat_response.status_code == 200, chat_response.text
    assistant_message = chat_response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] != "deterministic_preset_sandbox_request"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    style_brief = assistant_message["content_json"]["reference_style_brief"]
    assert style_brief["preset_direction"]["title"] == "Cyberpunk Editorial Poster"
    assert "teal-and-orange cyberpunk anime poster" in " ".join(style_brief["visual_analysis"]["palette"])

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the temporary text-to-image sandbox now.",
            "workflow": workflow,
            "capability": "plan_graph",
            "assistant_mode": "preset",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert payload["graph_plan"]["operations"]
    assert "Cyberpunk Editorial Poster" in payload["graph_plan"]["summary"]
    assert "Single-Image Reference Preset" not in payload["graph_plan"]["summary"]
    assert not any(node["type"] == "media.load_image" for node in payload["workflow"]["nodes"])
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    assert "Cyberpunk Editorial Poster" in prompt_text
    assert "cyberpunk" in prompt_text.lower()
    assert "Runnable sandbox draft" not in prompt_text
    assert "[Character Brief]" not in prompt_text
    assert "runtime image input" not in prompt_text
    assert "Graph Studio" not in prompt_text


def test_media_assistant_style_brief_rejects_sentence_as_title() -> None:
    brief = build_reference_style_brief(
        user_text="Turn this reference style into a reusable Media Preset.",
        assistant_text=(
            "This looks like a good fit for something like `a stylized illustrated poster/portrait preset for chaotic bedroom-scene character art`. "
            "Reusable direction: The attached reference reads as: gritty cartoon poster illustration with warm ochre and black palette, cluttered bedroom props, "
            "thick hand-drawn linework, oversized expressive faces, scrappy paper texture, and sarcastic playful mood. "
            "I’d keep the preset simple with editable fields: Scene / Subject and Wall Text."
        ),
        proposal={"title": "Reference Style Preset", "description": "Reusable reference style preset.", "preset_contract": {"fields": [], "image_slots": []}},
        attachments=[{"assistant_attachment_id": "asatt_title", "reference_id": "ref_title", "kind": "image"}],
    )

    assert brief.preset_direction.title == "Gritty Cartoon Poster Illustration"
    traits = " ".join(item for items in brief.visual_analysis.values() for item in items)
    assert "attached reference reads as" not in traits.lower()
    assert "editable fields" not in traits.lower()


def test_media_assistant_style_brief_replaces_palette_only_title() -> None:
    brief = build_reference_style_brief(
        user_text=(
            "I added a reference image and want to turn this look into a reusable Media Preset. "
            "I am not sure whether it should be text-only or use an image input."
        ),
        assistant_text=(
            "This looks like `Hot Pink`.\n\n"
            "I would lock the style around: hot pink and teal rebel styling; "
            "distressed checkerboard + paint-splatter backdrop; "
            "tattooed editorial portrait with bold banner text and a rough vintage-print finish.\n\n"
            "Suggested fields: Scene Brief, Optional Detail Notes. No image input yet."
        ),
        proposal={
            "title": "Reference Style Preset",
            "description": "Reusable reference style preset.",
            "preset_contract": {"fields": [], "image_slots": []},
        },
        attachments=[{"assistant_attachment_id": "asatt_palette_title", "reference_id": "ref_palette_title", "kind": "image"}],
    )

    assert brief.preset_direction.title != "Hot Pink"
    assert brief.preset_direction.title == "Tattooed Editorial Portrait"


def test_media_assistant_creates_year_personal_reference_sandbox_graph(client, app_modules, monkeypatch) -> None:
    first_reference_id = _create_reference_image(app_modules, name="1978.jpg")
    second_reference_id = _create_reference_image(app_modules, name="1989.jpg")
    workflow = {"schema_version": 1, "name": "Year preset sandbox graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-year-preset-sandbox-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": first_reference_id, "label": "1978.jpg"})
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": second_reference_id, "label": "1989.jpg"})

    def style_provider(**_kwargs):
        return {
            "generated_text": (
                "This looks like `Era Marker Character Poster`. "
                "Reusable direction: cinematic retro poster illustration, glowing oversized year numerals, warm neon-and-gold palette, "
                "toy-like character proportions, nostalgic period props, glossy sign lighting, centered hero composition, "
                "clean studio-grade depth and playful collectible mood. "
                "Use one runtime subject image input named Personal Reference and a Year field."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "year-personal-reference-sandbox",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    intake_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Using these attached style references, create a media preset where I can enter a year "
                "and attach one picture of me as the personal reference."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert intake_response.status_code == 200, intake_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Using these attached style references, create a media preset where I can enter a year "
                "and attach one picture of me as the personal reference. Create a temporary graph test sandbox first."
            ),
            "workflow": workflow,
            "capability": "plan_graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    node_titles = [node["metadata"]["ui"]["customTitle"] for node in payload["workflow"]["nodes"]]
    assert "Personal Reference" in node_titles
    assert "Face Reference" not in node_titles
    assert "Body Reference" not in node_titles
    load_nodes = [node for node in payload["workflow"]["nodes"] if node["type"] == "media.load_image"]
    assert len(load_nodes) == 1
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    assert "Era Marker Character Poster" in prompt_text
    assert "glowing oversized year numerals" in prompt_text
    assert "provided Personal Reference as the identity and likeness source" in prompt_text
    assert "Set the Year as" in prompt_text
    assert "{{year}}" not in prompt_text
    assert "period props, typography, palette, and decor" in prompt_text
    assert "baked-in extracted style direction" not in prompt_text
    assert "image reference 2" not in prompt_text.lower()
    assert any("actual Personal Reference image" in warning for warning in payload["graph_plan"]["warnings"])


def test_media_assistant_refines_existing_preset_sandbox_prompt(client, app_modules) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Skate preset sandbox graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a skater fashion photo with sadie."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-skate-refine-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Compare the current output against the skater reference images. Create a reviewable graph plan that only updates "
                "the draft preset prompt to push the style closer: more toy like 3d, oversized hoodie silhouette, bigger baggy jeans, "
                "stylized proportions, skateboard under feet, headphones and backpack details, less fashion photo. Do not run."
            ),
            "workflow": workflow,
            "capability": "plan_graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert payload["graph_plan"]["operations"][0]["op"] == "set_node_field"
    assert payload["graph_plan"]["operations"][0]["node_id"] == "prompt"
    next_prompt = payload["workflow"]["nodes"][0]["fields"]["text"]
    assert "approved reference style more closely" in next_prompt
    assert any("does not run the graph" in warning for warning in payload["graph_plan"]["warnings"])


def test_media_assistant_reference_style_refinement_uses_prior_style_analysis(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style1.jpg")
    workflow = {
        "schema_version": 1,
        "name": "Reference style refinement graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Create a polished media image using the attached references as fixed style inspiration."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-reference-style-refine-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style1.jpg"})

    def style_provider(**kwargs):
        style_payload = {
            "title": "Chaotic Graffiti Bedroom Caricature",
            "summary": "A rough cartoon bedroom poster style with wall slogans, doodles, and cluttered optimistic chaos.",
            "target_model_mode": "image_edit",
            "visual_analysis": {
                "medium": ["rough cartoon poster illustration", "grungy editorial room scene"],
                "palette": ["mustard yellow room palette", "dirty ochre paper tones", "heavy black ink contrast"],
                "line_shape_language": ["brushy hand-drawn outlines", "scribbled wall doodles", "exaggerated cartoon proportions"],
                "composition": ["wide cluttered bedroom composition", "large wall slogan dominates upper background", "foreground oversized sneakers anchor the frame"],
                "subject_treatment": ["expressive cartoon character with exaggerated features", "subject integrated into a messy room narrative"],
                "environment_props": ["poster-covered bedroom wall", "vinyl record", "cassette equipment", "desk clutter", "lamp glow"],
                "texture_lighting": ["dirty paper grain", "warm lamp light", "scuffed poster texture"],
                "typography_text_energy": ["large brush-lettered wall slogan", "small taped note typography", "doodle-like caption energy"],
                "mood": ["anxious but funny", "chaotic optimism", "messy bedroom humor"],
            },
            "fixed_style_traits": [
                "rough cartoon bedroom poster",
                "scribbled wall doodles",
                "bold brush-lettered slogan energy",
                "dirty warm paper texture",
            ],
            "recommended_fields": [
                {"key": "room_theme", "label": "Room Theme", "required": True},
                {"key": "poster_slogan", "label": "Poster Slogan", "required": False},
            ],
            "recommended_image_slots": [{"key": "subject_reference", "label": "Subject Reference", "required": True}],
            "source_specific_exclusions": ["exact source slogan", "exact source character identity"],
            "negative_guidance": ["avoid clean minimal bedrooms", "avoid photorealism", "avoid copying exact source text"],
        }
        return {
            "generated_text": (
                "Likely preset: `Chaotic Graffiti Bedroom Caricature`. "
                "Use a subject reference and keep bold room posters, comic doodles, and crowded sticker-wall energy. "
                f"{PROVIDER_BRIEF_JSON_OPEN}{json.dumps(style_payload)}{PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "style-analysis-refine-test",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", style_provider)
    chat_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Turn this attached reference style into a reusable Media Preset.",
            "workflow": {"schema_version": 1, "name": "Reference style intake", "nodes": [], "edges": [], "metadata": {}},
            "assistant_mode": "preset",
        },
    )
    assert chat_response.status_code == 200, chat_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Update the draft preset prompt with the specific style details you inferred.",
            "workflow": workflow,
            "capability": "plan_graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["graph_plan"]["operations"][0]["op"] == "set_node_field"
    next_prompt = payload["workflow"]["nodes"][0]["fields"]["text"]
    assert "Chaotic Graffiti Bedroom Caricature" in next_prompt
    assert "poster-covered bedroom wall" in next_prompt
    assert "brushy hand-drawn outlines" in next_prompt
    assert "large brush-lettered wall slogan" in next_prompt


def test_reference_style_refinement_marker_does_not_block_prompt_update(app_modules) -> None:
    del app_modules
    brief = ReferenceStyleBrief(
        brief_id="rsb_marker_refinement",
        preset_direction=ReferenceStylePresetDirection(
            title="Marker Safe Editorial Poster",
            target_model_mode="image_edit",
        ),
        visual_analysis={
            "medium": ["editorial poster illustration", "graphic collage layout"],
            "palette": ["warm neutral background", "single bright accent color"],
            "line_shape_language": ["bold geometric framing blocks", "clean silhouette emphasis"],
            "composition": ["center hero subject", "large title margin", "layered callout zones"],
            "subject_treatment": ["subject becomes the main poster hero"],
            "environment_props": ["abstract studio surface", "small label stickers"],
            "texture_lighting": ["softbox lighting", "subtle paper grain"],
            "typography_text_energy": ["large condensed headline", "small technical microtype"],
            "mood": ["premium editorial energy"],
        },
        fixed_style_traits=["editorial poster collage", "geometric callout system", "paper grain"],
        source_specific_exclusions=["exact source logo", "exact source text"],
    )
    workflow = GraphWorkflow(
        schema_version=1,
        name="Marker refinement",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "Create a polished media image using the attached references as fixed style inspiration."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Update the draft preset prompt with the specific style details you inferred.\n\n"
        f"{encode_reference_style_brief_marker(brief)}"
    )

    plan = plan_graph_from_message(message, workflow, [])

    assert plan.operations
    assert plan.operations[0].op == "set_node_field"
    assert "Marker Safe Editorial Poster" in plan.operations[0].fields["text"]


def test_media_assistant_output_aware_refinement_plan_uses_latest_run(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-output-aware-plan",
        workflow_id="workflow-output-aware-plan",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-output-aware-plan",
        "name": "Skate output-aware sandbox graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a skater fashion photo with sadie."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-output-aware-plan", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Compare the latest output to the skater refs and push the style closer. It is missing key elements.",
            "workflow": workflow,
            "capability": "plan_graph",
            "run_id": run_id,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert "latest generated output" in payload["graph_plan"]["summary"]
    assert payload["graph_plan"]["operations"][0]["op"] == "set_node_field"
    assert payload["graph_plan"]["operations"][0]["node_id"] == "prompt"
    next_prompt = payload["workflow"]["nodes"][0]["fields"]["text"]
    assert "latest generated output" not in next_prompt
    assert "currently attached references" not in next_prompt
    assert "Additional visual direction" not in next_prompt
    assert "Strengthen the next version" not in next_prompt
    assert "Emphasize key elements." in next_prompt
    assert "key elements" in next_prompt
    assert any("latest completed run output" in warning for warning in payload["graph_plan"]["warnings"])
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    assert usage_rows[0]["usage_json"]["latest_run_id"] == run_id
    assert usage_rows[0]["usage_json"]["output_aware"] is True


def test_media_assistant_output_check_keeps_missing_and_prompt_delta_separate() -> None:
    output_check = build_reference_style_output_check(
        "\n".join(
            [
                "- Matches: aged paper and ticket layout are close.",
                "- Missing: ticket should be cleaner with more open cream paper.",
                "- Refine once: brighten the paper base and sharpen ticket geometry.",
            ]
        ),
        latest_output_asset_id="asset-output-1",
        reference_ids=["ref-style-1"],
    )

    assert output_check.next_action == "update_prompt"
    assert output_check.missing_traits == ["Missing: ticket should be cleaner with more open cream paper."]
    assert output_check.prompt_delta == "brighten the paper base and sharpen ticket geometry"


def test_media_assistant_output_aware_refinement_removes_contrast_scaffold() -> None:
    workflow = GraphWorkflow(
        name="Output-aware prompt cleanup",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "text": (
                        "Cyber fairy industrial poster with cold blue haze, utility poles, translucent wings, dense typography.\n\n"
                        "Strengthen the next version by adding more of the output feels cleaner and more heroic; the reference has a grittier flyer feel."
                    ),
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}, "assistant": {"semantic_ref": "prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Update the current test prompt from the latest output comparison.\n\n"
        "Prior assistant output comparison:\n"
        "- Improve: the output feels cleaner and more heroic; the reference has a grittier Y2K-tech flyer feel with smaller microtype clusters, softer blur, and a more fragile crouched-body tension.\n"
        "- Prompt tweak: Refine once: push the prompt toward scrappier micrographic density, slightly dirtier diffusion, and a less polished editorial pose before saving the preset."
    )

    plan = plan_graph_from_message(message, workflow, [], latest_run={"run_id": "run_cleanup"})
    next_prompt = plan.operations[0].fields["text"]

    assert "the output feels cleaner" not in next_prompt
    assert "the reference has" not in next_prompt
    assert "push the prompt toward" not in next_prompt
    assert "before saving" not in next_prompt
    assert "the preset" not in next_prompt
    assert "Strengthen the next version" not in next_prompt
    assert "Emphasize" in next_prompt
    assert "grittier Y2K-tech flyer feel" in next_prompt
    assert "scrappier micrographic density" in next_prompt


def test_media_assistant_output_check_splits_merged_labeled_fragments() -> None:
    output_check = build_reference_style_output_check(
        "\n".join(
            [
                "- Matches: strong double-exposure silhouette and warm poster palette.",
                "- Improve: add denser cultural detail inside the silhouette; Prompt tweak: sharpen secondary typography and layer more landmarks through the torso.",
            ]
        ),
        latest_output_asset_id="asset-output-1",
        reference_ids=["ref-style-1"],
    )

    assert output_check.next_action == "update_prompt"
    assert output_check.missing_traits == ["Improve: add denser cultural detail inside the silhouette"]
    assert output_check.prompt_delta == "sharpen secondary typography and layer more landmarks through the torso"


def test_media_assistant_output_check_removes_visible_refine_scaffold() -> None:
    output_check = build_reference_style_output_check(
        "\n".join(
            [
                "- Matches: giant low-angle shoe perspective, bright cobalt sky, and cute companion energy are landing well.",
                "- Improve: the reference style has stronger storybook polish and whimsy.",
                "- Prompt tweak: The reference style has a stronger storybook polish and whimsy push; Refine once. I’d push the prompt toward more animated charm, shinier stylization, and one clearer whimsical prop beat before saving the preset.",
            ]
        ),
        latest_output_asset_id="asset-output-1",
        reference_ids=["ref-style-10"],
    )

    assert output_check.next_action == "update_prompt"
    assert output_check.prompt_delta == "more animated charm, shinier stylization, and one clearer whimsical prop beat"
    assert "Refine once" not in output_check.prompt_delta
    assert "before saving" not in output_check.prompt_delta


def test_media_assistant_output_aware_refinement_removes_test_again_scaffold() -> None:
    workflow = GraphWorkflow(
        name="Output-aware test-again prompt cleanup",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "text": (
                        "Whimsical giant-perspective adventure portrait with low-angle scale, "
                        "sunny alley, oversized foreground foot, and cute companion storytelling."
                    ),
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}, "assistant": {"semantic_ref": "prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Update the current test prompt from the latest output comparison.\n\n"
        "Prior assistant output comparison:\n"
        "- Matches: the low-angle composition is close.\n"
        "- Improve: the output is more photoreal and less glossy-whimsical than the reference.\n"
        "- Prompt tweak: push a slightly more stylized glossy character finish and stronger cute-companion emphasis, then test again."
    )

    plan = plan_graph_from_message(message, workflow, [], latest_run={"run_id": "run_test_again_cleanup"})
    next_prompt = plan.operations[0].fields["text"]

    assert "then test again" not in next_prompt
    assert "test again" not in next_prompt
    assert "push a slightly" not in next_prompt
    assert "slightly more stylized glossy character finish" in next_prompt
    assert "stronger cute-companion emphasis" in next_prompt
    assert ",." not in next_prompt


def test_media_assistant_output_aware_refinement_removes_positive_match_scaffold() -> None:
    workflow = GraphWorkflow(
        name="Output-aware positive match cleanup",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "text": (
                        "Cinematic collector-room crossover portrait with warm sunset light, central seated subject, "
                        "surrounding stylized companion cast, dense shelves, books, figurines, and cozy fandom-lounge detail.\n\n"
                        "Increase the warm sunset collector-room look is there, the central seated subject reads clearly, "
                        "and the supporting cast now has stronger silhouette variety and cleaner spacing.; "
                        "the human realism contrast and collector clutter density; Want me to prep that final prompt tweak?."
                    ),
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}, "assistant": {"semantic_ref": "prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Update the current test prompt from the latest output comparison.\n\n"
        "Prior assistant output comparison:\n"
        "- Matches: the warm sunset collector-room look is there, the central seated subject reads clearly, and the supporting cast now has stronger silhouette variety and cleaner spacing.\n"
        "- Improve: the warm sunset collector-room look is there, the central seated subject reads clearly, and the supporting cast now has stronger silhouette variety and cleaner spacing.\n"
        "- Prompt tweak: one more prompt pass should push the human realism contrast and collector clutter density; I would update once more rather than save yet. Want me to prep that final prompt tweak?"
    )

    plan = plan_graph_from_message(message, workflow, [], latest_run={"run_id": "run_positive_match_cleanup"})
    next_prompt = plan.operations[0].fields["text"]

    assert "Strengthen the next version" not in next_prompt
    assert "the warm sunset collector-room look is there" not in next_prompt
    assert "reads clearly" not in next_prompt
    assert "Want me" not in next_prompt
    assert "one more prompt pass" not in next_prompt
    assert "human realism contrast" in next_prompt
    assert "collector clutter density" in next_prompt


def test_media_assistant_output_aware_refinement_sanitizes_existing_brand_text_prompt() -> None:
    workflow = GraphWorkflow(
        name="Output-aware brand text cleanup",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "text": (
                        "Collector lounge portrait with warm window light, surrounding companion figures, "
                        "visible branded book spines and graphic merchandise text in the foreground."
                    ),
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}, "assistant": {"semantic_ref": "prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Update the current test prompt from the latest output comparison.\n\n"
        "Prior assistant output comparison:\n"
        "- Improve: the reference has a stronger ensemble portrait setup.\n"
        "- Prompt tweak: use larger surrounding companion figures around the sofa and less emphasis on foreground merchandise."
    )

    plan = plan_graph_from_message(message, workflow, [], latest_run={"run_id": "run_brand_text_cleanup"})
    next_prompt = plan.operations[0].fields["text"]

    lowered = next_prompt.lower()
    assert "visible branded" not in lowered
    assert "merchandise text" not in lowered
    assert "invented collectible book spines" in lowered
    assert "decorative graphic set dressing with no real brands" in lowered
    assert "larger surrounding companion figures" in lowered


def test_media_assistant_output_aware_refinement_replaces_prior_refinement_tail() -> None:
    workflow = GraphWorkflow(
        name="Output-aware repeated refinement cleanup",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "text": (
                        "Collector lounge portrait with warm window light and surrounding companion figures. "
                        "Emphasize a tighter group-portrait composition with larger surrounding companion figures around the sofa."
                    ),
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}, "assistant": {"semantic_ref": "prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Update the current test prompt from the latest output comparison.\n\n"
        "Prior assistant output comparison:\n"
        "- Prompt tweak: use larger surrounding companion figures around the sofa and less emphasis on foreground merchandise."
    )

    plan = plan_graph_from_message(message, workflow, [], latest_run={"run_id": "run_repeated_refinement_cleanup"})
    next_prompt = plan.operations[0].fields["text"]

    assert next_prompt.count("Emphasize") == 1
    assert "less emphasis on foreground merchandise" in next_prompt


def test_media_assistant_refinement_uses_exact_delta_not_generic_verdict() -> None:
    workflow = GraphWorkflow(
        name="Exact comparison delta cleanup",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "Neon punk graffiti creature poster with a giant magenta letterform."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}, "assistant": {"semantic_ref": "prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Apply a reviewable prompt update using this exact comparison delta only: "
        "make the render slightly flatter and more graphic, reduce micro-detail, simplify texture clusters, "
        "and make the background letterform read as one bold compositional mass behind the figure. "
        "Do not add generic comparison labels to the prompt.\n\n"
        "Prior assistant output comparison:\n"
        "- Prompt tweak: Close enough to justify one last paid refinement."
    )

    plan = plan_graph_from_message(message, workflow, [], latest_run={"run_id": "run_exact_delta_cleanup"})
    next_prompt = plan.operations[0].fields["text"]

    assert "Close enough to justify one last paid refinement" not in next_prompt
    assert "make the render slightly flatter and more graphic" in next_prompt
    assert "background letterform read as one bold compositional mass" in next_prompt


def test_media_assistant_output_aware_refinement_removes_still_leans_diagnostic() -> None:
    workflow = GraphWorkflow(
        name="Output-aware still-leans cleanup",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "Collector lounge portrait with warm light and original companion figures."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}, "assistant": {"semantic_ref": "prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Update the current test prompt from the latest output comparison.\n\n"
        "Prior assistant output comparison:\n"
        "- Improve: the reference is a fuller ensemble tableau with more balanced human-scale characters across the whole frame; this output still leans more editorial and sparse, with a few branded/readable merch details still pulling focus.\n"
        "- Prompt tweak: Push a denser ensemble portrait with larger companion figures distributed around the couch, and suppress readable text, logos, and branded merch accents."
    )

    plan = plan_graph_from_message(message, workflow, [], latest_run={"run_id": "run_still_leans_cleanup"})
    next_prompt = plan.operations[0].fields["text"]
    lowered = next_prompt.lower()

    assert "this output still" not in lowered
    assert "still pulling focus" not in lowered
    assert "branded/readable merch" not in lowered
    assert "denser ensemble portrait" in lowered
    assert "suppress readable text, logos, and branded merch accents" in lowered


def test_media_assistant_output_aware_refinement_removes_shift_diagnostic_scaffold() -> None:
    workflow = GraphWorkflow(
        name="Output-aware shift diagnostic cleanup",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "text": (
                        "Cinematic fandom lounge portrait with a real central seated person, warm amber light, "
                        "collector-room shelves, table props, stylized anime display figures, and dense cozy fan clutter."
                    ),
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}, "assistant": {"semantic_ref": "prompt"}},
            }
        ],
        edges=[],
    )
    message = (
        "Update the current test prompt from the latest output comparison.\n\n"
        "Prior assistant output comparison:\n"
        "- Matches: warm sunset collector-lounge mood, centered seated portrait, and layered fandom-display storytelling all came through well.\n"
        "- Improve: the output shifts into a fantasy-creatures ensemble instead of the tighter anime-figure fandom energy from the reference, and the room props feel more premium-fantasy than manga/anime collectible dense.\n"
        "- Prompt tweak: the output shifts into a fantasy-creatures ensemble instead of the tighter anime-figure fandom energy from the reference, and the room props feel more premium-fantasy than manga/anime collectible dense; I’d tighten the surrounding cast toward stylized collectible/anime display energy and increase the shelf/table fandom clutter."
    )

    output_check = build_reference_style_output_check(message)
    assert "the output shifts" not in output_check.prompt_delta
    assert "tighter surrounding cast" in output_check.prompt_delta
    assert "shelf/table fandom clutter" in output_check.prompt_delta

    plan = plan_graph_from_message(message, workflow, [], latest_run={"run_id": "run_shift_cleanup"})
    next_prompt = plan.operations[0].fields["text"]

    assert "the output shifts" not in next_prompt
    assert "premium-fantasy" not in next_prompt
    assert "I’d tighten" not in next_prompt
    assert "Use a tighter surrounding cast" in next_prompt
    assert "tighter surrounding cast" in next_prompt
    assert "stylized collectible/anime display energy" in next_prompt
    assert "shelf/table fandom clutter" in next_prompt


def test_media_assistant_output_check_does_not_turn_save_ready_language_into_prompt_delta() -> None:
    output_check = build_reference_style_output_check(
        "\n".join(
            [
                "- Matches: the icy blue cyber-goth palette, low-angle utility-pole setting, translucent wings, and dense poster typography are all very close to the style reference.",
                "- Improve: the reference has a slightly softer dream-glow, but the overall look is already consistent enough for a reusable preset.",
                "- Prompt tweak: the reference has a slightly softer dream-glow, but the overall look is already consistent enough for a reusable preset.",
                "If you like this result, I can save it as the Media Preset.",
            ]
        ),
        latest_output_asset_id="asset-output-save-ready",
        reference_ids=["ref-style-9"],
    )

    assert output_check.next_action == "save_preset"
    assert output_check.prompt_delta == ""
    assert "consistent enough" not in output_check.prompt_delta


def test_media_assistant_output_comparison_stays_in_media_preset_skill(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style7-compare.jpg")
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-style7-media-preset-compare",
        workflow_id="workflow-style7-media-preset-compare",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-style7-media-preset-compare",
        "name": "Style7 media preset comparison",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Create a double-exposure travel poster portrait."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-style7-media-preset-compare", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style7-compare.jpg"})
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session_response.json(),
            "summary_json": {
                "media_preset_builder": {
                    "skill": "create_media_preset",
                    "status": "sandbox_run",
                    "latest_output_run_id": run_id,
                }
            },
        }
    )

    def compare_provider(**_kwargs):
        return {
            "generated_text": (
                "I compared the latest output to the reference. It captures the double-exposure portrait and warm travel poster mood, "
                "but the title text is not controlled and the destination details need a stronger Location field. Suggested update: "
                "lock the portrait silhouette, use the provided subject likeness more strongly, and make poster lettering decorative unless a title is supplied."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_response_id": "style7-output-compare",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", compare_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Compare the latest output again and tell me what to adjust before saving.",
            "workflow": workflow,
            "assistant_mode": "preset",
            "run_id": run_id,
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert "title text" in assistant_message["content_text"]
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    skill_trace = usage_rows[-1]["usage_json"]["skill_trace"]
    assert skill_trace["skill"] == "media_preset_builder"
    assert skill_trace["legacy_skill"] == "create_media_preset"
    assert skill_trace["provider_called"] is True
    assert skill_trace["latest_run_id"] == run_id
    assert skill_trace["latest_output_asset_id"]


def test_media_assistant_refinement_confirmation_does_not_restart_preset_intake(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules, name="style-refinement.jpg")
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-refinement-confirmation",
        workflow_id="workflow-refinement-confirmation",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-refinement-confirmation",
        "name": "Reference style refinement confirmation",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create an original image in the Neon Alley Ink Poster reusable style. "
                        "Use hot orange and magenta, thick black ink linework, oversized sneakers, and urban poster energy."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt", "assistant": {"semantic_ref": "prompt"}}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-refinement-confirmation", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style-refinement.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "yes apply that prompt update to the current draft preset prompt then run it again",
            "workflow": workflow,
            "assistant_mode": "preset",
            "run_id": run_id,
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_sandbox_refinement"
    assert assistant_message["content_json"].get("preset_builder_proposal") is None
    assert "prompt update" in assistant_message["content_text"]
    assert "reviewable prompt update" not in assistant_message["content_text"]
    assert "one runtime" not in assistant_message["content_text"].lower()


def test_media_assistant_refinement_confirmation_uses_prior_output_comparison(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-refinement-confirmation-plan",
        workflow_id="workflow-refinement-confirmation-plan",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-refinement-confirmation-plan",
        "name": "Reference style refinement confirmation plan",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create an original image in the Neon Alley Ink Poster reusable style. "
                        "Use hot orange and magenta, thick black ink linework, oversized sneakers, and urban poster energy."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-refinement-confirmation-plan", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session_response.json(),
            "summary_json": {
                "reference_style_brief": {
                    "brief_id": "brief-stale-update-title",
                    "source_reference_ids": ["reference-stale"],
                    "version": 1,
                    "status": "draft",
                    "preset_direction": {
                        "title": "Update The Style Prompt To Shift Away From A Mostly Human Street Poste",
                        "one_line_summary": "Stale refinement-style brief that should not replace a concrete prompt.",
                        "target_model_mode": "text_to_image",
                    },
                    "visual_analysis": {
                        "medium": ["update the style prompt toward a stranger poster read"],
                        "palette": ["hot orange and magenta palette"],
                        "line_shape_language": ["glossy black creature-like body shapes and thick ink linework"],
                        "composition": ["iconic poster read with oversized sneaker emphasis"],
                        "texture_lighting": ["glossy finish and black ink splatter"],
                        "mood": ["punk alley energy"],
                    },
                    "preset_contract": {"fields": [], "image_slots": []},
                    "prompt_blueprint": {"fixed_style_ingredients": [], "variable_ingredients": [], "negative_guidance": []},
                    "verification_targets": {"must_match": [], "may_vary": [], "must_not_copy": []},
                    "validation_warnings": [],
                }
            },
        }
    )
    app_modules["store_assistant"].create_assistant_message(
        {
            "assistant_session_id": session_id,
            "role": "assistant",
            "content_text": (
                "I compared the latest output against the attached refs.\n"
                "- Matches: Palette and splatter are close. Refine: I’d do one more pass to increase glossy black ink density before saving.\n"
                "- Missing weird character silhouette and glossy black creature shapes.\n"
                "- Improve: denser cultural/location storytelling; Prompt tweak: sharpen the creature-like silhouette and sticker-poster chaos; Recommendation: refine once before saving.\n"
                "I can prepare a reviewable prompt update now; apply it from the workflow review, then test it again."
            ),
            "content_json": {"output_aware": True, "latest_run_id": run_id},
        }
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "yes apply that prompt update to the current draft preset prompt then run it again",
            "workflow": workflow,
            "capability": "plan_graph",
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["graph_plan"]["operations"][0]["op"] == "set_node_field"
    assert len(payload["graph_plan"]["operations"]) == 1
    next_prompt = payload["workflow"]["nodes"][0]["fields"]["text"]
    assert "latest generated output" not in next_prompt
    assert "visual comparison notes" not in next_prompt
    assert "Refinement for the next test run" not in next_prompt
    assert "Refine:" not in next_prompt
    assert "Next prompt change" not in next_prompt
    assert "Improve:" not in next_prompt
    assert "Prompt tweak:" not in next_prompt
    assert "Recommendation:" not in next_prompt
    assert "Emphasize this in the prompt" not in next_prompt
    assert "before saving" not in next_prompt
    assert "Additional visual direction" not in next_prompt
    assert "Strengthen the next version" not in next_prompt
    assert "Emphasize" in next_prompt
    assert "weird character silhouette" in next_prompt
    assert "glossy black creature shapes" in next_prompt
    assert "sticker-poster chaos" in next_prompt
    assert "Neon Alley Ink Poster" in next_prompt
    assert "Update The Style Prompt" not in next_prompt
    assert "media.load_image" not in {node["type"] for node in payload["workflow"]["nodes"]}


def test_media_assistant_output_aware_refinement_preserves_year_era_sandbox(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-year-era-output-aware-plan",
        workflow_id="workflow-year-era-output-aware-plan",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-year-era-output-aware-plan",
        "name": "Year era output-aware sandbox graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create a polished stylized portrait of the person in the personal reference image, "
                        "set inside a cinematic visual world inspired by the year 1978. Use the attached style references "
                        "as fixed inspiration for the overall year-number composition."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-year-era-output-aware-plan", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Compare the current output to the attached style refs and push it closer: more toy chibi proportions, "
                "stronger giant glowing year sign, neon year world props, and closer reference composition."
            ),
            "workflow": workflow,
            "capability": "plan_graph",
            "run_id": run_id,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert "approved reference style" in payload["graph_plan"]["summary"]
    assert payload["graph_plan"]["operations"][0]["op"] == "set_node_field"
    next_prompt = payload["workflow"]["nodes"][0]["fields"]["text"]
    assert "year 1978" in next_prompt
    assert "latest generated output" not in next_prompt
    assert "Additional visual direction" not in next_prompt
    assert "Strengthen the next version" not in next_prompt
    assert "Emphasize" in next_prompt
    assert "toy chibi proportions" in next_prompt
    assert "giant glowing year sign" in next_prompt
    assert "personal reference image" in next_prompt
    assert "skater" not in next_prompt.lower()
    assert "skateboard" not in next_prompt.lower()


def test_media_assistant_compacts_preset_sandbox_refinement_chat(client, app_modules) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Skate preset sandbox graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a skater fashion photo with sadie."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-skate-refine-chat-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Compare the current output to the skater refs and push the style closer, it is close but missing a few elements.",
            "workflow": workflow,
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["role"] == "assistant"
    assert len(assistant_message["content_text"]) < 500
    assert "prompt update" in assistant_message["content_text"]
    assert "workflow review" not in assistant_message["content_text"]
    assert "plan card" not in assistant_message["content_text"]
    assert "full prompt" not in assistant_message["content_text"].lower()
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_sandbox_refinement"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"


def test_media_assistant_text_only_sandbox_request_is_not_save_intent(client, app_modules, monkeypatch) -> None:
    def fake_provider_chat(**_kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": "I can prepare a temporary sandbox graph for that preset after you review the extracted style.",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "sandbox-not-save",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    reference_id = _create_reference_image(app_modules, name="text-style-not-save.jpg")
    workflow = {"schema_version": 1, "name": "Text style not save", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-text-style-not-save", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "text-style-not-save.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Extract the attached reference images into a reusable text style prompt. "
                "Do not use the style reference image as a runtime image input. "
                "Keep this text-driven with one or two editable fields, then create a temporary text-to-image test graph for this preset."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] != "deterministic_preset_save_request"
    assert "save the approved Media Preset" not in assistant_message["content_text"]


def test_media_assistant_followup_sandbox_reuses_single_image_contract(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="single-input-style.jpg")
    workflow = {"schema_version": 1, "name": "Single input style", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-single-input-style", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "single-input-style.jpg"})

    def fake_provider_chat(**_kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "This looks like `Streetwear Slogan Cap Hero`. "
                "Reusable direction: close-up editorial streetwear poster-photo, black cap silhouette, warm amber indoor background blur, "
                "bold white slogan typography, glossy eyewear highlights, tight commercial crop, lo-fi grain texture, cheeky rebellious attitude. "
                "Use one runtime subject image input named Personal Reference."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "single-input-contract",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    intake_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Turn this attached reference image into a reusable Media Preset. "
                "I want one runtime subject image input so I can attach a person or product later."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert intake_response.status_code == 200, intake_response.text
    contract = intake_response.json()["summary_json"]["reference_style_contract"]
    assert [slot["label"] for slot in contract["image_slots"]] == ["Personal Reference"]

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create the test sandbox now with exactly one runtime image input named Personal Reference. Do not add a second image input.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    load_nodes = [node for node in plan_response.json()["workflow"]["nodes"] if node["type"] == "media.load_image"]
    assert [node["metadata"]["ui"]["customTitle"] for node in load_nodes] == ["Personal Reference"]
    prompt_node = next(node for node in plan_response.json()["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    assert "Streetwear Slogan Cap Hero" in prompt_text
    assert "black cap silhouette" in prompt_text
    assert "warm amber indoor background blur" in prompt_text
    assert "provided Personal Reference as the identity and likeness source" in prompt_text
    assert "baked-in extracted style direction" not in prompt_text
    assert load_nodes[0]["position"]["y"] < prompt_node["position"]["y"]
    assert prompt_node["position"]["y"] <= 700


def test_media_assistant_temporary_sandbox_preserves_explicit_image_to_image_intent(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="image-to-image-temporary-style.jpg")
    workflow = {"schema_version": 1, "name": "Image input sandbox", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-image-input-sandbox", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "image-to-image-temporary-style.jpg"})

    def fake_provider_chat(**_kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "This looks like `Ink Pop Portrait Poster`. "
                "Reusable direction: hot pink and teal punk poster palette, distressed print grain, bold slogan-banner framing, "
                "jewelry and tattoo detail, face-forward editorial pose, black ink accents, irreverent glam attitude. "
                "Use one runtime subject image input named Personal Reference."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "image-input-temporary-sandbox",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    intake_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create an image-to-image Media Preset from the attached style with one input image for the main subject.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert intake_response.status_code == 200, intake_response.text

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Create an image-to-image temporary sandbox to test it with one input image for the main subject. "
                "The attached style reference should be compiled into the prompt, not wired as the runtime input."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    node_types = {node["type"] for node in payload["workflow"]["nodes"]}
    assert "media.load_image" in node_types
    assert "model.kie.gpt_image_2_image_to_image" in node_types
    assert "model.kie.gpt_image_2_text_to_image" not in node_types
    load_nodes = [node for node in payload["workflow"]["nodes"] if node["type"] == "media.load_image"]
    assert [node["metadata"]["ui"]["customTitle"] for node in load_nodes] == ["Main Subject"]


def test_media_assistant_compact_style_reply_can_create_image_to_image_sandbox(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="compact-style6.jpg")
    workflow = {"schema_version": 1, "name": "Compact style sandbox", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-compact-style-sandbox", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "compact-style6.jpg"})

    def fake_provider_chat(**_kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Likely preset: `Pop-Punk Grunge Poster Portrait` Style read: distressed punk poster energy with hot pink "
                "and teal accents, checkerboard/graffiti texture, heavy accessories, and bold banner typography. "
                "Suggested preset shape: - `Subject Image` as the single required image input - `Top Text` as a short "
                "editable field - `Bottom Text` as a short editable field This should stay `image-to-image` with one "
                "separate user-provided subject image, not reuse this exact reference image at runtime. For testing, "
                "the next step would be a temporary Graph Studio sandbox, not a saved preset. One question: should the "
                "banner text be part of the preset, or do you want the same visual style but without built-in text?"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "compact-style6-sandbox",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    intake_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create an image-to-image Media Preset from this reference style. "
                "Use one input image for the main subject plus one or two useful fields."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert intake_response.status_code == 200, intake_response.text
    style_brief = intake_response.json()["summary_json"]["reference_style_brief"]
    assert style_brief["status"] == "draft"

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Use inputs + test",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["graph_plan"]["summary"] != "I need concrete extracted style notes before creating a runnable preset sandbox graph."
    node_types = {node["type"] for node in payload["workflow"]["nodes"]}
    assert "media.load_image" in node_types
    assert "model.kie.gpt_image_2_image_to_image" in node_types
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt")
    prompt_text = prompt_node["fields"]["text"]
    assert "Pop-Punk Grunge Poster Portrait" in prompt_text
    assert "checkerboard/graffiti texture" in prompt_text
    assert "Graph Studio" not in prompt_text
    assert "temporary sandbox" not in prompt_text
    assert "Suggested preset shape" not in prompt_text


def test_media_assistant_rejected_fields_turn_returns_new_field_options(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style7-field-alternatives.jpg")
    workflow = {"schema_version": 1, "name": "Field alternatives", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-field-alternatives", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "style7-field-alternatives.jpg"},
    )

    call_count = {"count": 0}

    def first_turn_provider(**_kwargs):
        call_count["count"] += 1
        if call_count["count"] > 1:
            raise AssertionError("Rejected-field follow-up should use the stored image analysis, not rerun provider intake.")
        payload = {
            "title": "Cinematic Double-Exposure Travel Poster",
            "summary": "Double-exposure travel poster portrait with scenic destination imagery and poster typography.",
            "target_model_mode": "image_edit",
            "visual_analysis": {
                "medium": ["photo-illustration travel poster composite"],
                "palette": ["warm peach and gold sunrise light"],
                "composition": ["large side-profile portrait with landscape nested inside the head and torso"],
                "environment_props": ["mountain path", "landmark architecture", "small traveler figure"],
                "texture_lighting": ["paper grain", "soft haze"],
                "typography_text_energy": ["large lower headline", "small top tagline", "supporting subtitle"],
                "mood": ["reflective wanderlust"],
            },
            "replaceable_elements": [
                "destination landmarks",
                "poster title",
                "subtitle tagline",
                "small traveler detail",
            ],
            "recommended_fields": [
                {"key": "destination", "label": "Destination", "required": True},
                {"key": "poster_title", "label": "Poster Title", "required": False},
            ],
            "recommended_image_slots": [{"key": "face_reference", "label": "Face Reference", "required": True}],
        }
        return {
            "mode": "provider_chat",
            "generated_text": (
                "This looks like `Cinematic Double-Exposure Travel Poster`.\n"
                "Suggested setup:\n"
                "- Field: Destination\n"
                "- Field: Poster Title\n"
                "- Image input: Face Reference\n"
                "Create a test workflow with this setup?\n"
                f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "style7-field-alternatives-intake",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", first_turn_provider)
    intake_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create a media preset from this image.",
            "workflow": workflow,
            "assistant_mode": "preset",
            "metadata": {"preset_loop_lane": "image_to_image", "source": "guided_loop_ui"},
        },
    )
    assert intake_response.status_code == 200, intake_response.text

    alternative_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "I do not like those fields. What other fields would work for this preset?",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert alternative_response.status_code == 200, alternative_response.text
    assistant_message = alternative_response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_replacement_field_planning"
    assert assistant_message["content_json"]["assistant_prompt_route"] == "replacement_field_planning"
    assert "Locked to Image-to-Image" not in assistant_message["content_text"]
    assert "Other good fields from this image" in assistant_message["content_text"]
    assert "Suggested setup" not in assistant_message["content_text"]
    assert "- Field: Destination" not in assistant_message["content_text"]
    assert "- Field: Poster Title" not in assistant_message["content_text"]
    assert "Face Reference as the image input" in assistant_message["content_text"]
    labels = [
        field["label"]
        for field in alternative_response.json()["summary_json"]["reference_style_brief"]["preset_contract"]["fields"]
    ]
    assert labels != ["Destination", "Poster Title"]
    assert any(label in labels for label in ("Landmark / Scene Details", "Subtitle / Tagline", "Traveler Detail"))

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create test workflow",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert plan_response.status_code == 200, plan_response.text
    prompt_node = next(
        node
        for node in plan_response.json()["workflow"]["nodes"]
        if node["metadata"]["ui"]["customTitle"] == "Draft preset prompt"
    )
    prompt_text = prompt_node["fields"]["text"]
    assert "Set the Subtitle / Tagline as" in prompt_text
    assert "Set the Traveler Detail as" in prompt_text
    assert "Set the Destination as" not in prompt_text
    assert "Set the Poster Title as" not in prompt_text


def test_media_assistant_custom_image_slots_reuse_existing_style_brief(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style7-slot-followup.jpg")
    workflow = {"schema_version": 1, "name": "Slot followup", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-slot-followup", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]
    attachment_response = client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "style7-slot-followup.jpg"},
    )
    assert attachment_response.status_code == 200, attachment_response.text
    attachments = app_modules["store_assistant"].list_assistant_attachments(session_id)
    brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this portrait poster reference.",
        assistant_text=(
            "This looks like `Editorial Hero Portrait Poster`.\n"
            "Suggested setup:\n"
            "- Field: Headline\n"
            "- Field: Wardrobe Note\n"
            "- Image input: Subject Image\n"
            "Create a test workflow with this setup?\n"
            f"{PROVIDER_BRIEF_JSON_OPEN}\n"
            + json.dumps(
                {
                    "title": "Editorial Hero Portrait Poster",
                    "summary": "High-contrast editorial portrait poster with polished fashion lighting.",
                    "target_model_mode": "image_edit",
                    "visual_analysis": {
                        "medium": ["editorial portrait poster"],
                        "palette": ["black, silver, and warm skin tones"],
                        "composition": ["centered hero portrait with full-body fashion silhouette"],
                        "subject_treatment": ["sharp facial identity and styled body pose"],
                        "texture_lighting": ["glossy rim light and soft studio haze"],
                        "typography_text_energy": ["large headline and small magazine-style captions"],
                        "mood": ["premium cinematic fashion"],
                    },
                    "replaceable_elements": ["headline", "wardrobe note"],
                    "recommended_fields": [
                        {"key": "headline", "label": "Headline", "required": True},
                        {"key": "wardrobe_note", "label": "Wardrobe Note", "required": False},
                    ],
                    "recommended_image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
                }
            )
            + f"\n{PROVIDER_BRIEF_JSON_CLOSE}"
        ),
        proposal={},
        attachments=attachments,
    )
    assert has_concrete_style_traits(brief)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **app_modules["store_assistant"].get_assistant_session(session_id),
            "summary_json": {
                "reference_style_brief": brief.model_dump(mode="json"),
                "media_preset_builder": {"attachment_set_hash": attachment_set_hash(attachments)},
            },
        }
    )

    def fail_provider(**_kwargs):
        raise AssertionError("Image-slot follow-up should use stored image analysis, not rerun provider intake.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider)
    slot_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Use two image inputs, one face and one body.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert slot_response.status_code == 200, slot_response.text
    assistant_message = slot_response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_image_slot_planning"
    assert assistant_message["content_json"]["assistant_prompt_route"] == "image_slot_planning"
    assert "Face Reference and Body Reference as the image inputs" in assistant_message["content_text"]
    assert "Headline and Wardrobe Note as the editable fields" in assistant_message["content_text"]
    assert "Suggested setup" not in assistant_message["content_text"]
    slots = [
        slot["label"]
        for slot in slot_response.json()["summary_json"]["reference_style_brief"]["preset_contract"]["image_slots"]
    ]
    assert slots == ["Face Reference", "Body Reference"]
    assert all(
        slot["required"]
        for slot in slot_response.json()["summary_json"]["reference_style_brief"]["preset_contract"]["image_slots"]
    )


def test_media_assistant_does_not_reuse_cached_style_brief_when_provider_is_unavailable(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="cached-style7.jpg")
    cached_brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this travel poster reference.",
        assistant_text=(
            "This looks like `Cinematic Double-Exposure Travel Poster`. Style read: digital travel poster photomontage, "
            "double-exposure side-profile portrait composite, warm cream paper background, sunrise peach and amber light, "
            "destination landmarks embedded inside the head and torso, bold condensed title typography, matte poster grain, "
            "and premium editorial travel advertisement spacing."
        ),
        proposal={
            "title": "Cinematic Double-Exposure Travel Poster",
            "preset_contract": {
                "model_hint": "image_edit",
                "fields": [
                    {"key": "pose_framing", "label": "Pose / Framing", "required": False},
                    {"key": "style_notes", "label": "Style Notes", "required": False},
                ],
                "image_slots": [],
            },
        },
        attachments=[
            {
                "assistant_attachment_id": "asatt_cached_style7",
                "reference_id": reference_id,
                "kind": "image",
                "label": "cached-style7.jpg",
            }
        ],
    )
    assert has_concrete_style_traits(cached_brief)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            "assistant_session_id": "asst_cached_style7",
            "owner_kind": "graph_workflow",
            "owner_id": "workflow-cached-style7",
            "status": "active",
            "summary_json": {"reference_style_brief": cached_brief.model_dump(mode="json")},
            "state_snapshot_json": {},
        }
    )

    def unavailable_provider(**_kwargs):
        raise provider_chat.AssistantProviderChatError("Selected model is at capacity. Please try a different model.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", unavailable_provider)
    workflow = {"schema_version": 1, "name": "Cached style sandbox", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-current-cached-style7", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "cached-style7.jpg"},
    )
    client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Can you create an image-to-image media preset from these reference images?",
            "workflow": workflow,
            "assistant_mode": "preset",
            "metadata": {"preset_loop_lane": "image_to_image", "source": "guided_loop_ui"},
        },
    )

    intake_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create the image-to-image test sandbox now. Use one required image input named Subject Image. "
                "Keep Scene / Subject and Style Notes as editable fields."
            ),
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )
    assert intake_response.status_code == 200, intake_response.text
    assistant_message = intake_response.json()["messages"][-1]
    assert "reference_style_brief" not in intake_response.json()["summary_json"]
    assert "Cinematic Double-Exposure Travel Poster" not in assistant_message["content_text"]
    assert "Should this stay text-only" not in assistant_message["content_text"]


def test_media_assistant_fresh_reference_analysis_wins_over_cross_session_cache(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="fresh-style7.jpg")
    cached_brief = build_reference_style_brief(
        user_text="Create a preset from this old cached reference.",
        assistant_text=(
            "This looks like `Old Cached Poster`. Style read: analog street poster collage, xerox halftone texture, "
            "muted charcoal and red palette, flat flash lighting, torn-paper edges, sticker-like prop clusters, "
            "off-center portrait framing, rough marker typography, dense wall clutter, and gritty punk-room mood. "
            "Suggested fields: `Old Field` and `Old Caption`. One image input makes sense for an old reference subject."
        ),
        proposal={
            "title": "Old Cached Poster",
            "preset_contract": {
                "model_hint": "image_edit",
                "fields": [{"key": "old_field", "label": "Old Field", "required": False}],
                "image_slots": [{"key": "old_reference", "label": "Old Reference", "required": True}],
            },
        },
        attachments=[
            {
                "assistant_attachment_id": "asatt_old_cached_style7",
                "reference_id": reference_id,
                "kind": "image",
                "label": "fresh-style7.jpg",
            }
        ],
    )
    assert has_concrete_style_traits(cached_brief)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            "assistant_session_id": "asst_old_cached_style7",
            "owner_kind": "graph_workflow",
            "owner_id": "workflow-old-cached-style7",
            "status": "active",
            "summary_json": {"reference_style_brief": cached_brief.model_dump(mode="json")},
            "state_snapshot_json": {},
        }
    )

    def fresh_provider(**_kwargs):
        return {
            "generated_text": (
                "This looks like `Fresh Double-Exposure Travel Poster`. Style read: premium travel-poster photo composite, "
                "side-profile double exposure, scenic location silhouettes layered through the face and torso, warm sunrise "
                "peach and cream palette, editorial campaign layout, soft poster grain, large destination typography, "
                "and cinematic atmospheric depth. Suggested fields: `Location` and `Poster Title`. "
                "One image input makes sense for the person or subject."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.1-codex",
            "provider_session_id": "provider-session-style7",
            "provider_thread_id": "provider-thread-style7",
            "provider_turn_id": "provider-turn-style7-1",
            "provider_thread_reused": False,
            "provider_response_id": "fresh-style7-analysis",
            "provider_image_path_count": 1,
            "provider_image_path_basenames": ["fresh-style7.jpg"],
            "provider_image_path_hashes": ["hash-style7-path"],
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fresh_provider)
    workflow = {"schema_version": 1, "name": "Fresh style7 loop", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-fresh-style7-loop", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "fresh-style7.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create a media preset from this image and let me use one input image.",
            "workflow": workflow,
            "assistant_mode": "preset",
            "metadata": {"preset_loop_lane": "image_to_image", "source": "guided_loop_ui"},
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    style_brief = payload["summary_json"]["reference_style_brief"]
    assert style_brief["preset_direction"]["title"] == "Fresh Double-Exposure Travel Poster"
    assert style_brief["preset_direction"]["title"] != "Old Cached Poster"
    builder_state = payload["summary_json"]["media_preset_builder"]
    assert builder_state["attachment_set_hash"]
    assert builder_state["skill_session_id"].startswith("askill_")
    assert builder_state["lane"] == "image_to_image"
    assert builder_state["status"] == "reference_analysis"
    assert builder_state["workflow_tab_id"] == "workflow-fresh-style7-loop"
    assert builder_state["latest_provider_response_id"] == "fresh-style7-analysis"
    assert builder_state["latest_provider_turn_id"] == "provider-turn-style7-1"
    assert builder_state["provider_session_id"] == "provider-session-style7"
    assert builder_state["provider_thread_id"] == "provider-thread-style7"
    assert builder_state["provider_lifecycle"] == {
        "provider_called": True,
        "provider_kind": "codex_local",
        "provider_model_id": "gpt-5.1-codex",
        "provider_session_id": "provider-session-style7",
        "provider_thread_id": "provider-thread-style7",
        "provider_turn_id": "provider-turn-style7-1",
        "provider_thread_reused": False,
        "provider_response_id": "fresh-style7-analysis",
    }
    assert payload["provider_thread_id"] == "provider-thread-style7"
    assistant_message = payload["messages"][-1]
    assert "Fresh Double-Exposure Travel Poster" in assistant_message["content_text"]
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    skill_trace = usage_rows[-1]["usage_json"]["skill_trace"]
    assert skill_trace["skill"] == "media_preset_builder"
    assert skill_trace["skill_session_id"] == builder_state["skill_session_id"]
    assert skill_trace["provider_called"] is True
    assert skill_trace["provider_model_id"] == "gpt-5.1-codex"
    assert skill_trace["provider_session_id"] == "provider-session-style7"
    assert skill_trace["provider_thread_id"] == "provider-thread-style7"
    assert skill_trace["provider_turn_id"] == "provider-turn-style7-1"
    assert skill_trace["provider_thread_reused"] is False
    assert skill_trace["provider_response_id"] == "fresh-style7-analysis"
    assert skill_trace["provider_image_path_count"] == 1
    assert skill_trace["provider_image_path_basenames"] == ["fresh-style7.jpg"]
    assert skill_trace["provider_image_path_hashes"] == ["hash-style7-path"]
    assert skill_trace["prompt_asset"].endswith("media_preset_builder.md")
    assert skill_trace["prompt_asset_version"]
    assert skill_trace["attachment_set_hash"] == builder_state["attachment_set_hash"]
    assert skill_trace["attachment_ids"]
    assert skill_trace["attachment_labels"] == ["fresh-style7.jpg"]
    assert skill_trace["prompt_quality_score"] >= PROMPT_QUALITY_MIN_SCORE
    assert skill_trace["prompt_quality_passed"] is True
    assert skill_trace["prompt_contract_validation_status"] == "valid"
    assert isinstance(skill_trace["prompt_quality_issues"], list)
    assert isinstance(skill_trace["prompt_contract_validation_issues"], list)
    assert skill_trace["repair_attempt_count"] in {0, 1}
    assert skill_trace["saved_preset_ids"] == []
    assert skill_trace["saved_preset_keys"] == []
    assert "prompt" not in skill_trace
    assert "generated_text" not in skill_trace
    assert skill_trace["cache_decision"] == "none"
    assert skill_trace["intent_capability"] == "draft_media_preset"
    assert skill_trace["intent_confidence"] >= 0.86
    assert skill_trace["contract_validation"] == {
        "status": "valid",
        "contract": "MediaPresetBuilderSkillInput",
    }


def test_media_assistant_required_fresh_reference_analysis_cannot_use_deterministic_fallback(
    client, app_modules, monkeypatch
) -> None:
    reference_id = _create_reference_image(app_modules, name="fresh-analysis-required.jpg")

    def unavailable_provider(**_kwargs):
        raise provider_chat.AssistantProviderChatError("Codex planner unavailable.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", unavailable_provider)
    workflow = {"schema_version": 1, "name": "Fresh analysis required", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-fresh-analysis-required", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "fresh-analysis-required.jpg"},
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create a reusable media preset from this image. Suggest the best image input and a few useful fields first.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assistant_message = payload["messages"][-1]
    assistant_text = assistant_message["content_text"]
    assert "could not analyze the attached reference image" in assistant_text
    assert "Suggested setup" not in assistant_text
    assert "Create a test workflow" not in assistant_text
    assert "reference_style_brief" not in payload["summary_json"]
    assert "reference_style_contract" not in payload["summary_json"]
    assert assistant_message["content_json"]["mode"] == "provider_reference_analysis_failed"
    assert assistant_message["content_json"]["provider_error"] == "Codex planner unavailable."

    builder_state = payload["summary_json"]["media_preset_builder"]
    assert builder_state["status"] == "reference_analysis_failed"
    assert builder_state["workflow_tab_id"] == "workflow-fresh-analysis-required"
    assert builder_state["attachment_set_hash"]
    assert builder_state["provider_lifecycle"] == {
        "provider_called": True,
        "provider_error": "Codex planner unavailable.",
        "fallback_mode": "fresh_reference_analysis_failed",
    }
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    usage_json = usage_rows[-1]["usage_json"]
    assert usage_json["mode"] == "provider_reference_analysis_failed"
    skill_trace = usage_json["skill_trace"]
    assert skill_trace["provider_called"] is True
    assert skill_trace["fallback_mode"] == "fresh_reference_analysis_failed"
    assert skill_trace["state_after"] == "reference_analysis_failed"
    assert skill_trace["cache_decision"] == "none"


def test_media_assistant_provider_failure_can_replay_same_workflow_style_brief(
    client, app_modules, monkeypatch
) -> None:
    reference_id = _create_reference_image(app_modules, name="same-workflow-style7.jpg")
    workflow = {"schema_version": 1, "name": "Same workflow replay", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-same-style-replay", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "same-workflow-style7.jpg"},
    )
    attachments = app_modules["store_assistant"].list_assistant_attachments(session_id)
    brief = ReferenceStyleBrief(
        brief_id="rsb_same_workflow_replay",
        source_attachment_ids=[str(item["assistant_attachment_id"]) for item in attachments],
        source_reference_ids=[reference_id],
        preset_direction=ReferenceStylePresetDirection(
            title="Same Workflow Travel Poster",
            target_model_mode="image_edit",
        ),
        visual_analysis={
            "medium": ["photo-based double-exposure poster composition", "editorial travel advertisement treatment"],
            "palette": ["warm sunrise peach and amber highlights", "muted cream paper background"],
            "line_shape_language": ["clean side-profile silhouette used as the main mask"],
            "composition": [
                "tall poster aspect with a single dominant portrait",
                "landscape scenes nested inside the head and torso silhouette",
                "large destination title block anchored across the lower third",
            ],
            "subject_treatment": ["adult subject shown in thoughtful side profile"],
            "environment_props": ["mountain scenery", "temple architecture", "stone path", "small traveler figure"],
            "texture_lighting": ["golden-hour backlight and sky glow", "soft haze and subtle paper-poster grain"],
            "typography_text_energy": ["bold condensed uppercase main title", "flowing script subtitle"],
            "mood": ["reflective aspirational cinematic travel discovery energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="location", label="Location", required=True),
                ReferenceStylePresetField(key="poster_title", label="Poster Title", required=False),
            ],
            image_slots=[ReferenceStyleImageSlot(key="portrait", label="Portrait", required=True)],
        ),
        prompt_blueprint=ReferenceStylePromptBlueprint(
            fixed_style_ingredients=[
                "side-profile portrait used as a double-exposure silhouette mask",
                "multiple destination scenes layered inside the face and torso",
                "warm sunrise lighting with soft atmospheric haze",
                "editorial travel-poster layout with generous negative space",
            ],
            negative_guidance=[
                "avoid generic plain portrait overlays without layered scenic storytelling",
                "avoid copying the exact source text, destination, or silhouette details",
            ],
        ),
        fixed_style_traits=[
            "double-exposure portrait composite",
            "editorial travel poster layout",
            "warm sunrise palette",
        ],
        source_specific_exclusions=["exact source text", "exact landmark arrangement"],
    )
    assert has_concrete_style_traits(brief)
    record = app_modules["store_assistant"].get_assistant_session(session_id)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **record,
            "summary_json": {
                "reference_style_brief": brief.model_dump(mode="json"),
                "media_preset_builder": {
                    "skill": "create_media_preset",
                    "status": "reference_analysis",
                    "workflow_tab_id": "workflow-same-style-replay",
                    "lane": "image_to_image",
                    "attachment_set_hash": attachment_set_hash(attachments),
                },
            },
        }
    )

    def unavailable_provider(**_kwargs):
        raise provider_chat.AssistantProviderChatError("Codex planner unavailable.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", unavailable_provider)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create a media preset from this image and let me use one input image.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["summary_json"]["reference_style_brief"]["preset_direction"]["title"] == "Same Workflow Travel Poster"
    builder_state = payload["summary_json"]["media_preset_builder"]
    assert builder_state.get("fallback_recovery") in {None, "server_state_replay"}
    assert builder_state.get("fallback_recovery_style_brief_id") in {None, brief.brief_id}
    if builder_state.get("provider_lifecycle"):
        assert builder_state["provider_lifecycle"] in (
            {
                "provider_called": True,
                "provider_error": "Codex planner unavailable.",
                "fallback_mode": "server_state_replay",
            },
            {
                "provider_called": False,
                "fallback_mode": "deterministic_image_slot_planning",
            },
        )
    assistant_text = payload["messages"][-1]["content_text"]
    assert "Same Workflow Travel Poster" in assistant_text or "Location and Poster Title" in assistant_text
    assert "could not analyze the attached reference image" not in assistant_text
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    skill_trace = usage_rows[-1]["usage_json"]["skill_trace"]
    assert skill_trace["fallback_mode"] in {"server_state_replay", "deterministic_image_slot_planning"}
    assert skill_trace["cache_decision"] == "same_loop_reuse"


def test_media_assistant_guided_i2i_start_does_not_use_cached_style_contract(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="cached-travel-poster.jpg")
    cached_brief = build_reference_style_brief(
        user_text="Create an image-to-image preset from this double-exposure travel poster.",
        assistant_text=(
            "This looks like `Double-Exposure Travel Odyssey Poster`. Style read: digital photomontage travel poster, "
            "double-exposure portrait composite, editorial poster design with cinematic retouching, warm peach sunrise tones, "
            "scenic landmarks embedded inside a side-profile silhouette, and bold destination typography."
        ),
        proposal={
            "title": "Double-Exposure Travel Odyssey Poster",
            "preset_contract": {
                "model_hint": "image_edit",
                "fields": [
                    {"key": "location", "label": "Location", "required": True},
                    {"key": "poster_title", "label": "Poster Title", "required": False},
                ],
                "image_slots": [
                    {"key": "person_reference", "label": "Person Reference", "required": True},
                ],
            },
        },
        attachments=[
            {
                "assistant_attachment_id": "asatt_cached_travel_poster",
                "reference_id": reference_id,
                "kind": "image",
                "label": "cached-travel-poster.jpg",
            }
        ],
    )
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            "assistant_session_id": "asst_cached_travel_poster",
            "owner_kind": "graph_workflow",
            "owner_id": "workflow-cached-travel-poster",
            "status": "active",
            "summary_json": {"reference_style_brief": cached_brief.model_dump(mode="json")},
            "state_snapshot_json": {},
        }
    )

    def unavailable_provider(**_kwargs):
        raise provider_chat.AssistantProviderChatError("Selected model is at capacity. Please try a different model.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", unavailable_provider)
    workflow = {"schema_version": 1, "name": "Guided cached style lane", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-current-cached-travel-poster", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "cached-travel-poster.jpg"},
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Can you create an image-to-image media preset from these reference images?",
            "workflow": workflow,
            "assistant_mode": "preset",
            "metadata": {"preset_loop_lane": "image_to_image", "source": "guided_loop_ui"},
        },
    )

    assert response.status_code == 200, response.text
    assistant_text = response.json()["messages"][-1]["content_text"]
    assert "Double-Exposure Travel Odyssey Poster" not in assistant_text
    assert "Field: Location" not in assistant_text
    assert "Field: Poster Title" not in assistant_text
    assert "Image input: Person Reference" not in assistant_text
    assert "test graph" in assistant_text


def test_media_assistant_save_request_with_latest_output_is_not_refinement_chat(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-save-chat-latest-output",
        workflow_id="workflow-save-chat-latest-output",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-save-chat-latest-output",
        "name": "Year era save chat graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Create a highly stylized toy-like/chibi portrait of the person in the personal reference image, "
                        "set inside a cinematic visual world inspired by the year 1978."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-save-chat-latest-output", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create the actual media preset now from the approved sandbox result with one required year field and one required personal reference image input, "
                "using the approved draft prompt and latest output as the thumbnail."
            ),
            "workflow": workflow,
            "run_id": run_id,
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_save_request"
    assert assistant_message["content_json"]["suggested_action"] == "save_media_preset"
    assert "save the approved Media Preset" in assistant_message["content_text"]
    assert "prompt update" not in assistant_message["content_text"].lower()


def test_media_assistant_official_preset_from_this_sandbox_routes_to_save(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-official-preset-from-this-sandbox",
        workflow_id="workflow-official-preset-from-this-sandbox",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-official-preset-from-this-sandbox",
        "name": "Official preset from sandbox graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Create a punk poster portrait from the Personal Reference image."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-official-preset-from-this-sandbox", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "This result is close enough. Create the official Media Preset now from this sandbox. "
                "Use the last generated image as the thumbnail. Keep one required Personal Reference image input and one Banner Text field."
            ),
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_save_request"
    assert assistant_message["content_json"]["suggested_action"] == "save_media_preset"
    assert "prompt update" not in assistant_message["content_text"].lower()


def test_media_assistant_approved_test_workflow_routes_to_save_preset(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-save-approved-text-to-image-test-workflow",
        workflow_id="workflow-save-approved-text-to-image-test-workflow",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-save-approved-text-to-image-test-workflow",
        "name": "Approved text-to-image test workflow",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Cybernetic poster prompt with teal atmosphere, orange typography, and dense mech detailing."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-save-approved-text-to-image-test-workflow", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Save this approved text-to-image test workflow as a media preset. Use the latest generated image as the thumbnail.",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_save_request"
    assert assistant_message["content_json"]["suggested_action"] == "save_media_preset"
    assert "workflow review" not in assistant_message["content_text"].lower()


def test_media_assistant_save_preset_title_uses_approved_prompt_style_title(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-save-approved-prompt-title",
        workflow_id="workflow-save-approved-prompt-title",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-save-approved-prompt-title",
        "name": "Approved prompt title graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {
                    "text": (
                        "Cybernetic Battle Dossier Poster: high-detail digital illustration with painterly realism; "
                        "dominant teal atmosphere, burnt orange typography, dense mech detailing."
                    )
                },
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-save-approved-prompt-title", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": "Save this approved text-to-image test workflow as a media preset. Use the latest generated image as the thumbnail.",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["created"] is True
    assert payload["record"]["label"] == "Cybernetic Battle Dossier Poster"
    assert payload["record"]["thumbnail_path"]


def test_media_assistant_approved_image_to_image_sandbox_request_saves_not_updates(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-save-approved-image-to-image-sandbox",
        workflow_id="workflow-save-approved-image-to-image-sandbox",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-save-approved-image-to-image-sandbox",
        "name": "Approved image-to-image save graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Create a punk graffiti restyle from the Personal Reference image."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-save-approved-image-to-image-sandbox", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **session_response.json(),
            "summary_json": {
                "reference_style_brief": {
                    "brief_id": "brief-stale-comparison-title",
                    "source_reference_ids": ["reference-stale-comparison"],
                    "version": 1,
                    "status": "draft",
                    "preset_direction": {
                        "title": "Missing: The Refs Are Still A Bit More Silhouette-Driven",
                        "one_line_summary": "Stale comparison title that should not override an explicit save name.",
                        "target_model_mode": "image_to_image",
                    },
                    "visual_analysis": {
                        "medium": ["high-contrast punk street-art illustration"],
                        "palette": ["acid orange and hot magenta palette"],
                        "line_shape_language": ["heavy black ink shapes"],
                        "composition": ["bold poster composition"],
                        "texture_lighting": ["splatter textures"],
                        "mood": ["chaotic rebellious mood"],
                    },
                    "preset_contract": {"fields": [], "image_slots": []},
                    "prompt_blueprint": {"fixed_style_ingredients": [], "variable_ingredients": [], "negative_guidance": []},
                    "verification_targets": {"must_match": [], "may_vary": [], "must_not_copy": []},
                    "validation_warnings": [],
                }
            },
        }
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create the Media Preset now from this approved image-to-image sandbox. "
                "Name it Punk Graffiti Character Restyle. Keep Personal Reference required, "
                "keep Pose / Framing and Style Notes as the editable fields, use the current draft prompt, "
                "and use the latest output as the thumbnail."
            ),
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_save_request"
    assert assistant_message["content_json"]["suggested_action"] == "save_media_preset"
    assert assistant_message["content_json"]["output_aware"] is None
    assert "prompt update" not in assistant_message["content_text"].lower()

    save_response = client.post(
        f"/media/assistant/sessions/{session_id}/preset-saves",
        json={
            "message": (
                "Create the Media Preset now from this approved image-to-image sandbox. "
                "Name it Punk Graffiti Character Restyle. Keep Personal Reference required, "
                "keep Pose / Framing and Style Notes as the editable fields, use the current draft prompt, "
                "and use the latest output as the thumbnail."
            ),
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert save_response.status_code == 200, save_response.text
    saved = save_response.json()
    assert saved["record"]["label"] == "Punk Graffiti Character Restyle"
    assert saved["record"]["key"].startswith("assistant_punk_graffiti_character_restyle")


def test_media_assistant_negated_save_routes_to_prompt_update_not_preset_save(client, app_modules) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-negated-save-update-prompt",
        workflow_id="workflow-negated-save-update-prompt",
    )
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-negated-save-update-prompt",
        "name": "Negated save prompt update graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "Use the provided Subject Image as the identity and likeness source. Create a double-exposure travel poster portrait."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-negated-save-update-prompt", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Yes, update the Draft preset prompt with that one improvement now. Do not save yet.",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_preset_sandbox_refinement"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert assistant_message["content_json"].get("suggested_action") != "save_media_preset"
    assert "save the approved Media Preset" not in assistant_message["content_text"]
    assert "without running or saving anything" in assistant_message["content_text"]


def test_media_assistant_output_aware_refinement_chat_uses_latest_run_provider(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-output-aware-chat",
        workflow_id="workflow-output-aware-chat",
    )
    reference_id = _create_reference_image(app_modules, name="skater-style-reference.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-output-aware-chat",
        "name": "Skate output-aware chat graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a skater fashion photo with sadie."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    captured: dict = {}

    def fake_provider_chat(**kwargs):
        captured["context"] = kwargs["context"]
        return {
            "mode": "provider_chat",
            "generated_text": (
                "- The output reads too much like a clean fashion portrait.\n"
                "- Push the hoodie volume, wider denim, headphones, backpack patches, and board-under-feet stance."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-output-aware-chat",
            "usage": {},
            "image_count": 2,
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-output-aware-chat", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "skater ref"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Compare the current output to the skater refs and push the style closer.",
            "workflow": workflow,
            "run_id": run_id,
        },
    )

    assert response.status_code == 200, response.text
    assert captured["context"]["latest_graph_run"]["run_id"] == run_id
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_text"].startswith("I compared the latest output")
    assert "Want me to update the prompt and run one more test?" in assistant_message["content_text"]
    assert "full prompt" not in assistant_message["content_text"].lower()
    assert assistant_message["content_json"]["mode"] == "provider_chat"
    assert assistant_message["content_json"]["output_aware"] is True
    assert assistant_message["content_json"]["latest_run_id"] == run_id
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    output_check = assistant_message["content_json"]["output_check"]
    assert output_check["latest_output_asset_id"]
    assert output_check["reference_ids"] == [reference_id]
    assert output_check["next_action"] == "update_prompt"
    assert "hoodie volume" in output_check["prompt_delta"]

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Compare the current output to the skater refs and push the style closer.",
            "workflow": workflow,
            "run_id": run_id,
        },
    )
    assert plan_response.status_code == 200, plan_response.text
    next_prompt = plan_response.json()["workflow"]["nodes"][0]["fields"]["text"]
    assert "visual comparison notes" not in next_prompt
    assert "Refinement for the next test run" not in next_prompt
    assert "Additional visual direction" not in next_prompt
    assert "Strengthen the next version" not in next_prompt
    assert "Emphasize" in next_prompt
    assert "clean fashion portrait" not in next_prompt
    assert "hoodie volume" in next_prompt


def test_media_assistant_newest_output_compare_wording_stays_output_aware(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-newest-output-aware-chat",
        workflow_id="workflow-newest-output-aware-chat",
    )
    reference_id = _create_reference_image(app_modules, name="style-reference-newest.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-newest-output-aware-chat",
        "name": "Newest output-aware chat graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a graphic poster restyle."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "- Matches: palette and splatter are close.\n"
                "- Missing: anatomy should be more silhouette-driven and less polished."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-newest-output-aware-chat",
            "usage": {},
            "image_count": 2,
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-newest-output-aware-chat", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style ref"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Compare the newest output to the refs. Is it good enough to create the preset, or would you push one more tweak?",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["output_aware"] is True
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert assistant_message["content_json"]["preset_builder_proposal"] is None
    assert assistant_message["content_json"]["output_check"]["next_action"] == "update_prompt"
    assert "Missing:" in assistant_message["content_json"]["output_check"]["prompt_delta"]
    assert assistant_message["content_text"].startswith("I compared the latest output")
    assert "- Matches: palette and splatter are close." in assistant_message["content_text"]
    assert "- Improve: anatomy should be more silhouette-driven and less polished." in assistant_message["content_text"]
    assert "- Prompt tweak: anatomy should be more silhouette-driven and less polished." in assistant_message["content_text"]


def test_media_assistant_output_compare_rejects_score_only_feedback(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-score-only-output-aware-chat",
        workflow_id="workflow-score-only-output-aware-chat",
    )
    reference_id = _create_reference_image(app_modules, name="style-reference-score-only.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-score-only-output-aware-chat",
        "name": "Score only output-aware chat graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a neon punk graffiti character poster."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Similarity score: 84/100 - very close, one refinement is worth testing\n"
                "What matches:\n"
                "- Improve: Similarity score: 84/100 - very close, one refinement is worth testing\n"
                "- Prompt tweak: Similarity score: 84/100 - very close, one refinement is worth testing; "
                "What is missing or drifting:."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-score-only-output-aware-chat",
            "usage": {},
            "image_count": 2,
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-score-only-output-aware-chat", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style ref"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Compare the latest output against the refs and suggest one prompt change if needed.",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["output_aware"] is True
    assert assistant_message["content_json"]["output_check"]["next_action"] == "ask_user"
    assert assistant_message["content_text"].startswith("I could not produce a usable visual comparison yet.")
    assert "Similarity score" not in assistant_message["content_text"]
    assert "concrete visible traits" in assistant_message["content_text"]
    assert "What is missing" not in assistant_message["content_text"]
    assert "- Prompt tweak:" not in assistant_message["content_text"]


def test_media_assistant_stored_latest_output_compare_stays_output_aware_without_run_id(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style7-stored-output.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-stored-output-aware-chat",
        "name": "Stored output-aware chat graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a double-exposure travel poster portrait."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "- Matches: warm poster palette and side-profile composition are close.\n"
                "- Missing: interior scenery needs denser layering through the full silhouette.\n"
                "- Next prompt change: add denser layered travel scenery through the head and torso mask."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-stored-output-aware-chat",
            "usage": {},
            "image_count": 2,
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-stored-output-aware-chat", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style7.jpg"})
    record = app_modules["store_assistant"].get_assistant_session(session_id)
    app_modules["store_assistant"].create_or_update_assistant_session(
        {
            **record,
            "summary_json": {
                "media_preset_builder": {
                    "skill": "create_media_preset",
                    "status": "output_comparison",
                    "latest_output_asset_id": "asset-stored-output-aware-chat",
                    "latest_output_run_id": "run-stored-output-aware-chat",
                }
            },
        }
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Compare the latest generated image again and prepare a clean prompt update if it needs one.",
            "workflow": workflow,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "provider_chat"
    assert assistant_message["content_json"]["output_aware"] is True
    assert assistant_message["content_json"]["latest_run_id"] == "run-stored-output-aware-chat"
    assert assistant_message["content_json"]["output_check"]["latest_output_asset_id"] == "asset-stored-output-aware-chat"
    assert "time-period" not in assistant_message["content_text"]
    assert "- Matches: warm poster palette and side-profile composition are close." in assistant_message["content_text"]
    assert "- Improve: interior scenery needs denser layering through the full silhouette." in assistant_message["content_text"]
    assert "- Prompt tweak: add denser layered travel scenery through the head and torso mask." in assistant_message["content_text"]


def test_media_assistant_newest_output_compare_again_does_not_save_preset(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-newest-output-good-enough-chat",
        workflow_id="workflow-newest-output-good-enough-chat",
    )
    reference_id = _create_reference_image(app_modules, name="style-reference-good-enough.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-newest-output-good-enough-chat",
        "name": "Newest output good enough graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a graphic poster restyle."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "- It is good enough to create the preset.\n"
                "- Matches: palette, ink linework, and splatter are close.\n"
                "- Missing: one more flatter silhouette pass would help."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-newest-output-good-enough-chat",
            "usage": {},
            "image_count": 2,
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-newest-output-good-enough-chat", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style ref"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Compare the newest output to the refs again. It looks much closer to me. "
                "Keep it short: is it good enough to create the preset, or would you push one more tweak?"
            ),
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["output_aware"] is True
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert assistant_message["content_json"]["preset_builder_proposal"] is None
    assert assistant_message["content_json"]["mode"] == "provider_chat"
    assert "Saved Media Preset" not in assistant_message["content_text"]
    assert assistant_message["content_text"].startswith("I compared the latest output")
    assert "- Matches: It is good enough to create the preset. Matches: palette, ink linework, and splatter are close." in assistant_message["content_text"]
    assert "- Improve: one more flatter silhouette pass would help." in assistant_message["content_text"]
    assert "- Prompt tweak: one more flatter silhouette pass would help." in assistant_message["content_text"]
    assert "If you like this result, I can save it as the Media Preset." in assistant_message["content_text"]
    assert "save it as the Media Preset" in assistant_message["content_text"]
    assert "reviewable prompt update" not in assistant_message["content_text"]


def test_media_assistant_save_ready_optional_polish_does_not_duplicate_as_prompt_tweak(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-save-ready-optional-polish",
        workflow_id="workflow-save-ready-optional-polish",
    )
    reference_id = _create_reference_image(app_modules, name="style-reference-save-ready-polish.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-save-ready-optional-polish",
        "name": "Save ready optional polish graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a double-exposure travel poster portrait."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "- Matches: very close double-exposure travel poster style.\n"
                "- Verdict: Good enough for final signoff. If you want one last polish pass, add slightly denser interior landmark layering."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-save-ready-optional-polish",
            "usage": {},
            "image_count": 2,
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-save-ready-optional-polish", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style ref"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Compare the saved preset test output to the reference style. "
                "Is this good enough, or should we adjust one thing before final signoff?"
            ),
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["output_check"]["next_action"] == "save_preset"
    assert "- Matches:" in assistant_message["content_text"]
    assert "- Improve:" not in assistant_message["content_text"]
    assert "- Prompt tweak:" not in assistant_message["content_text"]
    assert "If you like this result, I can save it as the Media Preset." in assistant_message["content_text"]


def test_media_assistant_match_only_output_compare_asks_choice_without_prompt_tweak(client, app_modules, monkeypatch) -> None:
    run_id, _output_path = _create_graph_output_asset(
        app_modules,
        run_id="run-match-only-output-compare",
        workflow_id="workflow-match-only-output-compare",
    )
    reference_id = _create_reference_image(app_modules, name="style-reference-match-only.jpg")
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-match-only-output-compare",
        "name": "Match only output compare graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 520},
                "fields": {"text": "create a double-exposure travel poster portrait."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": "- Matches: strong warm paper palette, profile double-exposure silhouette, and bold title stack.",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "assistant-match-only-output-compare",
            "usage": {},
            "image_count": 2,
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-match-only-output-compare", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": reference_id, "label": "style ref"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Compare this saved preset output again. Keep it short: is it ready to sign off, or is one prompt tweak needed?",
            "workflow": workflow,
            "run_id": run_id,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["output_check"]["next_action"] == "ask_user"
    assert "- Matches:" in assistant_message["content_text"]
    assert "- Prompt tweak:" not in assistant_message["content_text"]
    assert "Want me to save it, or run one more refinement?" in assistant_message["content_text"]


def test_media_assistant_graph_mode_compacts_template_plan_chat(client, app_modules, monkeypatch) -> None:
    def fail_provider_chat(**_kwargs):
        raise AssertionError("Graph mode template chat should not call the provider.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    workflow = {"schema_version": 1, "name": "Graph mode template", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={
            "owner_kind": "graph_workflow",
            "owner_id": "workflow-graph-mode-chat-test",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create a clean text-to-image graph workflow with prompt, preview, and save image.",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert len(assistant_message["content_text"]) < 250
    assert "build that graph" in assistant_message["content_text"]
    assert "reviewable graph plan" not in assistant_message["content_text"]
    assert assistant_message["content_json"]["mode"] == "deterministic_graph_mode_plan_request"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"


def test_media_assistant_requires_confirmation_for_test_run_chat(client, app_modules, monkeypatch) -> None:
    def fail_provider_chat(**kwargs):
        raise AssertionError("Run confirmation handling should be deterministic.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    for phrase in ("test it", "run again", "try again", "rerun the workflow"):
        workflow = {"schema_version": 1, "name": f"Preset sandbox graph {phrase}", "nodes": [], "edges": [], "metadata": {}}
        session_response = client.post(
            "/media/assistant/sessions",
            json={"owner_kind": "graph_workflow", "owner_id": f"workflow-skate-test-run-chat-{phrase}", "workflow": workflow},
        )
        session_id = session_response.json()["assistant_session_id"]
        response = client.post(
            f"/media/assistant/sessions/{session_id}/messages",
            json={"content_text": phrase, "workflow": workflow},
        )

        assert response.status_code == 200, response.text
        assistant_message = response.json()["messages"][-1]
        assert "need explicit paid/provider approval" in assistant_message["content_text"]
        assert assistant_message["content_json"]["mode"] == "deterministic_test_run_confirmation_required"
        assert assistant_message["content_json"]["suggested_action"] == "clarify"
        assert assistant_message["content_json"]["confirmation_action"] == "run_workflow"
        assert assistant_message["content_json"]["assistant_response_kind"] == "ask"


def test_media_assistant_routes_explicit_paid_run_permission_to_existing_run_action(client, app_modules, monkeypatch) -> None:
    def fail_provider_chat(**kwargs):
        raise AssertionError("Approved run handling should be deterministic.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    workflow = {"schema_version": 1, "name": "Approved graph run", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-approved-run-chat", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Okay run it. Run the current graph exactly as it is. This is approved as a paid provider run.",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_text"] == "I will run the current graph now."
    assert assistant_message["content_json"]["mode"] == "deterministic_test_run_request"
    assert assistant_message["content_json"]["suggested_action"] == "run_workflow"
    assert assistant_message["content_json"]["run_approval_source"] == "explicit_paid_provider_permission"
    assert assistant_message["content_json"]["assistant_response_kind"] == "confirm_paid_or_mutating"


def test_media_assistant_accepts_run_after_its_confirmation_prompt(client, app_modules, monkeypatch) -> None:
    def fail_provider_chat(**kwargs):
        raise AssertionError("Run confirmation follow-up should be deterministic.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    workflow = {"schema_version": 1, "name": "Confirmed graph run", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-confirmed-run-chat", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    first_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "run it", "workflow": workflow, "assistant_mode": "graph"},
    )
    assert first_response.status_code == 200, first_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "run it", "workflow": workflow, "assistant_mode": "graph"},
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_test_run_request"
    assert assistant_message["content_json"]["suggested_action"] == "run_workflow"
    assert assistant_message["content_json"]["run_approval_source"] == "prior_assistant_confirmation"
    assert assistant_message["content_json"]["assistant_response_kind"] == "confirm_paid_or_mutating"


def test_media_assistant_response_kind_contract_maps_core_actions(client, app_modules) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Assistant action contract",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 120, "y": 120},
                "fields": {"text": "cinematic gothic sci-fi portrait, cathedral glass, blue ghost light"},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-assistant-action-contract", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def post_message(content: str, assistant_mode: str = "graph") -> dict:
        response = client.post(
            f"/media/assistant/sessions/{session_id}/messages",
            json={"content_text": content, "workflow": workflow, "assistant_mode": assistant_mode},
        )
        assert response.status_code == 200, response.text
        return response.json()["messages"][-1]["content_json"]

    answer_payload = post_message("Show me the full prompt from the current graph.")
    ask_payload = post_message("do it")
    create_payload = post_message("Create a clean text-to-image graph workflow with prompt, preview, and save image.")
    run_payload = post_message("run it")
    save_payload = post_message("Create the media preset now based on this approved result.", assistant_mode="preset")

    assert answer_payload["assistant_response_kind"] == "answer"
    assert ask_payload["assistant_response_kind"] == "ask"
    assert create_payload["assistant_response_kind"] == "create_local"
    assert run_payload["assistant_response_kind"] == "ask"
    assert run_payload["confirmation_action"] == "run_workflow"
    assert save_payload["assistant_response_kind"] == "confirm_paid_or_mutating"


def test_media_assistant_no_create_story_request_stays_answer_contract(client, app_modules, monkeypatch) -> None:
    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Use GPT Image 2 image-to-image for storyboard stills from the approved character sheet. "
                "Use Seedance only after the stills are approved and you are ready for video clips."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "no-create-story-flow",
            "usage": {},
            "assistant_prompt_route": kwargs["context"].get("assistant_prompt_route"),
            "loaded_prompt_assets": [],
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    workflow = {"schema_version": 1, "name": "No-create story contract", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-no-create-story-contract", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "I want to create a storyboard from an approved character sheet. I use GPT Image 2 image-to-image "
                "for storyboard stills and only use Seedance later for videos. What flow should the assistant build? "
                "Do not create, add, run, save, import, export, or submit anything."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"].get("suggested_action") is None
    assert assistant_message["content_json"]["assistant_response_kind"] == "answer"
    assert "GPT Image 2 image-to-image" in assistant_message["content_text"]


def test_media_assistant_explains_failed_graph_run(client, app_modules) -> None:
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-repair-test",
        "name": "Repair graph",
        "nodes": [
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "hello"},
                "metadata": {},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    run = app_modules["store"].create_graph_run(
        {
            "workflow_id": "workflow-repair-test",
            "status": "failed",
            "workflow_json": workflow,
            "compiled_graph_json": {},
            "output_snapshot_json": {},
            "error": "Graph run was interrupted before completion.",
        },
        [
            {
                "node_id": "prompt",
                "node_type": "prompt.text",
                "status": "failed",
                "error": "Graph run was interrupted before completion.",
            }
        ],
    )
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-repair-test", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/repair",
        json={"run_id": run["run_id"], "workflow": workflow},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["capability"] == "repair_graph"
    assert payload["run_id"] == run["run_id"]
    assert payload["failed_nodes"][0]["node_id"] == "prompt"
    assert "did not complete" in payload["summary"]
    assert payload["validation"]["valid"] is True


def test_media_assistant_uses_codex_local_structured_plan_when_available(client, app_modules, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Provider planned graph", "nodes": [], "edges": [], "metadata": {}}

    def fake_provider_plan(**kwargs):
        assert kwargs["message"] == "Create a text-to-image workflow."
        return {
            "mode": "provider_graph_plan",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "provider-plan-thread",
            "usage": {"prompt_tokens": 50, "completion_tokens": 25, "total_tokens": 75},
            "prompt_tokens": 50,
            "completion_tokens": 25,
            "total_tokens": 75,
            "cost": None,
            "latency_ms": 144,
            "image_count": 0,
            "attempts": 1,
            "graph_plan": AssistantGraphPlan(
                summary="Create a provider-planned image workflow.",
                operations=[
                    {"op": "add_node", "node_ref": "prompt", "node_type": "prompt.text", "title": "Prompt", "position": {"x": 120, "y": 120}, "fields": {"text": "Create a calm editorial portrait."}},
                    {"op": "add_node", "node_ref": "model", "node_type": "model.kie.gpt_image_2_text_to_image", "title": "GPT Image 2", "position": {"x": 520, "y": 120}},
                    {"op": "add_node", "node_ref": "preview", "node_type": "preview.image", "title": "Preview", "position": {"x": 920, "y": 120}},
                    {"op": "connect_nodes", "source_ref": "prompt", "source_port": "text", "target_ref": "model", "target_port": "prompt"},
                    {"op": "connect_nodes", "source_ref": "model", "source_port": "image", "target_ref": "preview", "target_port": "image"},
                ],
            ),
        }

    monkeypatch.setattr("app.assistant.routes.run_provider_graph_plan", fake_provider_plan)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-provider-plan-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={"message": "Create a text-to-image workflow.", "workflow": workflow},
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["validation"]["valid"] is True
    assert payload["graph_plan"]["summary"] == "Create a provider-planned image workflow."
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    assert usage_rows[0]["provider_response_id"] == "provider-plan-thread"
    assert usage_rows[0]["usage_json"]["mode"] == "provider_graph_plan"
    assert usage_rows[0]["usage_json"]["provider_attempts"] == 1


def test_media_assistant_cancelled_provider_plan_does_not_persist_plan(client, app_modules, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Cancelled provider graph", "nodes": [], "edges": [], "metadata": {}}
    observed = {}
    routes = importlib.import_module("app.assistant.routes")

    def fake_provider_plan(**kwargs):
        observed["has_cancel_event"] = kwargs.get("cancel_event") is not None
        raise routes.AssistantRequestCancelled("cancelled")

    monkeypatch.setattr("app.assistant.routes.run_provider_graph_plan", fake_provider_plan)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-provider-cancel-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={"message": "Create a provider-planned workflow.", "workflow": workflow},
    )

    assert plan_response.status_code == 409
    assert observed["has_cancel_event"] is True
    assert app_modules["store_assistant"].list_assistant_plans(session_id) == []
    session_payload = client.get(f"/media/assistant/sessions/{session_id}").json()
    assert [item["role"] for item in session_payload["messages"]] == ["user"]


def test_media_assistant_cancelled_provider_chat_does_not_persist_assistant_reply(client, app_modules, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Cancelled chat graph", "nodes": [], "edges": [], "metadata": {}}
    observed = {}
    routes = importlib.import_module("app.assistant.routes")

    def fake_provider_chat(**kwargs):
        observed["has_cancel_event"] = kwargs.get("cancel_event") is not None
        raise routes.AssistantRequestCancelled("cancelled")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-chat-cancel-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    message_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "Think for a long time.", "workflow": workflow},
    )

    assert message_response.status_code == 200, message_response.text
    assert observed["has_cancel_event"] is True
    assert [item["role"] for item in message_response.json()["messages"]] == ["user"]
    assert app_modules["store_assistant"].list_assistant_turn_usage(session_id) == []


def test_media_assistant_repairs_provider_set_field_alias() -> None:
    plan = _validate_plan_payload(
        {
            "capability": "plan_graph",
            "summary": "Repair provider operation alias.",
            "operations": [
                {"op": "add_node", "node_ref": "prompt", "node_type": "prompt.text"},
                {"op": "set_field", "node_ref": "prompt", "field_id": "text", "value": "A repaired prompt."},
            ],
            "warnings": [],
            "requires_confirmation": True,
        }
    )

    assert plan.operations[1].op == "set_node_field"
    assert plan.operations[1].fields == {"text": "A repaired prompt."}
    assert "Repaired unsupported operation `set_field`" in plan.warnings[0]


def test_media_assistant_rejects_unsupported_provider_operation() -> None:
    try:
        _validate_plan_payload(
            {
                "capability": "plan_graph",
                "summary": "Unsupported operation.",
                "operations": [{"op": "delete_everything"}],
                "warnings": [],
                "requires_confirmation": True,
            }
        )
    except provider_chat.AssistantProviderChatError as exc:
        assert "unsupported graph operation `delete_everything`" in str(exc)
    else:
        raise AssertionError("Unsupported provider operation should be rejected.")


def test_media_assistant_skill_catalog_selects_narrow_capabilities() -> None:
    catalog = assistant_skill_catalog()
    catalog_by_id = {item["skill_id"]: item for item in catalog}

    assert {item["skill_id"] for item in catalog} >= {"create_workflow", "create_prompt_recipe", "create_media_preset"}
    assert catalog_by_id["create_media_preset"]["runtime_skill_id"] == "media_preset_builder"
    assert catalog_by_id["create_media_preset"]["prompt_asset"].endswith("skills/media_preset_builder.md")
    assert "save_media_preset" in catalog_by_id["create_media_preset"]["allowed_operations"]
    assert catalog_by_id["create_workflow"]["runtime_skill_id"] == "graph_workflow_builder"
    assert catalog_by_id["create_media_preset"]["lifecycle_states"][:3] == [
        "intake",
        "reference_analysis",
        "contract_proposal",
    ]
    assert select_assistant_skill("create a prompt recipe from this image").skill_id == "create_prompt_recipe"
    assert select_assistant_skill("build a graph with a load image node").skill_id == "create_workflow"
    assert select_assistant_skill("build a graph with a prompt recipe and image output").skill_id == "create_workflow"
    assert select_assistant_skill("make a reusable media preset").skill_id == "create_media_preset"


def test_media_assistant_provider_planner_catalog_includes_media_preset_node() -> None:
    catalog = _catalog_for_prompt()

    preset_node = next(item for item in catalog if item["type"] == "preset.render")
    assert preset_node["category"] == "Preset"
    assert any(field["id"] == "preset_id" for field in preset_node["fields"])


def test_media_assistant_provider_planner_prompt_includes_media_preset_catalog() -> None:
    workflow = GraphWorkflow(name="Preset planner", nodes=[], edges=[])
    messages = _build_plan_messages(
        message="Use the Storyboard Character Sheet Generator preset.",
        workflow=workflow,
        context={
            "workflow": {"name": "Preset planner"},
            "media_presets": [
                {
                    "preset_id": "preset_123",
                    "label": "Storyboard Character Sheet Generator",
                }
            ],
            "assistant_limits": {"max_image_references": 8},
        },
        attachments=[],
    )

    assert "media_presets" in messages[1]["content"]
    assert "preset_123" in messages[1]["content"]
    assert "Storyboard Character Sheet Generator" in messages[1]["content"]


def test_media_assistant_deterministic_planner_builds_existing_preset_workflow(app_modules) -> None:
    del app_modules
    suffix = _unique_test_suffix()
    label = f"Storyboard Character Sheet Generator Deterministic Test {suffix}"
    preset = upsert_preset(
        PresetUpsertRequest(
            key=f"storyboard_character_sheet_generator_deterministic_test_{suffix}",
            label=label,
            description="Deterministic planner test preset.",
            status="active",
            model_key="nano-banana-2",
            applies_to_models=["nano-banana-2"],
            prompt_template=(
                "Create a storyboard character sheet for {{outfit_details}} in {{background_environment}} "
                "with {{panel_story_notes}}. Use [[face_reference]] and [[full_body_reference]] when provided."
            ),
            input_schema_json=[
                {"key": "outfit_details", "label": "Clothing / Outfit", "placeholder": "Layered field jacket with utility belt.", "default_value": "", "required": True},
                {"key": "background_environment", "label": "Background / Environment", "placeholder": "Warm neutral studio board with small notes.", "default_value": "", "required": True},
                {"key": "panel_story_notes", "label": "Panel Story Notes", "placeholder": "Hero pose, expression line-up, and prop closeups.", "default_value": "", "required": True},
            ],
            input_slots_json=[
                {"key": "face_reference", "label": "Face / Identity Reference", "max_files": 1, "help_text": "", "required": False},
                {"key": "full_body_reference", "label": "Full-Body Reference", "max_files": 1, "help_text": "", "required": False},
            ],
            notes="Test preset",
            source_kind="custom",
            priority=0,
        )
    )

    plan = plan_graph_from_message(
        f"Create a graph workflow that uses the saved Media Preset named {label} and leave both image loaders unfilled for now.",
        GraphWorkflow(name="Preset planner graph", nodes=[], edges=[]),
        [],
    )

    assert plan.capability == "plan_graph"
    assert plan.metadata["template_id"] == SAVED_PRESET_TEST_TEMPLATE_ID
    assert plan.metadata["template_slot_count"] == 2
    preset_node = next(item for item in plan.operations if item.op == "add_node" and item.node_type == "preset.render")
    assert preset_node.fields["preset_id"] == preset["preset_id"]
    assert preset_node.fields["preset_model_key"] == "nano-banana-2"
    assert preset_node.fields["text__outfit_details"] == "yellow windbreaker and vintage sneakers"
    assert preset_node.fields["text__background_environment"] == "rainy downtown street"
    assert preset_node.fields["text__panel_story_notes"] == "Original panel story notes"
    connected_ports = {item.target_port for item in plan.operations if item.op == "connect_nodes" and item.target_ref == "preset"}
    assert {"slot__face_reference", "slot__full_body_reference"}.issubset(connected_ports)


def test_media_assistant_reference_style_plan_uses_embedded_brief_contract(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Cinematic Double-Exposure Travel Poster",
        "summary": "Editorial travel poster portrait with scenic double exposure.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["digitally composited poster artwork", "double-exposure portrait treatment"],
            "palette": ["warm peach and gold sunrise sky", "muted cream paper background"],
            "composition": ["side-profile portrait used as a scenic mask", "large headline near the bottom"],
            "environment_props": ["mountain scenery", "travel landmarks", "small traveler figure"],
            "texture_lighting": ["soft atmospheric haze", "paper grain"],
            "typography_text_energy": ["bold condensed headline", "small editorial microtype"],
            "mood": ["aspirational", "reflective"],
        },
        "recommended_fields": [
            {"key": "destination", "label": "Destination", "required": True},
            {"key": "headline", "label": "Headline", "required": False},
            {"key": "subheading", "label": "Subheading", "required": False},
        ],
        "recommended_image_slots": [{"key": "subject_image", "label": "Subject Image", "required": True}],
    }
    assistant_text = (
        "This looks like `Cinematic Double-Exposure Travel Poster`.\n"
        "Suggested setup:\n"
        "- Field: Destination\n"
        "- Field: Headline\n"
        "- Image input: Subject Image\n"
        "Create a test workflow with this setup?\n"
        f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"
    )
    brief = build_reference_style_brief(
        user_text="Create a media preset from this style as image-to-image.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )
    message = "Create a test workflow with this setup.\n\n" + encode_reference_style_brief_marker(brief)

    plan = _graph_preset_sandbox_plan(message, GraphWorkflow(name="Style brief planner graph", nodes=[], edges=[]), [])
    prompt_node = next(item for item in plan.operations if item.op == "add_node" and item.node_type == "prompt.text")
    note_node = next(item for item in plan.operations if item.op == "add_node" and item.node_type == "utility.note")
    prompt_text = prompt_node.fields["text"]

    assert "Set the Destination as" in prompt_text
    assert "Set the Headline as" in prompt_text
    assert "Set the Subheading as" not in prompt_text
    assert "Fields: 2" in note_node.fields["body"]


def test_media_assistant_reference_style_repairs_generic_fields_from_analysis(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Vintage Coastal Muscle Car Advertisement Poster",
        "summary": "Sun-faded coastal road poster with a hero vehicle and bold editorial type.",
        "target_model_mode": "text_to_image",
        "input_mode": "no_image",
        "visual_analysis": {
            "medium": ["vintage print advertisement poster", "photo-illustrated automotive campaign"],
            "palette": ["sun-faded cream paper with sea-blue shadows and warm orange highlights"],
            "composition": ["hero car parked low in the foreground", "coastal highway route receding behind it", "large headline block across the upper margin"],
            "environment_props": ["coastal highway route", "ocean cliffs", "retro roadside sign", "muscle car"],
            "texture_lighting": ["paper grain", "golden-hour glare", "slightly weathered ink"],
            "typography_text_energy": ["large condensed headline", "small route-label microtype"],
            "mood": ["nostalgic road-trip energy"],
        },
        "replaceable_elements": ["vehicle model", "route or place", "headline text"],
        "recommended_fields": [
            {"key": "subject_brief", "label": "Subject Brief", "required": True},
            {"key": "accent_palette", "label": "Accent Palette", "required": False},
        ],
        "recommended_image_slots": [],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create a media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    field_keys = [field.key for field in brief.recommended_fields]
    assert field_keys == ["vehicle_model", "route"]
    assert not any(field.default_value for field in brief.recommended_fields)
    assert "accent_palette" not in field_keys

    prompt = compile_reference_style_t2i_prompt(brief)
    assert "Set the Vehicle / Model as" in prompt
    assert "Set the Route / Place as" in prompt
    assert "Coastal Falcon GT" not in prompt
    assert "Big Sur coastal highway" not in prompt
    assert "source" not in prompt.lower()
    assert "copy exact" not in prompt.lower()


def test_media_assistant_route_field_uses_route_sample_in_test_workflow(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Weathered Coastal Muscle-Car Poster",
        "summary": "Vintage coastal car poster with a foreground vehicle and scenic route.",
        "target_model_mode": "text_to_image",
        "input_mode": "no_image",
        "visual_analysis": {
            "medium": ["illustrated commercial poster", "screen-printed vintage ad finish"],
            "palette": ["faded sky blue vehicle paint", "rust orange cliff tones"],
            "line_shape_language": ["chunky angular car geometry", "sweeping curved highway"],
            "composition": ["low front three-quarter hero vehicle view", "winding road leading into distance"],
            "subject_treatment": ["vehicle shown oversized and dominant"],
            "environment_props": ["cliffside coastal highway", "guardrail along ocean edge", "mountain ridges"],
            "texture_lighting": ["dry matte print grain", "sunlit daytime scene"],
            "typography_text_energy": ["large headline block", "small route-label microtype"],
            "mood": ["nostalgic road-trip energy"],
        },
        "replaceable_elements": ["subject vehicle", "scenic route"],
        "recommended_fields": [
            {"key": "subject_vehicle", "label": "Subject Vehicle", "required": True},
            {"key": "scenic_route", "label": "Scenic Route", "required": True},
        ],
        "recommended_image_slots": [],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"
    brief = build_reference_style_brief(
        user_text="Create a text-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={"explicit_text_only": True},
        attachments=[],
    )
    message = "Create the text-to-image test workflow now with the suggested fields.\n\n" + encode_reference_style_brief_marker(brief)

    plan = _graph_preset_sandbox_plan(message, GraphWorkflow(name="Route sample test graph", nodes=[], edges=[]), [])
    prompt_node = next(item for item in plan.operations if item.op == "add_node" and item.node_type == "prompt.text")
    prompt_text = prompt_node.fields["text"]

    assert "Scenic Route" in prompt_text
    assert "road streaking" not in prompt_text
    assert any(value in prompt_text for value in ("Pacific Coast Highway", "cliffside coastal highway", "coastal highway"))


def test_media_assistant_reference_style_rejects_abstract_mood_attitude_field(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Grungy Scribble Bedroom Cartoon Poster",
        "summary": "Cartoon poster scene with rough wall lettering and dense bedroom clutter.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["digital cartoon illustration", "poster-like character scene"],
            "palette": ["warm tan wall background", "mustard yellow clothing accents"],
            "line_shape_language": ["scratchy doodles", "angular expressive outlines"],
            "composition": ["large central wall slogan", "two seated characters in the foreground"],
            "subject_treatment": ["oversized sneakers and expressive cartoon proportions"],
            "environment_props": ["bedroom clutter", "poster-filled wall", "desk props"],
            "texture_lighting": ["rough paper texture", "painterly shading"],
            "typography_text_energy": ["thick rough brush lettering", "large central wall slogan"],
            "mood": ["anxious but funny", "chaotic optimism", "messy bedroom humor"],
        },
        "replaceable_elements": ["headline phrase", "person or character image"],
        "recommended_fields": [
            {"key": "headline_phrase", "label": "Headline Phrase", "required": True},
            {"key": "mood_attitude", "label": "Mood / Attitude", "required": False},
        ],
        "recommended_image_slots": [{"key": "person_character", "label": "Person / Character", "required": True}],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    labels = [field.label for field in brief.recommended_fields]
    keys = [field.key for field in brief.recommended_fields]
    assert "Headline Phrase" in labels
    assert "Mood / Attitude" not in labels
    assert "mood_attitude" not in keys

    prompt = compile_reference_style_i2i_prompt(brief)
    assert "Set the Headline Phrase as" in prompt
    assert "Set the Mood / Attitude as" not in prompt


def test_media_assistant_reference_style_repairs_character_vibe_to_concrete_field(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Retro Neon Caricature Year Poster",
        "summary": "Toy-like retro character poster with giant year numerals and music-room props.",
        "target_model_mode": "text_to_image",
        "input_mode": "no_image",
        "visual_analysis": {
            "medium": ["3D-rendered caricature illustration", "poster-like cinematic scene styling"],
            "palette": ["warm orange and red neon highlights", "deep brown and black shadows"],
            "line_shape_language": ["oversized rounded head and eyes", "large curved neon numerals"],
            "composition": ["single character placed beside giant foreground text", "layered retro music room"],
            "subject_treatment": ["fashion-forward caricature character", "compact body proportions"],
            "environment_props": ["boomboxes", "cassette deck equipment", "retro wall posters"],
            "texture_lighting": ["strong neon edge lighting", "glossy toy-like reflections"],
            "typography_text_energy": ["giant readable year numerals", "retro poster copy zones"],
            "mood": ["nostalgic playful music-driven energy"],
        },
        "replaceable_elements": ["headline or year", "main character", "room setting"],
        "recommended_fields": [
            {"key": "headline_year", "label": "Headline / Year", "required": True},
            {"key": "character_vibe", "label": "Character Vibe", "required": False},
        ],
        "recommended_image_slots": [],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create a text-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    labels = [field.label for field in brief.recommended_fields]
    keys = [field.key for field in brief.recommended_fields]
    assert "Headline / Year" in labels
    assert "Character Vibe" not in labels
    assert "character_vibe" not in keys
    assert any(key in keys for key in ("main_character", "setting", "year"))

    prompt = compile_reference_style_t2i_prompt(brief)
    assert "Character Vibe" not in prompt
    assert any(text in prompt for text in ("Set the Main Character as", "Set the Setting as", "Set the Year as"))


def test_media_assistant_landmark_field_uses_landmark_value_not_subject_value(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Cinematic Double-Exposure Travel Poster",
        "summary": "Warm double-exposure travel poster with a portrait mask and scenic landmarks.",
        "target_model_mode": "text_to_image",
        "input_mode": "no_image",
        "visual_analysis": {
            "medium": ["digital travel poster", "photo-composite double exposure"],
            "palette": ["warm peach sunrise tones", "soft cream paper background"],
            "line_shape_language": ["clean side-profile silhouette", "stacked vertical text columns"],
            "composition": [
                "large left-facing portrait dominates frame",
                "landscape scenes layered inside silhouette",
                "small lone explorer walking into the landscape",
            ],
            "subject_treatment": ["small lone explorer walking into the landscape"],
            "environment_props": ["mountain peak", "temple roofline", "stone path", "travel landmark scenery"],
            "texture_lighting": ["soft glowing sunrise backlight", "misty atmospheric depth"],
            "typography_text_energy": ["large bold destination title", "small editorial labels"],
            "mood": ["reflective aspirational cinematic travel discovery energy"],
        },
        "replaceable_elements": ["destination", "hero landmark"],
        "recommended_fields": [
            {"key": "destination", "label": "Destination", "required": True},
            {"key": "hero_landmark", "label": "Hero Landmark", "required": False},
        ],
        "recommended_image_slots": [],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create a text-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )
    prompt_fields = _fields_with_sandbox_prompt_values([field.model_dump() for field in brief.recommended_fields], brief)
    values_by_key = {field["key"]: field.get("default_value") for field in prompt_fields}

    assert values_by_key["hero_landmark"]
    assert "human" not in values_by_key["hero_landmark"].lower()
    assert "figure" not in values_by_key["hero_landmark"].lower()

    prompt = compile_reference_style_t2i_prompt(brief, fields=prompt_fields)
    assert "Hero Landmark to choose the destination, landmarks" in prompt
    assert "Hero Landmark to define the main character" not in prompt


def test_media_assistant_word_phrase_fields_compile_as_visible_text(app_modules) -> None:
    del app_modules
    brief = ReferenceStyleBrief(
        brief_id="rsb_word_phrase",
        preset_direction=ReferenceStylePresetDirection(
            title="Neon Street Pop Mascot Poster",
            target_model_mode="text_to_image",
        ),
        visual_analysis={
            "medium": ["digital illustration", "poster-like character artwork"],
            "palette": ["blazing orange background", "hot magenta 3D letters"],
            "line_shape_language": ["bulging circular eyes", "chunky rounded shoes"],
            "composition": ["single centered full-body figure", "oversized text behind subject"],
            "subject_treatment": ["toy-like creature silhouette", "glossy oversized eyes"],
            "environment_props": ["boombox-style speaker", "paint splatters"],
            "texture_lighting": ["wet glossy highlights", "spray-paint splatter texture"],
            "typography_text_energy": ["huge sculptural background word", "graffiti poster lettering"],
            "mood": ["loud surreal street-pop energy"],
        },
        preset_contract=ReferenceStylePresetContract(
            fields=[
                ReferenceStylePresetField(key="main_word_or_phrase", label="Main Word or Phrase", required=True),
                ReferenceStylePresetField(key="backdrop_word", label="Backdrop Word", default_value="LOUD", required=False),
            ],
            image_slots=[],
        ),
    )

    prompt = compile_reference_style_t2i_prompt(brief)

    assert "Set the Main Word or Phrase as short visible copy" in prompt
    assert "Use LOUD as the Backdrop Word, preserving the typography hierarchy" in prompt
    assert "Backdrop Word to define the environment" not in prompt


def test_media_assistant_repairs_detail_fields_to_concrete_gear_fields(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Cybernetic Poster Character",
        "summary": "Graphic sci-fi poster with armor panels and streetwear gear.",
        "target_model_mode": "text_to_image",
        "input_mode": "no_image",
        "visual_analysis": {
            "medium": ["digital sci-fi poster illustration", "painted-photoreal hybrid rendering"],
            "palette": ["deep teal background", "burnt orange accents"],
            "line_shape_language": ["sharp angular armor plates", "technical panel lines"],
            "composition": ["single centered hero figure", "low-angle poster framing"],
            "subject_treatment": ["cybernetic warrior with mechanical limbs"],
            "environment_props": ["barcode graphic", "industrial warning labels"],
            "texture_lighting": ["scratched metal", "weathered paint"],
            "typography_text_energy": ["large vertical headline", "small technical annotations"],
            "mood": ["intense rebellious cyberpunk poster energy"],
        },
        "replaceable_elements": ["armor tech details", "outfit details"],
        "recommended_fields": [
            {"key": "armor_tech_details", "label": "Armor / Tech Details", "required": True},
            {"key": "armor_design", "label": "Armor Design", "required": False},
            {"key": "gear_augmentation_notes", "label": "Gear / Augmentation Notes", "required": False},
            {"key": "outfit_details", "label": "Outfit Details", "required": False},
            {"key": "outfit_direction", "label": "Outfit Direction", "required": False},
            {"key": "outfit_gear_direction", "label": "Outfit / Gear Direction", "required": False},
            {"key": "outfit_vibe", "label": "Outfit Vibe", "required": False},
        ],
        "recommended_image_slots": [],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create a text-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    labels = [field.label for field in brief.recommended_fields]
    keys = [field.key for field in brief.recommended_fields]
    assert "Armor / Tech Details" not in labels
    assert "Armor Design" not in labels
    assert "Gear / Augmentation Notes" not in labels
    assert "Outfit Details" not in labels
    assert "Outfit Direction" not in labels
    assert "Outfit / Gear Direction" not in labels
    assert "Outfit Vibe" not in labels
    assert "Armor / Tech Gear" in labels
    assert "Outfit / Wardrobe" in labels
    assert "armor_tech_details" not in keys
    assert "armor_design" not in keys
    assert "gear_augmentation_notes" not in keys
    assert "outfit_details" not in keys
    assert "outfit_direction" not in keys
    assert "outfit_gear_direction" not in keys
    assert "outfit_vibe" not in keys


def test_media_assistant_repairs_stochastic_abstract_field_labels(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Graffiti Poster Portrait",
        "summary": "Graffiti portrait poster with wall text, room clutter, and doodle symbols.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["editorial portrait collage", "graffiti poster treatment"],
            "palette": ["hot pink accents", "black-and-white contrast"],
            "line_shape_language": ["rough brush lettering", "inked doodle symbols"],
            "composition": ["full-body seated portrait", "dense edge-to-edge text framing"],
            "subject_treatment": ["fashion-forward streetwear styling"],
            "environment_props": ["busy room clutter", "painted wall quote", "doodle stickers"],
            "texture_lighting": ["paint splatter texture", "glossy highlights"],
            "typography_text_energy": ["large wall quote", "small side labels"],
            "mood": ["rebellious street-poster energy"],
        },
        "replaceable_elements": ["wall quote", "room vibe", "graphic mood steers the extra doodles"],
        "recommended_fields": [
            {"key": "wall_quote", "label": "Wall Quote", "required": True},
            {"key": "room_vibe", "label": "Room Vibe", "required": False},
            {
                "key": "graphic_mood_steers_the_extra_doodles",
                "label": "Graphic Mood` Steers the extra doodles",
                "required": False,
            },
        ],
        "recommended_image_slots": [{"key": "face_reference", "label": "Face Reference", "required": True}],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    labels = [field.label for field in brief.recommended_fields]
    keys = [field.key for field in brief.recommended_fields]
    assert "Wall Quote" in labels
    assert "Room Vibe" not in labels
    assert "Graphic Mood` Steers the extra doodles" not in labels
    assert "room_vibe" not in keys
    assert "graphic_mood_steers_the_extra_doodles" not in keys
    assert any(label in labels for label in ("Room Decor", "Graphic Symbols"))

    prompt = compile_reference_style_i2i_prompt(brief)
    assert "Wall Quote as short visible copy" in prompt


def test_media_assistant_repairs_environment_and_accessory_details_fields(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Stylized Streetwear Character Figure",
        "summary": "Polished 3D character render with studio backdrop, skateboard, pins, and backpack accessories.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["highly polished 3D character render", "fashion-doll stylization"],
            "palette": ["charcoal black hoodie", "washed denim blue jeans"],
            "line_shape_language": ["oversized rounded clothing silhouette", "chunky sneaker forms"],
            "composition": ["single centered full-body subject", "clean studio backdrop"],
            "subject_treatment": ["youthful skater identity", "stylized fashion figure"],
            "environment_props": ["skateboard underfoot", "black backpack", "pins and patches"],
            "texture_lighting": ["soft studio lighting", "smooth fabric material shading"],
            "typography_text_energy": ["small patch graphics"],
            "mood": ["cool playful streetwear confidence"],
        },
        "replaceable_elements": ["environment", "accessory details"],
        "recommended_fields": [
            {"key": "environment", "label": "Environment", "required": True},
            {"key": "accessory_details", "label": "Accessory Details", "required": False},
        ],
        "recommended_image_slots": [{"key": "body_reference", "label": "Body Reference", "required": True}],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    labels = [field.label for field in brief.recommended_fields]
    keys = [field.key for field in brief.recommended_fields]
    assert "Environment" not in labels
    assert "Accessory Details" not in labels
    assert "Scene / Setting" in labels
    assert "Accessories / Props" in labels
    assert "environment" not in keys
    assert "accessory_details" not in keys


def test_media_assistant_repairs_landmark_scene_details_to_destination_landmark(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Cinematic Double-Exposure Travel Poster",
        "summary": "Double-exposure travel portrait with destination scenery and landmark forms inside the silhouette.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["photo-based poster collage", "double-exposure portrait composite"],
            "palette": ["warm sunrise peach and gold sky", "muted cream paper background"],
            "line_shape_language": ["large clean profile silhouette", "stacked vertical landmark forms"],
            "composition": ["left-facing portrait dominates frame", "landscape scenes embedded inside head and torso"],
            "subject_treatment": ["calm introspective portrait", "face used as destination mask"],
            "environment_props": ["snow-capped mountain", "temple roof", "forest path", "small traveler"],
            "texture_lighting": ["soft atmospheric haze", "matte poster grain"],
            "typography_text_energy": ["bold bottom headline", "small vertical labels"],
            "mood": ["reflective romantic travel energy"],
        },
        "replaceable_elements": ["destination", "landmarks scene details"],
        "recommended_fields": [
            {"key": "destination", "label": "Destination", "required": True},
            {"key": "landmarks_scene_details", "label": "Landmarks / Scene Details", "required": False},
        ],
        "recommended_image_slots": [{"key": "face_reference", "label": "Face Reference", "required": True}],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    labels = [field.label for field in brief.recommended_fields]
    keys = [field.key for field in brief.recommended_fields]
    assert "Landmarks / Scene Details" not in labels
    assert "Destination / Landmark" in labels
    assert "landmarks_scene_details" not in keys
    assert "destination_landmark" in keys


def test_media_assistant_repairs_damage_level_to_visible_wear_field(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Battle-Worn Cinematic Cyborg Portrait",
        "summary": "Photoreal sci-fi portrait with chipped armor, scratches, and weathered paint.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["photoreal cinematic sci-fi portrait", "high-detail concept art realism"],
            "palette": ["desaturated red armor panels", "off-white chipped plating"],
            "line_shape_language": ["hard angular armor segments", "dense mechanical panel seams"],
            "composition": ["vertical close portrait crop", "three-quarter side profile"],
            "subject_treatment": ["stoic cybernetic soldier with heavy armor"],
            "environment_props": ["blurred sci-fi vehicle", "dusty battlefield landing area"],
            "texture_lighting": ["scratched chipped paint", "scuffed metal", "soft natural cinematic light"],
            "typography_text_energy": ["no visible typography"],
            "mood": ["battle-worn guarded stillness"],
        },
        "replaceable_elements": ["battle damage level", "outfit theme"],
        "recommended_fields": [
            {"key": "battle_damage_level", "label": "Battle Damage Level", "required": True},
            {"key": "outfit_theme", "label": "Outfit Theme", "required": False},
        ],
        "recommended_image_slots": [{"key": "person_character", "label": "Person / Character", "required": True}],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    labels = [field.label for field in brief.recommended_fields]
    keys = [field.key for field in brief.recommended_fields]
    assert "Battle Damage Level" not in labels
    assert "Outfit Theme" not in labels
    assert "Surface Wear / Damage" in labels
    assert "Outfit / Wardrobe" in labels
    assert "battle_damage_level" not in keys
    assert "surface_wear_damage" in keys


def test_media_assistant_repairs_augmentation_level_to_concrete_field(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Cybernetic Manga Cover Portrait",
        "summary": "Cybernetic poster character with mechanical limbs, exposed cables, armor plates, and tech markings.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["digital illustration with painterly realism", "editorial poster composition"],
            "palette": ["deep teal background wash", "burnt orange typography and trim"],
            "line_shape_language": ["angular mech limb detailing", "chunky armor silhouettes", "sharp cable accents"],
            "composition": ["extreme low-angle perspective", "foreshortened boot in foreground"],
            "subject_treatment": ["streetwear character merged with cybernetic prosthetics"],
            "environment_props": ["barcode blocks", "warning labels", "unit markings"],
            "texture_lighting": ["weathered paint", "grimy panel texture", "moody rim lighting"],
            "typography_text_energy": ["vertical poster text bands", "technical side labels"],
            "mood": ["rebellious industrial sci-fi energy"],
        },
        "replaceable_elements": ["augmentation level", "outfit theme"],
        "recommended_fields": [
            {"key": "augmentation_level", "label": "Augmentation Level", "required": True},
            {"key": "outfit_theme", "label": "Outfit Theme", "required": False},
        ],
        "recommended_image_slots": [{"key": "person_character", "label": "Person / Character", "required": True}],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    labels = [field.label for field in brief.recommended_fields]
    keys = [field.key for field in brief.recommended_fields]
    assert "Augmentation Level" not in labels
    assert "Outfit Theme" not in labels
    assert "Cybernetic Augmentations" in labels
    assert "Outfit / Wardrobe" in labels
    assert "augmentation_level" not in keys
    assert "cybernetic_augmentations" in keys


def test_media_assistant_repairs_generic_reference_style_preset_summary_fields(app_modules) -> None:
    del app_modules
    assistant_text = (
        "This looks like `Reference Style Preset`; I would lock the style around: "
        "This reads as a loud neon street-pop poster style: black inked characters, hot orange "
        "and magenta backgrounds, splatter graffiti energy, oversized footwear, and a rebellious "
        "toy-monster silhouette.\n\n"
        "Suggested setup:\n"
        "- Field: one or two short text fields\n"
        "- Image input: none\n\n"
        "Create a text-only test workflow with these fields?"
    )

    brief = build_reference_style_brief(
        user_text="Create a reusable text-to-image media preset from these images. Suggest useful fields, but no image input.",
        assistant_text=assistant_text,
        proposal={"explicit_text_only": True},
        attachments=[],
    )

    field_labels = [field.label for field in brief.recommended_fields]
    assert "One Or Two Short Text Fields" not in field_labels
    assert field_labels == ["Poster Text", "Main Subject"]
    assert "reference style preset" not in brief.preset_direction.title.lower()
    assert has_concrete_style_traits(brief)
    reply = compact_style_brief_reply(brief, {"explicit_text_only": True})
    assert "one or two short text fields" not in reply.lower()
    assert "Useful fields: Poster Text and Main Subject" in reply
    assert "Suggested setup" not in reply


def test_media_assistant_compact_reply_repairs_empty_field_contract(app_modules) -> None:
    del app_modules
    brief = ReferenceStyleBrief(
        brief_id="rsb_empty_reply_contract",
        preset_direction=ReferenceStylePresetDirection(
            title="Reference Style Preset",
            target_model_mode="text_to_image",
            input_mode="no_image",
        ),
        visual_analysis={
            "medium": ["graphic music-room poster with toy-like 3D character rendering"],
            "palette": ["hot pink neon glow", "warm amber room lighting"],
            "line_shape_language": ["rounded caricature proportions", "large readable year numerals"],
            "composition": ["full-body character left of center", "oversized glowing numerals on the right"],
            "subject_treatment": ["playful caricature portrait with glossy toy surfaces"],
            "environment_props": ["boombox, cassette tapes, vinyl records, and poster-covered room decor"],
            "texture_lighting": ["soft bloom, haze, glossy reflections, and neon rim light"],
            "typography_text_energy": ["bold readable year numerals as the main graphic element"],
            "mood": ["nostalgic playful retro music energy"],
        },
        preset_contract=ReferenceStylePresetContract(fields=[], image_slots=[]),
    )

    reply = compact_style_brief_reply(brief, {"explicit_text_only": True})

    assert "Reference Style Preset" not in reply
    assert "one or two short text fields" not in reply.lower()
    assert "Useful fields:" in reply
    assert "Suggested setup" not in reply
    assert any(label in reply for label in ("Poster Text", "Main Subject", "Room Decor"))


def test_media_assistant_reference_style_rejects_location_for_retro_year_room(app_modules) -> None:
    del app_modules
    payload = {
        "title": "Neon Retro Caricature Year Portrait",
        "summary": "Toy-like character portrait staged in a neon retro music room with giant year numerals.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["3D character illustration with toy-like proportions"],
            "palette": ["warm amber room lighting", "hot pink neon glow from oversized numerals"],
            "composition": [
                "full-body character placed slightly left of center",
                "giant glowing year numerals occupying the right half",
            ],
            "environment_props": ["boombox", "stereo tower", "vinyl records", "cassette props"],
            "texture_lighting": ["glossy reflections", "light haze and bloom"],
            "typography_text_energy": ["bold readable year numerals as the primary graphic element"],
            "mood": ["nostalgic playful music-driven energy"],
        },
        "replaceable_elements": ["person reference image", "year", "room setting"],
        "recommended_fields": [
            {"key": "location", "label": "Location", "required": True},
            {"key": "year_sign", "label": "Year Sign", "required": True},
        ],
        "recommended_image_slots": [{"key": "portrait", "label": "Portrait", "required": True}],
    }
    assistant_text = f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}"

    brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this style.",
        assistant_text=assistant_text,
        proposal={},
        attachments=[],
    )

    field_labels = [field.label for field in brief.recommended_fields]
    assert "Location" not in field_labels
    assert any(label in field_labels for label in ("Era Setting", "Year Sign", "Year"))

    prompt = compile_reference_style_i2i_prompt(brief)
    assert "Big Sur coastal highway" not in prompt
    assert "destination, landmarks" not in prompt
    assert "Year Sign to define the subject role" not in prompt
    assert "vehicle type" not in prompt
    assert "Room" not in prompt or "to define the environment, backdrop, atmosphere, and supporting scene details" in prompt
    assert "year numerals" in prompt.lower()

    brief.preset_contract.fields = [
        ReferenceStylePresetField(key="location", label="Location", default_value="Big Sur coastal highway", required=True),
        ReferenceStylePresetField(key="neon_year", label="Neon Year", default_value="1989", required=True),
    ]
    stale_contract_prompt = compile_reference_style_i2i_prompt(brief)
    assert "Big Sur coastal highway" not in stale_contract_prompt
    assert "destination, landmarks" not in stale_contract_prompt
    assert "Neon Year" in stale_contract_prompt


def test_media_assistant_deterministic_text_only_preset_plan_summary_does_not_claim_image_loaders(app_modules) -> None:
    del app_modules
    suffix = _unique_test_suffix()
    label = f"Text Only Style Preset {suffix}"
    upsert_preset(
        PresetUpsertRequest(
            key=f"text_only_style_preset_{suffix}",
            label=label,
            description="Text-only deterministic planner test preset.",
            status="active",
            model_key="gpt-image-2-text-to-image",
            applies_to_models=["gpt-image-2-text-to-image"],
            prompt_template="Create {{scene_subject}} with {{headline_slogan}}.",
            input_schema_json=[
                {"key": "scene_subject", "label": "Scene / Subject", "placeholder": "Scene / Subject.", "default_value": "", "required": True},
                {"key": "headline_slogan", "label": "Headline / Slogan", "placeholder": "Headline / Slogan.", "default_value": "", "required": True},
            ],
            input_slots_json=[],
            notes="Text-only test preset",
            source_kind="custom",
            priority=0,
        )
    )

    plan = plan_graph_from_message(
        f"Create a graph workflow that uses the saved Media Preset named {label}.",
        GraphWorkflow(name="Text-only preset planner graph", nodes=[], edges=[]),
        [],
    )

    assert plan.metadata["template_id"] == SAVED_PRESET_TEST_TEMPLATE_ID
    assert plan.metadata["template_slot_count"] == 0
    assert "preset fields, preview, and save output" in plan.summary
    assert "image loaders" not in plan.summary
    assert not any(item.op == "add_node" and item.node_type == "media.load_image" for item in plan.operations)


def test_media_assistant_saved_preset_test_prefills_required_smoke_values_without_defaults(app_modules) -> None:
    del app_modules
    suffix = _unique_test_suffix()
    label = f"Travel Poster Preset {suffix}"
    preset = upsert_preset(
        PresetUpsertRequest(
            key=f"travel_poster_preset_{suffix}",
            label=label,
            description="Saved preset field default regression.",
            status="active",
            model_key="gpt-image-2-text-to-image",
            applies_to_models=["gpt-image-2-text-to-image"],
            prompt_template="Use {{headline_title}}, {{destination_theme}}, and {{transit_line}}.",
            input_schema_json=[
                {"key": "headline_title", "label": "Headline Title", "default_value": "", "required": True},
                {"key": "destination_theme", "label": "Destination Theme", "default_value": "", "required": False},
                {"key": "transit_line", "label": "Transit Line", "default_value": "", "required": True},
            ],
            input_slots_json=[],
            source_kind="custom",
            priority=0,
        )
    )

    plan = plan_graph_from_message(
        f"Use saved preset key {preset['key']} in a graph workflow.",
        GraphWorkflow(name="Saved preset generic field values", nodes=[], edges=[]),
        [],
    )

    preset_node = next(item for item in plan.operations if item.op == "add_node" and item.node_type == "preset.render")
    assert all(str(field.get("default_value") or "") == "" for field in preset["input_schema_json"])
    assert preset_node.fields["text__headline_title"] == "Midnight City Guide"
    assert preset_node.fields["text__destination_theme"] == ""
    assert preset_node.fields["text__transit_line"] == "M7 Express"
    assert "Example" not in json.dumps(preset_node.fields)
    assert "MAKE IT LOUD" not in json.dumps(preset_node.fields)


def test_media_assistant_saved_preset_button_message_bypasses_reference_style_sandbox(app_modules) -> None:
    del app_modules
    suffix = _unique_test_suffix()
    label = f"Cinematic Fandom Lounge Portrait {suffix}"
    preset = upsert_preset(
        PresetUpsertRequest(
            key=f"assistant_cinematic_fandom_lounge_portrait_{suffix}",
            label=label,
            description="Saved preset button routing regression.",
            status="active",
            model_key="gpt-image-2-text-to-image",
            applies_to_models=["gpt-image-2-text-to-image"],
            prompt_template="Render {{main_subject}} with {{fandom_theme}}.",
            input_schema_json=[
                {"key": "main_subject", "label": "Main Subject", "default_value": "", "required": True},
                {"key": "fandom_theme", "label": "Fandom Theme", "default_value": "", "required": False},
            ],
            input_slots_json=[],
            source_kind="custom",
            priority=0,
        )
    )

    plan = plan_graph_from_message(
        (
            f"Create a clean replacement workflow that uses the saved Media Preset named {label} "
            f"with key {preset['key']}. Leave required image inputs empty so the user can attach "
            "the correct images before running."
        ),
        GraphWorkflow(name="Saved preset button graph", nodes=[], edges=[]),
        [{"reference_id": "ref_style11", "label": "style11.jpg", "media_type": "image"}],
    )

    preset_node = next(item for item in plan.operations if item.op == "add_node" and item.node_type == "preset.render")
    assert plan.metadata["template_id"] == SAVED_PRESET_TEST_TEMPLATE_ID
    assert plan.metadata["template_slot_count"] == 0
    assert preset_node.fields["preset_id"] == preset["preset_id"]


def test_media_assistant_saved_i2i_preset_button_message_bypasses_attached_reference_style(app_modules) -> None:
    del app_modules
    suffix = _unique_test_suffix()
    label = f"Cyber Fairy Techno Poster Portrait {suffix}"
    preset = upsert_preset(
        PresetUpsertRequest(
            key=f"assistant_cyber_fairy_techno_poster_portrait_{suffix}",
            label=label,
            description="Saved I2I preset button routing regression.",
            status="active",
            model_key="gpt-image-2-image-to-image",
            applies_to_models=["gpt-image-2-image-to-image"],
            prompt_template="Use [[main_subject]] with {{poster_title}} and {{track_list_subtitle}}.",
            input_schema_json=[
                {"key": "poster_title", "label": "Poster Title", "default_value": "", "required": True},
                {"key": "track_list_subtitle", "label": "Track List / Subtitle", "default_value": "", "required": False},
            ],
            input_slots_json=[
                {"key": "main_subject", "label": "Main Subject", "required": True},
            ],
            source_kind="custom",
            priority=0,
        )
    )

    plan = plan_graph_from_message(
        (
            f"Create a clean replacement workflow that uses the saved Media Preset named {label} "
            f"with key {preset['key']}. Leave required image inputs empty so the user can attach "
            "the correct images before running."
        ),
        GraphWorkflow(name="Saved I2I preset button graph", nodes=[], edges=[]),
        [{"reference_id": "ref_style9", "label": "style9.jpg", "media_type": "image"}],
    )

    preset_node = next(item for item in plan.operations if item.op == "add_node" and item.node_type == "preset.render")
    assert plan.metadata["template_id"] == SAVED_PRESET_TEST_TEMPLATE_ID
    assert plan.metadata["template_slot_count"] == 1
    assert preset_node.fields["preset_id"] == preset["preset_id"]
    assert any(item.op == "add_node" and item.node_type == "media.load_image" for item in plan.operations)
    assert "concrete style read" not in plan.summary.lower()


def test_media_assistant_new_i2i_preset_plan_is_not_hijacked_by_existing_saved_label(app_modules) -> None:
    del app_modules
    suffix = _unique_test_suffix()
    label = f"Cyber Fairy Techno Poster {suffix}"
    upsert_preset(
        PresetUpsertRequest(
            key=f"assistant_cyber_fairy_techno_poster_t2i_{suffix}",
            label=label,
            description="Existing text-only preset with the same style title.",
            status="active",
            model_key="gpt-image-2-text-to-image",
            applies_to_models=["gpt-image-2-text-to-image"],
            prompt_template="Render {{main_subject}} with {{poster_title}}.",
            input_schema_json=[
                {"key": "main_subject", "label": "Main Subject", "default_value": "", "required": True},
                {"key": "poster_title", "label": "Poster Title", "default_value": "", "required": False},
            ],
            input_slots_json=[],
            source_kind="custom",
            priority=0,
        )
    )
    payload = {
        "title": label,
        "summary": "Icy blue techno poster portrait with insect wings and utility-pole infrastructure.",
        "target_model_mode": "image_edit",
        "visual_analysis": {
            "medium": ["photo-based fashion editorial poster", "album-cover techno-flyer styling"],
            "palette": ["icy blue-gray monochrome", "silver-white haze"],
            "composition": ["low-angle crouched subject on utility equipment", "large translucent wings spanning the frame"],
            "environment_props": ["utility poles", "heavy cables", "warning labels"],
            "texture_lighting": ["misty bloom", "soft washed highlights"],
            "typography_text_energy": ["large poster title", "vertical CJK-style headline", "track-list microtype"],
            "mood": ["fragile futuristic romance"],
        },
        "recommended_fields": [
            {"key": "poster_title", "label": "Poster Title", "required": False},
            {"key": "track_list_subtitle", "label": "Track List / Subtitle", "required": False},
        ],
        "recommended_image_slots": [{"key": "main_subject", "label": "Main Subject", "required": True}],
    }
    brief = build_reference_style_brief(
        user_text="Create an image-to-image media preset from this reference image.",
        assistant_text=f"{PROVIDER_BRIEF_JSON_OPEN}\n{json.dumps(payload)}\n{PROVIDER_BRIEF_JSON_CLOSE}",
        proposal={},
        attachments=[{"reference_id": "style9-ref", "label": "style9.jpg", "media_type": "image"}],
    )

    plan = plan_graph_from_message(
        (
            "Create an image-to-image media preset from this reference image with one input image for the main subject. "
            "Create a test workflow with this setup.\n"
            "Latest visible assistant setup: Suggested setup: - Field: Poster Title - Field: Track List / Subtitle - Image input: Main Subject\n\n"
            f"{encode_reference_style_brief_marker(brief)}"
        ),
        GraphWorkflow(name="New image-to-image style preset graph", nodes=[], edges=[]),
        [{"reference_id": "style9-ref", "label": "style9.jpg", "media_type": "image"}],
    )

    assert plan.metadata["template_id"] == I2I_SANDBOX_TEMPLATE_ID
    assert plan.metadata["template_slot_count"] == 1
    assert "saved preset" not in plan.summary.lower()
    assert any(item.op == "add_node" and item.node_type == "media.load_image" and item.title == "Main Subject" for item in plan.operations)
    assert not any(item.op == "add_node" and item.node_type == "preset.render" for item in plan.operations)


def test_media_preset_renderer_strips_missing_optional_field_tokens(app_modules) -> None:
    del app_modules
    service_module = importlib.import_module("app.service")

    rendered = service_module._render_preset_prompt(
        "Create {{headline_title}}.\nUse {{destination_theme}} only when provided.\nKeep poster texture.",
        {"headline_title": "Far Horizon"},
        {},
    )

    assert "{{" not in rendered
    assert "Far Horizon" in rendered
    assert "destination_theme" not in rendered
    assert "Keep poster texture." in rendered


def test_media_assistant_existing_preset_plan_prefers_exact_key_over_label(app_modules) -> None:
    del app_modules
    suffix = _unique_test_suffix()
    shared_label = f"Shared Style Preset {suffix}"
    first = upsert_preset(
        PresetUpsertRequest(
            key=f"shared_style_first_{suffix}",
            label=shared_label,
            description="First preset with a shared label.",
            status="active",
            model_key="gpt-image-2-text-to-image",
            applies_to_models=["gpt-image-2-text-to-image"],
            prompt_template="Create {{scene_subject}}.",
            input_schema_json=[
                {"key": "scene_subject", "label": "Scene / Subject", "default_value": "", "required": True},
            ],
            input_slots_json=[],
            source_kind="custom",
            priority=0,
        )
    )
    second = upsert_preset(
        PresetUpsertRequest(
            key=f"shared_style_second_{suffix}",
            label=shared_label,
            description="Second preset with a shared label.",
            status="active",
            model_key="nano-banana-2",
            applies_to_models=["nano-banana-2"],
            prompt_template="Create {{scene_subject}} using [[subject_image]].",
            input_schema_json=[
                {"key": "scene_subject", "label": "Scene / Subject", "default_value": "", "required": True},
            ],
            input_slots_json=[
                {"key": "subject_image", "label": "Subject Image", "max_files": 1, "required": False},
            ],
            source_kind="custom",
            priority=0,
        )
    )

    plan = plan_graph_from_message(
        f"Use saved preset key shared_style_second_{suffix} in a graph workflow.",
        GraphWorkflow(name="Exact preset key graph", nodes=[], edges=[]),
        [],
    )

    preset_node = next(item for item in plan.operations if item.op == "add_node" and item.node_type == "preset.render")
    assert first["preset_id"] != second["preset_id"]
    assert preset_node.fields["preset_id"] == second["preset_id"]
    assert plan.metadata["template_id"] == SAVED_PRESET_TEST_TEMPLATE_ID
    assert plan.metadata["template_slot_count"] == 1


def test_media_assistant_existing_preset_plan_prefers_longest_exact_key_prefix(app_modules) -> None:
    del app_modules
    suffix = _unique_test_suffix()
    shared_label = f"Prefix Style Preset {suffix}"
    base_key = f"assistant_prefix_style_{suffix}"
    text_only = upsert_preset(
        PresetUpsertRequest(
            key=base_key,
            label=shared_label,
            description="Text-only preset whose key prefixes the image preset key.",
            status="active",
            model_key="gpt-image-2-text-to-image",
            applies_to_models=["gpt-image-2-text-to-image"],
            prompt_template="Create {{scene_subject}}.",
            input_schema_json=[
                {"key": "scene_subject", "label": "Scene / Subject", "default_value": "", "required": True},
            ],
            input_slots_json=[],
            source_kind="custom",
            priority=0,
        )
    )
    image_preset = upsert_preset(
        PresetUpsertRequest(
            key=f"{base_key}_2",
            label=shared_label,
            description="Image preset with a suffixed key.",
            status="active",
            model_key="gpt-image-2-image-to-image",
            applies_to_models=["gpt-image-2-image-to-image"],
            prompt_template="Restyle [[subject_image]] with {{scene_subject}}.",
            input_schema_json=[
                {"key": "scene_subject", "label": "Scene / Subject", "default_value": "", "required": True},
            ],
            input_slots_json=[
                {"key": "subject_image", "label": "Subject Image", "max_files": 1, "required": True},
            ],
            source_kind="custom",
            priority=0,
        )
    )

    plan = plan_graph_from_message(
        f"Use saved preset key {base_key}_2 in a graph workflow.",
        GraphWorkflow(name="Prefix exact preset key graph", nodes=[], edges=[]),
        [],
    )

    preset_node = next(item for item in plan.operations if item.op == "add_node" and item.node_type == "preset.render")
    assert text_only["preset_id"] != image_preset["preset_id"]
    assert preset_node.fields["preset_id"] == image_preset["preset_id"]
    assert preset_node.fields["preset_model_key"] == "gpt-image-2-image-to-image"
    assert plan.metadata["template_id"] == SAVED_PRESET_TEST_TEMPLATE_ID
    assert plan.metadata["template_slot_count"] == 1
    assert any(item.op == "add_node" and item.node_type == "media.load_image" and item.title == "Subject Image" for item in plan.operations)


def test_media_assistant_saved_preset_key_chat_bypasses_reference_style_intake(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="style-reference.png")
    suffix = _unique_test_suffix()
    shared_label = f"Shared Saved Key Style {suffix}"
    preset_request = app_modules["schemas"].PresetUpsertRequest
    app_modules["service"].upsert_preset(
        preset_request(
            key=f"saved_key_text_{suffix}",
            label=shared_label,
            description="Text preset sharing a label.",
            status="active",
            model_key="gpt-image-2-text-to-image",
            applies_to_models=["gpt-image-2-text-to-image"],
            prompt_template="Create {{scene_subject}}.",
            input_schema_json=[
                {"key": "scene_subject", "label": "Scene / Subject", "default_value": "", "required": True},
            ],
            input_slots_json=[],
            source_kind="custom",
            priority=0,
        )
    )
    app_modules["service"].upsert_preset(
        preset_request(
            key=f"saved_key_image_{suffix}",
            label=shared_label,
            description="Image preset sharing a label.",
            status="active",
            model_key="nano-banana-2",
            applies_to_models=["nano-banana-2"],
            prompt_template="Restyle [[subject_image]] with {{scene_subject}}.",
            input_schema_json=[
                {"key": "scene_subject", "label": "Scene / Subject", "default_value": "", "required": True},
            ],
            input_slots_json=[
                {"key": "subject_image", "label": "Subject Image", "max_files": 1, "required": False},
            ],
            source_kind="custom",
            priority=0,
        )
    )

    def fail_provider_chat(**_kwargs):
        raise AssertionError("Saved preset key chat should not call provider style intake.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    workflow = {"schema_version": 1, "name": "Saved key chat graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": f"workflow-saved-key-chat-{suffix}", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]
    attach_response = client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "style-reference.png"},
    )
    assert attach_response.status_code == 200, attach_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": f"Create a graph workflow using saved Media Preset key saved_key_image_{suffix}.",
            "workflow": workflow,
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_saved_preset_workflow_request"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert "exact preset key/id" in assistant_message["content_text"]
    assert "Do you want a runtime image input" not in assistant_message["content_text"]


def test_media_assistant_deterministic_preset_plan_does_not_prefill_style_reference_attachments(app_modules) -> None:
    del app_modules
    suffix = _unique_test_suffix()
    label = f"Storyboard Character Sheet Generator Attachment Test {suffix}"
    upsert_preset(
        PresetUpsertRequest(
            key=f"storyboard_character_sheet_generator_attachment_test_{suffix}",
            label=label,
            description="Attachment prefill planner test preset.",
            status="active",
            model_key="nano-banana-2",
            applies_to_models=["nano-banana-2"],
            prompt_template=(
                "Create a storyboard character sheet for {{outfit_details}} in {{background_environment}} "
                "with {{panel_story_notes}}. Use [[face_reference]] and [[full_body_reference]] when provided."
            ),
            input_schema_json=[
                {"key": "outfit_details", "label": "Clothing / Outfit", "placeholder": "Layered field jacket with utility belt.", "default_value": "", "required": True},
                {"key": "background_environment", "label": "Background / Environment", "placeholder": "Warm neutral studio board with small notes.", "default_value": "", "required": True},
                {"key": "panel_story_notes", "label": "Panel Story Notes", "placeholder": "Hero pose, expression line-up, and prop closeups.", "default_value": "", "required": True},
            ],
            input_slots_json=[
                {"key": "face_reference", "label": "Face / Identity Reference", "max_files": 1, "help_text": "", "required": False},
                {"key": "full_body_reference", "label": "Full-Body Reference", "max_files": 1, "help_text": "", "required": False},
            ],
            notes="Attachment test preset",
            source_kind="custom",
            priority=0,
        )
    )

    plan = plan_graph_from_message(
        f"Create a graph workflow that uses the saved Media Preset named {label}.",
        GraphWorkflow(name="Preset planner graph", nodes=[], edges=[]),
        [{"reference_id": "reference-style-sheet", "kind": "image"}],
    )

    loader_nodes = [item for item in plan.operations if item.op == "add_node" and item.node_type == "media.load_image"]
    assert len(loader_nodes) == 2
    assert all("reference_id" not in (node.fields or {}) for node in loader_nodes)


def test_media_assistant_skips_provider_planner_when_deterministic_plan_is_available(client, app_modules, monkeypatch) -> None:
    deterministic_plan = plan_graph_from_message(
        "Create a text-to-image workflow.",
        GraphWorkflow(name="Deterministic route graph", nodes=[], edges=[]),
        [],
    )
    monkeypatch.setattr("app.assistant.routes._deterministic_graph_plan_candidate", lambda *_args, **_kwargs: deterministic_plan)

    def fail_provider_plan(**_kwargs):
        raise AssertionError("Provider planner should be skipped for existing preset workflow requests.")

    monkeypatch.setattr("app.assistant.routes.run_provider_graph_plan", fail_provider_plan)

    workflow = {"schema_version": 1, "name": "Deterministic route graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-deterministic-route-test", "workflow": workflow},
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create a text-to-image workflow.",
            "workflow": workflow,
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["validation"]["valid"] is True
    assert any(node["type"] == "prompt.text" for node in payload["workflow"]["nodes"])
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    assert usage_rows[0]["usage_json"]["mode"] == "deterministic_graph_plan"
    assert usage_rows[0]["usage_json"]["provider_attempts"] is None


def test_media_assistant_graph_mode_skips_provider_planner_for_template_plan(client, app_modules, monkeypatch) -> None:
    def fail_provider_plan(**_kwargs):
        raise AssertionError("Graph mode template planning should use the deterministic planner.")

    monkeypatch.setattr("app.assistant.routes.run_provider_graph_plan", fail_provider_plan)

    workflow = {"schema_version": 1, "name": "Graph mode deterministic route", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={
            "owner_kind": "graph_workflow",
            "owner_id": "workflow-graph-mode-deterministic-route-test",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )
    assert session_response.status_code == 200, session_response.text
    session_id = session_response.json()["assistant_session_id"]

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create a clean text-to-image graph workflow with prompt, preview, and save image.",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["validation"]["valid"] is True
    assert payload["graph_plan"]["summary"] == "Create a text-to-image workflow with a prompt, model, preview, and save output."
    assert {node["type"] for node in payload["workflow"]["nodes"]} >= {"prompt.text", "preview.image", "media.save_image"}
    group = payload["workflow"]["metadata"]["groups"][0]
    assert set(group["node_ids"]) == {node["id"] for node in payload["workflow"]["nodes"]}
    guide_node = next(node for node in payload["workflow"]["nodes"] if node["metadata"]["ui"]["customTitle"] == "Guide")
    assert guide_node["id"] in group["node_ids"]
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["type"] == "prompt.text")
    assert prompt_node["metadata"]["assistant"]["semantic_ref"] == "prompt"
    assert group["bounds"]["x"] < guide_node["position"]["x"]
    assert group["bounds"]["y"] < guide_node["position"]["y"]
    usage_rows = app_modules["store_assistant"].list_assistant_turn_usage(session_id)
    assert usage_rows[0]["usage_json"]["mode"] == "deterministic_graph_plan"
    assert usage_rows[0]["usage_json"]["provider_attempts"] is None


def test_media_assistant_provider_plan_receives_canvas_context(client, monkeypatch) -> None:
    captured_context: dict[str, object] = {}

    def fake_provider_plan(**kwargs):
        captured_context.update(kwargs["context"])
        return {
            "graph_plan": AssistantGraphPlan(
                summary="I need one target node before changing the canvas.",
                questions=["Which storyboard section should I update?"],
                operations=[],
                warnings=[],
                requires_confirmation=True,
                metadata={"template_id": "canvas_context_provider_test"},
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "canvas-context-plan",
            "usage": {},
        }

    monkeypatch.setattr("app.assistant.routes.run_provider_graph_plan", fake_provider_plan)
    workflow = {
        "schema_version": 1,
        "workflow_id": "workflow-canvas-plan",
        "name": "Canvas plan",
        "nodes": [],
        "edges": [],
        "metadata": {},
    }
    canvas_context = {
        "workflow_id": "workflow-canvas-plan",
        "workflow_name": "Canvas plan",
        "node_count": 1,
        "edge_count": 0,
        "nodes": [{"id": "recipe", "type": "prompt.recipe", "title": "Storyboard 1 Recipe", "position": {"x": 100, "y": 100}}],
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-canvas-plan", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Use the current canvas context to recommend a safe local edit.",
            "workflow": workflow,
            "canvas_context": canvas_context,
            "assistant_mode": "graph",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    assert captured_context["canvas_context"]["workflow_name"] == "Canvas plan"
    assert captured_context["canvas_context"]["nodes"][0]["title"] == "Storyboard 1 Recipe"
    assert plan_response.json()["graph_plan"]["metadata"]["template_id"] == "canvas_context_provider_test"


def test_media_assistant_canvas_preset_shape_uses_current_graph_without_provider(client, monkeypatch) -> None:
    def fail_provider_chat(**_kwargs):
        raise AssertionError("Canvas preset shape should not call provider chat.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    workflow = {"schema_version": 1, "workflow_id": "workflow-canvas-preset-shape", "name": "Canvas preset shape", "nodes": [], "edges": [], "metadata": {}}
    canvas_context = {
        "workflow_id": "workflow-canvas-preset-shape",
        "workflow_name": "Canvas preset shape",
        "node_count": 2,
        "edge_count": 1,
        "nodes": [
            {
                "id": "character-ref",
                "type": "media.load_image",
                "title": "Character Reference",
                "position": {"x": 0, "y": 0},
                "media_refs": [{"reference_id": "ref-character", "kind": "image"}],
            },
            {
                "id": "prompt",
                "type": "prompt.text",
                "title": "Draft preset prompt",
                "position": {"x": 420, "y": 0},
                "prompt_summaries": [
                    {"text": "cinematic sci-fi character in a ruined spaceport with moody blue lighting and dialogue caption"}
                ],
            },
        ],
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-canvas-preset-shape", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "What preset should I make from this current graph? Recommend the preset shape.",
            "workflow": workflow,
            "canvas_context": canvas_context,
            "assistant_mode": "preset",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_canvas_preset_shape"
    assert assistant_message["content_json"]["recommended_preset_shape"] == "image_to_image"
    assert assistant_message["content_json"]["assistant_response_kind"] == "answer"
    assert assistant_message["content_json"]["assistant_turn_trace"]["canvas_context_used"] is True
    assert "Subject / Character" in assistant_message["content_text"]
    assert "Character / Subject Reference" in assistant_message["content_text"]

    trace_response = client.get(f"/media/assistant/sessions/{session_id}/debug-trace")
    assert trace_response.status_code == 200, trace_response.text
    trace_payload = trace_response.json()
    assert trace_payload["transcript_quality"]["passed"] is True
    assert trace_payload["turn_trace"][-1]["mode"] == "deterministic_canvas_preset_shape"


def test_media_assistant_preset_followup_edit_updates_existing_prompt_locally() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Preset follow-up edit",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "Create a polished portrait from the reference."},
                "metadata": {"ui": {"customTitle": "Draft preset prompt"}},
            }
        ],
        edges=[],
        metadata={},
    )

    plan = plan_graph_from_message(
        "Make the Draft preset prompt closer to the reference style with stronger gothic sci-fi lighting.",
        workflow,
        [],
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan.operations[0].op == "set_node_field"
    assert [operation.op for operation in plan.operations] == ["set_node_field"]
    updated_prompt = next(node for node in planned_workflow.nodes if node.id == "prompt").fields["text"]
    assert "gothic" in updated_prompt.lower() or "reference style" in updated_prompt.lower()
    assert "does not run the graph or save" in plan.warnings[0].lower()


def test_media_assistant_selected_prompt_recipe_user_prompt_edit_uses_canvas_selection() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Selected recipe edit",
        nodes=[
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 100, "y": 100},
                "fields": {"user_prompt": "Make a Western marshal.", "character_name": "Sadi"},
                "metadata": {"ui": {"customTitle": "Character Sheet Recipe"}},
            }
        ],
        edges=[],
        metadata={},
    )
    canvas_context = {"selection_available": True, "selected_node_ids": ["recipe"], "nodes": [{"id": "recipe"}]}

    plan = selected_node_field_edit_plan_from_context(
        "Update only the selected node USER PROMPT to make the character a futuristic cyborg with chrome panels and turquoise energy lines. Do not run or save.",
        workflow,
        canvas_context,
    )
    assert plan is not None
    assert [operation.op for operation in plan.operations] == ["set_node_field"]
    assert plan.operations[0].node_id == "recipe"
    assert set(plan.operations[0].fields) == {"user_prompt"}
    assert "provider" in plan.warnings[0]

    planned_workflow = apply_graph_plan(workflow, plan)
    updated_node = next(node for node in planned_workflow.nodes if node.id == "recipe")
    assert "futuristic cyborg" in str(updated_node.fields["user_prompt"]).lower()
    assert "do not run" not in str(updated_node.fields["user_prompt"]).lower()
    assert updated_node.fields["character_name"] == "Sadi"

    name_plan = selected_node_field_edit_plan_from_context(
        "Set the selected Character Sheet visible name to Character so storyboard outputs do not use the local project label. Do not run or save.",
        workflow,
        canvas_context,
    )
    assert name_plan is not None
    assert name_plan.operations[0].fields == {"character_name": "Character"}

    colon_plan = selected_node_field_edit_plan_from_context(
        "Update only the selected node user prompt to: make the character wear obsidian-white cybernetic explorer armor. Do not run or save.",
        workflow,
        canvas_context,
    )
    assert colon_plan is not None
    assert colon_plan.operations[0].fields["user_prompt"] == "make the character wear obsidian-white cybernetic explorer armor."

    story_plan = selected_node_field_edit_plan_from_context(
        "Update this Storyboard v2 story brief to: a woman is pulled from the real world into a dark fantasy realm, "
        "escapes a dungeon, and is chased through ruined castle halls by ogres. Keep it as the story brief only. Do not run or save.",
        workflow,
        canvas_context,
    )
    assert story_plan is not None
    assert story_plan.operations[0].fields["user_prompt"] == (
        "a woman is pulled from the real world into a dark fantasy realm, escapes a dungeon, "
        "and is chased through ruined castle halls by ogres."
    )

    natural_plan = selected_node_field_edit_plan_from_context(
        "Make this darker and more haunted, like cold moonlight in a dungeon escape. Do not run or save.",
        workflow,
        canvas_context,
    )
    assert natural_plan is not None
    assert natural_plan.operations[0].fields["user_prompt"] == "darker and more haunted, like cold moonlight in a dungeon escape."

    character_style_plan = selected_node_field_edit_plan_from_context(
        "Let's try to create her as a new rogue wizard wearing all black with yoga pants and carrying a staff.",
        workflow,
        canvas_context,
    )
    assert character_style_plan is not None
    assert character_style_plan.operations[0].fields["user_prompt"] == (
        "rogue wizard wearing all black with yoga pants and carrying a staff."
    )

    action_plan = selected_node_field_edit_plan_from_context(
        "I want to have her inspecting cybernetic upgrades on her arm.",
        workflow,
        canvas_context,
    )
    assert action_plan is not None
    assert action_plan.operations[0].fields["user_prompt"] == "the character inspecting cybernetic upgrades on her arm."

    compact_brief_plan = selected_node_field_edit_plan_from_context(
        "Tighten the selected Character Sheet user prompt into a compact creative brief only, not instructions and not a full recipe. "
        "Use this direction: adult rogue assassin in red-and-black tattered combat clothing, worn torn fabrics and leather wraps, "
        "subtle blade details, scratches, grime, signs of a recent attack, dangerous confident stance, cinematic dark-fantasy stealth styling, "
        "alluring but tasteful production-reference design, no nudity. Update the field only. Do not run or save.",
        workflow,
        canvas_context,
    )
    assert compact_brief_plan is not None
    assert compact_brief_plan.operations[0].fields["user_prompt"] == (
        "adult rogue assassin in red-and-black tattered combat clothing, worn torn fabrics and leather wraps, subtle blade details, "
        "scratches, grime, signs of a recent attack, dangerous confident stance, cinematic dark-fantasy stealth styling, "
        "alluring but tasteful production-reference design, no nudity."
    )

    natural_compact_brief_plan = selected_node_field_edit_plan_from_context(
        "Update the selected Character Sheet user prompt to a compact creative brief for the sheet: adult dark-fantasy rogue assassin "
        "in red-and-black battle-worn layered clothing, torn fabric edges, leather wraps, subtle blade details, scratches, grime, "
        "recently ambushed survival mood, dangerous confident stance, cinematic stealth styling, stylish and tasteful production-reference "
        "design, no nudity and no graphic injury. Update the field only; do not run or save.",
        workflow,
        canvas_context,
    )
    assert natural_compact_brief_plan is not None
    assert natural_compact_brief_plan.operations[0].fields["user_prompt"] == (
        "adult dark-fantasy rogue assassin in red-and-black battle-worn layered clothing, torn fabric edges, leather wraps, "
        "subtle blade details, scratches, grime, recently ambushed survival mood, dangerous confident stance, cinematic stealth styling, "
        "stylish and tasteful production-reference design, no nudity and no graphic injury."
    )

    sentence_boundary_plan = selected_node_field_edit_plan_from_context(
        "Update the selected Character Sheet user prompt. Make the character a fantasy rogue warrior woman in red-and-black "
        "tattered battle-worn clothing, visibly worn from a recent fight, seductive and revealing but tasteful adult fantasy styling, "
        "leather wraps, torn fabric edges, scratches and grime, dangerous confident stance, and a mysterious green amulet hanging "
        "from her neck. Keep this as a compact character-sheet creative brief only. Do not run, save, submit, upload, delete, import, or export.",
        workflow,
        canvas_context,
    )
    assert sentence_boundary_plan is not None
    assert sentence_boundary_plan.operations[0].fields["user_prompt"] == (
        "fantasy rogue warrior woman in red-and-black tattered battle-worn clothing, visibly worn from a recent fight, seductive "
        "and revealing but tasteful adult fantasy styling, leather wraps, torn fabric edges, scratches and grime, dangerous "
        "confident stance, and a mysterious green amulet hanging from her neck."
    )

    loose_character_intent_plan = selected_node_field_edit_plan_from_context(
        "Can we create a chr for a sci-fi Westworld female chr as a cyborg gunslinder? "
        "Keep it as the character sheet user prompt only. Do not run or save.",
        workflow,
        canvas_context,
    )
    assert loose_character_intent_plan is not None
    assert loose_character_intent_plan.operations[0].fields["user_prompt"] == (
        "sci-fi Westworld female character as a cyborg gunslinger."
    )


def test_media_assistant_selected_generic_prompt_recipe_user_prompt_edit_is_recipe_scoped() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Selected generic recipe edit",
        nodes=[
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 100, "y": 100},
                "fields": {"user_prompt": "Old product brief.", "recipe_id": "prompt-recipe-product-poster"},
                "metadata": {"ui": {"customTitle": "Product Poster Recipe"}},
            }
        ],
        edges=[],
        metadata={},
    )
    canvas_context = {"selection_available": True, "selected_node_ids": ["recipe"], "nodes": [{"id": "recipe"}]}

    plan = selected_node_field_edit_plan_from_context(
        "Can we create a user prompt for a chrome cyberpunk perfume bottle on a rain-slick neon street?",
        workflow,
        canvas_context,
    )
    assert plan is not None
    assert [operation.op for operation in plan.operations] == ["set_node_field"]
    assert plan.operations[0].node_id == "recipe"
    assert plan.operations[0].fields == {
        "user_prompt": "a chrome cyberpunk perfume bottle on a rain-slick neon street."
    }
    assert "provider" in plan.warnings[0]


def test_selected_node_edit_ignores_story_chat_when_no_node_selected() -> None:
    workflow = GraphWorkflow(schema_version=1, name="Story chat", nodes=[], edges=[], metadata={})

    plan = selected_node_field_edit_plan_from_context(
        "I want to build a story about two characters: a portal-trapped cyber-western heroine and a cursed dungeon knight. "
        "Keep this as chat only for now. Draft the story bible and do not build a graph yet.",
        workflow,
        {"selection_available": True, "selected_node_ids": []},
    )

    assert plan is None


def test_media_assistant_selected_prompt_recipe_chat_and_plan_use_canvas_selection(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Selected recipe route edit",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 100, "y": 100},
                "fields": {"user_prompt": "Make a Western marshal.", "character_name": "Sadi"},
                "metadata": {"ui": {"customTitle": "Character Sheet Recipe"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    canvas_context = {"selection_available": True, "selected_node_ids": ["recipe"], "nodes": [{"id": "recipe"}]}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "selected-recipe-route-edit", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    message = "Update only the selected node USER PROMPT to make the character a futuristic cyborg. Do not run or save."

    message_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": message, "workflow": workflow, "canvas_context": canvas_context, "assistant_mode": "graph"},
    )
    assert message_response.status_code == 200, message_response.text
    assistant_message = message_response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_selected_node_field_edit"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert assistant_message["content_json"]["assistant_response_kind"] == "create_local"
    assert "no run, save, or provider action happened" in assistant_message["content_text"].lower()

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={"message": message, "workflow": workflow, "canvas_context": canvas_context, "assistant_mode": "graph"},
    )
    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["graph_plan"]["metadata"]["template_id"] == "selected_node_field_edit_v1"
    assert payload["graph_plan"]["operations"][0]["op"] == "set_node_field"
    assert payload["graph_plan"]["operations"][0]["fields"]["user_prompt"] == "make the character a futuristic cyborg."
    updated_node = payload["workflow"]["nodes"][0]
    assert updated_node["fields"]["character_name"] == "Sadi"
    assert updated_node["fields"]["user_prompt"] == "make the character a futuristic cyborg."

    name_plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Set the selected Character Sheet visible name to Character. Do not run or save.",
            "workflow": workflow,
            "canvas_context": canvas_context,
            "assistant_mode": "graph",
        },
    )
    assert name_plan_response.status_code == 200, name_plan_response.text
    name_payload = name_plan_response.json()
    assert name_payload["graph_plan"]["operations"][0]["fields"] == {"character_name": "Character"}
    assert name_payload["workflow"]["nodes"][0]["fields"]["character_name"] == "Character"
    assert name_payload["workflow"]["nodes"][0]["fields"]["user_prompt"] == "Make a Western marshal."


def test_media_assistant_selected_storyboard_story_brief_edit_uses_canvas_selection(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Selected storyboard route edit",
        "nodes": [
            {
                "id": "storyboard-recipe",
                "type": "prompt.recipe",
                "position": {"x": 100, "y": 100},
                "fields": {"user_prompt": "Old storyboard brief.", "recipe_id": "prompt-recipe-storyboard-v2-gpt-image-2"},
                "metadata": {"ui": {"customTitle": "Storyboard 1 v2 Recipe"}},
            }
        ],
        "edges": [],
        "metadata": {},
    }
    canvas_context = {"selection_available": True, "selected_node_ids": ["storyboard-recipe"], "nodes": [{"id": "storyboard-recipe"}]}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "selected-storyboard-route-edit", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    message = (
        "Update this Storyboard v2 story brief to: a woman is pulled from the real world through a portal, "
        "escapes a dark fantasy dungeon, and is chased by ogres through ruined castle halls. "
        "Do not run, save, submit, upload, delete, import, or export."
    )

    message_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": message, "workflow": workflow, "canvas_context": canvas_context, "assistant_mode": "graph"},
    )
    assert message_response.status_code == 200, message_response.text
    assistant_message = message_response.json()["messages"][-1]
    assert assistant_message["content_json"]["mode"] == "deterministic_selected_node_field_edit"
    assert assistant_message["content_json"]["assistant_response_kind"] == "create_local"

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={"message": message, "workflow": workflow, "canvas_context": canvas_context, "assistant_mode": "graph"},
    )
    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["graph_plan"]["operations"][0]["op"] == "set_node_field"
    assert payload["graph_plan"]["operations"][0]["fields"]["user_prompt"] == (
        "a woman is pulled from the real world through a portal, escapes a dark fantasy dungeon, "
        "and is chased by ogres through ruined castle halls."
    )
    assert payload["workflow"]["nodes"][0]["fields"]["user_prompt"] == payload["graph_plan"]["operations"][0]["fields"]["user_prompt"]

    no_dialogue_message = (
        "Change this storyboard brief so Sadie is pulled through a portal into a cursed dungeon, breaks free, "
        "finds a green amulet, and escapes through moonlit castle halls. No dialogue, keep it wordless and visual. "
        "Do not run or save."
    )
    no_dialogue_plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={"message": no_dialogue_message, "workflow": workflow, "canvas_context": canvas_context, "assistant_mode": "graph"},
    )
    assert no_dialogue_plan_response.status_code == 200, no_dialogue_plan_response.text
    no_dialogue_value = no_dialogue_plan_response.json()["graph_plan"]["operations"][0]["fields"]["user_prompt"]
    assert "Sadie" not in no_dialogue_value
    assert "Sadi" not in no_dialogue_value
    assert "the character is pulled through a portal" in no_dialogue_value
    assert "No dialogue" in no_dialogue_value


def test_media_assistant_selected_prompt_text_edit_uses_canvas_selection() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Selected prompt text edit",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 100, "y": 100},
                "fields": {"text": "Old prompt"},
                "metadata": {"ui": {"customTitle": "Draft Prompt"}},
            }
        ],
        edges=[],
        metadata={},
    )

    plan = selected_node_field_edit_plan_from_context(
        "Set the selected node text to gothic sci-fi lighting, wet stone, and a confident cinematic stance. Do not run or save.",
        workflow,
        {"selection_available": True, "selected_node_ids": ["prompt"]},
    )
    assert plan is not None
    assert [operation.op for operation in plan.operations] == ["set_node_field"]
    assert plan.operations[0].fields == {"text": "gothic sci-fi lighting, wet stone, and a confident cinematic stance."}

    planned_workflow = apply_graph_plan(workflow, plan)
    assert next(node for node in planned_workflow.nodes if node.id == "prompt").fields["text"].startswith("gothic sci-fi")

    natural_plan = selected_node_field_edit_plan_from_context(
        "Make this moodier and more cinematic with haunted castle moonlight. Do not run or save.",
        workflow,
        {"selection_available": True, "selected_node_ids": ["prompt"]},
    )
    assert natural_plan is not None
    assert natural_plan.operations[0].fields == {"text": "moodier and more cinematic with haunted castle moonlight."}


def test_media_assistant_selected_model_settings_edit_uses_canvas_selection() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Selected model settings edit",
        nodes=[
            {
                "id": "gpt",
                "type": "model.kie.gpt_image_2_image_to_image",
                "position": {"x": 100, "y": 100},
                "fields": {"aspect_ratio": "1:1", "resolution": "2K"},
                "metadata": {"ui": {"customTitle": "GPT Image 2"}},
            }
        ],
        edges=[],
        metadata={},
    )

    plan = selected_node_field_edit_plan_from_context(
        "Update the selected node aspect ratio to 16:9 and resolution to 4K. Do not run or save.",
        workflow,
        {"selection_available": True, "selected_node_ids": ["gpt"]},
    )
    assert plan is not None
    assert [operation.op for operation in plan.operations] == ["set_node_field"]
    assert plan.operations[0].fields == {"aspect_ratio": "16:9", "resolution": "4K"}

    planned_workflow = apply_graph_plan(workflow, plan)
    updated_node = next(node for node in planned_workflow.nodes if node.id == "gpt")
    assert updated_node.fields["aspect_ratio"] == "16:9"
    assert updated_node.fields["resolution"] == "4K"

    natural_plan = selected_node_field_edit_plan_from_context(
        "Make this widescreen 2K. Do not run or save.",
        workflow,
        {"selection_available": True, "selected_node_ids": ["gpt"]},
    )
    assert natural_plan is not None
    assert natural_plan.operations[0].fields == {"aspect_ratio": "16:9", "resolution": "2K"}

    vertical_plan = selected_node_field_edit_plan_from_context(
        "Set this to vertical 4K. Do not run or save.",
        workflow,
        {"selection_available": True, "selected_node_ids": ["gpt"]},
    )
    assert vertical_plan is not None
    assert vertical_plan.operations[0].fields == {"aspect_ratio": "9:16", "resolution": "4K"}


def test_media_assistant_selected_node_rename_uses_canvas_selection() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Selected rename",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 100, "y": 100},
                "fields": {"text": "Old prompt"},
                "metadata": {"ui": {"customTitle": "Draft Prompt"}},
            }
        ],
        edges=[],
        metadata={},
    )

    plan = selected_node_field_edit_plan_from_context(
        "Rename the selected node to Cyborg Character Prompt. Do not run or save.",
        workflow,
        {"selection_available": True, "selected_node_ids": ["prompt"]},
    )
    assert plan is not None
    assert [operation.op for operation in plan.operations] == ["set_node_title"]
    assert plan.operations[0].title == "Cyborg Character Prompt"

    planned_workflow = apply_graph_plan(workflow, plan)
    updated_node = next(node for node in planned_workflow.nodes if node.id == "prompt")
    assert updated_node.metadata["ui"]["customTitle"] == "Cyborg Character Prompt"


def test_media_assistant_transcript_quality_flags_plan_machinery() -> None:
    result = audit_assistant_transcript(
        [
            {
                "assistant_message_id": "assistant-1",
                "role": "assistant",
                "content_text": "Workflow ready for review. Operation count: 7. template_id=storyboard",
            }
        ]
    )
    clean = audit_assistant_transcript(
        [
            {
                "assistant_message_id": "assistant-2",
                "role": "assistant",
                "content_text": "I made Storyboard 4 with GPT Image 2.\nReview the prompt, adjust the beat, then run it when ready.",
            }
        ]
    )

    assert result["passed"] is False
    assert {issue["code"] for issue in result["issues"]} == {"assistant_machinery_phrase"}
    assert clean["passed"] is True


def test_media_assistant_transcript_quality_flags_inline_list_collapse() -> None:
    result = audit_assistant_transcript(
        [
            {
                "assistant_message_id": "assistant-inline-list",
                "role": "assistant",
                "content_text": "Storyboard nodes: - `Character Sheet Ref` - `Storyboard 1 GPT`",
            }
        ]
    )
    clean = audit_assistant_transcript(
        [
            {
                "assistant_message_id": "assistant-readable-list",
                "role": "assistant",
                "content_text": "Storyboard nodes:\n- Character Sheet Ref\n- Storyboard 1 GPT",
            }
        ]
    )

    assert result["passed"] is False
    assert {issue["code"] for issue in result["issues"]} == {"assistant_inline_list_collapse"}
    assert clean["passed"] is True


def test_media_assistant_routes_rough_mixed_creative_intent() -> None:
    route = route_assistant_intent(
        "Create me a work graph with the image attached as reference. I need a character generator prompt recipe and an image output.",
        [{"kind": "image", "reference_id": "reference-1"}],
    )

    assert route.skill.skill_id == "create_workflow"
    assert route.mixed_intent is True
    assert route.media_intent is True
    assert route.needs_clarification is True
    assert any("Prompt Recipe" in question for question in route.questions)


def test_media_assistant_routes_storyboard_generator_to_recipe_questions() -> None:
    route = route_assistant_intent("Make a storyboard generator from this Reddit image.", [])

    assert route.skill.skill_id == "create_prompt_recipe"
    assert route.media_intent is True
    assert any("storyboard" in question.lower() for question in route.questions)


def test_media_assistant_routes_story_project_chat_before_workflow_planning() -> None:
    story_route = route_assistant_intent(
        "I want to build a short sci-fi fantasy story with Mira and Oren. Do not build a graph yet.",
        [],
    )
    character_route = route_assistant_intent("Make character sheet prompts for Mira and Oren. Keep it text only.", [])
    storyboard_route = route_assistant_intent("Create a 4-shot storyboard with duration, camera, action, motion, and continuity.", [])
    graph_route = route_assistant_intent("Now build a reviewable Seed Dance graph plan from the latest 6-shot segment, but do not run it.", [])

    assert story_route.skill.skill_id == "answer_question"
    assert story_route.needs_clarification is False
    assert character_route.skill.skill_id == "answer_question"
    assert storyboard_route.skill.skill_id == "answer_question"
    assert graph_route.skill.skill_id == "create_workflow"


def test_media_assistant_story_project_message_uses_story_chat_policy(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Story assistant route", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-story-route-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    captured_context: dict[str, object] = {}

    def fake_provider_chat(**kwargs):
        captured_context.update(kwargs["context"])
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Story bible: Mira and Oren are trapped inside an orbital cathedral during an eclipse. "
                "Next, I can turn this into character sheets while keeping it as chat."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "story-route-test",
            "usage": {},
            "assistant_prompt_route": "story_project",
            "loaded_prompt_assets": ["skills/story_project.md"],
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "I want to build a short sci-fi fantasy story with two characters: Mira, a runaway star-mage, "
                "and Oren, a haunted robot knight. Help me shape it, but do not build a graph yet."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert captured_context["assistant_prompt_route"] == "story_project"
    assert captured_context["assistant_intent"]["skill_id"] == "answer_question"
    assert assistant_message["content_json"]["mode"] == "provider_chat"
    assert assistant_message["content_json"]["assistant_prompt_route"] == "story_project"
    assert assistant_message["content_json"].get("suggested_action") is None
    assert "Story bible" in assistant_message["content_text"]


def test_media_assistant_story_project_state_is_stored_in_existing_session_fields(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Story assistant state", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-story-state-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Story bible: Mira and Oren are trapped inside an orbital cathedral during an eclipse. "
                "**Mira:** runaway star-mage. **Oren:** haunted robot knight. "
                "Visual style: sci-fi fantasy, mythic horror, eclipse-lit cathedral."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "story-state-test",
            "usage": {},
            "assistant_prompt_route": "story_project",
            "loaded_prompt_assets": ["skills/story_project.md"],
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "I want to build a short sci-fi fantasy story with two characters: Mira, a runaway star-mage, "
                "and Oren, a haunted robot knight. They are trapped inside an ancient orbital cathedral. "
                "Do not build a graph yet."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    summary_story = payload["summary_json"]["story_project"]
    snapshot_story = payload["state_snapshot_json"]["story_project"]
    assistant_story = payload["messages"][-1]["content_json"]["story_project"]
    character_names = {character["name"] for character in summary_story["characters"]}

    assert summary_story == snapshot_story == assistant_story
    assert summary_story["latest_turn_kind"] == "story_bible"
    assert {"Mira", "Oren"}.issubset(character_names)
    assert summary_story["continuity_ledger"][0]["kind"] == "story_bible"
    assert "sci-fi" in summary_story["visual_style_terms"]


def test_media_assistant_story_project_state_reaches_character_sheet_turn(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Story assistant state followup", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-story-state-followup-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    captured_contexts: list[dict[str, object]] = []

    def fake_provider_chat(**kwargs):
        captured_contexts.append(kwargs["context"])
        user_text = kwargs["user_text"]
        if "character sheet" in user_text.lower():
            return {
                "mode": "provider_chat",
                "generated_text": (
                    "Character sheet prompts: Mira keeps the unstable star-mage identity; "
                    "Oren keeps the haunted robot knight armor and cathedral continuity."
                ),
                "provider_kind": "codex_local",
                "provider_model_id": "gpt-5.4",
                "provider_response_id": "story-character-test",
                "usage": {},
                "assistant_prompt_route": "story_project",
                "loaded_prompt_assets": ["skills/story_project.md"],
            }
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Story bible: Mira and Oren are trapped inside an orbital cathedral during an eclipse. "
                "**Mira:** runaway star-mage. **Oren:** haunted robot knight."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "story-intake-test",
            "usage": {},
            "assistant_prompt_route": "story_project",
            "loaded_prompt_assets": ["skills/story_project.md"],
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    first_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "I want to build a short sci-fi fantasy story with two characters: Mira and Oren. "
                "They are trapped inside an orbital cathedral. Do not build a graph yet."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )
    assert first_response.status_code == 200, first_response.text

    second_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Make character sheet prompts for Mira and Oren. Keep it text only and do not build a graph yet.",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert second_response.status_code == 200, second_response.text
    assert "story_project" not in captured_contexts[0]
    story_context = captured_contexts[1]["story_project"]
    assert story_context["latest_turn_kind"] == "story_bible"
    assert {character["name"] for character in story_context["characters"]} == {"Mira", "Oren"}
    payload = second_response.json()
    assert payload["summary_json"]["story_project"]["latest_turn_kind"] == "character_sheet"
    assert payload["summary_json"]["story_project"]["continuity_ledger"][-1]["kind"] == "character_sheet"
    assert payload["messages"][-1]["content_json"].get("suggested_action") is None
    assert "Character sheet prompts" in payload["messages"][-1]["content_text"]


def test_media_assistant_story_project_tracks_flexible_storyboard_segments(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Story segment state", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-story-segment-state-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "4-shot storyboard for the first 15 seconds:\n"
                "Shot 1 (3.75s): Camera: wide orbital cathedral. Action: Mira touches the eclipse glass. Motion: slow push in. Prompt: Mira reaches toward a black sun window. Continuity: establish the cracked halo.\n"
                "Shot 2 (3.75s): Camera: low angle on Oren. Action: Oren's armor wakes. Motion: sparks crawl upward. Prompt: Oren lifts a haunted chrome sword. Continuity: keep blue ghost-light.\n"
                "Shot 3 (3.75s): Camera: over-shoulder. Action: Mira and Oren face the choir doors. Motion: doors breathe open. Prompt: two heroes before enormous living doors. Continuity: same cathedral aisle.\n"
                "Shot 4 (3.75s): Camera: close on the portal. Action: the portal opens under the black sun. Motion: hard flare. Prompt: eclipse portal tearing open. Continuity: handoff is the open portal."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "story-segment-test",
            "usage": {},
            "assistant_prompt_route": "story_project",
            "loaded_prompt_assets": ["skills/story_project.md"],
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Create a 4-shot storyboard for the first 15 seconds. Keep this chat text only.",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    story = response.json()["summary_json"]["story_project"]
    segment = story["story_segments"][-1]
    assert story["latest_turn_kind"] == "storyboard"
    assert story["output_preferences"]["default_shot_count"] == 4
    assert story["output_preferences"]["segment_duration_seconds"] == 15
    assert segment["requested_shot_count"] == 4
    assert segment["shot_count"] == 4
    assert segment["total_duration_seconds"] == 15
    assert len(segment["shots"]) == 4
    assert segment["shots"][0]["camera"] == "wide orbital cathedral."
    assert "open portal" in segment["handoff"]
    assert response.json()["messages"][-1]["content_json"].get("suggested_action") is None


def test_media_assistant_story_project_continuation_uses_previous_segment_state(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Story continuation state", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-story-continuation-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    captured_contexts: list[dict[str, object]] = []

    def fake_provider_chat(**kwargs):
        captured_contexts.append(kwargs["context"])
        user_text = kwargs["user_text"].lower()
        if "continue" in user_text:
            generated_text = "\n".join(
                [
                    "6-shot continuation from the open portal:",
                    "Shot 1: Camera: portal POV. Action: Mira crosses first. Motion: gravity rolls sideways. Prompt: Mira enters a violet storm hall. Continuity: starts from the open portal.",
                    "Shot 2: Camera: tracking Oren. Action: Oren shields the threshold. Motion: sword leaves comet trails. Prompt: Oren blocks shadow choirs.",
                    "Shot 3: Camera: crane down. Action: the cathedral becomes a star map. Motion: floors rotate. Prompt: floor tiles turn into constellations.",
                    "Shot 4: Camera: close-up. Action: Mira sees her lost sigil. Motion: sigil pulses. Prompt: star sigil reflected in her eyes.",
                    "Shot 5: Camera: wide duel. Action: Oren fights the choir. Motion: hard cuts. Prompt: robot knight against spectral choir.",
                    "Shot 6: Camera: final push. Action: they reach the second gate. Motion: light inhales. Prompt: second eclipse gate opening. Continuity: handoff is the second gate.",
                ]
            )
        else:
            generated_text = "\n".join(
                [
                    "4-shot storyboard:",
                    "Shot 1: Camera: wide. Action: Mira touches the eclipse glass. Prompt: Mira at the black sun window.",
                    "Shot 2: Camera: low. Action: Oren wakes. Prompt: robot knight ghost-light.",
                    "Shot 3: Camera: over-shoulder. Action: doors breathe open. Prompt: living choir doors.",
                    "Shot 4: Camera: close. Action: the portal opens under the black sun. Prompt: open eclipse portal. Continuity: handoff is the open portal.",
                ]
            )
        return {
            "mode": "provider_chat",
            "generated_text": generated_text,
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "story-continuation-test",
            "usage": {},
            "assistant_prompt_route": "story_project",
            "loaded_prompt_assets": ["skills/story_project.md"],
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    first_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "Create a 4-shot storyboard. Chat text only.", "workflow": workflow, "assistant_mode": "graph"},
    )
    assert first_response.status_code == 200, first_response.text
    second_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "Continue from the previous storyboard with 6 shots. Chat text only.", "workflow": workflow, "assistant_mode": "graph"},
    )

    assert second_response.status_code == 200, second_response.text
    assert "story_project" in captured_contexts[1]
    prior_story = captured_contexts[1]["story_project"]
    assert prior_story["story_segments"][0]["shot_count"] == 4
    story = second_response.json()["summary_json"]["story_project"]
    assert len(story["story_segments"]) == 2
    continuation = story["story_segments"][-1]
    assert continuation["shot_count"] == 6
    assert "open portal" in continuation["previous_segment_handoff"]
    assert "second gate" in continuation["handoff"]


def test_media_assistant_story_project_prompt_rewrite_stays_chat_only(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Story prompt rewrite", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-story-prompt-rewrite-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fake_provider_chat(**kwargs):
        if "rewrite" in kwargs["user_text"].lower():
            generated_text = "Prompt rewrite: Shot 3 should become a colder horror beat with Mira reflected in cracked cathedral glass."
        else:
            generated_text = (
                "Shot 1: Prompt: Mira enters the cathedral. Shot 2: Prompt: Oren wakes. "
                "Shot 3: Prompt: the choir doors open. Shot 4: Prompt: eclipse portal handoff."
            )
        return {
            "mode": "provider_chat",
            "generated_text": generated_text,
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "story-prompt-rewrite-test",
            "usage": {},
            "assistant_prompt_route": "story_project",
            "loaded_prompt_assets": ["skills/story_project.md"],
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    first_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "Create a 4-shot storyboard. Chat text only.", "workflow": workflow, "assistant_mode": "graph"},
    )
    assert first_response.status_code == 200, first_response.text
    second_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": "Try again from the story state: show me the full prompts from the latest storyboard segment and rewrite shot 3 to feel more horror. Do not build a graph.",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert second_response.status_code == 200, second_response.text
    story = second_response.json()["summary_json"]["story_project"]
    assert story["latest_turn_kind"] == "prompt_rewrite"
    assert story["story_segments"][-1]["prompt_revisions"][-1]["user_request"].startswith("Try again from the story state")
    assert second_response.json()["messages"][-1]["content_json"].get("suggested_action") is None
    assert "current workflow prompt" not in second_response.json()["messages"][-1]["content_text"]
    assert "test the current workflow" not in second_response.json()["messages"][-1]["content_text"]


def test_story_project_graph_review_does_not_append_storyboard_segment() -> None:
    existing = {
        "story_segments": [
            {
                "segment_id": "segment_1",
                "sequence_index": 1,
                "title": "Storyboard Segment 1",
                "shot_count": 6,
                "requested_shot_count": 6,
                "shots": [{"shot_number": index, "prompt": f"Shot {index} prompt"} for index in range(1, 7)],
            }
        ],
        "output_preferences": {"default_shot_count": 6, "segment_duration_seconds": 15},
    }

    story = merge_story_project_state(
        existing,
        user_text="Build the Seed Dance graph from the latest 6-scene storyboard segment, but do not run it.",
        assistant_text=(
            "Graph added. It uses one prompt node, one Seedance node, preview, and save. "
            "Shot 1 through Shot 6 stay inside the existing segment prompt."
        ),
    )

    assert story["latest_turn_kind"] == "graph_review"
    assert len(story["story_segments"]) == 1
    assert story["story_segments"][0]["shot_count"] == 6


def test_story_project_counts_bold_markdown_storyboard_shots() -> None:
    assistant_text = "\n".join(
        [
            "I made the next 6 scenes.",
            "**Shot 5 - 0:15 to 0:18** Camera: close. Action: Vale steps back. Motion: handheld. Prompt: Vale watches the dead portal. Continuity: same chamber.",
            "**Shot 6 - 0:18 to 0:21** Camera: low. Action: Caelan lowers the sword. Motion: curse light fades. Prompt: Caelan speaks with restraint. Continuity: tension softens.",
            "**Shot 7 - 0:21 to 0:24** Camera: insert. Action: sigils ignite. Motion: red light crawls. Prompt: red sigils crossing wet stone. Continuity: threat rises.",
            "**Shot 8 - 0:24 to 0:27** Camera: wide. Action: revenants rise. Motion: dust lifts. Prompt: revenants at the edge of torchlight. Continuity: common enemy appears.",
            "**Shot 9 - 0:27 to 0:31** Camera: tracking. Action: Vale and Caelan reposition. Motion: cloak and duster move together. Prompt: reluctant alliance in motion. Continuity: first teamwork.",
            "**Shot 10 - 0:31 to 0:36** Camera: medium low angle. Action: both turn to fight. Motion: weapons rise. Prompt: neon frontier and cursed relic steel side by side. Continuity: alliance begins.",
        ]
    )

    story = merge_story_project_state(
        {"output_preferences": {"default_shot_count": 6, "segment_duration_seconds": 15}},
        user_text="Make the next one 6 scenes and continue from the end of that storyboard.",
        assistant_text=assistant_text,
    )

    segment = story["story_segments"][-1]
    assert segment["shot_count"] == 6
    assert [shot["shot_number"] for shot in segment["shots"]] == [5, 6, 7, 8, 9, 10]


def _graph_node_type(node) -> str:
    return node["type"] if isinstance(node, dict) else node.type


def _graph_node_position(node) -> dict:
    return node["position"] if isinstance(node, dict) else node.position


def _graph_node_title(node) -> str:
    metadata = node.get("metadata", {}) if isinstance(node, dict) else node.metadata
    return str((metadata.get("ui") or {}).get("customTitle") or "")


def _graph_node_by_title(nodes, title: str):
    return next(node for node in nodes if _graph_node_title(node) == title)


def _assert_group_contains_rendered_node(group: dict, node) -> None:
    bounds = group["bounds"]
    position = _graph_node_position(node)
    width, height = _node_layout_size_for_bounds(_graph_node_type(node))
    assert bounds["x"] < position["x"]
    assert bounds["y"] < position["y"]
    assert bounds["x"] + bounds["width"] > position["x"] + width
    assert bounds["y"] + bounds["height"] > position["y"] + height


def _workflow_bounds_overlap(first: dict, second: dict) -> bool:
    return not (
        first["x"] + first["width"] <= second["x"]
        or second["x"] + second["width"] <= first["x"]
        or first["y"] + first["height"] <= second["y"]
        or second["y"] + second["height"] <= first["y"]
    )


def test_media_assistant_story_state_tracks_gpt_image_storyboard_boundary() -> None:
    story = merge_story_project_state(
        None,
        user_text=(
            "Create a 4-shot storyboard from the approved character sheet using GPT Image 2 image-to-image "
            "for storyboard stills. Seedance is only for videos later."
        ),
        assistant_text=(
            "Shot 1: Prompt: Mira studies the eclipse map.\n"
            "Shot 2: Prompt: Oren guards the cathedral doors.\n"
            "Shot 3: Prompt: Mira and Oren cross the black sun aisle.\n"
            "Shot 4: Prompt: the portal opens for the next board."
        ),
    )

    assert story["approved_character_sheet"]["status"] == "approved"
    assert story["output_preferences"]["graph_output_intent"] == "storyboard_stills"
    assert story["output_preferences"]["storyboard_image_model"] == "gpt-image-2-image-to-image"
    assert story["output_preferences"]["video_model_stage"] == "seedance_after_storyboard_approval"
    assert story["story_segments"][-1]["target_model"] == "gpt-image-2-image-to-image"


def test_media_assistant_story_graph_plan_uses_latest_story_segment(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Story graph plan", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-story-graph-plan-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Shot 1: Camera: wide. Prompt: Mira sees the eclipse cathedral.\n"
                "Shot 2: Camera: low. Prompt: Oren wakes under blue ghost-light.\n"
                "Shot 3: Camera: tracking. Prompt: both heroes run toward the choir doors.\n"
                "Shot 4: Camera: close. Prompt: the black sun portal opens."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "story-graph-plan-test",
            "usage": {},
            "assistant_prompt_route": "story_project",
            "loaded_prompt_assets": ["skills/story_project.md"],
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    story_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={"content_text": "Create a 4-shot storyboard for 15 seconds. Chat text only.", "workflow": workflow, "assistant_mode": "graph"},
    )
    assert story_response.status_code == 200, story_response.text
    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Now build a reviewable Seed Dance graph plan from the latest 4-shot segment, but do not run it.",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["graph_plan"]["metadata"]["template_id"] == "story_seedance_segment_v1"
    assert payload["plan"]["status"] == "validated"
    assert not any(warning["code"] == "disconnected_node" for warning in payload["validation"]["warnings"])
    node_types = {node["type"] for node in payload["workflow"]["nodes"]}
    assert {"utility.note", "prompt.text", "model.kie.seedance_2_0", "preview.video", "media.save_video"}.issubset(node_types)
    prompt_node = next(node for node in payload["workflow"]["nodes"] if node["type"] == "prompt.text")
    assert "Shot 1" in prompt_node["fields"]["text"]
    assert "Shot 4" in prompt_node["fields"]["text"]
    model_node = next(node for node in payload["workflow"]["nodes"] if node["type"] == "model.kie.seedance_2_0")
    assert model_node["fields"]["duration"] == 5
    assert not any(edge["target_port"] in {"start_frame", "end_frame", "reference_images", "reference_videos", "reference_audios"} for edge in payload["workflow"]["edges"])
    story_nodes = payload["workflow"]["nodes"]
    note_node = _graph_node_by_title(story_nodes, "Story Segment Notes")
    preview_node = _graph_node_by_title(story_nodes, "Preview Story Clip")
    save_node = _graph_node_by_title(story_nodes, "Save Story Clip")
    note_position = _graph_node_position(note_node)
    prompt_position = _graph_node_position(prompt_node)
    model_position = _graph_node_position(model_node)
    preview_position = _graph_node_position(preview_node)
    save_position = _graph_node_position(save_node)
    note_width, note_height = _node_layout_size_for_bounds("utility.note")
    prompt_width, prompt_height = _node_layout_size_for_bounds("prompt.text")
    model_width, _model_height = _node_layout_size_for_bounds("model.kie.seedance_2_0")
    preview_width, preview_height = _node_layout_size_for_bounds("preview.video")
    assert prompt_position["y"] - (note_position["y"] + note_height) >= 120
    assert model_position["x"] - (prompt_position["x"] + prompt_width) >= 120
    assert preview_position["x"] - (model_position["x"] + model_width) >= 160
    assert save_position["x"] - (model_position["x"] + model_width) >= 160
    assert save_position["y"] - (preview_position["y"] + preview_height) >= 120
    assert note_width > 0
    group = payload["workflow"]["metadata"]["groups"][0]
    assert set(group["node_ids"]) == {node["id"] for node in story_nodes}
    for node in story_nodes:
        _assert_group_contains_rendered_node(group, node)


def test_media_assistant_story_graph_plan_builds_gpt_image_storyboard_stills(monkeypatch) -> None:
    from app.assistant.routes import _allows_pending_user_input_apply

    monkeypatch.setattr(story_graph_module, "_storyboard_v2_recipe_id", lambda: "prompt-recipe-storyboard-v2-gpt-image-2")
    workflow = GraphWorkflow(schema_version=1, name="Storyboard stills graph", nodes=[], edges=[], metadata={})
    story_project = {
        "characters": [{"name": "Mira"}, {"name": "Oren"}],
        "visual_style_terms": ["gothic sci-fi", "eclipse cathedral"],
        "approved_character_sheet": {"status": "approved", "label": "Approved Character Sheet"},
        "output_preferences": {
            "graph_output_intent": "storyboard_stills",
            "storyboard_image_model": "gpt-image-2-image-to-image",
            "video_model_stage": "seedance_after_storyboard_approval",
        },
        "story_segments": [
            {
                "segment_id": "segment_1",
                "shot_count": 4,
                "shots": [
                    {"shot_number": 1, "prompt": "Mira studies the eclipse map.", "camera": "wide"},
                    {"shot_number": 2, "prompt": "Oren guards the cathedral doors.", "camera": "low"},
                    {"shot_number": 3, "prompt": "Mira and Oren cross the black sun aisle.", "camera": "tracking"},
                    {"shot_number": 4, "prompt": "the portal opens for the next board.", "camera": "close"},
                ],
            }
        ],
    }

    plan = story_graph_module.story_graph_plan_from_state(
        message="Create that storyboard graph from the approved character sheet. Do not run or save.",
        story_project=story_project,
        workflow=workflow,
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan is not None
    assert plan.metadata["template_id"] == "story_gpt_image_2_storyboard_stills_v1"
    assert plan.metadata["uses_seedance"] is False
    node_types = {node.type for node in planned_workflow.nodes}
    assert {"utility.note", "media.load_image", "prompt.recipe", "model.kie.gpt_image_2_image_to_image", "preview.image", "media.save_image"}.issubset(node_types)
    assert "model.kie.seedance_2_0" not in node_types
    prompt_node = next(node for node in planned_workflow.nodes if node.type == "prompt.recipe")
    assert prompt_node.fields["recipe_id"] == "prompt-recipe-storyboard-v2-gpt-image-2"
    assert prompt_node.fields["shot_count"] == "4"
    assert "Panel 1" in prompt_node.fields["user_prompt"]
    assert "Mira studies the eclipse map" in prompt_node.fields["user_prompt"]
    model_node = next(node for node in planned_workflow.nodes if node.type == "model.kie.gpt_image_2_image_to_image")
    assert any(edge.target == model_node.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    assert any(edge.target == prompt_node.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    validation = validate_workflow(planned_workflow)
    assert validation.valid is False
    assert [error.code for error in validation.errors] == ["missing_media_reference"]
    assert _allows_pending_user_input_apply(validation, plan) is True
    load_node = _graph_node_by_title(planned_workflow.nodes, "Character Sheet Ref")
    preview_node = _graph_node_by_title(planned_workflow.nodes, "Storyboard 1 Preview")
    save_node = _graph_node_by_title(planned_workflow.nodes, "Storyboard 1 Save")
    load_width, load_height = _node_layout_size_for_bounds("media.load_image")
    prompt_width, _prompt_height = _node_layout_size_for_bounds("prompt.recipe")
    model_width, _model_height = _node_layout_size_for_bounds("model.kie.gpt_image_2_image_to_image")
    preview_width, preview_height = _node_layout_size_for_bounds("preview.image")
    assert _graph_node_position(prompt_node)["y"] - (_graph_node_position(load_node)["y"] + load_height) >= 120
    assert _graph_node_position(model_node)["x"] - (_graph_node_position(prompt_node)["x"] + prompt_width) >= 120
    assert _graph_node_position(preview_node)["x"] - (_graph_node_position(model_node)["x"] + model_width) >= 160
    assert _graph_node_position(save_node)["x"] - (_graph_node_position(model_node)["x"] + model_width) >= 160
    assert _graph_node_position(save_node)["y"] - (_graph_node_position(preview_node)["y"] + preview_height) >= 120
    assert load_width > 0 and preview_width > 0
    group = planned_workflow.metadata["groups"][0]
    assert load_node.id not in set(group["node_ids"])
    assert set(group["node_ids"]) == {node.id for node in planned_workflow.nodes if node.id != load_node.id}
    for node in planned_workflow.nodes:
        if node.id == load_node.id:
            continue
        _assert_group_contains_rendered_node(group, node)


def test_media_assistant_storyboard_graph_review_request_creates_first_segment() -> None:
    message = (
        "Create a new Sadi workflow. Use GPT Image 2 image-to-image and the correct Storyboard v2 3x2 storyboard recipe. "
        "Story: Sadi is thrown through a portal into a cursed castle dungeon, breaks free from her captor, reaches the battlements, "
        "and sees a storm portal opening above her airship."
    )

    story = merge_story_project_state(None, user_text=message, assistant_text="I can set that graph up.")

    assert story["latest_turn_kind"] == "graph_review"
    assert story["output_preferences"]["graph_output_intent"] == "storyboard_stills"
    assert story["story_segments"]
    assert story["story_segments"][-1]["goal"].startswith("Sadi is thrown through a portal")
    assert "Create a new Sadi workflow" not in story["story_segments"][-1]["goal"]


def test_storyboard_v2_recipe_id_prefers_hardened_gpt_image_recipe(monkeypatch) -> None:
    recipes = {
        "storyboard-v2-gpt-image-2": {"recipe_id": "prompt-recipe-storyboard-v2-gpt-image-2", "status": "active"},
        "storyboard_v2": {"recipe_id": "recipe_5746f1b11753", "status": "active"},
        "cinematic_3x2_storyboard_v2": {"recipe_id": "recipe_ac3d54d1e564", "status": "active"},
    }

    monkeypatch.setattr(story_graph_module.store, "get_prompt_recipe_by_key", lambda key: recipes.get(key))

    assert story_graph_module._storyboard_v2_recipe_id() == "prompt-recipe-storyboard-v2-gpt-image-2"


def test_media_assistant_storyboard_graph_plan_prefers_exact_storyboard_v2_recipe(monkeypatch) -> None:
    monkeypatch.setattr(story_graph_module, "_storyboard_v2_recipe_id", lambda: "recipe_exact_storyboard_v2")
    message = (
        "Create a new Sadi workflow. Use GPT Image 2 image-to-image and the correct Storyboard v2 3x2 storyboard recipe. "
        "Story: Sadi is thrown through a portal into a cursed castle dungeon, breaks free from her captor, reaches the battlements, "
        "and sees a storm portal opening above her airship."
    )
    workflow = GraphWorkflow(schema_version=1, name="Exact storyboard v2 graph", nodes=[], edges=[], metadata={})
    story_project = merge_story_project_state(None, user_text=message, assistant_text="I can set that graph up.")

    plan = story_graph_module.story_graph_plan_from_state(message=message, story_project=story_project, workflow=workflow)
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan is not None
    recipe_node = next(node for node in planned_workflow.nodes if node.type == "prompt.recipe")
    assert recipe_node.fields["recipe_id"] == "recipe_exact_storyboard_v2"
    assert "Story / scene brief:" in recipe_node.fields["user_prompt"]
    assert "storm portal opening above her airship" in recipe_node.fields["user_prompt"]
    assert "Create a new Sadi workflow" not in recipe_node.fields["user_prompt"]
    assert "Use GPT Image 2 image-to-image" not in recipe_node.fields["user_prompt"]


def test_media_assistant_character_sheet_to_storyboard_plan_builds_both_stages(monkeypatch) -> None:
    monkeypatch.setattr(story_graph_module, "_character_sheet_v1_recipe_id", lambda: "recipe_character_sheet_v1")
    monkeypatch.setattr(story_graph_module, "_storyboard_v2_recipe_id", lambda: "recipe_exact_storyboard_v2")
    message = (
        "Create a new Sadi workflow. Build a Character Sheet first from face/body refs, then use the correct Storyboard v2 recipe. "
        "Character brief: futuristic warrior wizard in portal-fantasy escape gear. "
        "Story brief: Sadi is dropped through a portal into a castle dungeon, breaks free from her captor, escapes across the battlements, "
        "and sees a storm portal opening above her airship. Use GPT Image 2 image-to-image. No Seedance. Do not run or save."
    )
    workflow = GraphWorkflow(schema_version=1, name="Character sheet to storyboard", nodes=[], edges=[], metadata={})
    story_project = merge_story_project_state(None, user_text=message, assistant_text="I can build that workflow.")

    plan = story_graph_module.story_graph_plan_from_state(message=message, story_project=story_project, workflow=workflow)
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan is not None
    assert plan.metadata["subtemplate_id"] == "story_character_sheet_to_storyboard_v1"
    assert plan.metadata["uses_seedance"] is False
    assert plan.metadata["character_sheet_recipe_id"] == "recipe_character_sheet_v1"
    assert plan.metadata["storyboard_v2_recipe_id"] == "recipe_exact_storyboard_v2"
    node_types = [node.type for node in planned_workflow.nodes]
    assert node_types.count("media.load_image") == 2
    assert node_types.count("prompt.recipe") == 2
    assert node_types.count("model.kie.gpt_image_2_image_to_image") == 2
    assert "model.kie.seedance_2_0" not in set(node_types)

    face_ref = _graph_node_by_title(planned_workflow.nodes, "Sadi Face / Identity Ref")
    body_ref = _graph_node_by_title(planned_workflow.nodes, "Sadi Body / Shape Ref")
    character_recipe = _graph_node_by_title(planned_workflow.nodes, "Character Sheet v1 Recipe")
    character_model = _graph_node_by_title(planned_workflow.nodes, "Sadi Character Sheet GPT Image 2")
    storyboard_recipe = _graph_node_by_title(planned_workflow.nodes, "Storyboard 1 v2 Recipe")
    storyboard_model = _graph_node_by_title(planned_workflow.nodes, "Storyboard 1 GPT Image 2")

    assert character_recipe.fields["recipe_id"] == "recipe_character_sheet_v1"
    assert character_recipe.fields["character_name"] == "Sadi"
    assert "Character name: Sadi" in character_recipe.fields["user_prompt"]
    assert "futuristic warrior wizard" in character_recipe.fields["user_prompt"]
    assert "reference_role_block" in character_recipe.fields["external_variables_json"]
    assert "FACE / IDENTITY LOCK" in character_recipe.fields["external_variables_json"]["reference_role_block"]
    assert "BODY / SHAPE LOCK" in character_recipe.fields["external_variables_json"]["reference_role_block"]
    assert storyboard_recipe.fields["recipe_id"] == "recipe_exact_storyboard_v2"
    assert storyboard_recipe.fields["dialogue_mode"] == "light"
    assert "storm portal opening above her airship" in storyboard_recipe.fields["user_prompt"]
    assert "Character Sheet visual continuity" in storyboard_recipe.fields["user_prompt"]
    assert "futuristic warrior wizard" in storyboard_recipe.fields["user_prompt"]
    assert "Sadi" not in storyboard_recipe.fields["user_prompt"]
    assert "Build a Character Sheet first" not in storyboard_recipe.fields["user_prompt"]
    assert "Use GPT Image 2 image-to-image" not in storyboard_recipe.fields["user_prompt"]

    character_recipe_sources = [
        edge.source
        for edge in planned_workflow.edges
        if edge.target == character_recipe.id and edge.target_port == "image_refs"
    ]
    character_model_sources = [
        edge.source
        for edge in planned_workflow.edges
        if edge.target == character_model.id and edge.target_port == "image_refs"
    ]
    storyboard_recipe_sources = [
        edge.source
        for edge in planned_workflow.edges
        if edge.target == storyboard_recipe.id and edge.target_port == "image_refs"
    ]
    storyboard_model_sources = [
        edge.source
        for edge in planned_workflow.edges
        if edge.target == storyboard_model.id and edge.target_port == "image_refs"
    ]
    assert character_recipe_sources == [face_ref.id, body_ref.id]
    assert character_model_sources == [face_ref.id, body_ref.id]
    assert storyboard_recipe_sources == [face_ref.id, character_model.id]
    assert storyboard_model_sources == [face_ref.id, character_model.id]

    groups = {group["title"]: group for group in planned_workflow.metadata["groups"]}
    assert "Sadi Character Sheet Source" in groups
    assert "Storyboard 1" in groups
    assert not _workflow_bounds_overlap(groups["Sadi Character Sheet Source"]["bounds"], groups["Storyboard 1"]["bounds"])


def test_media_assistant_character_sheet_to_storyboard_binds_attached_face_body_refs(monkeypatch) -> None:
    monkeypatch.setattr(story_graph_module, "_character_sheet_v1_recipe_id", lambda: "recipe_character_sheet_v1")
    monkeypatch.setattr(story_graph_module, "_storyboard_v2_recipe_id", lambda: "recipe_exact_storyboard_v2")
    message = (
        "Create this graph now in the current new workflow, but do not run yet. "
        "Use the two attached reference images as actual runtime image inputs, not just style refs. "
        "Use sadi-face_chest.jpg as FACE / IDENTITY LOCK / image reference 1. "
        "Use sadi-front.jpg as BODY / SHAPE LOCK / image reference 2. "
        "Build a Character Sheet v1 branch first with GPT Image 2 image-to-image. "
        "Character user prompt: fairy warrior princess, green glowing amulet, elegant fantasy armor, "
        "bunch of knives on her belt, strong heroic stance, production-reference readable, adult, "
        "cinematic dark character sheet style. "
        "Then build a Storyboard v2 branch that uses the generated character sheet output as its visual continuity reference. "
        "Storyboard story brief: she has been captured in a dungeon by an evil wizard, watched by ogre guards. "
        "She tries to break free, uses the green glowing amulet to melt off her chains, breaks out of the cell, "
        "kills two guards, and runs down the hallway. Include sparse dialogue where it makes sense. "
        "Use GPT Image 2 image-to-image only. No Seedance and no video nodes."
    )
    workflow = GraphWorkflow(schema_version=1, name="Golden character storyboard", nodes=[], edges=[], metadata={})
    story_project = merge_story_project_state(None, user_text=message, assistant_text="I can build that workflow.")
    attachments = [
        {"reference_id": "ref_body", "kind": "image", "label": "sadi-front.jpg"},
        {"reference_id": "ref_face", "kind": "image", "label": "sadi-face_chest.jpg"},
    ]

    plan = story_graph_module.story_graph_plan_from_state(
        message=message,
        story_project=story_project,
        workflow=workflow,
        attachments=attachments,
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan is not None
    assert plan.warnings == []
    assert plan.metadata["bound_reference_ids"] == {
        "face_identity": "ref_face",
        "body_shape": "ref_body",
    }
    face_ref = _graph_node_by_title(planned_workflow.nodes, "Sadi Face / Identity Ref")
    body_ref = _graph_node_by_title(planned_workflow.nodes, "Sadi Body / Shape Ref")
    character_recipe = _graph_node_by_title(planned_workflow.nodes, "Character Sheet v1 Recipe")
    storyboard_recipe = _graph_node_by_title(planned_workflow.nodes, "Storyboard 1 v2 Recipe")

    assert face_ref.fields["reference_id"] == "ref_face"
    assert body_ref.fields["reference_id"] == "ref_body"
    assert character_recipe.fields["character_name"] == "Sadi"
    assert "Character name: Sadi" in character_recipe.fields["user_prompt"]
    assert "fairy warrior princess" in character_recipe.fields["user_prompt"]
    assert "green glowing amulet" in character_recipe.fields["user_prompt"]
    assert "Then build" not in character_recipe.fields["user_prompt"]
    assert "meltdown" not in storyboard_recipe.fields["user_prompt"].lower()
    assert "melt off her chains" in storyboard_recipe.fields["user_prompt"]
    assert "kills two guards" in storyboard_recipe.fields["user_prompt"]
    assert "runs down the hallway" in storyboard_recipe.fields["user_prompt"]
    assert "Character Sheet visual continuity" in storyboard_recipe.fields["user_prompt"]
    assert "fairy warrior princess" in storyboard_recipe.fields["user_prompt"]
    assert "Mandatory story beats, do not omit" in storyboard_recipe.fields["user_prompt"]
    assert "Include at least one short in-character DIALOG value" in storyboard_recipe.fields["user_prompt"]
    assert storyboard_recipe.fields["dialogue_mode"] == "light"
    assert storyboard_recipe.fields["previous_output"] == "No previous board handoff provided."
    assert "Characters: Sheet" not in storyboard_recipe.fields["user_prompt"]


def test_media_assistant_storyboard_stills_plan_builds_three_sections_from_one_character_reference(monkeypatch) -> None:
    monkeypatch.setattr(story_graph_module, "_storyboard_v2_recipe_id", lambda: "prompt-recipe-storyboard-v2-gpt-image-2")
    monkeypatch.setattr(story_graph_module, "_storyboard_continuation_recipe_id", lambda: "prompt-recipe-storyboard-continuation-v1")
    reference_id = "ref-sadie-character-sheet"
    workflow = GraphWorkflow(schema_version=1, name="Three storyboard stills graph", nodes=[], edges=[], metadata={})
    story_project = {
        "characters": [{"name": "Sadie"}],
        "visual_style_terms": ["portal fantasy", "castle dungeon", "cinematic"],
        "approved_character_sheet": {"status": "approved", "label": "Sadie Character Sheet", "reference_id": reference_id},
        "output_preferences": {
            "graph_output_intent": "storyboard_stills",
            "storyboard_image_model": "gpt-image-2-image-to-image",
            "video_model_stage": "seedance_after_storyboard_approval",
        },
        "story_segments": [
            {
                "segment_id": "segment_portal_escape",
                "shot_count": 6,
                "shots": [
                    {"shot_number": 1, "prompt": "Sadie falls through a violet portal into a ruined fantasy realm."},
                    {"shot_number": 2, "prompt": "Sadie wakes inside a torchlit castle dungeon."},
                    {"shot_number": 3, "prompt": "The captor enters with a ring of keys."},
                    {"shot_number": 4, "prompt": "Sadie breaks the lock and starts the escape."},
                    {"shot_number": 5, "prompt": "Sadie races across the castle battlements."},
                    {"shot_number": 6, "prompt": "Sadie escapes into the moonlit forest beyond the castle."},
                ],
            }
        ],
    }

    plan = story_graph_module.story_graph_plan_from_state(
        message=(
            "Create exactly three connected GPT Image 2 image-to-image storyboard sections from the approved character sheet. "
            "No Seedance. No video nodes. Add the graph now."
        ),
        story_project=story_project,
        workflow=workflow,
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan is not None
    assert plan.metadata["storyboard_numbers"] == [1, 2, 3]
    assert plan.metadata["uses_seedance"] is False
    load_nodes = [node for node in planned_workflow.nodes if node.type == "media.load_image"]
    assert len(load_nodes) == 1
    assert _graph_node_title(load_nodes[0]) == "Character Sheet Ref"
    assert load_nodes[0].fields["reference_id"] == reference_id
    model_nodes = [node for node in planned_workflow.nodes if node.type == "model.kie.gpt_image_2_image_to_image"]
    assert len(model_nodes) == 3
    for model_node in model_nodes:
        assert model_node.fields["aspect_ratio"] == "16:9"
        assert model_node.fields["resolution"] == "2K"
    recipe_nodes = [node for node in planned_workflow.nodes if node.type == "prompt.recipe"]
    assert len(recipe_nodes) == 3
    recipe_nodes_by_title = sorted(recipe_nodes, key=_graph_node_title)
    assert [_graph_node_title(node) for node in recipe_nodes_by_title] == [
        "Storyboard 1 Recipe",
        "Storyboard 2 Continuation",
        "Storyboard 3 Continuation",
    ]
    assert recipe_nodes_by_title[0].fields["recipe_id"] == "prompt-recipe-storyboard-v2-gpt-image-2"
    assert recipe_nodes_by_title[1].fields["recipe_id"] == "prompt-recipe-storyboard-continuation-v1"
    assert recipe_nodes_by_title[2].fields["recipe_id"] == "prompt-recipe-storyboard-continuation-v1"
    assert recipe_nodes_by_title[0].fields["dialogue_mode"] == "light"
    assert recipe_nodes_by_title[1].fields["dialogue_mode"] == "light"
    assert recipe_nodes_by_title[2].fields["dialogue_mode"] == "light"
    assert "Multi-board story planning" in recipe_nodes_by_title[0].fields["user_prompt"]
    assert "segment 1 of 3" in recipe_nodes_by_title[0].fields["user_prompt"]
    assert "Opening-board pacing: establish the place, threat, confinement, and first attempted solution" in recipe_nodes_by_title[0].fields["user_prompt"]
    assert "Storyboard 2 shows" not in recipe_nodes_by_title[0].fields["user_prompt"]
    assert "Storyboard 3 pays" not in recipe_nodes_by_title[0].fields["user_prompt"]
    assert "segment 2 of 3" in recipe_nodes_by_title[1].fields["continuation_brief"]
    assert "Middle-board pacing: show the causal bridge between setup and payoff" in recipe_nodes_by_title[1].fields["continuation_brief"]
    assert "segment 3 of 3" in recipe_nodes_by_title[2].fields["continuation_brief"]
    assert "Final-board pacing: pay off the prior boards by showing the earned route to escape or resolution" in recipe_nodes_by_title[2].fields["continuation_brief"]
    assert "not appear as a sudden teleport" in recipe_nodes_by_title[2].fields["continuation_brief"]
    assert recipe_nodes_by_title[1].fields["previous_storyboard_prompt"].startswith("Continue from Storyboard 1")
    assert recipe_nodes_by_title[2].fields["previous_storyboard_prompt"].startswith("Continue from Storyboard 2")
    assert "continuity_notes" not in recipe_nodes_by_title[1].fields
    assert "handoff_goal" not in recipe_nodes_by_title[1].fields
    assert "continuity_notes" not in recipe_nodes_by_title[2].fields
    assert "handoff_goal" not in recipe_nodes_by_title[2].fields
    assert "model.kie.seedance_2_0" not in {node.type for node in planned_workflow.nodes}
    for model_node in model_nodes:
        assert any(edge.source == load_nodes[0].id and edge.target == model_node.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    for recipe_node in recipe_nodes:
        assert any(edge.source == load_nodes[0].id and edge.target == recipe_node.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    storyboard_1_model = _graph_node_by_title(planned_workflow.nodes, "Storyboard 1 GPT Image 2")
    storyboard_2_model = _graph_node_by_title(planned_workflow.nodes, "Storyboard 2 GPT Image 2")
    storyboard_1_recipe = _graph_node_by_title(planned_workflow.nodes, "Storyboard 1 Recipe")
    storyboard_2_recipe = _graph_node_by_title(planned_workflow.nodes, "Storyboard 2 Continuation")
    storyboard_3_recipe = _graph_node_by_title(planned_workflow.nodes, "Storyboard 3 Continuation")
    assert any(edge.source == storyboard_1_model.id and edge.target == storyboard_2_recipe.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    assert any(edge.source == storyboard_1_model.id and edge.target == storyboard_2_model.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    assert any(edge.source == storyboard_1_recipe.id and edge.source_port == "text" and edge.target == storyboard_2_recipe.id and edge.target_port == "previous_storyboard_prompt" for edge in planned_workflow.edges)
    assert any(edge.source == storyboard_2_model.id and edge.target == storyboard_3_recipe.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    assert any(edge.source == storyboard_2_recipe.id and edge.source_port == "text" and edge.target == storyboard_3_recipe.id and edge.target_port == "previous_storyboard_prompt" for edge in planned_workflow.edges)
    groups = [group for group in planned_workflow.metadata["groups"] if str(group.get("title") or "").startswith("Storyboard ")]
    assert [group["title"] for group in groups] == ["Storyboard 1", "Storyboard 2", "Storyboard 3"]
    for first_group, second_group in zip(groups, groups[1:]):
        assert second_group["bounds"]["y"] - first_group["bounds"]["y"] >= 4200
    for first_index, first_group in enumerate(groups):
        for second_group in groups[first_index + 1 :]:
            assert not _workflow_bounds_overlap(first_group["bounds"], second_group["bounds"])
        for node in planned_workflow.nodes:
            if node.id in set(first_group["node_ids"]):
                _assert_group_contains_rendered_node(first_group, node)


def test_media_assistant_preset_save_request_ignores_storyboard_graph_save_image_language() -> None:
    from app.assistant.routes import _preset_save_request

    assert not _preset_save_request(
        "GRAPH mode, not Media Presets. Create exactly three GPT Image 2 image-to-image storyboard sections now, "
        "with Preview Image and Save Image nodes. Do not run, save, submit, upload, delete, import, or export."
    )
    assert _preset_save_request(
        "Create the actual Media Preset now from the approved sandbox result with one required character image input."
    )


def test_media_assistant_storyboard_plan_route_uses_attached_character_reference(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules, name="sadie-attached-character-reference.png")
    workflow = {"schema_version": 1, "name": "Attached character storyboard graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-storyboard-attached-character", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(
        f"/media/assistant/sessions/{session_id}/attachments",
        json={"reference_id": reference_id, "label": "Character Reference.png"},
    )

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Shot 1: Prompt: Sadie falls through a violet portal into a ruined fantasy realm.\n"
                "Shot 2: Prompt: Sadie wakes inside a torchlit castle dungeon.\n"
                "Shot 3: Prompt: The captor enters with a ring of keys.\n"
                "Shot 4: Prompt: Sadie breaks the lock and starts the escape.\n"
                "Shot 5: Prompt: Sadie races across the castle battlements.\n"
                "Shot 6: Prompt: Sadie escapes into the moonlit forest beyond the castle."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "storyboard-attached-character-seed",
            "usage": {},
            "assistant_prompt_route": "story_project",
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    seed_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Use the attached character reference as the approved character sheet. "
                "Plan a six-shot storyboard where Sadie falls through a portal, gets trapped in a castle dungeon, "
                "breaks free, and escapes. Use GPT Image 2 image-to-image for storyboard stills. Chat text only."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )
    assert seed_response.status_code == 200, seed_response.text

    plan_response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Create exactly three connected GPT Image 2 image-to-image storyboard sections from the approved character sheet. "
                "No Seedance. No video nodes. Add the graph now."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert plan_response.status_code == 200, plan_response.text
    payload = plan_response.json()
    assert payload["graph_plan"]["metadata"]["storyboard_numbers"] == [1, 2, 3]
    nodes = payload["workflow"]["nodes"]
    load_nodes = [node for node in nodes if node["type"] == "media.load_image"]
    assert len(load_nodes) == 1
    assert load_nodes[0]["fields"]["reference_id"] == reference_id
    assert (load_nodes[0]["metadata"].get("ui") or {}).get("customTitle") == "Character Sheet Ref"
    assert len([node for node in nodes if node["type"] == "model.kie.gpt_image_2_image_to_image"]) == 3
    for model_node in [node for node in nodes if node["type"] == "model.kie.gpt_image_2_image_to_image"]:
        assert model_node["fields"]["aspect_ratio"] == "16:9"
        assert model_node["fields"]["resolution"] == "2K"
    assert "model.kie.seedance_2_0" not in {node["type"] for node in nodes}


def test_media_assistant_direct_storyboard_graph_request_skips_generic_graph_mode_plan(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Direct storyboard graph request", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-direct-storyboard-request", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fake_provider_chat(**kwargs):
        return {
            "mode": "provider_chat",
            "generated_text": (
                "Shot 1: Prompt: Sadie falls through a violet portal into a ruined fantasy realm.\n"
                "Shot 2: Prompt: Sadie wakes inside a torchlit castle dungeon.\n"
                "Shot 3: Prompt: The captor enters with a ring of keys.\n"
                "Shot 4: Prompt: Sadie breaks the lock and starts the escape.\n"
                "Shot 5: Prompt: Sadie crosses the castle battlements.\n"
                "Shot 6: Prompt: Sadie escapes into the moonlit forest beyond the castle."
            ),
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "direct-storyboard-request",
            "usage": {},
            "assistant_prompt_route": "story_project",
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create exactly three connected GPT Image 2 image-to-image storyboard sections for Sadie. "
                "Use one shared Character Sheet Ref loader. No Seedance. No video nodes. Add the graph now."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["assistant_prompt_route"] == "story_project"
    assert assistant_message["content_json"]["mode"] == "provider_chat"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert assistant_message["content_json"]["assistant_response_kind"] == "create_local"


def test_media_assistant_storyboard_graph_request_can_name_existing_recipe() -> None:
    message = (
        "Create exactly two connected GPT Image 2 image-to-image storyboard sections. "
        "Use the reusable Storyboard v2 recipe for the storyboard prompts. Add the graph now."
    )

    assert is_story_project_request(message) is True


def test_media_assistant_storyboard_graph_request_routes_without_add_graph_phrase() -> None:
    message = (
        "Create exactly two connected GPT Image 2 image-to-image storyboard sections for a portal fantasy escape. "
        "Use one shared Character Sheet Ref loader. Use the reusable Storyboard v2 recipe for the storyboard prompts. "
        "No Seedance. No video nodes."
    )

    assert is_story_project_request(message) is True


def test_media_assistant_story_brief_prefers_explicit_story_arc_over_short_for_story_phrase() -> None:
    message = (
        "Create exactly three connected GPT Image 2 image-to-image storyboard sections for this Westworld-like gunslinger escape story. "
        "Story arc: she wakes restrained in a mechanical saloon hideout, studies the captors and exits, notices a brass portal key, "
        "escapes her restraints, grabs weapons and the key, fights through the captors in a fierce gun battle, activates the portal, "
        "and escapes into the next adventure. No Seedance. No video nodes."
    )

    brief = _story_brief_from_user_request(message)

    assert "mechanical saloon hideout" in brief
    assert "brass portal key" in brief
    assert "fierce gun battle" in brief
    assert brief != "this Westworld-like gunslinger escape story"


def test_media_assistant_storyboard_section_briefs_accept_natural_should_phrasing() -> None:
    message = (
        "Storyboard 1 should establish captivity, captors, saloon hideout, and the portal-key clue without escaping. "
        "Storyboard 2 shows the causal escape, grabbing weapons, and the first gunfight. "
        "Storyboard 3 pays off the final gun battle and portal escape. No Seedance. No video nodes."
    )

    briefs = story_graph_module._storyboard_message_section_briefs(message, 3)

    assert briefs[0] == "establish captivity, captors, saloon hideout, and the portal-key clue without escaping"
    assert briefs[1] == "shows the causal escape, grabbing weapons, and the first gunfight"
    assert briefs[2] == "pays off the final gun battle and portal escape"


def test_media_assistant_storyboard_plan_route_derives_story_state_without_prior_chat(client) -> None:
    workflow = {"schema_version": 1, "name": "Storyboard v2 plan route", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-storyboard-v2-plan-route", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    message = (
        "Create exactly two connected GPT Image 2 image-to-image storyboard sections for a portal fantasy escape. "
        "Storyboard 1: she is trapped in a cursed castle dungeon by an evil wizard and ogre guards. "
        "Storyboard 2: she uses the amulet to melt the chains, breaks out of the cell, and fights through the guards. "
        "Use one shared Character Sheet Ref loader. Use the reusable Storyboard v2 recipe for the storyboard prompts. "
        "No Seedance. No video nodes. Do not run, save, submit, upload, delete, import, or export."
    )

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={"message": message, "workflow": workflow, "assistant_mode": "graph"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["graph_plan"]["metadata"]["template_id"] == "story_gpt_image_2_storyboard_stills_v1"
    assert payload["graph_plan"]["metadata"]["storyboard_numbers"] == [1, 2]
    nodes = payload["workflow"]["nodes"]
    assert len(nodes) == 11
    recipe_nodes = [node for node in nodes if node["type"] == "prompt.recipe"]
    assert len(recipe_nodes) == 2
    assert {node["fields"]["recipe_id"] for node in recipe_nodes} == {
        "prompt-recipe-storyboard-v2-gpt-image-2",
        "prompt-recipe-storyboard-continuation-v1",
    }
    recipe_by_title = {(node["metadata"].get("ui") or {}).get("customTitle"): node for node in recipe_nodes}
    first_prompt = recipe_by_title["Storyboard 1 Recipe"]["fields"]["user_prompt"]
    continuation_fields = recipe_by_title["Storyboard 2 Continuation"]["fields"]
    assert recipe_by_title["Storyboard 1 Recipe"]["fields"]["shot_count"] == "6"
    assert recipe_by_title["Storyboard 1 Recipe"]["fields"]["dialogue_mode"] == "light"
    assert continuation_fields["panel_count"] == "6"
    assert continuation_fields["dialogue_mode"] == "light"
    assert "Story / scene brief: she is trapped in a cursed castle dungeon by an evil wizard and ogre guards" in first_prompt
    assert "Required segment story beat: she is trapped in a cursed castle dungeon by an evil wizard and ogre guards" in first_prompt
    assert "portal fantasy escape" not in first_prompt
    assert "Opening-board pacing: establish the place, threat, confinement, and first attempted solution" in first_prompt
    assert "Do not resolve the main escape, final portal, destination reveal, or final payoff" in first_prompt
    assert "Required segment story beat: she uses the amulet to melt the chains, breaks out of the cell, and fights through the guards" in continuation_fields["continuation_brief"]
    assert "do not replace it with a generic fantasy journey" in continuation_fields["continuation_brief"].lower()
    assert "Final-board pacing: pay off the prior boards by showing the earned route to escape or resolution" in continuation_fields["continuation_brief"]
    assert "not appear as a sudden teleport" in continuation_fields["continuation_brief"]
    assert "Use one shared Character Sheet Ref loader" not in first_prompt
    assert "No Seedance" not in first_prompt
    assert "Do not run" not in continuation_fields["continuation_brief"]
    assert len([node for node in nodes if node["type"] == "media.load_image"]) == 1
    assert "model.kie.seedance_2_0" not in {node["type"] for node in nodes}
    assert not [node for node in nodes if "video" in node["type"]]


def test_media_assistant_storyboard_stills_plan_uses_canvas_character_sheet_anchor() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Current storyboard canvas",
        nodes=[
            {
                "id": "character-sheet-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": "ref-character-sheet"},
                "metadata": {"ui": {"customTitle": "Character Sheet Ref"}},
            },
            {
                "id": "storyboard-1-gpt",
                "type": "model.kie.gpt_image_2_image_to_image",
                "position": {"x": 620, "y": 0},
                "fields": {},
                "metadata": {"ui": {"customTitle": "Storyboard 1 GPT"}},
            },
        ],
        edges=[],
        metadata={
            "groups": [
                {
                    "id": "storyboard-1",
                    "title": "Storyboard 1",
                    "node_ids": ["character-sheet-ref", "storyboard-1-gpt"],
                    "bounds": {"x": -80, "y": -80, "width": 1120, "height": 620},
                },
                {
                    "id": "storyboard-2",
                    "title": "Storyboard 2",
                    "node_ids": [],
                    "bounds": {"x": -80, "y": 1300, "width": 1120, "height": 620},
                },
                {
                    "id": "storyboard-3",
                    "title": "Storyboard 3",
                    "node_ids": [],
                    "bounds": {"x": -80, "y": 2600, "width": 1120, "height": 620},
                },
            ]
        },
    )
    canvas_context = {
        "workflow_name": "Current storyboard canvas",
        "node_count": 2,
        "edge_count": 0,
        "nodes": [
            {
                "id": "character-sheet-ref",
                "type": "media.load_image",
                "title": "Character Sheet Ref",
                "position": {"x": 0, "y": 0},
                "media_refs": [{"reference_id": "ref-character-sheet", "kind": "image"}],
            },
            {"id": "storyboard-1-gpt", "type": "model.kie.gpt_image_2_image_to_image", "title": "Storyboard 1 GPT", "position": {"x": 620, "y": 0}},
        ],
        "groups": workflow.metadata["groups"],
    }
    story_project = {
        "characters": [{"name": "Sadie"}],
        "visual_style_terms": ["cinematic sci-fi"],
        "approved_character_sheet": {"status": "approved", "label": "Character Sheet Ref"},
        "output_preferences": {
            "graph_output_intent": "storyboard_stills",
            "storyboard_image_model": "gpt-image-2-image-to-image",
        },
        "story_segments": [
            {
                "segment_id": "segment_1",
                "shot_count": 6,
                "shots": [
                    {"shot_number": 1, "prompt": "Sadie inspects the ship hatch."},
                    {"shot_number": 2, "prompt": "Sadie crosses the ruined spaceport."},
                ],
            }
        ],
    }

    plan = story_graph_plan_from_state(
        message="Create two more storyboards from the current character sheet and add them to the graph.",
        story_project=story_project,
        workflow=workflow,
        canvas_context=canvas_context,
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan is not None
    assert plan.metadata["character_sheet_anchor_node_id"] == "character-sheet-ref"
    assert plan.metadata["storyboard_numbers"] == [4, 5]
    assert "model.kie.seedance_2_0" not in {operation.node_type for operation in plan.operations if operation.op == "add_node"}
    assert not any(operation.op == "add_node" and operation.node_type == "media.load_image" for operation in plan.operations)
    storyboard_4 = _graph_node_by_title(planned_workflow.nodes, "Storyboard 4 GPT Image 2")
    storyboard_5 = _graph_node_by_title(planned_workflow.nodes, "Storyboard 5 GPT Image 2")
    assert any(edge.source == "character-sheet-ref" and edge.target == storyboard_4.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    assert any(edge.source == "character-sheet-ref" and edge.target == storyboard_5.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    groups = {group["title"]: group for group in planned_workflow.metadata["groups"]}
    assert {"Storyboard 4", "Storyboard 5"}.issubset(groups)
    assert not _workflow_bounds_overlap(groups["Storyboard 4"]["bounds"], groups["Storyboard 5"]["bounds"])


def test_media_assistant_storyboard_stills_plan_uses_single_generic_loaded_image_anchor() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Current loaded image canvas",
        nodes=[
            {
                "id": "loaded-character-sheet",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"asset_id": "asset-western-sheet"},
                "metadata": {"ui": {"customTitle": "Load Image"}},
            }
        ],
        edges=[],
        metadata={},
    )
    canvas_context = {
        "workflow_name": "Current loaded image canvas",
        "node_count": 1,
        "edge_count": 0,
        "nodes": [
            {
                "id": "loaded-character-sheet",
                "type": "media.load_image",
                "title": "Load Image",
                "position": {"x": 0, "y": 0},
                "media_refs": [{"field": "asset_id", "asset_id": "asset-western-sheet", "kind": "image"}],
            }
        ],
        "groups": [],
    }
    story_project = {
        "characters": [{"name": "the gunslinger"}],
        "visual_style_terms": ["gritty sci-fi western", "Westworld-like frontier"],
        "approved_character_sheet": {"status": "approved", "label": "Loaded Character Sheet"},
        "output_preferences": {
            "graph_output_intent": "storyboard_stills",
            "storyboard_image_model": "gpt-image-2-image-to-image",
        },
        "story_segments": [
            {
                "segment_id": "segment_1",
                "shot_count": 6,
                "shots": [
                    {"shot_number": 1, "prompt": "The gunslinger wakes in a frontier cell."},
                    {"shot_number": 2, "prompt": "The captors close in."},
                    {"shot_number": 3, "prompt": "She starts the escape."},
                ],
            }
        ],
    }

    plan = story_graph_plan_from_state(
        message=(
            "Create exactly three connected GPT Image 2 image-to-image storyboard sections. "
            "Use the current loaded image as the shared Character Sheet Ref. "
            "No Seedance. No video nodes. Do not run, save, submit, upload, delete, import, or export."
        ),
        story_project=story_project,
        workflow=workflow,
        canvas_context=canvas_context,
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan is not None
    assert plan.metadata["character_sheet_anchor_node_id"] == "loaded-character-sheet"
    assert plan.metadata["storyboard_numbers"] == [1, 2, 3]
    assert plan.metadata.get("missing_character_sheet_anchor") is None
    assert plan.metadata.get("ambiguous_character_sheet_anchor") is None
    assert not any(operation.op == "add_node" and operation.node_type == "media.load_image" for operation in plan.operations)
    model_nodes = [node for node in planned_workflow.nodes if node.type == "model.kie.gpt_image_2_image_to_image"]
    assert len(model_nodes) == 3
    assert all(node.fields["aspect_ratio"] == "16:9" for node in model_nodes)
    assert all(node.fields["resolution"] == "2K" for node in model_nodes)
    assert "model.kie.seedance_2_0" not in {node.type for node in planned_workflow.nodes}
    assert not [node for node in planned_workflow.nodes if "video" in node.type]
    assert all(
        any(edge.source == "loaded-character-sheet" and edge.target == node.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
        for node in model_nodes
    )


def test_media_assistant_storyboard_continuation_action_adds_next_board_from_canvas_anchor() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Current storyboard continuation canvas",
        nodes=[
            {
                "id": "character-sheet-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": "ref-character-sheet"},
                "metadata": {"ui": {"customTitle": "Character Sheet Ref"}},
            },
            {
                "id": "storyboard-1-gpt",
                "type": "model.kie.gpt_image_2_image_to_image",
                "position": {"x": 620, "y": 0},
                "fields": {},
                "metadata": {"ui": {"customTitle": "Storyboard 1 GPT"}},
            },
            {
                "id": "storyboard-2-gpt",
                "type": "model.kie.gpt_image_2_image_to_image",
                "position": {"x": 620, "y": 1200},
                "fields": {},
                "metadata": {"ui": {"customTitle": "Storyboard 2 GPT"}},
            },
        ],
        edges=[],
        metadata={
            "groups": [
                {"id": "storyboard-1", "title": "Storyboard 1", "node_ids": ["storyboard-1-gpt"], "bounds": {"x": -80, "y": -80, "width": 1120, "height": 620}},
                {"id": "storyboard-2", "title": "Storyboard 2", "node_ids": ["storyboard-2-gpt"], "bounds": {"x": -80, "y": 1120, "width": 1120, "height": 620}},
            ]
        },
    )
    canvas_context = {
        "workflow_name": "Current storyboard continuation canvas",
        "node_count": 3,
        "edge_count": 0,
        "nodes": [
            {
                "id": "character-sheet-ref",
                "type": "media.load_image",
                "title": "Character Sheet Ref",
                "position": {"x": 0, "y": 0},
                "media_refs": [{"reference_id": "ref-character-sheet", "kind": "image"}],
            },
            {"id": "storyboard-1-gpt", "type": "model.kie.gpt_image_2_image_to_image", "title": "Storyboard 1 GPT", "position": {"x": 620, "y": 0}},
            {"id": "storyboard-2-gpt", "type": "model.kie.gpt_image_2_image_to_image", "title": "Storyboard 2 GPT", "position": {"x": 620, "y": 1200}},
        ],
        "groups": workflow.metadata["groups"],
    }
    story_project = {
        "characters": [{"name": "Sadie"}],
        "visual_style_terms": ["portal fantasy", "stormlit castle"],
        "approved_character_sheet": {"status": "approved", "label": "Character Sheet Ref"},
        "output_preferences": {
            "graph_output_intent": "storyboard_stills",
            "storyboard_image_model": "gpt-image-2-image-to-image",
        },
        "story_segments": [
            {
                "segment_id": "segment_2",
                "shot_count": 6,
                "handoff": "Storyboard 2 ends with Sadie outside the dungeon, seeing storm clouds above the battlements.",
                "shots": [{"shot_number": 1, "prompt": "Sadie escapes the dungeon corridor."}],
            }
        ],
    }

    plan = story_graph_plan_from_state(
        message="Add the next storyboard where she reaches the airship beyond the storm portal. Do not run or save.",
        story_project=story_project,
        workflow=workflow,
        canvas_context=canvas_context,
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan is not None
    assert plan.metadata["storyboard_numbers"] == [3]
    assert plan.metadata["uses_seedance"] is False
    assert not any(operation.op == "add_node" and operation.node_type == "media.load_image" for operation in plan.operations)
    recipe_node = _graph_node_by_title(planned_workflow.nodes, "Storyboard 3 Continuation")
    assert recipe_node.fields["recipe_id"] == "prompt-recipe-storyboard-continuation-v1"
    assert "Requested continuation beat: she reaches the airship beyond the storm portal" in recipe_node.fields["continuation_brief"]
    assert "Continuation planning" in recipe_node.fields["continuation_brief"]
    assert recipe_node.fields["previous_storyboard_prompt"].startswith("Storyboard 2 ends")
    model_node = _graph_node_by_title(planned_workflow.nodes, "Storyboard 3 GPT Image 2")
    assert any(edge.source == "character-sheet-ref" and edge.target == model_node.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    assert any(edge.source == "storyboard-2-gpt" and edge.target == recipe_node.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    assert any(edge.source == "storyboard-2-gpt" and edge.target == model_node.id and edge.target_port == "image_refs" for edge in planned_workflow.edges)
    assert "model.kie.seedance_2_0" not in {node.type for node in planned_workflow.nodes}


def test_media_assistant_storyboard_stills_plan_asks_when_canvas_anchor_missing() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Missing character sheet canvas",
        nodes=[
            {
                "id": "storyboard-prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "Storyboard prompt"},
                "metadata": {"ui": {"customTitle": "Storyboard Prompt"}},
            }
        ],
        edges=[],
        metadata={},
    )
    story_project = {
        "approved_character_sheet": {"status": "approved", "label": "Character Sheet Ref"},
        "output_preferences": {"graph_output_intent": "storyboard_stills", "storyboard_image_model": "gpt-image-2-image-to-image"},
        "story_segments": [{"segment_id": "segment_1", "shot_count": 2, "shots": [{"shot_number": 1, "prompt": "Sadie checks her arm."}]}],
    }

    plan = story_graph_plan_from_state(
        message="Create that storyboard graph from the approved character sheet.",
        story_project=story_project,
        workflow=workflow,
        canvas_context={
            "workflow_name": "Missing character sheet canvas",
            "node_count": 1,
            "nodes": [{"id": "storyboard-prompt", "type": "prompt.text", "title": "Storyboard Prompt", "position": {"x": 0, "y": 0}}],
        },
    )

    assert plan is not None
    assert plan.operations == []
    assert plan.metadata["missing_character_sheet_anchor"] is True
    assert "character sheet image node" in plan.summary


def test_media_assistant_storyboard_stills_plan_asks_when_canvas_anchor_ambiguous() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Ambiguous character sheet canvas",
        nodes=[
            {
                "id": "sheet-a",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": "ref-a"},
                "metadata": {"ui": {"customTitle": "Character Sheet Ref A"}},
            },
            {
                "id": "sheet-b",
                "type": "media.load_image",
                "position": {"x": 0, "y": 500},
                "fields": {"reference_id": "ref-b"},
                "metadata": {"ui": {"customTitle": "Character Sheet Ref B"}},
            },
        ],
        edges=[],
        metadata={},
    )
    story_project = {
        "approved_character_sheet": {"status": "approved", "label": "Character Sheet Ref"},
        "output_preferences": {"graph_output_intent": "storyboard_stills", "storyboard_image_model": "gpt-image-2-image-to-image"},
        "story_segments": [{"segment_id": "segment_1", "shot_count": 2, "shots": [{"shot_number": 1, "prompt": "Sadie checks her arm."}]}],
    }

    plan = story_graph_plan_from_state(
        message="Create that storyboard graph from the approved character sheet.",
        story_project=story_project,
        workflow=workflow,
        canvas_context={
            "workflow_name": "Ambiguous character sheet canvas",
            "node_count": 2,
            "nodes": [
                {"id": "sheet-a", "type": "media.load_image", "title": "Character Sheet Ref A", "position": {"x": 0, "y": 0}},
                {"id": "sheet-b", "type": "media.load_image", "title": "Character Sheet Ref B", "position": {"x": 0, "y": 500}},
            ],
        },
    )

    assert plan is not None
    assert plan.operations == []
    assert plan.metadata["ambiguous_character_sheet_anchor"] is True
    assert plan.questions == ["Which image node should anchor the next storyboard sections?"]


def test_media_assistant_storyboard_stills_plan_ignores_negated_video_terms() -> None:
    workflow = GraphWorkflow(schema_version=1, name="Storyboard stills graph", nodes=[], edges=[], metadata={})
    story_project = {
        "approved_character_sheet": {"status": "approved", "label": "Approved Character Sheet"},
        "output_preferences": {
            "graph_output_intent": "storyboard_stills",
            "storyboard_image_model": "gpt-image-2-image-to-image",
        },
        "story_segments": [
            {
                "segment_id": "segment_1",
                "shot_count": 4,
                "shots": [
                    {"shot_number": 1, "prompt": "Mira studies the eclipse map."},
                    {"shot_number": 2, "prompt": "Oren guards the cathedral doors."},
                    {"shot_number": 3, "prompt": "Mira and Oren cross the black sun aisle."},
                    {"shot_number": 4, "prompt": "the portal opens for the next board."},
                ],
            }
        ],
    }

    plan = story_graph_plan_from_state(
        message="Create and add the GPT Image 2 storyboard stills graph. Stills only, not Seedance and not video.",
        story_project=story_project,
        workflow=workflow,
    )

    assert plan is not None
    assert plan.metadata["template_id"] == "story_gpt_image_2_storyboard_stills_v1"
    assert plan.metadata["uses_seedance"] is False
    node_types = {operation.node_type for operation in plan.operations if operation.op == "add_node"}
    assert "model.kie.gpt_image_2_image_to_image" in node_types
    assert "model.kie.seedance_2_0" not in node_types


def test_media_assistant_message_marks_storyboard_stills_request_for_local_graph_plan(client, monkeypatch) -> None:
    workflow = {"schema_version": 1, "name": "Storyboard stills graph", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-story-stills-message-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    def fake_provider_chat(**kwargs):
        message = str(kwargs.get("message") or "")
        if "chat text only" in message.lower():
            return {
                "mode": "provider_chat",
                "generated_text": (
                    "Shot 1: Prompt: Mira studies the eclipse map.\n"
                    "Shot 2: Prompt: Oren guards the cathedral doors.\n"
                    "Shot 3: Prompt: Mira and Oren cross the black sun aisle.\n"
                    "Shot 4: Prompt: the portal opens for the next board."
                ),
                "provider_kind": "codex_local",
                "provider_model_id": "gpt-5.4",
                "provider_response_id": "story-stills-message-seed",
                "usage": {},
                "assistant_prompt_route": "story_project",
            }
        return {
            "mode": "provider_chat",
            "generated_text": "I can sketch the stills graph, but the local planner should place it.",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_response_id": "story-stills-message-request",
            "usage": {},
            "assistant_prompt_route": "story_project",
        }

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fake_provider_chat)
    seed_response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create a 4-shot storyboard from the approved character sheet using GPT Image 2 image-to-image "
                "for storyboard stills. Seedance is only for videos later. Chat text only."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )
    assert seed_response.status_code == 200, seed_response.text

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create and add the GPT Image 2 image-to-image storyboard stills graph from the approved character sheet. "
                "Do not run or save."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert assistant_message["content_json"]["assistant_response_kind"] == "create_local"


def test_media_assistant_storyboard_graph_offsets_away_from_existing_graph_group() -> None:
    existing_group = {
        "id": "existing-text-to-image",
        "title": "Text-to-image workflow",
        "color": "blue",
        "node_ids": ["existing-note", "existing-prompt", "existing-model", "existing-preview", "existing-save"],
        "bounds": {"x": -80, "y": -80, "width": 1720, "height": 1260},
        "execution": {"mode": "enabled"},
    }
    workflow = GraphWorkflow(
        schema_version=1,
        name="Storyboard stills after existing graph",
        nodes=[
            {"id": "existing-note", "type": "utility.note", "position": {"x": 0, "y": 0}, "fields": {"body": "Existing graph"}},
            {"id": "existing-prompt", "type": "prompt.text", "position": {"x": 0, "y": 360}, "fields": {"text": "Existing prompt"}},
            {"id": "existing-model", "type": "model.kie.gpt_image_2_text_to_image", "position": {"x": 500, "y": 360}, "fields": {}},
            {"id": "existing-preview", "type": "preview.image", "position": {"x": 980, "y": 220}, "fields": {}},
            {"id": "existing-save", "type": "media.save_image", "position": {"x": 980, "y": 740}, "fields": {}},
        ],
        edges=[],
        metadata={"groups": [existing_group]},
    )
    story_project = {
        "approved_character_sheet": {"status": "approved", "label": "Approved Character Sheet"},
        "output_preferences": {
            "graph_output_intent": "storyboard_stills",
            "storyboard_image_model": "gpt-image-2-image-to-image",
        },
        "story_segments": [
            {
                "segment_id": "segment_1",
                "shot_count": 4,
                "shots": [
                    {"shot_number": 1, "prompt": "Mira studies the eclipse map."},
                    {"shot_number": 2, "prompt": "Oren guards the cathedral doors."},
                    {"shot_number": 3, "prompt": "Mira and Oren cross the black sun aisle."},
                    {"shot_number": 4, "prompt": "the portal opens for the next board."},
                ],
            }
        ],
    }

    plan = story_graph_plan_from_state(
        message="Create that storyboard graph from the approved character sheet. Do not run or save.",
        story_project=story_project,
        workflow=workflow,
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    storyboard_group = next(group for group in planned_workflow.metadata["groups"] if group["title"] == "Storyboard 1")
    existing_right = existing_group["bounds"]["x"] + existing_group["bounds"]["width"]
    assert storyboard_group["bounds"]["x"] >= existing_right + 200
    assert not _workflow_bounds_overlap(existing_group["bounds"], storyboard_group["bounds"])
    storyboard_node_ids = set(storyboard_group["node_ids"])
    for node in planned_workflow.nodes:
        if node.id in storyboard_node_ids:
            assert node.position["x"] > existing_right
            _assert_group_contains_rendered_node(storyboard_group, node)


def test_media_assistant_graph_diff_summarizes_local_node_title_and_field_changes() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Diff summary",
        nodes=[
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 0, "y": 0},
                "fields": {"text": "Old prompt"},
                "metadata": {"ui": {"customTitle": "Old Prompt"}},
            }
        ],
        edges=[],
        metadata={},
    )
    plan = AssistantGraphPlan(
        summary="Update the prompt locally.",
        operations=[
            AssistantGraphOperation(op="set_node_title", node_id="prompt", title="Storyboard 1 Prompt"),
            AssistantGraphOperation(op="set_node_field", node_id="prompt", fields={"text": "New prompt"}),
        ],
        requires_confirmation=True,
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    diff = graph_plan_diff_summary(workflow, planned_workflow, plan)

    assert diff["operation_kinds"] == ["set_node_title", "set_node_field"]
    assert diff["nodes_changed"] == [
        {"id": "prompt", "title": "Storyboard 1 Prompt", "changed": ["title", "fields"], "field_keys": ["text"]}
    ]
    assert diff["nodes_added"] == []


def test_media_assistant_graph_layout_guard_blocks_new_group_overlap() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Overlap guard",
        nodes=[
            {"id": "existing", "type": "prompt.text", "position": {"x": 100, "y": 100}, "fields": {"text": "Existing"}},
        ],
        edges=[],
        metadata={
            "groups": [
                {
                    "id": "group-existing",
                    "title": "Existing Section",
                    "node_ids": ["existing"],
                    "bounds": {"x": 80, "y": 80, "width": 500, "height": 300},
                }
            ]
        },
    )
    planned_workflow = workflow.model_copy(deep=True)
    planned_workflow.metadata = {
        "groups": [
            *workflow.metadata["groups"],
            {
                "id": "assistant-group-overlap",
                "title": "Assistant Section",
                "node_ids": [],
                "bounds": {"x": 120, "y": 120, "width": 480, "height": 280},
            },
        ]
    }
    plan = AssistantGraphPlan(
        summary="Overlapping local edit.",
        operations=[AssistantGraphOperation(op="group_nodes", group_ref="overlap", node_refs=["missing"], title="Assistant Section")],
        requires_confirmation=True,
    )

    errors = graph_plan_layout_errors(workflow, planned_workflow, plan)

    assert [error.code for error in errors] == ["assistant_group_overlap"]
    assert "Existing Section" in errors[0].message


def test_media_assistant_story_graph_plan_respects_no_create_graph_negation() -> None:
    workflow = GraphWorkflow(schema_version=1, name="Chat-only storyboard", nodes=[], edges=[], metadata={})
    story_project = {
        "approved_character_sheet": {"status": "approved", "label": "Approved Character Sheet"},
        "output_preferences": {
            "graph_output_intent": "storyboard_stills",
            "storyboard_image_model": "gpt-image-2-image-to-image",
        },
        "story_segments": [
            {
                "segment_id": "segment_1",
                "shot_count": 4,
                "shots": [
                    {"shot_number": 1, "prompt": "Mira studies the eclipse map."},
                    {"shot_number": 2, "prompt": "Oren guards the cathedral doors."},
                ],
            }
        ],
    }

    plan = story_graph_plan_from_state(
        message="Create a 4-shot storyboard from the approved character sheet, but do not create a graph.",
        story_project=story_project,
        workflow=workflow,
    )

    assert plan is None


def test_media_assistant_plan_endpoint_returns_noop_when_graph_creation_is_negated(client) -> None:
    workflow = {"schema_version": 1, "name": "Chat-only graph guard", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-chat-only-guard-test", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Create a 4-shot storyboard from the approved character sheet using GPT Image 2 image-to-image, "
                "but do not create a graph, run, save, import, export, or submit anything."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["graph_plan"]["operations"] == []
    assert payload["graph_plan"]["metadata"]["template_id"] == "chat_only_graph_change_negated"
    assert payload["workflow"]["nodes"] == []
    assert payload["workflow"]["edges"] == []
    assert payload["workflow"]["name"] == workflow["name"]


def test_media_assistant_character_sheet_plan_reuses_current_face_body_refs(client, app_modules) -> None:
    face_reference_id = _create_reference_image(app_modules, name="character-sheet-face-lock.png")
    body_reference_id = _create_reference_image(app_modules, name="character-sheet-body-lock.png")
    existing_group = {
        "id": "existing-character-inputs",
        "title": "Existing Character Inputs",
        "color": "green",
        "node_ids": ["face-ref", "body-ref"],
        "bounds": {"x": -80, "y": -80, "width": 680, "height": 1160},
        "execution": {"mode": "enabled"},
    }
    workflow = {
        "schema_version": 1,
        "name": "Character Sheet local branch",
        "nodes": [
            {
                "id": "body-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 520},
                "fields": {"reference_id": body_reference_id},
                "metadata": {"ui": {"customTitle": "Body Shape Ref"}},
            },
            {
                "id": "face-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": face_reference_id},
                "metadata": {"ui": {"customTitle": "Face Lock Ref"}},
            },
        ],
        "edges": [],
        "metadata": {"groups": [existing_group]},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-plan", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Create a local Character Sheet branch from the current face and body refs. "
                "Make her more sexy and badass as a warrior wizard escaping a castle dungeon. Do not run or save."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert payload["validation"]["valid"] is True
    assert payload["graph_plan"]["metadata"]["template_id"] == "character_sheet_reference_v1"
    nodes = payload["workflow"]["nodes"]
    model = _graph_node_by_title(nodes, "Character Sheet GPT Image 2 - Variant 1")
    prompt = _graph_node_by_title(nodes, "Character Sheet Prompt - Variant 1")
    incoming_sources = [
        edge["source"]
        for edge in payload["workflow"]["edges"]
        if edge["target"] == model["id"] and edge["target_port"] == "image_refs"
    ]
    assert incoming_sources == ["face-ref", "body-ref"]
    assert model["fields"]["aspect_ratio"] == "16:9"
    assert model["fields"]["resolution"] == "2K"
    assert "[image reference 1] = FACE / IDENTITY LOCK" in prompt["fields"]["text"]
    assert "[image reference 2] = BODY / SHAPE LOCK" in prompt["fields"]["text"]
    assert "image reference 3" not in prompt["fields"]["text"].lower()
    assert "character sheet branch" not in prompt["fields"]["text"].lower()
    assert "current face and body refs" not in prompt["fields"]["text"].lower()
    assert "adult, self-possessed confidence" in prompt["fields"]["text"]
    assert "intricate RPG fantasy design language" in prompt["fields"]["text"]
    assert "model.kie.seedance_2_0" not in {node["type"] for node in nodes}
    groups = {group["title"]: group for group in payload["workflow"]["metadata"]["groups"]}
    assert "Character Sheet Variant 1" in groups
    assert not _workflow_bounds_overlap(existing_group["bounds"], groups["Character Sheet Variant 1"]["bounds"])
    assert "face-ref" not in set(groups["Character Sheet Variant 1"]["node_ids"])
    assert "body-ref" not in set(groups["Character Sheet Variant 1"]["node_ids"])


def test_media_assistant_character_sheet_v3_plan_uses_attached_refs_on_blank_canvas(client, app_modules) -> None:
    character_sheet_recipe = importlib.import_module("app.assistant.character_sheet_recipe")
    prompt_recipe_validation = importlib.import_module("app.service_prompt_recipe_validation")
    existing_recipe = app_modules["store"].get_prompt_recipe_by_key("character_sheet_reference_v3")
    prompt_recipe_validation.upsert_prompt_recipe(
        character_sheet_recipe.character_sheet_v3_prompt_recipe_draft(),
        recipe_id=existing_recipe["recipe_id"] if existing_recipe else None,
    )
    face_reference_id = _create_reference_image(app_modules, name="sadi-face_chest.jpg")
    body_reference_id = _create_reference_image(app_modules, name="sadi-front.jpg")
    workflow = {"schema_version": 1, "name": "Attached Character Sheet v3", "nodes": [], "edges": [], "metadata": {}}
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-v3-attached", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": face_reference_id, "label": "sadi-face_chest.jpg"})
    client.post(f"/media/assistant/sessions/{session_id}/attachments", json={"reference_id": body_reference_id, "label": "sadi-front.jpg"})

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Create a local unsaved Character Sheet v3 workflow using the two attached reference images. "
                "Use attached reference image 1 as FACE / IDENTITY LOCK and attached reference image 2 as BODY / SHAPE LOCK. "
                "Creative brief: adult fantasy ranger princess with emerald amulet. Do not run or save."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert payload["validation"]["valid"] is True
    assert payload["graph_plan"]["metadata"]["template_id"] == "character_sheet_reference_v3"
    nodes = payload["workflow"]["nodes"]
    face = _graph_node_by_title(nodes, "Sadi Face / Identity Ref")
    body = _graph_node_by_title(nodes, "Sadi Body / Shape Ref")
    recipe = _graph_node_by_title(nodes, "Character Sheet v3 Recipe - Variant 1")
    model = _graph_node_by_title(nodes, "Character Sheet v3 GPT Image 2 - Variant 1")
    incoming_recipe_refs = [
        edge["source"]
        for edge in payload["workflow"]["edges"]
        if edge["target"] == recipe["id"] and edge["target_port"] == "image_refs"
    ]
    incoming_model_refs = [
        edge["source"]
        for edge in payload["workflow"]["edges"]
        if edge["target"] == model["id"] and edge["target_port"] == "image_refs"
    ]
    assert face["fields"]["reference_id"] == face_reference_id
    assert body["fields"]["reference_id"] == body_reference_id
    assert recipe["fields"]["recipe_id"]
    assert "adult fantasy ranger princess with emerald amulet" in recipe["fields"]["user_prompt"]
    assert "attached reference" not in recipe["fields"]["user_prompt"].lower()
    assert "identity lock" not in recipe["fields"]["user_prompt"].lower()
    assert incoming_recipe_refs == [face["id"], body["id"]]
    assert incoming_model_refs == [face["id"], body["id"]]
    assert model["fields"]["aspect_ratio"] == "16:9"
    assert model["fields"]["resolution"] == "2K"


def test_media_assistant_character_sheet_plan_creates_two_clean_white_variants(client, app_modules) -> None:
    face_reference_id = _create_reference_image(app_modules, name="character-sheet-multi-face.png")
    body_reference_id = _create_reference_image(app_modules, name="character-sheet-multi-body.png")
    workflow = {
        "schema_version": 1,
        "name": "Character Sheet multi variant",
        "nodes": [
            {
                "id": "face-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": face_reference_id},
                "metadata": {"ui": {"customTitle": "Face Lock Ref"}},
            },
            {
                "id": "body-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 520},
                "fields": {"reference_id": body_reference_id},
                "metadata": {"ui": {"customTitle": "Body Shape Ref"}},
            },
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-multi", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": (
                "Create two more clean white character sheet variations from the same face and body refs. "
                "Make her a desert star marshal with polished chrome and luminous turquoise stitch details. Do not run or save."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["plan"]["status"] == "validated"
    assert payload["validation"]["valid"] is True
    assert payload["graph_plan"]["metadata"]["template_id"] == "character_sheet_reference_v1"
    assert payload["graph_plan"]["metadata"]["variant_count"] == 2
    assert payload["graph_plan"]["metadata"]["variant_labels"] == ["Clean White 1", "Clean White 2"]
    nodes = payload["workflow"]["nodes"]
    first_model = _graph_node_by_title(nodes, "Character Sheet GPT Image 2 - Clean White 1")
    second_model = _graph_node_by_title(nodes, "Character Sheet GPT Image 2 - Clean White 2")
    first_prompt = _graph_node_by_title(nodes, "Character Sheet Prompt - Clean White 1")
    second_prompt = _graph_node_by_title(nodes, "Character Sheet Prompt - Clean White 2")
    first_sources = [
        edge["source"]
        for edge in payload["workflow"]["edges"]
        if edge["target"] == first_model["id"] and edge["target_port"] == "image_refs"
    ]
    second_sources = [
        edge["source"]
        for edge in payload["workflow"]["edges"]
        if edge["target"] == second_model["id"] and edge["target_port"] == "image_refs"
    ]
    groups = {group["title"]: group for group in payload["workflow"]["metadata"]["groups"]}
    assert first_sources == ["face-ref", "body-ref"]
    assert second_sources == ["face-ref", "body-ref"]
    assert "desert star marshal" in first_prompt["fields"]["text"]
    assert "desert star marshal" in second_prompt["fields"]["text"]
    assert "Create two more" not in first_prompt["fields"]["text"]
    assert "Create two more" not in second_prompt["fields"]["text"]
    assert "image reference 3" not in first_prompt["fields"]["text"].lower()
    assert "image reference 3" not in second_prompt["fields"]["text"].lower()
    assert "Character Sheet Clean White 1" in groups
    assert "Character Sheet Clean White 2" in groups
    assert not _workflow_bounds_overlap(groups["Character Sheet Clean White 1"]["bounds"], groups["Character Sheet Clean White 2"]["bounds"])
    assert "model.kie.seedance_2_0" not in {node["type"] for node in nodes}


def test_media_assistant_character_sheet_message_sets_local_graph_action(client, app_modules, monkeypatch) -> None:
    def fail_provider_chat(**_kwargs):
        raise AssertionError("Explicit Character Sheet graph requests should be deterministic.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    face_reference_id = _create_reference_image(app_modules, name="character-sheet-message-face.png")
    body_reference_id = _create_reference_image(app_modules, name="character-sheet-message-body.png")
    workflow = {
        "schema_version": 1,
        "name": "Character Sheet message route",
        "nodes": [
            {
                "id": "face-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": face_reference_id},
                "metadata": {"ui": {"customTitle": "Face Lock Ref"}},
            },
            {
                "id": "body-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 520},
                "fields": {"reference_id": body_reference_id},
                "metadata": {"ui": {"customTitle": "Body Shape Ref"}},
            },
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-message", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create a local Character Sheet branch from the current face/body refs. "
                "Make her a badass fantasy warrior wizard. Do not run or save."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert "Character Sheet Variant 1" in assistant_message["content_text"]
    assert "local Character Sheet branch" in assistant_message["content_text"]
    assert "Image reference 1: FACE / IDENTITY LOCK" in assistant_message["content_text"]
    assert "Image reference 2: BODY / SHAPE LOCK" in assistant_message["content_text"]
    assert assistant_message["content_json"]["mode"] == "deterministic_character_sheet_graph_request"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert assistant_message["content_json"]["assistant_response_kind"] == "create_local"
    assert assistant_message["content_json"]["template_id"] == "character_sheet_reference_v1"
    assert assistant_message["content_json"]["variant_labels"] == ["Variant 1"]
    assert assistant_message["content_json"]["reference_roles"][0]["role_label"] == "FACE / IDENTITY LOCK"
    assert assistant_message["content_json"]["reference_roles"][1]["role_label"] == "BODY / SHAPE LOCK"


def test_media_assistant_character_sheet_message_explains_two_variant_mapping(client, app_modules, monkeypatch) -> None:
    def fail_provider_chat(**_kwargs):
        raise AssertionError("Explicit Character Sheet multi-variant messages should be deterministic.")

    monkeypatch.setattr("app.assistant.routes.run_assistant_provider_chat", fail_provider_chat)
    face_reference_id = _create_reference_image(app_modules, name="character-sheet-message-multi-face.png")
    body_reference_id = _create_reference_image(app_modules, name="character-sheet-message-multi-body.png")
    workflow = {
        "schema_version": 1,
        "name": "Character Sheet message multi route",
        "nodes": [
            {
                "id": "face-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": face_reference_id},
                "metadata": {"ui": {"customTitle": "Face Lock Ref"}},
            },
            {
                "id": "body-ref",
                "type": "media.load_image",
                "position": {"x": 0, "y": 520},
                "fields": {"reference_id": body_reference_id},
                "metadata": {"ui": {"customTitle": "Body Shape Ref"}},
            },
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-message-multi", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/messages",
        json={
            "content_text": (
                "Create two more clean white Character Sheet variations from the current face and body refs. "
                "Make her a moonlit frontier spellmarshal with pearl-white armor. Do not run or save."
            ),
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    assistant_message = response.json()["messages"][-1]
    assert "Clean White 1, Clean White 2" in assistant_message["content_text"]
    assert "local Character Sheet branches" in assistant_message["content_text"]
    assert "Image reference 1: FACE / IDENTITY LOCK" in assistant_message["content_text"]
    assert "Image reference 2: BODY / SHAPE LOCK" in assistant_message["content_text"]
    assert assistant_message["content_json"]["mode"] == "deterministic_character_sheet_graph_request"
    assert assistant_message["content_json"]["suggested_action"] == "create_graph_plan"
    assert assistant_message["content_json"]["assistant_response_kind"] == "create_local"
    assert assistant_message["content_json"]["variant_count"] == 2
    assert assistant_message["content_json"]["variant_labels"] == ["Clean White 1", "Clean White 2"]


def test_media_assistant_character_sheet_plan_asks_when_current_refs_are_unclear(client, app_modules, monkeypatch) -> None:
    def fail_provider_plan(**_kwargs):
        raise AssertionError("Ambiguous Character Sheet graph requests should ask locally.")

    monkeypatch.setattr("app.assistant.routes.run_provider_graph_plan", fail_provider_plan)
    first_reference_id = _create_reference_image(app_modules, name="character-sheet-ambiguous-a.png")
    second_reference_id = _create_reference_image(app_modules, name="character-sheet-ambiguous-b.png")
    workflow = {
        "schema_version": 1,
        "name": "Ambiguous Character Sheet refs",
        "nodes": [
            {
                "id": "load-a",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": first_reference_id},
                "metadata": {"ui": {"customTitle": "Load Image A"}},
            },
            {
                "id": "load-b",
                "type": "media.load_image",
                "position": {"x": 0, "y": 520},
                "fields": {"reference_id": second_reference_id},
                "metadata": {"ui": {"customTitle": "Load Image B"}},
            },
        ],
        "edges": [],
        "metadata": {},
    }
    session_response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "graph_workflow", "owner_id": "workflow-character-sheet-ambiguous", "workflow": workflow},
    )
    session_id = session_response.json()["assistant_session_id"]

    response = client.post(
        f"/media/assistant/sessions/{session_id}/plans",
        json={
            "message": "Create a local Character Sheet branch from these refs. Do not run or save.",
            "workflow": workflow,
            "assistant_mode": "graph",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["graph_plan"]["operations"] == []
    assert payload["graph_plan"]["questions"] == [
        "Which image node should be the face lock, and which should be the body lock?"
    ]
    assert payload["graph_plan"]["metadata"]["blocked_reason"] == "missing_reference_roles"
    assert payload["workflow"]["nodes"] == workflow["nodes"]


def test_graph_validation_allows_disconnected_note_annotations() -> None:
    workflow = GraphWorkflow(
        schema_version=1,
        name="Note annotation validation",
        nodes=[
            {"id": "note", "type": "utility.note", "position": {"x": 0, "y": -160}, "fields": {"body": "Planning note"}},
            {"id": "prompt", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "Prompt"}},
            {"id": "display", "type": "display.any", "position": {"x": 320, "y": 0}, "fields": {}},
        ],
        edges=[{"id": "edge-prompt-display", "source": "prompt", "source_port": "text", "target": "display", "target_port": "value"}],
        metadata={},
    )

    validation = validate_workflow(workflow)

    assert validation.valid is True
    assert not any(warning.code == "disconnected_node" and warning.node_id == "note" for warning in validation.warnings)


def test_media_assistant_story_combine_guard_requires_approved_clips() -> None:
    workflow = GraphWorkflow(schema_version=1, name="Story combine guard", nodes=[], edges=[], metadata={})
    story_project = {
        "story_segments": [
            {
                "segment_id": "segment_1",
                "shot_count": 4,
                "approved_outputs": [],
            }
        ]
    }

    plan = story_graph_plan_from_state(
        message="Build a graph to combine and stitch the story clips.",
        story_project=story_project,
        workflow=workflow,
    )

    assert plan is not None
    assert plan.metadata["template_id"] == "story_clip_combine_guard_v1"
    assert plan.operations == []
    assert "at least two approved story clips" in plan.summary


def test_media_assistant_story_combine_plan_uses_only_approved_video_outputs() -> None:
    workflow = GraphWorkflow(schema_version=1, name="Story combine plan", nodes=[], edges=[], metadata={})
    story_project = {
        "story_segments": [
            {"segment_id": "segment_1", "approved_outputs": [{"kind": "video", "reference_id": "reference-video-1"}]},
            {"segment_id": "segment_2", "approved_outputs": [{"kind": "video", "reference_id": "reference-video-2"}]},
        ]
    }

    plan = story_graph_plan_from_state(
        message="Build a graph to combine and stitch the approved story clips.",
        story_project=story_project,
        workflow=workflow,
    )
    planned_workflow = apply_graph_plan(workflow, plan)

    assert plan is not None
    assert plan.metadata["template_id"] == "story_clip_combine_v1"
    node_types = {node.type for node in planned_workflow.nodes}
    assert {"media.load_video", "video.combine", "preview.video", "media.save_video"}.issubset(node_types)
    combine = next(node for node in planned_workflow.nodes if node.type == "video.combine")
    assert combine.fields["clip_count"] == 2
    assert any(edge.target == combine.id and edge.target_port == "video_1" for edge in planned_workflow.edges)
    assert any(edge.target == combine.id and edge.target_port == "video_2" for edge in planned_workflow.edges)
    clip_1 = _graph_node_by_title(planned_workflow.nodes, "Approved Clip 1")
    clip_2 = _graph_node_by_title(planned_workflow.nodes, "Approved Clip 2")
    preview = _graph_node_by_title(planned_workflow.nodes, "Preview Combined Story")
    save = _graph_node_by_title(planned_workflow.nodes, "Save Combined Story")
    clip_width, clip_height = _node_layout_size_for_bounds("media.load_video")
    combine_width, _combine_height = _node_layout_size_for_bounds("video.combine")
    preview_width, preview_height = _node_layout_size_for_bounds("preview.video")
    assert _graph_node_position(clip_2)["y"] - (_graph_node_position(clip_1)["y"] + clip_height) >= 80
    assert _graph_node_position(combine)["x"] - (_graph_node_position(clip_1)["x"] + clip_width) >= 200
    assert _graph_node_position(preview)["x"] - (_graph_node_position(combine)["x"] + combine_width) >= 160
    assert _graph_node_position(save)["x"] - (_graph_node_position(combine)["x"] + combine_width) >= 160
    assert _graph_node_position(save)["y"] - (_graph_node_position(preview)["y"] + preview_height) >= 120
    assert preview_width > 0
    group = planned_workflow.metadata["groups"][0]
    assert set(group["node_ids"]) == {node.id for node in planned_workflow.nodes}
    for node in planned_workflow.nodes:
        _assert_group_contains_rendered_node(group, node)
