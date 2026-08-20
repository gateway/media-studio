from __future__ import annotations

import importlib

import pytest


def test_attachment_image_paths_resolves_stored_images_and_skips_missing(app_modules) -> None:
    target = app_modules["main"].settings.data_root / "reference-media" / "images" / "planner.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"image")
    reference = app_modules["store"].create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": target.name,
            "stored_path": "reference-media/images/planner.png",
            "mime_type": "image/png",
            "file_size_bytes": target.stat().st_size,
            "sha256": "planner-image",
            "metadata_json": {},
        },
        increment_usage=False,
    )
    provider_support = importlib.import_module("app.assistant.provider_support")

    paths = provider_support.attachment_image_paths(
        [
            {"reference_id": reference["reference_id"], "kind": "image"},
            {"reference_id": "ref_missing", "kind": "image"},
        ]
    )

    assert paths == [str(target)]


def test_runtime_prefers_dedicated_assistant_config_without_borrowing_other_features(
    app_modules,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = app_modules["store"]
    store.create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": "prompt_recipe_drafting",
            "provider_kind": "local_openai",
            "provider_model_id": "recipe-model",
            "provider_base_url": "http://recipe.invalid/v1",
        }
    )
    store.create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": "media_assistant",
            "provider_kind": "openrouter",
            "provider_model_id": "assistant/model",
            "temperature": 0.4,
            "max_tokens": 1200,
        }
    )
    provider_support = importlib.import_module("app.assistant.provider_support")
    captured: dict[str, object] = {}

    def fake_runtime(provider_kind: str, **kwargs):
        captured.update(provider_kind=provider_kind, **kwargs)
        return {
            "api_key": "assistant-key",
            "base_url": "https://openrouter.ai/api/v1",
            "credential_source": "env",
        }

    monkeypatch.setattr(provider_support, "shared_provider_runtime", fake_runtime)

    runtime = provider_support.resolve_assistant_provider_runtime(
        {"provider_kind": "codex_local", "provider_model_id": "session-model"}
    )

    assert runtime.provider_kind == "openrouter"
    assert runtime.provider_model_id == "assistant/model"
    assert runtime.temperature == 0.4
    assert runtime.max_tokens == 1200
    assert captured == {
        "provider_kind": "openrouter",
        "stored_base_url": None,
        "allow_feature_config": False,
    }


def test_runtime_reports_missing_external_credentials_as_configuration_error(
    app_modules,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app_modules["store"].create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": "media_assistant",
            "provider_kind": "openrouter",
            "provider_model_id": "assistant/model",
        }
    )
    provider_support = importlib.import_module("app.assistant.provider_support")
    monkeypatch.setattr(
        provider_support,
        "shared_provider_runtime",
        lambda *_args, **_kwargs: {
            "api_key": "",
            "base_url": "https://openrouter.ai/api/v1",
            "credential_source": None,
        },
    )

    with pytest.raises(provider_support.AssistantProviderChatError) as exc_info:
        provider_support.resolve_assistant_provider_runtime({})

    message = str(exc_info.value).lower()
    assert "credential" in message
    assert "ai settings" in message
