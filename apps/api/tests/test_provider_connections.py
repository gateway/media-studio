from __future__ import annotations

import importlib
from conftest import CONTROL_HEADERS


def modules():
    return importlib.import_module("app.service_provider_config"), importlib.import_module("app.store_provider_connections")


def test_connections_require_admin_and_never_return_keys(client):
    endpoint = "/media/provider-connections/openrouter"
    assert client.patch(endpoint, headers={**CONTROL_HEADERS, "x-media-studio-access-mode": "read"}, json={"api_key": "private-one"}).status_code == 403
    saved = client.patch(endpoint, json={"api_key": "private-one", "base_url": "https://router.invalid/v1"})
    assert saved.status_code == 200
    assert "private-one" not in saved.text
    assert client.get("/health").json()["openrouter_api_key_configured"] is True
    assert "private-one" not in client.get("/media/provider-connections").text
    assert client.patch(endpoint, json={"base_url": "https://new.invalid/v1"}).status_code == 200
    _, persistence = modules()
    assert persistence.get_provider_connection("openrouter")["api_key"] == "private-one"
    assert client.patch("/media/provider-connections/local_openai", json={"base_url": "http://localhost:9999/v1", "api_key": "private-two"}).status_code == 200
    assert persistence.get_provider_connection("openrouter")["api_key"] == "private-one"
    assert client.get("/health").json()["local_openai_configured"] is True
    assert client.patch(endpoint, json={"base_url": "https://user:secret@router.invalid/v1"}).status_code == 400
    assert client.patch("/media/provider-connections/codex_local", json={"api_key": "invalid"}).status_code == 400


def test_connection_runtime_and_assistant_legacy_boundary(app_modules, monkeypatch):
    service, persistence = modules()
    settings = importlib.import_module("app.settings").settings
    monkeypatch.setattr(settings, "openrouter_api_key", "environment-key")
    app_modules["store"].create_or_update_enhancement_config({"model_key": "__studio_enhancement__", "label": "Enhance", "provider_kind": "openrouter", "provider_api_key": "legacy-key", "provider_base_url": "https://legacy.invalid/v1"})
    assert service.shared_provider_runtime("openrouter")["api_key"] == "legacy-key"
    assert service.shared_provider_runtime("openrouter", allow_feature_config=False)["api_key"] == "environment-key"
    persistence.save_provider_connection("openrouter", {"api_key": "connected-key", "base_url": "https://shared.invalid/v1"})
    runtime = service.shared_provider_runtime("openrouter", allow_feature_config=False)
    assert runtime["api_key"] == "connected-key"
    assert runtime["base_url"] == "https://shared.invalid/v1"
    assert runtime["credential_source"] == "stored"
    assert service.shared_provider_runtime("openrouter", stored_base_url="https://task.invalid/v1")["base_url"] == "https://task.invalid/v1"


def test_switching_enhancement_preserves_credentials_and_legacy_endpoint(app_modules):
    service, _ = modules()
    app_modules["store"].create_or_update_enhancement_config({"model_key": "__studio_enhancement__", "label": "Enhance", "provider_kind": "openrouter", "provider_api_key": "legacy-private", "provider_base_url": "https://task.invalid/v1"})
    saved = app_modules["service"].upsert_enhancement_config({"model_key": "__studio_enhancement__", "label": "Enhance", "provider_kind": "codex_local", "provider_model_id": "codex-model"})
    assert saved["provider_api_key"] is None
    assert saved["provider_base_url"] is None
    assert service.shared_provider_runtime("openrouter")["api_key"] == "legacy-private"
    assert "legacy-private" not in str(app_modules["service"].public_enhancement_config(saved))
    restored = app_modules["service"].upsert_enhancement_config({"model_key": "__studio_enhancement__", "label": "Enhance", "provider_kind": "openrouter"})
    assert restored["provider_api_key"] == "legacy-private"
    assert restored["provider_base_url"] == "https://task.invalid/v1"
    assert "legacy-private" not in str(app_modules["service"].public_enhancement_config(restored))


def test_task_endpoint_survives_provider_round_trip(app_modules):
    service, _ = modules()
    schemas = app_modules["schemas"]
    app_modules["store"].create_or_update_prompt_recipe_drafting_config({"config_key": "prompt_recipe_drafting", "provider_kind": "local_openai", "provider_model_id": "old", "provider_base_url": "https://recipe.invalid/v1"})
    service.upsert_prompt_recipe_drafting_config(schemas.PromptRecipeDraftingConfigUpsertRequest(provider_kind="codex_local", provider_model_id="codex"))
    assert app_modules["store"].get_prompt_recipe_drafting_config()["provider_base_url"] is None
    service.upsert_prompt_recipe_drafting_config(schemas.PromptRecipeDraftingConfigUpsertRequest(provider_kind="local_openai", provider_model_id="local"))
    assert app_modules["store"].get_prompt_recipe_drafting_config()["provider_base_url"] == "https://recipe.invalid/v1"


def test_enhancement_execution_and_probe_use_connection(app_modules, monkeypatch):
    _, persistence = modules()
    persistence.save_provider_connection("openrouter", {"api_key": "connection-key", "base_url": "https://shared.invalid/v1"})
    provider = importlib.import_module("app.enhancement_provider")
    captured = []
    monkeypatch.setattr(provider, "run_openai_compatible_enhancement", lambda **kwargs: captured.append(kwargs) or {"enhanced_prompt": "enhanced"})
    request = app_modules["schemas"].EnhancePreviewRequest(model_key="nano_banana_2", task_mode="text_to_image", prompt="A quiet garden")
    app_modules["service"]._run_external_enhancement({"provider_kind": "openrouter", "provider_model_id": "test-model", "provider_api_key": "legacy-key", "supports_text_enhancement": True}, request, {"final_prompt": "A quiet garden"})
    assert captured[0]["api_key"] == "connection-key"
    assert captured[0]["base_url"] == "https://shared.invalid/v1"
    monkeypatch.setattr(provider, "test_openrouter_connection", lambda **kwargs: captured.append(kwargs) or {"provider": "openrouter"})
    result = app_modules["service"].probe_enhancement_provider({"provider_kind": "openrouter"})
    assert result["credential_source"] == "stored"
    assert captured[-1]["api_key"] == "connection-key"


def test_explicit_connection_save_adopts_legacy_key_for_assistant(client, app_modules):
    service, _ = modules()
    app_modules["store"].create_or_update_enhancement_config({"model_key": "__studio_enhancement__", "label": "Enhance", "provider_kind": "openrouter", "provider_api_key": "legacy-private"})
    assert service.shared_provider_runtime("openrouter", allow_feature_config=False)["api_key"] == ""
    assert client.patch("/media/provider-connections/openrouter", json={"base_url": "https://shared.invalid/v1"}).status_code == 200
    assert service.shared_provider_runtime("openrouter", allow_feature_config=False)["api_key"] == "legacy-private"


def test_graph_prompt_resolver_uses_connections_and_retains_legacy_endpoint(app_modules):
    service, persistence = modules()
    prompt_ops = importlib.import_module("app.graph.executors.prompt_ops")
    schema = importlib.import_module("app.graph.schemas")
    persistence.save_provider_connection("openrouter", {"api_key": "graph-connected-key", "base_url": "https://connected.invalid/v1"})
    node = schema.GraphWorkflowNode(id="llm", type="prompt.llm", position={"x": 0, "y": 0}, fields={"provider": "openrouter", "model_id": "explicit-model"})
    resolved = prompt_ops._provider_config(node, has_image=False)
    assert resolved["provider_model_id"] == "explicit-model"
    assert resolved["provider_api_key"] == "graph-connected-key"
    assert resolved["provider_base_url"] == "https://connected.invalid/v1"
    app_modules["store"].create_or_update_enhancement_config({"model_key": "__studio_enhancement__", "label": "Enhance", "provider_kind": "openrouter", "provider_model_id": "studio-model", "provider_api_key": "legacy-key", "provider_base_url": "https://legacy.invalid/v1"})
    resolved = prompt_ops._provider_config(node, has_image=False)
    assert resolved["provider_model_id"] == "explicit-model"
    assert resolved["provider_api_key"] == "graph-connected-key"
    assert resolved["provider_base_url"] == "https://legacy.invalid/v1"
    node.fields["provider"] = "studio_default"
    assert prompt_ops._provider_config(node, has_image=False)["provider_model_id"] == "studio-model"
    app_modules["service"].upsert_enhancement_config({"model_key": "__studio_enhancement__", "label": "Enhance", "provider_kind": "codex_local", "provider_model_id": "codex-model"})
    node.fields["provider"] = "openrouter"
    assert prompt_ops._provider_config(node, has_image=False)["provider_api_key"] == "graph-connected-key"


def test_blank_first_connection_save_keeps_environment_source(client, app_modules, monkeypatch):
    service, persistence = modules()
    settings = importlib.import_module("app.settings").settings
    monkeypatch.setattr(settings, "openrouter_api_key", "environment-private")
    assert client.patch("/media/provider-connections/openrouter", json={"base_url": "https://shared.invalid/v1"}).status_code == 200
    assert persistence.get_provider_connection("openrouter")["api_key"] is None
    assert service.shared_provider_runtime("openrouter")["credential_source"] == "env"
