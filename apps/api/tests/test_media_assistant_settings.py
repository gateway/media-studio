from __future__ import annotations

import importlib


def test_media_assistant_config_is_dedicated_and_drives_new_sessions(client) -> None:
    recipe_before = client.get("/media/prompt-recipe-drafting-config").json()

    initial = client.get("/media/assistant-config")

    assert initial.status_code == 200, initial.text
    assert initial.json()["config_key"] == "media_assistant"
    assert initial.json()["provider_kind"] == "codex_local"
    assert initial.json()["supports_media_studio_tools"] is True

    updated = client.patch(
        "/media/assistant-config",
        json={
            "provider_kind": "openrouter",
            "provider_model_id": "openrouter/assistant-model",
            "temperature": 0.45,
            "max_tokens": 1200,
        },
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["config_key"] == "media_assistant"
    assert updated.json()["provider_kind"] == "openrouter"
    assert updated.json()["supports_media_studio_tools"] is False
    assert client.get("/media/prompt-recipe-drafting-config").json() == recipe_before

    session = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone"},
    )

    assert session.status_code == 200, session.text
    assert session.json()["provider_kind"] == "openrouter"
    assert session.json()["provider_model_id"] == "openrouter/assistant-model"


def test_media_assistant_provider_probe_uses_dedicated_contract(
    client,
    app_modules,
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_probe(payload):
        captured.update(payload)
        return {
            "provider": "codex_local",
            "credential_source": "codex_local_login",
            "selected_model": {
                "id": "gpt-5.6-sol",
                "label": "GPT-5.6",
                "provider": "codex_local",
                "supports_images": True,
            },
            "available_models": [],
        }

    monkeypatch.setattr(app_modules["service"], "probe_media_assistant_provider", fake_probe)

    response = client.post(
        "/media/assistant-config/probe",
        json={
            "provider_kind": "codex_local",
            "selected_model_id": "gpt-5.6-sol",
            "require_images": False,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["provider"] == "codex_local"
    assert captured["provider_model_id"] == "gpt-5.6-sol"


def test_external_assistant_provider_is_single_turn_chat_without_tools(
    client,
    app_modules,
    monkeypatch,
) -> None:
    kernel = importlib.import_module("app.assistant.kernel")
    provider_support = importlib.import_module("app.assistant.provider_support")
    app_modules["store"].create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": "media_assistant",
            "provider_kind": "local_openai",
            "provider_model_id": "local/chat",
            "provider_base_url": "http://127.0.0.1:8080/v1",
        }
    )
    monkeypatch.setattr(
        provider_support,
        "shared_provider_runtime",
        lambda *_args, **_kwargs: {
            "api_key": "local-key",
            "base_url": "http://127.0.0.1:8080/v1",
            "credential_source": "env",
        },
    )
    calls: list[dict] = []

    def fake_chat(**kwargs):
        calls.append(kwargs)
        return {
            "generated_text": "I can discuss the workflow, but this provider cannot change the canvas.",
            "provider_kind": "local_openai",
            "provider_model_id": "local/chat",
            "usage": {},
        }

    monkeypatch.setattr(kernel.enhancement_provider, "run_openai_compatible_chat", fake_chat)
    session = client.post("/media/assistant/sessions", json={"owner_kind": "standalone"}).json()

    response = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/messages",
        json={"content_text": "Build a graph for me."},
    )

    assert response.status_code == 200, response.text
    turn = response.json()["messages"][-1]["content_json"]["kernel_turn"]
    assert turn["next_action"]["kind"] == "none"
    assert turn["trace"]["tool_calls"] == []
    assert turn["trace"]["termination"] == "read_only_provider"
    assert calls and calls[0]["provider_kind"] == "local_openai"
    assert "tools" not in calls[0]


def test_unavailable_assistant_provider_returns_configuration_path(
    client,
    app_modules,
    monkeypatch,
) -> None:
    settings_module = importlib.import_module("app.settings")
    monkeypatch.setattr(settings_module.settings, "openrouter_api_key", "")
    app_modules["store"].create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": "media_assistant",
            "provider_kind": "openrouter",
            "provider_model_id": "assistant/model",
        }
    )
    session = client.post("/media/assistant/sessions", json={"owner_kind": "standalone"}).json()

    response = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/messages",
        json={"content_text": "Help me think through a graph."},
    )

    assert response.status_code == 502
    detail = response.json()["detail"].lower()
    assert "credential" in detail
    assert "ai settings" in detail
