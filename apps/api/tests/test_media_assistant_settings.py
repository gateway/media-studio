from __future__ import annotations

import importlib
from threading import Thread


def test_provider_change_advances_session_generation_and_detaches_old_thread(
    app_modules,
    monkeypatch,
) -> None:
    provider_support = importlib.import_module("app.assistant.provider_support")
    store = app_modules["store"]
    store_assistant = app_modules["store_assistant"]
    closed_keys: list[str] = []
    session = store_assistant.create_or_update_assistant_session(
        {
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.6-sol",
            "provider_thread_id": "thread-old",
            "state_snapshot_json": {
                "provider_generation": 2,
                "workflow": {"name": "Preserve me"},
            },
        }
    )
    monkeypatch.setattr(
        provider_support.enhancement_provider.codex_local_provider,
        "close_codex_local_skill_session",
        closed_keys.append,
    )
    store.create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": "media_assistant",
            "provider_kind": "openrouter",
            "provider_model_id": "openrouter/new",
        }
    )

    switched_away = provider_support.sync_assistant_session_provider(session)

    assert closed_keys == [f"{session['assistant_session_id']}:2"]
    assert switched_away["provider_thread_id"] is None
    assert switched_away["state_snapshot_json"]["provider_generation"] == 3
    assert switched_away["state_snapshot_json"]["workflow"] == {"name": "Preserve me"}

    store.create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": "media_assistant",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.6-sol",
        }
    )
    switched_back = provider_support.sync_assistant_session_provider(switched_away)

    assert switched_back["provider_thread_id"] is None
    assert switched_back["state_snapshot_json"]["provider_generation"] == 4
    assert provider_support.assistant_codex_session_key(switched_back).endswith(":4")


def test_forced_provider_refresh_replaces_a_stalled_thread_without_changing_provider(
    app_modules,
    monkeypatch,
) -> None:
    provider_support = importlib.import_module("app.assistant.provider_support")
    store_assistant = app_modules["store_assistant"]
    closed_keys: list[str] = []
    session = store_assistant.create_or_update_assistant_session(
        {
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.6-sol",
            "provider_thread_id": "thread-stalled",
            "state_snapshot_json": {"provider_generation": 4},
        }
    )
    monkeypatch.setattr(
        provider_support.enhancement_provider.codex_local_provider,
        "close_codex_local_skill_session",
        closed_keys.append,
    )

    refreshed = provider_support.sync_assistant_session_provider(
        session,
        force_new_thread=True,
    )

    assert closed_keys == [f"{session['assistant_session_id']}:4"]
    assert refreshed["provider_thread_id"] is None
    assert refreshed["state_snapshot_json"]["provider_generation"] == 5


def test_provider_change_interrupts_in_flight_turn_before_closing_process(
    app_modules,
    monkeypatch,
) -> None:
    cancellation = importlib.import_module("app.assistant.cancellation")
    provider_support = importlib.import_module("app.assistant.provider_support")
    store = app_modules["store"]
    store_assistant = app_modules["store_assistant"]
    closed_keys: list[str] = []
    session = store_assistant.create_or_update_assistant_session(
        {
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.6-sol",
            "provider_thread_id": "thread-active",
        }
    )
    monkeypatch.setattr(
        provider_support.enhancement_provider.codex_local_provider,
        "close_codex_local_skill_session",
        closed_keys.append,
    )
    store.create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": "media_assistant",
            "provider_kind": "openrouter",
            "provider_model_id": "openrouter/new",
        }
    )

    with cancellation.track_session(session["assistant_session_id"]) as cancel_event:
        reset_thread = Thread(
            target=provider_support.sync_active_assistant_session_providers
        )
        reset_thread.start()
        assert cancel_event.wait(1) is True
        assert closed_keys == []

    reset_thread.join(timeout=2)
    assert reset_thread.is_alive() is False
    assert closed_keys == [f"{session['assistant_session_id']}:0"]


def test_archiving_assistant_session_archives_codex_thread_once(
    client,
    app_modules,
    monkeypatch,
) -> None:
    provider_support = importlib.import_module("app.assistant.provider_support")
    store_assistant = app_modules["store_assistant"]
    archived: list[tuple[str, str]] = []
    session = store_assistant.create_or_update_assistant_session(
        {
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.6-sol",
            "provider_thread_id": "thread-archive",
            "state_snapshot_json": {"provider_generation": 5},
        }
    )
    other = store_assistant.create_or_update_assistant_session(
        {
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.6-sol",
            "provider_thread_id": "thread-other",
        }
    )
    monkeypatch.setattr(
        provider_support.enhancement_provider.codex_local_provider,
        "archive_codex_local_thread",
        lambda *, session_key, thread_id: archived.append(
            (session_key, thread_id)
        )
        or True,
    )

    first = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/archive"
    )
    second = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/archive"
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["status"] == "archived"
    assert archived == [
        (f"{session['assistant_session_id']}:5", "thread-archive")
    ]
    assert store_assistant.get_assistant_session(other["assistant_session_id"])["status"] == "active"


def test_media_assistant_config_is_dedicated_and_drives_new_sessions(
    client,
    app_modules,
    monkeypatch,
) -> None:
    recipe_before = client.get("/media/prompt-recipe-drafting-config").json()

    initial = client.get("/media/assistant-config")

    assert initial.status_code == 200, initial.text
    assert initial.json()["config_key"] == "media_assistant"
    assert initial.json()["provider_kind"] == "codex_local"
    assert initial.json()["supports_media_studio_tools"] is True
    existing_session = app_modules[
        "store_assistant"
    ].create_or_update_assistant_session(
        {
            "provider_kind": "codex_local",
            "provider_model_id": initial.json()["provider_model_id"],
            "provider_thread_id": "thread-before-settings-change",
            "state_snapshot_json": {"provider_generation": 6},
        }
    )
    closed_keys: list[str] = []
    provider_support = importlib.import_module("app.assistant.provider_support")
    monkeypatch.setattr(
        provider_support.enhancement_provider.codex_local_provider,
        "close_codex_local_skill_session",
        closed_keys.append,
    )

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
    refreshed = app_modules["store_assistant"].get_assistant_session(
        existing_session["assistant_session_id"]
    )
    assert closed_keys == [f"{existing_session['assistant_session_id']}:6"]
    assert refreshed["provider_thread_id"] is None
    assert refreshed["state_snapshot_json"]["provider_generation"] == 7

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
