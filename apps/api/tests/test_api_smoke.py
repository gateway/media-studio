import pytest
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def test_media_routes_require_internal_control_token(unauthenticated_client) -> None:
    response = unauthenticated_client.get("/media/pricing")
    assert response.status_code == 403
    assert "control API token" in response.text


def test_health_endpoint(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert str(payload["install_id"]).startswith("install-")
    assert payload["kie_api_repo_connected"] is True
    assert payload["kie_api_key_configured"] is False
    assert payload["live_submit_enabled"] is False
    assert payload["openrouter_api_key_configured"] is False
    assert payload["local_openai_configured"] in {True, False}
    assert payload["local_openai_ready"] in {True, False}
    assert payload["codex_local_command_available"] in {True, False}
    assert payload["codex_local_login_configured"] in {True, False}
    assert payload["codex_local_ready"] in {True, False}
    assert payload["queue_enabled"] is True
    assert payload["runner_name"] == "Media Studio Runner"
    assert payload["runner_mode"] == "embedded"
    assert payload["runner_attached_to"] == "Media Studio API"
    assert payload["runner_process_name"] == "media-studio-runner"
    assert payload["runner_launch_mode"] == "manual"
    assert payload["runner_active"] is False
    assert payload["runner_health"] == "needs_attention"
    assert isinstance(payload["heartbeat_max_age_seconds"], int)
    assert payload["kie_spec_version"]
    assert payload["kie_models_total"] >= 1
    assert payload["kie_models_studio_exposed"] >= 1
    assert payload["pricing_version"]


def test_media_files_serves_relative_data_path(client, app_modules) -> None:
    target = app_modules["main"].settings.data_root / "outputs" / "smoke-relative.txt"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("relative ok", encoding="utf-8")

    response = client.get("/media/files/outputs/smoke-relative.txt")

    assert response.status_code == 200
    assert response.text == "relative ok"


def test_media_files_serves_windows_absolute_data_path(client, app_modules) -> None:
    target = app_modules["main"].settings.data_root / "reference-media" / "images" / "windows-ref.txt"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("windows path ok", encoding="utf-8")

    windows_absolute_path = "E:/Development/media-studio/data/reference-media/images/windows-ref.txt"
    response = client.get(f"/media/files/{quote(windows_absolute_path, safe='/')}")

    assert response.status_code == 200
    assert response.text == "windows path ok"


def test_media_files_rejects_paths_outside_data_root(client) -> None:
    response = client.get("/media/files/E%3A/Development/other/private.txt")

    assert response.status_code == 404


def test_health_endpoint_reports_paused_when_queue_disabled(client) -> None:
    update = client.patch("/media/queue/settings", json={"queue_enabled": False})
    assert update.status_code == 200, update.text

    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["queue_enabled"] is False
    assert payload["runner_health"] == "paused"
    assert payload["issues"] == []


def test_models_endpoint(client) -> None:
    response = client.get("/media/models")
    assert response.status_code == 200
    items = response.json()
    assert items
    assert any(item["key"] == "nano-banana-2" for item in items)
    kling = next(item for item in items if item["key"] == "kling-3.0-t2v")
    seedance = next(item for item in items if item["key"] == "seedance-2.0")
    assert "4K" in kling["raw"]["options"]["mode"]["allowed"]
    assert "1080p" in seedance["raw"]["options"]["resolution"]["allowed"]
    assert kling["studio_exposed"] is True
    assert kling["studio_support_status"] == "fully_supported"
    assert kling["kie_spec_version"]
    kling_options = {item["key"]: item for item in kling["studio_dynamic_options"]}
    assert "4K" in kling_options["mode"]["allowed"]
    for model_key in ["kling-2.6-t2v", "kling-2.6-i2v", "kling-3.0-t2v", "kling-3.0-i2v", "seedance-2.0"]:
        model = next(item for item in items if item["key"] == model_key)
        options = {item["key"]: item for item in model["studio_dynamic_options"]}
        assert options["duration"]["label"] == "Duration"
        assert options["duration"]["required"] is True
    seedance_options = {item["key"]: item for item in seedance["studio_dynamic_options"]}
    assert "1080p" in seedance_options["resolution"]["allowed"]


def test_external_llm_usage_summary_and_list_routes_return_actual_openrouter_spend(client, app_modules) -> None:
    store = app_modules["store"]
    first = store.create_external_llm_usage_event(
        {
            "provider_kind": "openrouter",
            "provider_model_id": "openai/gpt-4o-mini",
            "provider_response_id": "resp-summary-1",
            "source_kind": "graph_prompt_llm",
            "workflow_id": "graphwf_summary",
            "run_id": "grun_summary",
            "node_id": "node-summary",
            "usage_json": {"prompt_tokens": 120, "completion_tokens": 80, "total_tokens": 200, "cost": 0.0123},
            "prompt_tokens": 120,
            "completion_tokens": 80,
            "total_tokens": 200,
            "cost_usd": 0.0123,
            "metadata_json": {"surface": "graph"},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    second = store.create_external_llm_usage_event(
        {
            "provider_kind": "openrouter",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "provider_response_id": "resp-summary-2",
            "source_kind": "prompt_recipe_drafting",
            "recipe_id": "recipe_summary",
            "usage_json": {"prompt_tokens": 40, "completion_tokens": 20, "total_tokens": 60, "cost": 0.0031},
            "prompt_tokens": 40,
            "completion_tokens": 20,
            "total_tokens": 60,
            "cost_usd": 0.0031,
            "metadata_json": {"surface": "drafting"},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    summary_response = client.get("/media/external-llm-usage/summary")
    assert summary_response.status_code == 200, summary_response.text
    summary = summary_response.json()
    assert summary["provider_kind"] == "external_llm"
    assert summary["currency"] == "USD"
    assert summary["lifetime"]["event_count"] >= 2
    assert summary["lifetime"]["total_tokens"] >= 260
    assert summary["lifetime"]["cost_usd"] >= 0.0154

    list_response = client.get("/media/external-llm-usage?limit=10")
    assert list_response.status_code == 200, list_response.text
    payload = list_response.json()
    ids = {item["usage_event_id"] for item in payload["items"]}
    assert first["usage_event_id"] in ids
    assert second["usage_event_id"] in ids

    filtered = client.get("/media/external-llm-usage?limit=10&source_kind=prompt_recipe_drafting")
    assert filtered.status_code == 200, filtered.text
    filtered_payload = filtered.json()
    assert filtered_payload["total"] >= 1
    assert all(item["source_kind"] == "prompt_recipe_drafting" for item in filtered_payload["items"])


def test_external_llm_usage_deduplicates_on_provider_response_id(app_modules) -> None:
    store = app_modules["store"]
    store.bootstrap_schema()
    first = store.create_external_llm_usage_event(
        {
            "provider_kind": "openrouter",
            "provider_model_id": "openai/gpt-4o-mini",
            "provider_response_id": "resp-dedupe-1",
            "source_kind": "graph_prompt_llm",
            "usage_json": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "cost": 0.001},
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
            "cost_usd": 0.001,
            "metadata_json": {"attempt": 1},
        }
    )
    second = store.create_external_llm_usage_event(
        {
            "provider_kind": "openrouter",
            "provider_model_id": "openai/gpt-4o-mini",
            "provider_response_id": "resp-dedupe-1",
            "source_kind": "graph_prompt_llm",
            "usage_json": {"prompt_tokens": 11, "completion_tokens": 6, "total_tokens": 17, "cost": 0.0012},
            "prompt_tokens": 11,
            "completion_tokens": 6,
            "total_tokens": 17,
            "cost_usd": 0.0012,
            "metadata_json": {"attempt": 2},
        }
    )

    items = [item for item in store.list_external_llm_usage(limit=200) if item.get("provider_response_id") == "resp-dedupe-1"]
    assert len(items) == 1
    assert first["usage_event_id"] == second["usage_event_id"]
    assert items[0]["prompt_tokens"] == 11
    assert items[0]["total_tokens"] == 17
    assert items[0]["metadata_json"]["attempt"] == 2


def test_external_llm_usage_records_codex_local_zero_cost(app_modules) -> None:
    store = app_modules["store"]
    store.bootstrap_schema()
    external_llm_usage = __import__("app.external_llm_usage", fromlist=["record_external_llm_usage"])

    usage = external_llm_usage.record_external_llm_usage(
        provider_kind="codex_local",
        provider_model_id="gpt-5.4",
        provider_response_id="codex-thread-usage-1",
        source_kind="graph_prompt_recipe_final",
        workflow_id="graphwf_codex",
        run_id="grun_codex",
        node_id="recipe",
        usage={"prompt_tokens": 100, "completion_tokens": 30, "total_tokens": 130},
        metadata_json={"image_count": 2},
    )

    assert usage is not None
    assert usage["provider_kind"] == "codex_local"
    assert usage["cost_usd"] == 0.0
    assert usage["total_tokens"] == 130
    assert usage["metadata_json"]["image_count"] == 2


def test_kie_adapter_prefers_configured_repo(app_modules) -> None:
    kie_module = app_modules["main"].kie_adapter.get_kie_module()
    module_file = str(kie_module.__file__)
    configured_root = str(app_modules["main"].settings.kie_api_repo_path)
    assert module_file.startswith(configured_root)


def test_pricing_endpoint_returns_normalized_snapshot(client) -> None:
    response = client.get("/media/pricing")
    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "site_pricing_page_api"
    assert payload["source_url"] == "https://kie.ai/pricing"
    assert payload["rules"]
    assert any(rule["model_key"] == "nano-banana-2" for rule in payload["rules"])
    assert any(rule["model_key"] == "gpt-image-2-text-to-image" for rule in payload["rules"])
    gpt_rule = next(rule for rule in payload["rules"] if rule["model_key"] == "gpt-image-2-text-to-image")
    assert gpt_rule["pricing_status"] == "observed_site_pricing"
    assert gpt_rule["base_credits"] == pytest.approx(6.0)
    assert payload["priced_model_keys"]
    assert "gpt-image-2-text-to-image" in payload["priced_model_keys"]
    assert payload["missing_model_keys"] == []
    assert isinstance(payload["unmapped_source_rows"], list)
    # Snapshot freshness depends on the checked-in KIE pricing resource date.
    # Startup/manual refresh behavior is covered by the stale-refresh tests below.
    assert isinstance(payload["is_stale"], bool)
    assert payload["is_authoritative"] is False


def test_pricing_estimate_applies_output_count_and_option_multipliers(client) -> None:
    response = client.post(
        "/media/pricing/estimate",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "A neon storefront portrait in the rain.",
            "options": {"resolution": "2k"},
            "output_count": 3,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    summary = payload["pricing_summary"]
    assert summary["output_count"] == 3
    assert summary["per_output"]["estimated_credits"] == pytest.approx(12.0)
    assert summary["per_output"]["estimated_cost_usd"] == pytest.approx(0.06)
    assert summary["total"]["estimated_credits"] == pytest.approx(36.0)
    assert summary["total"]["estimated_cost_usd"] == pytest.approx(0.18)


def test_output_count_rejects_global_bounds(client) -> None:
    too_low = client.post(
        "/media/validate",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "A neon storefront portrait in the rain.",
            "output_count": 0,
        },
    )
    assert too_low.status_code == 422

    too_high = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "A neon storefront portrait in the rain.",
            "output_count": 11,
        },
    )
    assert too_high.status_code == 422


def test_output_count_respects_model_queue_policy_for_validate_estimate_and_submit(client) -> None:
    policy_response = client.patch("/media/queue/policies/nano-banana-2", json={"max_outputs_per_run": 1})
    assert policy_response.status_code == 200, policy_response.text

    payload = {
        "model_key": "nano-banana-2",
        "task_mode": "text_to_image",
        "prompt": "A neon storefront portrait in the rain.",
        "output_count": 2,
    }

    validate_response = client.post("/media/validate", json=payload)
    assert validate_response.status_code == 400
    assert "limit of 1" in validate_response.json()["detail"]

    estimate_response = client.post("/media/pricing/estimate", json=payload)
    assert estimate_response.status_code == 400
    assert "limit of 1" in estimate_response.json()["detail"]

    submit_response = client.post("/media/jobs", json=payload)
    assert submit_response.status_code == 400
    assert "limit of 1" in submit_response.json()["detail"]


def test_pricing_estimate_returns_gpt_image_2_observed_totals(client) -> None:
    response = client.post(
        "/media/pricing/estimate",
        json={
            "model_key": "gpt-image-2-text-to-image",
            "task_mode": "text_to_image",
            "prompt": "A product photograph of a matte black desk lamp.",
            "options": {"aspect_ratio": "16:9", "resolution": "4K"},
            "output_count": 2,
        },
    )
    assert response.status_code == 200, response.text
    summary = response.json()["pricing_summary"]
    assert summary["pricing_status"] == "observed_site_pricing"
    assert summary["pricing_source_kind"] == "site_pricing_page_api"
    assert summary["per_output"]["estimated_credits"] == pytest.approx(16.0)
    assert summary["per_output"]["estimated_cost_usd"] == pytest.approx(0.08)
    assert summary["total"]["estimated_credits"] == pytest.approx(32.0)
    assert summary["total"]["estimated_cost_usd"] == pytest.approx(0.16)


def test_pricing_estimate_returns_kling_4k_observed_totals(client) -> None:
    response = client.post(
        "/media/pricing/estimate",
        json={
            "model_key": "kling-3.0-t2v",
            "task_mode": "text_to_video",
            "prompt": "A high detail cinematic product reveal.",
            "options": {"duration": 5, "mode": "4K", "sound": True},
            "output_count": 1,
        },
    )
    assert response.status_code == 200, response.text
    summary = response.json()["pricing_summary"]
    assert summary["per_output"]["estimated_credits"] == pytest.approx(335.0)
    assert summary["per_output"]["estimated_cost_usd"] == pytest.approx(1.675)


def test_pricing_estimate_returns_kling_30_i2v_per_second_totals(client) -> None:
    response = client.post(
        "/media/pricing/estimate",
        json={
            "model_key": "kling-3.0-i2v",
            "task_mode": "image_to_video",
            "prompt": "A cinematic camera push from the reference frame.",
            "images": [{"path": "/tmp/reference.png", "role": "first_frame"}],
            "options": {"duration": 7, "mode": "4K", "sound": False},
            "output_count": 1,
        },
    )
    assert response.status_code == 200, response.text
    summary = response.json()["pricing_summary"]
    assert summary["per_output"]["estimated_credits"] == pytest.approx(469.0)
    assert summary["per_output"]["estimated_cost_usd"] == pytest.approx(2.345)


def test_pricing_startup_refreshes_when_snapshot_is_stale(app_modules, monkeypatch) -> None:
    adapter = app_modules["main"].kie_adapter
    calls = {"refresh": 0}

    monkeypatch.setattr(
        adapter,
        "pricing_snapshot",
        lambda force_refresh=False: {
            "refreshed_at": "2000-01-01T00:00:00+00:00",
            "rules": [],
            "notes": [],
            "cache_status": "resource_snapshot",
        },
    )

    def fake_refresh():
        calls["refresh"] += 1
        return {"refreshed_at": datetime.now(timezone.utc).isoformat(), "rules": [], "is_stale": False}

    monkeypatch.setattr(adapter, "refresh_pricing_snapshot", fake_refresh)

    snapshot = adapter.refresh_pricing_snapshot_if_stale()

    assert calls["refresh"] == 1
    assert snapshot["is_stale"] is False


def test_pricing_startup_keeps_fresh_snapshot(app_modules, monkeypatch) -> None:
    adapter = app_modules["main"].kie_adapter
    calls = {"refresh": 0}
    fresh_snapshot = {
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        "rules": [],
        "notes": [],
        "cache_status": "resource_snapshot",
    }

    monkeypatch.setattr(adapter, "pricing_snapshot", lambda force_refresh=False: dict(fresh_snapshot))
    monkeypatch.setattr(adapter, "refresh_pricing_snapshot", lambda: calls.__setitem__("refresh", calls["refresh"] + 1))

    snapshot = adapter.refresh_pricing_snapshot_if_stale()

    assert calls["refresh"] == 0
    assert snapshot["is_stale"] is False


def test_pricing_refresh_falls_back_to_cached_snapshot(app_modules, monkeypatch) -> None:
    adapter = app_modules["main"].kie_adapter
    original_import_module = adapter.importlib.import_module

    def fake_import_module(name: str):
        if name == "kie_api.services.pricing_refresh":
            raise RuntimeError("network unavailable")
        return original_import_module(name)

    monkeypatch.setattr(
        adapter,
        "pricing_snapshot",
        lambda force_refresh=False: {
            "refreshed_at": "2000-01-01T00:00:00+00:00",
            "rules": [{"model_key": "gpt-image-2-text-to-image"}],
            "notes": [],
            "cache_status": "resource_snapshot",
        },
    )
    monkeypatch.setattr(adapter.importlib, "import_module", fake_import_module)

    snapshot = adapter.refresh_pricing_snapshot()

    assert snapshot["refresh_error"] == "network unavailable"
    assert snapshot["cache_status"] == "resource_snapshot"
    assert snapshot["is_stale"] is True
    assert "Pricing refresh failed: network unavailable" in snapshot["notes"]


def test_seedance_validate_returns_prompt_context_and_reference_guide(client) -> None:
    response = client.post(
        "/media/validate",
        json={
            "model_key": "seedance-2.0",
            "task_mode": "reference_to_video",
            "prompt": "Use @image1 for the hero and @audio1 for the rhythm.",
            "images": [{"path": "/tmp/ref-image.png", "role": "reference"}],
            "audios": [{"path": "/tmp/ref-audio.wav", "role": "reference"}],
            "options": {"duration": 4, "resolution": "480p", "aspect_ratio": "16:9"},
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    prompt_context = payload["prompt_context"]
    assert prompt_context["input_pattern"] == "multimodal_reference"
    assert prompt_context["resolved_profile_key"] == "seedance_2_0_multimodal_reference_v1"
    assert "@image1 -> reference image 1" in prompt_context["rendered_system_prompt"]
    assert "@audio1 -> reference audio 1" in prompt_context["rendered_system_prompt"]


def test_submit_requires_admin_access_mode(app_modules) -> None:
    app = app_modules["main"].app
    from fastapi.testclient import TestClient

    with TestClient(
        app,
        headers={
            "x-media-studio-control-token": "test-control-token",
            "x-media-studio-access-mode": "read",
        },
    ) as client:
        response = client.post(
            "/media/jobs",
            json={
                "model_key": "nano-banana-2",
                "task_mode": "text_to_image",
                "prompt": "Studio portrait.",
                "output_count": 1,
            },
        )
    assert response.status_code == 403
    assert "Admin access" in response.text


def test_poll_job_route_uses_public_runner_method(client, app_modules, monkeypatch) -> None:
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Poll me.",
            "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    job_id = submit_response.json()["jobs"][0]["job_id"]

    captured = {"job_id": None}

    def fake_poll_job_once(job):
      captured["job_id"] = job["job_id"]

    monkeypatch.setattr(app_modules["main"].runner, "poll_job_once", fake_poll_job_once)

    response = client.post(f"/media/jobs/{job_id}/poll")
    assert response.status_code == 200, response.text
    assert captured["job_id"] == job_id


def test_enhancement_config_responses_redact_provider_credentials(client) -> None:
    create_response = client.post(
        "/media/enhancement-configs",
        json={
            "model_key": "__studio_enhancement__",
            "label": "Studio enhancement",
            "provider_kind": "openrouter",
            "provider_label": "OpenRouter.ai",
            "provider_model_id": "openrouter/model",
            "provider_api_key": "secret-key",
            "provider_base_url": "https://internal.example/v1",
            "supports_text_enhancement": True,
            "supports_image_analysis": False,
        },
    )
    assert create_response.status_code == 200, create_response.text
    created = create_response.json()
    assert created["provider_api_key_configured"] is True
    assert created["provider_base_url_configured"] is True
    assert "provider_api_key" not in created
    assert "provider_base_url" not in created

    list_response = client.get("/media/enhancement-configs")
    assert list_response.status_code == 200, list_response.text
    listed = next(item for item in list_response.json() if item["model_key"] == "__studio_enhancement__")
    assert listed["provider_api_key_configured"] is True
    assert listed["provider_base_url_configured"] is True
    assert "provider_api_key" not in listed
    assert "provider_base_url" not in listed


def test_create_and_list_preset(client) -> None:
    response = client.post(
        "/media/presets",
        json={
            "key": "selfie-movie",
            "label": "Selfie Movie",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "applies_to_models": ["nano-banana-2"],
            "prompt_template": "Use [[yourphoto]] as base with {{actor}} in {{movie}}",
            "input_schema_json": [
                {"key": "actor", "label": "Actor", "required": True},
                {"key": "movie", "label": "Movie", "required": True},
            ],
            "input_slots_json": [
                {"key": "yourphoto", "label": "Your Photo", "required": True},
            ],
        },
    )
    assert response.status_code == 200, response.text
    preset = response.json()
    assert preset["applies_to_models"] == ["nano-banana-2"]
    assert preset["applies_to_models_json"] == ["nano-banana-2"]
    list_response = client.get("/media/presets")
    assert list_response.status_code == 200
    assert any(item["preset_id"] == preset["preset_id"] for item in list_response.json())


def test_prompt_only_preset_allows_gpt_text_to_image(client) -> None:
    response = client.post(
        "/media/presets",
        json={
            "key": "prompt-only-gpt",
            "label": "Prompt Only GPT",
            "model_key": "gpt-image-2-text-to-image",
            "source_kind": "custom",
            "applies_to_models": ["gpt-image-2-text-to-image"],
            "prompt_template": "Create a portrait of {{subject}}.",
            "input_schema_json": [{"key": "subject", "label": "Subject", "required": True}],
            "input_slots_json": [],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["applies_to_models_json"] == ["gpt-image-2-text-to-image"]


def test_prompt_only_preset_rejects_gpt_image_to_image(client) -> None:
    response = client.post(
        "/media/presets",
        json={
            "key": "prompt-only-gpt-i2i",
            "label": "Prompt Only GPT I2I",
            "model_key": "gpt-image-2-image-to-image",
            "source_kind": "custom",
            "applies_to_models": ["gpt-image-2-image-to-image"],
            "prompt_template": "Create a portrait of {{subject}}.",
            "input_schema_json": [{"key": "subject", "label": "Subject", "required": True}],
            "input_slots_json": [],
        },
    )
    assert response.status_code == 400
    assert "Unsupported preset model scope" in response.text


def test_required_image_preset_allows_gpt_image_to_image(client) -> None:
    response = client.post(
        "/media/presets",
        json={
            "key": "image-gpt-i2i",
            "label": "Image GPT I2I",
            "model_key": "gpt-image-2-image-to-image",
            "source_kind": "custom",
            "applies_to_models": ["gpt-image-2-image-to-image"],
            "prompt_template": "Use [[reference]] to create {{scene}}.",
            "input_schema_json": [{"key": "scene", "label": "Scene", "required": True}],
            "input_slots_json": [{"key": "reference", "label": "Reference", "required": True}],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["applies_to_models_json"] == ["gpt-image-2-image-to-image"]


def test_required_image_preset_rejects_gpt_text_to_image(client) -> None:
    response = client.post(
        "/media/presets",
        json={
            "key": "image-gpt-t2i",
            "label": "Image GPT T2I",
            "model_key": "gpt-image-2-text-to-image",
            "source_kind": "custom",
            "applies_to_models": ["gpt-image-2-text-to-image"],
            "prompt_template": "Use [[reference]] to create {{scene}}.",
            "input_schema_json": [{"key": "scene", "label": "Scene", "required": True}],
            "input_slots_json": [{"key": "reference", "label": "Reference", "required": True}],
        },
    )
    assert response.status_code == 400
    assert "Unsupported preset model scope" in response.text


def test_seeded_shared_presets_exist(client) -> None:
    response = client.get("/media/presets")
    assert response.status_code == 200
    presets = response.json()
    expected_keys = {
        "2x2-pose-grid",
        "3d-caricature-style-nano-banana",
        "exploding-food",
        "food-recipe-infographic",
        "giant-animal-anywhere",
        "photo-restoration",
        "selfie-with-movie-character-nano-banana",
    }
    shared = {item["key"]: item for item in presets if item["key"] in expected_keys}
    assert set(shared.keys()) == expected_keys
    assert not any("2way" in item["key"].lower() or "two-way" in item["key"].lower() for item in presets)

    image_to_image_keys = {
        "2x2-pose-grid",
        "3d-caricature-style-nano-banana",
        "photo-restoration",
        "selfie-with-movie-character-nano-banana",
    }
    for preset in shared.values():
        assert preset["thumbnail_path"]
        assert preset["thumbnail_url"]
        if preset["key"] in image_to_image_keys:
            assert sorted(preset["applies_to_models"]) == [
                "gpt-image-2-image-to-image",
                "nano-banana-2",
                "nano-banana-pro",
            ]
            assert sorted(preset["applies_to_models_json"]) == [
                "gpt-image-2-image-to-image",
                "nano-banana-2",
                "nano-banana-pro",
            ]
        else:
            assert sorted(preset["applies_to_models"]) == [
                "gpt-image-2-text-to-image",
                "nano-banana-2",
                "nano-banana-pro",
            ]
            assert sorted(preset["applies_to_models_json"]) == [
                "gpt-image-2-text-to-image",
                "nano-banana-2",
                "nano-banana-pro",
            ]


def test_seeded_prompt_recipes_exist(client) -> None:
    response = client.get("/prompt-recipes")
    assert response.status_code == 200
    recipes = response.json()
    expected_keys = {
        "storyboard-director-3x3",
        "image-prompt-director",
        "video-director-multi-shot-json",
        "image-analysis-character-reference",
        "prompt-shortener",
    }
    by_key = {item["key"]: item for item in recipes if item["key"] in expected_keys}
    assert set(by_key) == expected_keys
    assert by_key["video-director-multi-shot-json"]["category"] == "video"
    assert by_key["video-director-multi-shot-json"]["output_format"] == "structured_shot_sequence"
    assert by_key["video-director-multi-shot-json"]["image_input"]["enabled"] is True
    assert by_key["prompt-shortener"]["image_input"]["mode"] == "none"


def test_create_patch_archive_prompt_recipe(client) -> None:
    create = client.post(
        "/prompt-recipes",
        json={
            "key": "alien_fortress_director",
            "label": "Alien Fortress Director",
            "description": "Turns a user scene into a cinematic image prompt.",
            "category": "image",
            "status": "active",
            "system_prompt_template": "USER:\n{{user_prompt}}\nSTYLE:\n{{mood}}\nReturn one prompt.",
            "output_format": "single_prompt",
            "input_variables": [
                {"key": "user_prompt", "label": "User Prompt", "enabled": True, "required": True},
            ],
            "custom_fields": [
                {"key": "mood", "label": "Mood", "type": "text", "default_value": "tense sci-fi"},
            ],
            "image_input": {
                "enabled": False,
                "required": False,
                "mode": "none",
                "analysis_variable": "image_analysis",
                "max_files": 0,
            },
            "rules": {"allow_external_variables": False, "return_only_final_output": True},
        },
    )
    assert create.status_code == 200, create.text
    recipe = create.json()
    assert recipe["recipe_id"].startswith("recipe_")
    assert recipe["input_variables_json"][0]["token"] == "{{user_prompt}}"
    assert recipe["custom_fields_json"][0]["key"] == "mood"
    assert recipe["validation_warnings"] == []

    get_response = client.get(f"/prompt-recipes/{recipe['recipe_id']}")
    assert get_response.status_code == 200
    assert get_response.json()["key"] == "alien_fortress_director"

    patch = client.patch(
        f"/prompt-recipes/{recipe['recipe_id']}",
        json={**recipe, "label": "Alien Fortress Prompt Director", "status": "inactive"},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["label"] == "Alien Fortress Prompt Director"
    assert patch.json()["status"] == "inactive"

    archive = client.delete(f"/prompt-recipes/{recipe['recipe_id']}")
    assert archive.status_code == 200
    assert archive.json()["status"] == "archived"
    list_response = client.get("/prompt-recipes")
    assert all(item["recipe_id"] != recipe["recipe_id"] for item in list_response.json())
    archived = client.get("/prompt-recipes?status=archived")
    assert any(item["recipe_id"] == recipe["recipe_id"] for item in archived.json())


def test_prompt_recipe_validation_rejects_duplicates_and_bad_tokens(client) -> None:
    first = client.post(
        "/prompt-recipes",
        json={
            "key": "duplicate_recipe",
            "label": "Duplicate Recipe",
            "category": "utility",
            "system_prompt_template": "Rewrite {{source_prompt}}.",
            "output_format": "single_prompt",
            "input_variables": [{"key": "source_prompt", "label": "Source Prompt", "enabled": True}],
        },
    )
    assert first.status_code == 200, first.text
    duplicate = client.post(
        "/prompt-recipes",
        json={
            "key": "duplicate_recipe",
            "label": "Duplicate Recipe 2",
            "category": "utility",
            "system_prompt_template": "Rewrite {{source_prompt}}.",
            "output_format": "single_prompt",
        },
    )
    assert duplicate.status_code == 400
    assert "already exists" in duplicate.text

    malformed = client.post(
        "/prompt-recipes",
        json={
            "key": "bad_token_recipe",
            "label": "Bad Token Recipe",
            "category": "utility",
            "system_prompt_template": "Rewrite {{Bad Token}}.",
            "output_format": "single_prompt",
        },
    )
    assert malformed.status_code == 400
    assert "Invalid prompt recipe variable token" in malformed.text


def test_prompt_recipe_validation_blocks_unknown_tokens_when_external_variables_disabled(client) -> None:
    response = client.post(
        "/prompt-recipes",
        json={
            "key": "strict_recipe",
            "label": "Strict Recipe",
            "category": "utility",
            "system_prompt_template": "Rewrite {{source_prompt}} and {{not_defined}}.",
            "output_format": "single_prompt",
            "input_variables": [{"key": "source_prompt", "label": "Source Prompt", "enabled": True}],
            "rules": {"allow_external_variables": False},
        },
    )
    assert response.status_code == 400
    assert "Unknown prompt recipe variables" in response.text


def test_prompt_recipe_returns_validation_warnings(client) -> None:
    response = client.post(
        "/prompt-recipes",
        json={
            "key": "warning_recipe",
            "label": "Warning Recipe",
            "category": "analysis",
            "system_prompt_template": "Analyze {{user_prompt}} and {{external_style}}.",
            "output_format": "image_analysis",
            "input_variables": [
                {"key": "user_prompt", "label": "User Prompt", "enabled": True},
                {"key": "source_prompt", "label": "Source Prompt", "enabled": True},
            ],
            "image_input": {
                "enabled": False,
                "required": False,
                "mode": "none",
                "analysis_variable": "image_analysis",
                "max_files": 0,
            },
            "rules": {"allow_external_variables": True},
        },
    )
    assert response.status_code == 200, response.text
    warnings = response.json()["validation_warnings"]
    assert any("source_prompt" in warning and "not used" in warning for warning in warnings)
    assert any("external_style" in warning and "external variables" in warning for warning in warnings)


def test_prompt_recipe_validation_blocks_broken_image_analysis_setup(client) -> None:
    response = client.post(
        "/prompt-recipes",
        json={
            "key": "broken_image_analysis_recipe",
            "label": "Broken Image Analysis Recipe",
            "category": "image",
            "system_prompt_template": "Use {{user_prompt}} and {{image_analysis}}.",
            "output_format": "single_prompt",
            "input_variables": [
                {"key": "user_prompt", "label": "User Prompt", "enabled": True},
                {"key": "image_analysis", "label": "Image Analysis", "enabled": True},
            ],
            "image_input": {
                "enabled": True,
                "required": True,
                "mode": "both",
                "analysis_variable": "image_analysis",
                "max_files": 1,
            },
        },
    )
    assert response.status_code == 400
    assert "Image Analysis Prompt" in response.text


def test_prompt_recipe_validation_blocks_image_reference_count_mismatch(client) -> None:
    response = client.post(
        "/prompt-recipes",
        json={
            "key": "image_reference_count_recipe",
            "label": "Image Reference Count Recipe",
            "category": "image",
            "system_prompt_template": "Use {{user_prompt}}, [image reference 1], and [image reference 2].",
            "image_analysis_prompt": "Describe the references.",
            "output_format": "single_prompt",
            "input_variables": [{"key": "user_prompt", "label": "User Prompt", "enabled": True}],
            "image_input": {
                "enabled": True,
                "required": True,
                "mode": "both",
                "analysis_variable": "image_analysis",
                "max_files": 1,
            },
        },
    )
    assert response.status_code == 400
    assert "image reference 2" in response.text


def test_prompt_recipe_validation_blocks_duplicate_select_options(client) -> None:
    response = client.post(
        "/prompt-recipes",
        json={
            "key": "duplicate_select_options_recipe",
            "label": "Duplicate Select Options Recipe",
            "category": "utility",
            "system_prompt_template": "Use {{user_prompt}} with {{mood}}.",
            "output_format": "single_prompt",
            "input_variables": [{"key": "user_prompt", "label": "User Prompt", "enabled": True}],
            "custom_fields": [
                {"key": "mood", "label": "Mood", "type": "select", "options": ["bright", "bright"]},
            ],
            "rules": {"allow_external_variables": False},
        },
    )
    assert response.status_code == 400
    assert "duplicate options" in response.text


def test_prompt_recipe_drafting_config_defaults_and_save(client) -> None:
    initial = client.get("/media/prompt-recipe-drafting-config")
    assert initial.status_code == 200, initial.text
    assert initial.json()["config_key"] == "prompt_recipe_drafting"
    assert initial.json()["enabled"] is True
    assert initial.json()["provider_kind"] == "openrouter"
    assert initial.json()["provider_model_id"] is None
    assert initial.json()["temperature"] == 0.2
    assert initial.json()["max_tokens"] == 1800

    update = client.patch(
        "/media/prompt-recipe-drafting-config",
        json={
            "enabled": False,
            "provider_kind": "openrouter",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "provider_label": "Qwen 3.5 35B",
            "provider_status": "connected",
            "temperature": 0.35,
            "max_tokens": 1600,
        },
    )
    assert update.status_code == 200, update.text
    config = update.json()
    assert config["enabled"] is False
    assert config["provider_model_id"] == "qwen/qwen3.5-35b-a3b"
    assert config["provider_label"] == "Qwen 3.5 35B"
    assert config["provider_status"] == "connected"
    assert config["temperature"] == 0.35
    assert config["max_tokens"] == 1600


def test_prompt_recipe_drafting_config_public_read_survives_local_provider_without_base_url(client, app_modules, monkeypatch) -> None:
    monkeypatch.setattr(app_modules["service"].settings, "local_openai_base_url", "")

    update = client.patch(
        "/media/prompt-recipe-drafting-config",
        json={
            "provider_kind": "local_openai",
            "provider_model_id": "local/model",
        },
    )
    assert update.status_code == 200, update.text
    assert update.json()["provider_kind"] == "local_openai"

    reload = client.get("/media/prompt-recipe-drafting-config")
    assert reload.status_code == 200, reload.text
    assert reload.json()["provider_kind"] == "local_openai"
    assert reload.json()["provider_model_id"] == "local/model"


def test_prompt_recipe_drafting_config_public_read_supports_codex_local(client) -> None:
    update = client.patch(
        "/media/prompt-recipe-drafting-config",
        json={
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_label": "GPT-5.4",
        },
    )
    assert update.status_code == 200, update.text
    assert update.json()["provider_kind"] == "codex_local"
    assert update.json()["provider_model_id"] == "gpt-5.4"
    assert update.json()["provider_credential_source"] == "codex_local_login"

    reload = client.get("/media/prompt-recipe-drafting-config")
    assert reload.status_code == 200, reload.text
    assert reload.json()["provider_kind"] == "codex_local"
    assert reload.json()["provider_credential_source"] == "codex_local_login"


def test_prompt_recipe_drafting_probe_supports_codex_local(client, app_modules, monkeypatch) -> None:
    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "load_codex_local_catalog",
        lambda **_: {
            "ok": True,
            "provider": "codex_local",
            "credential_source": "codex_local_login",
            "selected_model": {
                "id": "gpt-5.4",
                "label": "GPT-5.4",
                "provider": "codex_local",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {"billing_kind": "subscription"},
            },
            "available_models": [
                {
                    "id": "gpt-5.4",
                    "label": "GPT-5.4",
                    "provider": "codex_local",
                    "supports_images": True,
                    "input_modalities": ["text", "image"],
                    "raw": {"billing_kind": "subscription"},
                }
            ],
        },
    )

    response = client.post(
        "/media/prompt-recipe-drafting-config/probe",
        json={"provider_kind": "codex_local", "provider_model_id": "gpt-5.4", "require_images": False},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["provider"] == "codex_local"
    assert payload["credential_source"] == "codex_local_login"
    assert payload["selected_model"]["id"] == "gpt-5.4"


def test_enhancement_probe_ignores_stale_runtime_from_other_provider(client, app_modules, monkeypatch) -> None:
    update = client.patch(
        "/media/enhancement-configs/__studio_enhancement__",
        json={
            "model_key": "__studio_enhancement__",
            "label": "Studio enhancement",
            "helper_profile": "midctx-64k-no-thinking-q3-prefill",
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
            "provider_label": "gpt-5.4",
            "provider_base_url": "codex://app-server",
            "provider_supports_images": True,
            "provider_capabilities_json": {},
            "status": "active",
            "supports_text_enhancement": True,
            "supports_image_analysis": True,
            "system_prompt": "",
            "image_analysis_prompt": "",
            "notes": "",
        },
    )
    assert update.status_code == 200, update.text

    captured: dict[str, object] = {}

    def _fake_probe(**kwargs):
        captured.update(kwargs)
        return {
            "ok": True,
            "provider": "openrouter",
            "credential_source": "env",
            "selected_model": {
                "id": "openrouter/test-model",
                "label": "OpenRouter Test Model",
                "provider": "openrouter",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {},
            },
            "available_models": [
                {
                    "id": "openrouter/test-model",
                    "label": "OpenRouter Test Model",
                    "provider": "openrouter",
                    "supports_images": True,
                    "input_modalities": ["text", "image"],
                    "raw": {},
                }
            ],
        }

    monkeypatch.setattr(app_modules["service"].enhancement_provider, "test_openrouter_connection", _fake_probe)

    response = client.post(
        "/media/enhancement/providers/probe",
        json={"provider_kind": "openrouter", "model_key": "__studio_enhancement__", "require_images": False},
    )
    assert response.status_code == 200, response.text
    assert captured["base_url"] is None
    assert captured["api_key"] is None


def test_prompt_recipe_drafting_probe_ignores_stale_model_from_other_provider(client, app_modules, monkeypatch) -> None:
    client.patch(
        "/media/prompt-recipe-drafting-config",
        json={"provider_kind": "openrouter", "provider_model_id": "qwen/qwen3.5-35b-a3b"},
    )
    captured: dict[str, object] = {}

    def _fake_probe(**kwargs):
        captured.update(kwargs)
        return {
            "ok": True,
            "provider": "codex_local",
            "credential_source": "codex_local_login",
            "selected_model": {
                "id": "gpt-5.4",
                "label": "GPT-5.4",
                "provider": "codex_local",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {"billing_kind": "subscription"},
            },
            "available_models": [
                {
                    "id": "gpt-5.4",
                    "label": "GPT-5.4",
                    "provider": "codex_local",
                    "supports_images": True,
                    "input_modalities": ["text", "image"],
                    "raw": {"billing_kind": "subscription"},
                }
            ],
        }

    monkeypatch.setattr(app_modules["service"].enhancement_provider, "load_codex_local_catalog", _fake_probe)

    response = client.post(
        "/media/prompt-recipe-drafting-config/probe",
        json={"provider_kind": "codex_local", "require_images": False},
    )
    assert response.status_code == 200, response.text
    assert captured["model_id"] is None


def test_prompt_recipe_drafting_probe_returns_bad_request_for_provider_errors(client, app_modules, monkeypatch) -> None:
    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "load_codex_local_catalog",
        lambda **_: (_ for _ in ()).throw(app_modules["service"].enhancement_provider.EnhancementProviderError("Codex Local execution failed.")),
    )

    response = client.post(
        "/media/prompt-recipe-drafting-config/probe",
        json={"provider_kind": "codex_local", "require_images": False},
    )
    assert response.status_code == 400, response.text
    assert "Codex Local execution failed." in response.text


def test_shared_provider_catalog_probe_uses_shared_runtime(client, app_modules, monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_probe(**kwargs):
        captured.update(kwargs)
        return {
            "ok": True,
            "provider": "codex_local",
            "credential_source": "codex_local_login",
            "selected_model": {
                "id": "gpt-5.4",
                "label": "GPT-5.4",
                "provider": "codex_local",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {"billing_kind": "subscription"},
            },
            "available_models": [
                {
                    "id": "gpt-5.4",
                    "label": "GPT-5.4",
                    "provider": "codex_local",
                    "supports_images": True,
                    "input_modalities": ["text", "image"],
                    "raw": {"billing_kind": "subscription"},
                }
            ],
        }

    monkeypatch.setattr(app_modules["service"].enhancement_provider, "load_codex_local_catalog", _fake_probe)

    response = client.post(
        "/media/shared-provider-catalog/probe",
        json={"provider_kind": "codex_local", "selected_model_id": "gpt-5.4", "require_images": True},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["provider"] == "codex_local"
    assert payload["selected_model"]["id"] == "gpt-5.4"
    assert captured["model_id"] == "gpt-5.4"
    assert captured["require_images"] is True


def test_local_openai_provider_probes_return_bad_request_for_connection_failures(client, app_modules, monkeypatch) -> None:
    def _fail_local_openai(**_: object):
        raise app_modules["service"].enhancement_provider.EnhancementProviderError("Local model lookup failed: [Errno 61] Connection refused.")

    monkeypatch.setattr(app_modules["service"].enhancement_provider, "test_local_openai_connection", _fail_local_openai)

    enhancement_response = client.post(
        "/media/enhancement/providers/probe",
        json={
            "provider_kind": "local_openai",
            "model_key": "__studio_enhancement__",
            "base_url": "http://127.0.0.1:8080/v1",
            "require_images": False,
        },
    )
    assert enhancement_response.status_code == 400, enhancement_response.text
    assert "Local model lookup failed" in enhancement_response.text

    drafting_response = client.post(
        "/media/prompt-recipe-drafting-config/probe",
        json={
            "provider_kind": "local_openai",
            "provider_base_url": "http://127.0.0.1:8080/v1",
            "require_images": False,
        },
    )
    assert drafting_response.status_code == 400, drafting_response.text
    assert "Local model lookup failed" in drafting_response.text


def test_prompt_recipe_draft_requires_configured_model(client) -> None:
    response = client.post("/prompt-recipes/draft", json={"idea": "Create a cinematic video director recipe."})
    assert response.status_code == 400
    assert "Configure a Prompt Recipe Drafting model" in response.text


def test_prompt_recipe_draft_respects_disabled_setting(client) -> None:
    update = client.patch(
        "/media/prompt-recipe-drafting-config",
        json={
            "enabled": False,
            "provider_kind": "codex_local",
            "provider_model_id": "gpt-5.4",
        },
    )
    assert update.status_code == 200, update.text

    response = client.post("/prompt-recipes/draft", json={"idea": "Create a cinematic video director recipe."})
    assert response.status_code == 400
    assert "Recipe drafting is turned off in AI Settings." in response.text


def test_prompt_recipe_draft_uses_saved_default_and_validates_output(client, app_modules, monkeypatch) -> None:
    config_response = client.patch(
        "/media/prompt-recipe-drafting-config",
        json={
            "provider_kind": "openrouter",
            "provider_model_id": "openrouter/default-model",
            "temperature": 0.25,
            "max_tokens": 1700,
        },
    )
    assert config_response.status_code == 200, config_response.text

    captured: dict[str, object] = {}

    def _fake_generate(**kwargs):
        captured.update(kwargs)
        return {
            "label": "Alien Fortress Director",
            "key": "alien_fortress_director",
            "description": "Turns scene direction into one image prompt.",
            "category": "image",
            "system_prompt_template": "USER:\n{{user_prompt}}\nSTYLE:\n{{style_direction}}\nReturn only the final prompt.",
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract": {},
            "input_variables": [
                {"key": "user_prompt", "label": "User Prompt", "enabled": True, "required": True},
                {"key": "style_direction", "label": "Style Direction", "enabled": True, "required": False},
            ],
            "custom_fields": [],
            "image_input": {
                "enabled": False,
                "required": False,
                "mode": "none",
                "analysis_variable": "image_analysis",
                "max_files": 0,
            },
            "default_options": {"temperature": 0.3, "max_output_tokens": 1200},
            "rules": {"allow_external_variables": False, "return_only_final_output": True},
            "notes": "Generated from recipe drafting.",
        }

    monkeypatch.setattr(app_modules["service"].enhancement_provider, "run_openai_compatible_prompt_recipe_draft", _fake_generate)

    response = client.post(
        "/prompt-recipes/draft",
        json={
            "idea": "Create a director recipe that turns a user scene into one cinematic image prompt.",
            "category": "image",
            "output_format": "single_prompt",
            "image_input_mode": "none",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["key"] == "alien_fortress_director"
    assert payload["draft"]["status"] == "inactive"
    assert payload["drafting_model"]["provider_model_id"] == "openrouter/default-model"
    assert captured["model_id"] == "openrouter/default-model"
    assert captured["category"] == "image"
    assert captured["output_format"] == "single_prompt"


def test_prompt_recipe_draft_override_beats_saved_default(client, app_modules, monkeypatch) -> None:
    client.patch(
        "/media/prompt-recipe-drafting-config",
        json={"provider_kind": "openrouter", "provider_model_id": "openrouter/default-model"},
    )
    captured: dict[str, object] = {}

    def _fake_generate(**kwargs):
        captured.update(kwargs)
        return {
            "label": "Prompt Shortener",
            "key": "prompt_shortener_custom",
            "category": "utility",
            "system_prompt_template": "Rewrite {{source_prompt}}.",
            "output_format": "single_prompt",
            "input_variables": [{"key": "source_prompt", "label": "Source Prompt", "enabled": True, "required": True}],
            "custom_fields": [],
            "image_input": {"enabled": False, "required": False, "mode": "none", "analysis_variable": "image_analysis", "max_files": 0},
            "default_options": {},
            "rules": {"allow_external_variables": False, "return_only_final_output": True},
        }

    monkeypatch.setattr(app_modules["service"].enhancement_provider, "run_openai_compatible_prompt_recipe_draft", _fake_generate)

    response = client.post(
        "/prompt-recipes/draft",
        json={
            "idea": "Create a short prompt rewriting utility.",
            "provider_kind": "openrouter",
            "provider_model_id": "openrouter/override-model",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["drafting_model"]["provider_model_id"] == "openrouter/override-model"
    assert captured["model_id"] == "openrouter/override-model"


def test_prompt_recipe_draft_supports_codex_local_provider(client, app_modules, monkeypatch) -> None:
    client.patch(
        "/media/prompt-recipe-drafting-config",
        json={"provider_kind": "codex_local", "provider_model_id": "gpt-5.4"},
    )

    captured: dict[str, object] = {}

    def _fake_generate(**kwargs):
        captured.update(kwargs)
        return {
            "label": "Codex Prompt Director",
            "key": "codex_prompt_director",
            "category": "image",
            "system_prompt_template": "USER:\n{{user_prompt}}\nReturn the final prompt.",
            "output_format": "single_prompt",
            "input_variables": [{"key": "user_prompt", "label": "User Prompt", "enabled": True, "required": True}],
            "custom_fields": [],
            "image_input": {"enabled": False, "required": False, "mode": "none", "analysis_variable": "image_analysis", "max_files": 0},
            "default_options": {},
            "rules": {"allow_external_variables": False, "return_only_final_output": True},
        }

    monkeypatch.setattr(app_modules["service"].enhancement_provider, "run_codex_local_prompt_recipe_draft", _fake_generate)

    response = client.post("/prompt-recipes/draft", json={"idea": "Create a Codex-backed image director recipe."})
    assert response.status_code == 200, response.text
    assert response.json()["drafting_model"]["provider_kind"] == "codex_local"
    assert response.json()["drafting_model"]["provider_model_id"] == "gpt-5.4"
    assert captured["model_id"] == "gpt-5.4"


def test_prompt_recipe_draft_normalizes_loose_model_output(client, app_modules, monkeypatch) -> None:
    client.patch(
        "/media/prompt-recipe-drafting-config",
        json={"provider_kind": "openrouter", "provider_model_id": "openrouter/default-model"},
    )

    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "run_openai_compatible_prompt_recipe_draft",
        lambda **_: {
            "label": "Loose Director",
            "key": "loose_director",
            "category": "video",
            "system_prompt_template": "USER:\n{{user_prompt}}\nReturn JSON.",
            "output_format": "structured_shot_sequence",
            "input_variables_json": [
                {"name": "user prompt", "required": True},
                {"token": "{{shot_count}}"},
            ],
            "custom_fields": {},
            "rules": ["allow_external_variables", "return_only_final_output"],
            "default_options": [],
            "notes": ["Generated from Codex.", "Keep strict shot order."],
        },
    )

    response = client.post("/prompt-recipes/draft", json={"idea": "Create a loose draft."})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["draft"]["input_variables_json"][0]["key"] == "user_prompt"
    assert payload["draft"]["input_variables_json"][0]["label"] == "User Prompt"
    assert payload["draft"]["input_variables_json"][1]["key"] == "shot_count"
    assert payload["draft"]["rules_json"]["allow_external_variables"] is True
    assert payload["draft"]["custom_fields_json"] == []
    assert payload["draft"]["notes"] == "Generated from Codex.\nKeep strict shot order."


def test_prompt_recipe_draft_rejects_invalid_provider_payload(client, app_modules, monkeypatch) -> None:
    client.patch(
        "/media/prompt-recipe-drafting-config",
        json={"provider_kind": "openrouter", "provider_model_id": "openrouter/default-model"},
    )

    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "run_openai_compatible_prompt_recipe_draft",
        lambda **_: {"label": "Broken Draft", "key": "broken_draft"},
    )

    response = client.post("/prompt-recipes/draft", json={"idea": "Create a broken recipe."})
    assert response.status_code == 400
    assert "System prompt template is required" in response.text


def test_validate_and_submit_job(client) -> None:
    preset = client.post(
        "/media/presets",
        json={
            "key": "portrait-preset",
            "label": "Portrait Preset",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "applies_to_models": ["nano-banana-2"],
            "prompt_template": "Portrait of {{subject}} using [[ref]]",
            "input_schema_json": [{"key": "subject", "label": "Subject", "required": True}],
            "input_slots_json": [{"key": "ref", "label": "Ref", "required": True}],
        },
    ).json()

    assert preset["source_kind"] == "custom"
    assert preset["applies_to_models_json"] == ["nano-banana-2"]

    validate_response = client.post(
        "/media/validate",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "image_edit",
            "preset_id": preset["preset_id"],
            "preset_text_values": {"subject": "a studio portrait"},
            "preset_image_slots": {"ref": [{"path": "/tmp/ref.png"}]},
            "output_count": 2,
        },
    )
    assert validate_response.status_code == 200, validate_response.text

    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "image_edit",
            "preset_id": preset["preset_id"],
            "preset_text_values": {"subject": "a studio portrait"},
            "preset_image_slots": {"ref": [{"path": "/tmp/ref.png"}]},
            "output_count": 2,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    payload = submit_response.json()
    assert payload["batch"]["requested_outputs"] == 2
    assert len(payload["jobs"]) == 2


def test_gpt_image_to_image_preset_requires_image_slot_value(client) -> None:
    preset = client.post(
        "/media/presets",
        json={
            "key": "gpt-i2i-required-image",
            "label": "GPT I2I Required Image",
            "model_key": "gpt-image-2-image-to-image",
            "source_kind": "custom",
            "applies_to_models": ["gpt-image-2-image-to-image"],
            "prompt_template": "Use [[ref]] to create {{scene}}.",
            "input_schema_json": [{"key": "scene", "label": "Scene", "required": True}],
            "input_slots_json": [{"key": "ref", "label": "Ref", "required": True}],
        },
    ).json()

    validate_response = client.post(
        "/media/validate",
        json={
            "model_key": "gpt-image-2-image-to-image",
            "task_mode": "image_edit",
            "preset_id": preset["preset_id"],
            "preset_text_values": {"scene": "a studio portrait"},
            "preset_image_slots": {},
            "options": {"aspect_ratio": "4:3", "resolution": "1K"},
        },
    )
    assert validate_response.status_code == 400
    assert "Missing required preset image slot: ref" in validate_response.text


def test_single_batch_endpoint_includes_jobs(client) -> None:
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Batch detail contract check.",
            "output_count": 2,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    payload = submit_response.json()
    batch_id = payload["batch"]["batch_id"]

    detail_response = client.get(f"/media/batches/{batch_id}")
    assert detail_response.status_code == 200, detail_response.text
    detail = detail_response.json()
    assert detail["batch_id"] == batch_id
    assert len(detail["jobs"]) == 2
    assert {job["job_id"] for job in detail["jobs"]} == {job["job_id"] for job in payload["jobs"]}


def test_assets_endpoint_applies_server_side_filters(client, app_modules) -> None:
    store = app_modules["store"]
    store.create_or_update_asset(
        {
            "asset_id": "asset-image-1",
            "job_id": "job-image-1",
            "provider_task_id": "provider-image-1",
            "model_key": "nano-banana-2",
            "status": "completed",
            "generation_kind": "image",
            "preset_key": "preset-a",
            "favorited": True,
            "hero_thumb_path": "outputs/thumb-a.jpg",
            "created_at": "2026-04-04T01:00:00+00:00",
        }
    )
    store.create_or_update_asset(
        {
            "asset_id": "asset-video-1",
            "job_id": "job-video-1",
            "provider_task_id": "provider-video-1",
            "model_key": "kling-3.0-i2v",
            "status": "completed",
            "generation_kind": "video",
            "preset_key": "preset-b",
            "favorited": False,
            "hero_poster_path": "outputs/poster-a.jpg",
            "created_at": "2026-04-04T02:00:00+00:00",
        }
    )

    response = client.get(
        "/media/assets",
        params={
            "favorites": "true",
            "media_type": "image",
            "model_key": "nano-banana-2",
            "status": "completed",
            "preset_key": "preset-a",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["asset_id"] for item in payload["items"]] == ["asset-image-1"]


def test_kie_callback_rejects_unsigned_requests(client, unauthenticated_client, app_modules) -> None:
    store = app_modules["store"]
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Unsigned callback hardening check.",
            "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    job_id = submit_response.json()["jobs"][0]["job_id"]
    store.update_job(job_id, {"provider_task_id": "callback-task-unsigned"})

    response = unauthenticated_client.post(
        "/media/providers/kie/callback",
        json={"task_id": "callback-task-unsigned", "state": "succeeded", "output_urls": ["https://tempfile.aiquickdraw.com/out.jpeg"]},
    )
    assert response.status_code == 403
    assert "verification" in response.text.lower()


def test_kie_callback_accepts_valid_signed_requests(monkeypatch, client, app_modules) -> None:
    monkeypatch.setenv("KIE_WEBHOOK_SECRET", "test-webhook-secret")
    store = app_modules["store"]
    kie_adapter = app_modules["main"].kie_adapter
    callbacks = kie_adapter.importlib.import_module("kie_api.clients.callbacks")
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Signed callback hardening check.",
            "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    job_id = submit_response.json()["jobs"][0]["job_id"]
    store.update_job(job_id, {"provider_task_id": "callback-task-signed"})

    timestamp = str(int(time.time()))
    signature = callbacks.build_callback_signature("callback-task-signed", timestamp, "test-webhook-secret")
    callback_response = client.post(
        "/media/providers/kie/callback",
        headers={
            "X-Webhook-Timestamp": timestamp,
            "X-Webhook-Signature": signature,
        },
        json={
            "task_id": "callback-task-signed",
            "status": "succeeded",
            "output_urls": ["https://tempfile.aiquickdraw.com/out.jpeg"],
        },
    )
    assert callback_response.status_code == 200, callback_response.text
    assert callback_response.json()["ok"] is True

    updated_job = store.get_job(job_id)
    assert updated_job is not None
    assert updated_job["final_status_json"]["state"] == "succeeded"
    assert updated_job["final_status_json"]["output_urls"] == ["https://tempfile.aiquickdraw.com/out.jpeg"]


def test_publish_artifact_normalizes_image_extension(app_modules, tmp_path) -> None:
    service = app_modules["service"]
    image_path = tmp_path / "output.bin"
    image_path.write_bytes(b"\xff\xd8\xff\xe0" + b"test-image-payload")

    normalized = service._normalized_output_source_path(  # type: ignore[attr-defined]
        {"model_key": "nano-banana-2", "task_mode": "text_to_image"},
        image_path,
        None,
    )

    assert normalized.suffix == ".jpg"
    assert normalized.exists()
    assert not image_path.exists()


def test_validate_response_includes_total_pricing_summary(client) -> None:
    response = client.post(
        "/media/validate",
        json={
            "model_key": "kling-3.0-i2v",
            "task_mode": "image_to_video",
            "prompt": "A cinematic alleyway shot with rain and neon haze.",
            "images": [{"path": "/tmp/ref.png"}],
            "options": {"duration": 5, "sound": True, "mode": "std"},
            "output_count": 2,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    summary = payload["pricing_summary"]
    assert summary["output_count"] == 2
    assert summary["per_output"]["estimated_credits"] == pytest.approx(100.0, rel=1e-6)
    assert summary["total"]["estimated_credits"] == pytest.approx(200.0, rel=1e-6)
    assert summary["total"]["estimated_cost_usd"] == pytest.approx(1.0, rel=1e-6)


def test_queue_settings_update(client) -> None:
    response = client.patch("/media/queue/settings", json={"max_concurrent_jobs": 1})
    assert response.status_code == 200
    assert response.json()["max_concurrent_jobs"] == 1


def test_queue_settings_reject_out_of_bounds_values(client) -> None:
    too_low = client.patch("/media/queue/settings", json={"max_concurrent_jobs": 0})
    assert too_low.status_code == 422

    too_high = client.patch("/media/queue/settings", json={"default_poll_seconds": 301})
    assert too_high.status_code == 422

    retry_too_high = client.patch("/media/queue/settings", json={"max_retry_attempts": 11})
    assert retry_too_high.status_code == 422


def test_queue_policy_rejects_out_of_bounds_outputs(client) -> None:
    too_low = client.patch("/media/queue/policies/nano-banana-2", json={"max_outputs_per_run": 0})
    assert too_low.status_code == 422

    too_high = client.patch("/media/queue/policies/nano-banana-2", json={"max_outputs_per_run": 11})
    assert too_high.status_code == 422


def test_latest_asset_endpoint_returns_one_asset_record(client, app_modules) -> None:
    submit_response = client.post(
        "/media/jobs",
        json={
          "model_key": "nano-banana-2",
          "task_mode": "text_to_image",
          "prompt": "A cinematic sci-fi portrait in shallow depth of field.",
          "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    app_modules["runner"].runner.tick()

    latest_response = client.get("/media/assets/latest")
    assert latest_response.status_code == 200, latest_response.text
    payload = latest_response.json()
    assert payload["asset_id"]
    assert payload["job_id"]


def test_favorite_asset_accepts_json_body_false(client, app_modules) -> None:
    submit_response = client.post(
        "/media/jobs",
        json={
          "model_key": "nano-banana-2",
          "task_mode": "text_to_image",
          "prompt": "A cinematic western portrait with warm sunset haze.",
          "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    app_modules["runner"].runner.tick()
    latest_response = client.get("/media/assets/latest")
    assert latest_response.status_code == 200, latest_response.text
    asset = latest_response.json()

    favorite_on_response = client.post(f"/media/assets/{asset['asset_id']}/favorite", json={"favorited": True})
    assert favorite_on_response.status_code == 200, favorite_on_response.text
    assert favorite_on_response.json()["favorited"] is True

    favorite_off_response = client.post(f"/media/assets/{asset['asset_id']}/favorite", json={"favorited": False})
    assert favorite_off_response.status_code == 200, favorite_off_response.text
    assert favorite_off_response.json()["favorited"] is False


def test_create_fails_when_no_structured_image_model_scope_selected(client) -> None:
    response = client.post(
        "/media/presets",
        json={
            "key": "invalid-scope",
            "label": "Invalid Scope",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "applies_to_models": [],
            "prompt_template": "Portrait of [[subject]]",
            "input_schema_json": [],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True}],
        },
    )
    assert response.status_code == 400
    assert "Select at least one compatible image model" in response.text


def test_validate_fails_when_preset_scope_excludes_selected_model(client) -> None:
    preset = client.post(
        "/media/presets",
        json={
            "key": "nano2-only",
            "label": "Nano 2 Only",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "applies_to_models": ["nano-banana-2"],
            "prompt_template": "Portrait of [[subject]]",
            "input_schema_json": [],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True}],
        },
    ).json()

    response = client.post(
        "/media/validate",
        json={
            "model_key": "nano-banana-pro",
            "task_mode": "image_edit",
            "preset_id": preset["preset_id"],
            "preset_image_slots": {"subject": [{"path": "/tmp/ref.png"}]},
            "output_count": 1,
        },
    )
    assert response.status_code == 400
    assert "not available for the selected model" in response.text


def test_validate_accepts_legacy_web_preset_field_names(client) -> None:
    preset = client.post(
        "/media/presets",
        json={
            "key": "legacy-web-preset",
            "label": "Legacy Web Preset",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "applies_to_models": ["nano-banana-2"],
            "prompt_template": "Portrait of [[subject]] with {{style}} lighting",
            "input_schema_json": [{"key": "style", "label": "Style", "required": True}],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True}],
        },
    ).json()

    response = client.post(
        "/media/validate",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "image_edit",
            "preset_id": preset["preset_id"],
            "preset_inputs_json": {"style": "studio"},
            "preset_slot_values_json": {"subject": [{"path": "/tmp/ref.png"}]},
            "system_prompt_ids": ["prompt-1"],
            "output_count": 1,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["final_prompt"] == "Portrait of [image reference 1] with studio lighting"


def test_validate_structured_preset_numbers_image_references_across_slots(client) -> None:
    preset = client.post(
        "/media/presets",
        json={
            "key": "structured-preset-multi-image",
            "label": "Structured Preset Multi Image",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "applies_to_models": ["nano-banana-2"],
            "prompt_template": "Blend [[first]] with [[second]] and [[third]]",
            "input_schema_json": [],
            "input_slots_json": [
                {"key": "first", "label": "First", "required": True},
                {"key": "second", "label": "Second", "required": True},
                {"key": "third", "label": "Third", "required": False},
            ],
        },
    ).json()

    response = client.post(
        "/media/validate",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "image_edit",
            "preset_id": preset["preset_id"],
            "preset_slot_values_json": {
                "first": [{"path": "/tmp/first.png"}],
                "second": [{"path": "/tmp/second.png"}],
            },
            "output_count": 1,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["final_prompt"] == "Blend [image reference 1] with [image reference 2] and [[third]]"


def test_delete_preset_archives_instead_of_hard_delete(client) -> None:
    response = client.post(
        "/media/presets",
        json={
            "key": "archive-me",
            "label": "Archive Me",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "applies_to_models": ["nano-banana-2"],
            "prompt_template": "Portrait of [[subject]]",
            "input_schema_json": [],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True}],
        },
    )
    assert response.status_code == 200, response.text
    preset = response.json()

    archive_response = client.delete(f"/media/presets/{preset['preset_id']}")
    assert archive_response.status_code == 200, archive_response.text
    assert archive_response.json()["status"] == "archived"

    list_response = client.get("/media/presets")
    assert all(item["preset_id"] != preset["preset_id"] for item in list_response.json())


def test_runner_drains_queue_at_global_max_outputs(client, app_modules) -> None:
    client.patch("/media/queue/settings", json={"max_concurrent_jobs": 2})
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Blade Runner inspired neon archive district with chrome rain and off-world market lights.",
            "output_count": 10,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    payload = submit_response.json()
    batch_id = payload["batch"]["batch_id"]
    runner = app_modules["runner"].runner
    store = app_modules["store"]

    runner.tick()
    batch = store.get_batch(batch_id)
    assert batch["completed_count"] == 2
    assert batch["queued_count"] == 8
    assert batch["running_count"] == 0

    for _ in range(4):
        runner.tick()

    batch = store.get_batch(batch_id)
    assert batch["completed_count"] == 10
    assert batch["queued_count"] == 0
    assert batch["running_count"] == 0
    assert batch["status"] == "completed"
    assert len(store.list_assets(limit=20)) == 10


def test_enhancement_system_prompt_supports_user_prompt_placeholder(client, app_modules, monkeypatch) -> None:
    captured: dict[str, object] = {}
    original_runner = app_modules["service"].enhancement_provider.run_openai_compatible_enhancement

    def fake_run_openai_compatible_enhancement(**kwargs):
        messages = app_modules["service"].enhancement_provider._build_rewrite_messages(
            prompt=kwargs["prompt"],
            media_model_key=kwargs["media_model_key"],
            task_mode=kwargs["task_mode"],
            system_prompt=kwargs["system_prompt"],
            image_analysis_prompt=kwargs["image_analysis_prompt"],
            image_paths=kwargs["image_paths"],
        )
        captured["messages"] = messages
        return {
            "provider_kind": kwargs["provider_kind"],
            "provider_model_id": kwargs["model_id"],
            "provider_base_url": kwargs["base_url"],
            "enhanced_prompt": "enhanced",
            "final_prompt_used": "enhanced",
            "image_analysis": None,
            "warnings": [],
            "raw_response": {},
        }

    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "run_openai_compatible_enhancement",
        fake_run_openai_compatible_enhancement,
    )

    global_config = client.post(
        "/media/enhancement-configs",
        json={
            "model_key": "__studio_enhancement__",
            "label": "Studio enhancement",
            "provider_kind": "openrouter",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "provider_base_url": "https://openrouter.ai/api/v1",
            "provider_supports_images": True,
            "supports_text_enhancement": True,
            "supports_image_analysis": False,
        },
    )
    assert global_config.status_code == 200, global_config.text

    model_config = client.post(
        "/media/enhancement-configs",
        json={
            "model_key": "kling-3.0-t2v",
            "label": "Kling 3 helper",
            "system_prompt": "Enhance this Kling prompt carefully. User prompt: {user_prompt}",
            "supports_text_enhancement": True,
            "supports_image_analysis": False,
        },
    )
    assert model_config.status_code == 200, model_config.text

    response = client.post(
        "/media/enhance/preview",
        json={
            "model_key": "kling-3.0-t2v",
            "task_mode": "text_to_video",
            "prompt": "A woman walks through a neon market.",
            "output_count": 1,
        },
    )
    assert response.status_code == 200, response.text
    messages = captured["messages"]
    assert messages[0]["content"] == "Enhance this Kling prompt carefully. User prompt: A woman walks through a neon market."
    assert "{user_prompt}" not in messages[0]["content"]


def test_enhance_preview_uses_saved_openrouter_config(client, app_modules, monkeypatch) -> None:
    client.post(
        "/media/enhancement-configs",
        json={
            "model_key": "nano-banana-2",
            "label": "nano enhancement",
            "provider_kind": "openrouter",
            "provider_label": "OpenRouter.ai",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "provider_supports_images": True,
            "supports_text_enhancement": True,
            "supports_image_analysis": True,
            "system_prompt": "Rewrite the prompt.",
            "image_analysis_prompt": "Analyze the reference image.",
        },
    )

    def fake_enhancement(**kwargs):
        assert kwargs["provider_kind"] == "openrouter"
        assert kwargs["model_id"] == "qwen/qwen3.5-35b-a3b"
        assert kwargs["media_model_key"] == "nano-banana-2"
        assert kwargs["image_paths"] == ["/tmp/ref.png"]
        return {
            "provider_kind": "openrouter",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "enhanced_prompt": "enhanced neon portrait prompt",
            "final_prompt_used": "enhanced neon portrait prompt",
            "image_analysis": "reference image detected",
            "warnings": [],
        }

    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "run_openai_compatible_enhancement",
        fake_enhancement,
    )

    response = client.post(
        "/media/enhance/preview",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "image_edit",
            "prompt": "portrait in neon rain",
            "images": [{"path": "/tmp/ref.png"}],
            "enhance": True,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["provider_kind"] == "openrouter"
    assert payload["provider_model_id"] == "qwen/qwen3.5-35b-a3b"
    assert payload["enhanced_prompt"] == "enhanced neon portrait prompt"
    assert payload["image_analysis"] == "reference image detected"


def test_enhance_preview_uses_preview_prompt_policy_for_builtin_helper(client, app_modules, monkeypatch) -> None:
    captured: dict[str, object] = {}

    def fake_dry_run_prompt_enhancement(request):
        captured["prompt_policy"] = request.get("prompt_policy")
        captured["raw_prompt"] = request.get("raw_prompt")
        return {
            "enhanced_prompt": "built-in preview rewrite",
            "final_prompt_used": "built-in preview rewrite",
            "context": {"mode": "preview"},
            "warnings": [],
        }

    monkeypatch.setattr(
        app_modules["service"].kie_adapter,
        "dry_run_prompt_enhancement",
        fake_dry_run_prompt_enhancement,
    )

    response = client.post(
        "/media/enhance/preview",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "portrait in neon rain",
            "enhance": True,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert captured["prompt_policy"] == "preview"
    assert payload["enhanced_prompt"] == "built-in preview rewrite"
    assert payload["final_prompt_used"] == "built-in preview rewrite"


def test_enhance_preview_allows_prompt_only_when_text_and_image_support_are_enabled(client, app_modules, monkeypatch) -> None:
    client.post(
        "/media/enhancement-configs",
        json={
            "model_key": "nano-banana-2",
            "label": "nano enhancement",
            "provider_kind": "openrouter",
            "provider_label": "OpenRouter.ai",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "provider_supports_images": True,
            "supports_text_enhancement": True,
            "supports_image_analysis": True,
            "system_prompt": "Rewrite the prompt.",
            "image_analysis_prompt": "Analyze the reference image.",
        },
    )

    def fake_enhancement(**kwargs):
        assert kwargs["prompt"] == "portrait in neon rain"
        assert kwargs["image_paths"] == []
        return {
            "provider_kind": "openrouter",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "enhanced_prompt": "enhanced prompt-only portrait",
            "final_prompt_used": "enhanced prompt-only portrait",
            "image_analysis": None,
            "warnings": [],
        }

    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "run_openai_compatible_enhancement",
        fake_enhancement,
    )

    response = client.post(
        "/media/enhance/preview",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "image_edit",
            "prompt": "portrait in neon rain",
            "enhance": True,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["enhanced_prompt"] == "enhanced prompt-only portrait"
    assert payload["image_analysis"] is None


def test_enhance_preview_allows_image_only_when_image_support_is_enabled(client, app_modules, monkeypatch) -> None:
    client.post(
        "/media/enhancement-configs",
        json={
            "model_key": "nano-banana-2",
            "label": "nano enhancement",
            "provider_kind": "openrouter",
            "provider_label": "OpenRouter.ai",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "provider_supports_images": True,
            "supports_text_enhancement": False,
            "supports_image_analysis": True,
            "system_prompt": "Rewrite the prompt.",
            "image_analysis_prompt": "Analyze the reference image.",
        },
    )

    def fake_enhancement(**kwargs):
        assert kwargs["prompt"] == ""
        assert kwargs["image_paths"] == ["/tmp/ref.png"]
        return {
            "provider_kind": "openrouter",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "enhanced_prompt": "image-driven prompt",
            "final_prompt_used": "image-driven prompt",
            "image_analysis": "reference image detected",
            "warnings": [],
        }

    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "run_openai_compatible_enhancement",
        fake_enhancement,
    )

    response = client.post(
        "/media/enhance/preview",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "image_edit",
            "prompt": "",
            "images": [{"path": "/tmp/ref.png"}],
            "enhance": True,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["enhanced_prompt"] == "image-driven prompt"
    assert payload["image_analysis"] == "reference image detected"


def test_enhance_preview_resolves_reference_library_images_to_absolute_paths(client, app_modules, monkeypatch) -> None:
    client.post(
        "/media/enhancement-configs",
        json={
            "model_key": "kling-2.6-i2v",
            "label": "kling enhancement",
            "provider_kind": "openrouter",
            "provider_label": "OpenRouter.ai",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "provider_supports_images": True,
            "supports_text_enhancement": True,
            "supports_image_analysis": True,
            "system_prompt": "Rewrite the prompt.",
            "image_analysis_prompt": "Analyze the reference image.",
        },
    )

    reference_path = app_modules["main"].settings.data_root / "reference-media" / "images" / "enhance-ref.png"
    reference_path.parent.mkdir(parents=True, exist_ok=True)
    reference_path.write_bytes(b"png-bytes")
    reference = app_modules["store"].create_or_reuse_reference_media(
        {
            "kind": "image",
            "status": "active",
            "original_filename": "enhance-ref.png",
            "stored_path": "reference-media/images/enhance-ref.png",
            "mime_type": "image/png",
            "file_size_bytes": len(b"png-bytes"),
            "sha256": "enhance-ref-sha",
            "width": 768,
            "height": 1024,
            "duration_seconds": None,
            "thumb_path": None,
            "poster_path": None,
            "usage_count": 1,
            "metadata_json": {},
        },
        increment_usage=False,
    )

    def fake_enhancement(**kwargs):
        assert kwargs["prompt"] == "walk forward"
        assert kwargs["image_paths"] == [str(reference_path)]
        return {
            "provider_kind": "openrouter",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "enhanced_prompt": "enhanced walk forward",
            "final_prompt_used": "enhanced walk forward",
            "image_analysis": "reference image detected",
            "warnings": [],
        }

    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "run_openai_compatible_enhancement",
        fake_enhancement,
    )

    response = client.post(
        "/media/enhance/preview",
        json={
            "model_key": "kling-2.6-i2v",
            "task_mode": "image_to_video",
            "prompt": "walk forward",
            "images": [{"reference_id": reference["reference_id"]}],
            "enhance": True,
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["enhanced_prompt"] == "enhanced walk forward"
    assert payload["image_analysis"] == "reference image detected"


def test_enhance_preview_returns_timeout_error_when_provider_stalls(client, app_modules, monkeypatch) -> None:
    client.post(
        "/media/enhancement-configs",
        json={
            "model_key": "nano-banana-2",
            "label": "nano enhancement",
            "provider_kind": "openrouter",
            "provider_label": "OpenRouter.ai",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "provider_supports_images": False,
            "supports_text_enhancement": True,
            "supports_image_analysis": False,
        },
    )

    monkeypatch.setattr(app_modules["service"], "ENHANCEMENT_PROVIDER_TIMEOUT_SECONDS", 0.01)

    def slow_enhancement(**kwargs):
        time.sleep(0.05)
        return {
            "provider_kind": "openrouter",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "enhanced_prompt": "too late",
            "final_prompt_used": "too late",
            "image_analysis": None,
            "warnings": [],
        }

    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "run_openai_compatible_enhancement",
        slow_enhancement,
    )

    response = client.post(
        "/media/enhance/preview",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "portrait in neon rain",
            "enhance": True,
        },
    )
    assert response.status_code == 400, response.text
    assert "timed out" in response.text.lower()


def test_enhance_preview_rejects_unchanged_provider_output(client, app_modules, monkeypatch) -> None:
    client.post(
        "/media/enhancement-configs",
        json={
            "model_key": "nano-banana-2",
            "label": "nano enhancement",
            "provider_kind": "openrouter",
            "provider_label": "OpenRouter.ai",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "provider_supports_images": False,
            "supports_text_enhancement": True,
            "supports_image_analysis": False,
            "system_prompt": "Rewrite the prompt.",
        },
    )

    def noop_enhancement(**kwargs):
        prompt = kwargs["prompt"]
        return {
            "provider_kind": "openrouter",
            "provider_model_id": "qwen/qwen3.5-35b-a3b",
            "enhanced_prompt": prompt,
            "final_prompt_used": prompt,
            "image_analysis": None,
            "warnings": [],
        }

    monkeypatch.setattr(
        app_modules["service"].enhancement_provider,
        "run_openai_compatible_enhancement",
        noop_enhancement,
    )

    response = client.post(
        "/media/enhance/preview",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "portrait in neon rain",
            "enhance": True,
        },
    )
    assert response.status_code == 400, response.text
    assert "unchanged" in response.text.lower()


def test_dismissed_jobs_are_excluded_from_batch_responses(client, app_modules) -> None:
    store = app_modules["store"]

    batch, jobs = store.create_batch_and_jobs(
        {
            "model_key": "nano-banana-2",
            "status": "failed",
            "requested_outputs": 1,
        },
        [
            {
                "model_key": "nano-banana-2",
                "status": "failed",
                "raw_prompt": "failed prompt",
                "error": "provider failed",
            }
        ],
    )
    job_id = jobs[0]["job_id"]
    store.mark_job_dismissed(job_id)

    list_response = client.get("/media/batches")
    assert list_response.status_code == 200
    list_body = list_response.json()
    matching_batch = next((item for item in list_body["items"] if item["batch_id"] == batch["batch_id"]), None)
    assert matching_batch is not None
    assert matching_batch["jobs"] == []

    get_response = client.get(f"/media/batches/{batch['batch_id']}")
    assert get_response.status_code == 200
    get_body = get_response.json()
    assert get_body["jobs"] == []


def test_dismissed_assets_hide_completed_jobs_from_dashboard_lists(client, app_modules) -> None:
    store = app_modules["store"]

    batch, jobs = store.create_batch_and_jobs(
        {
            "model_key": "nano-banana-2",
            "status": "completed",
            "requested_outputs": 1,
            "completed_count": 1,
        },
        [
            {
                "model_key": "nano-banana-2",
                "status": "completed",
                "raw_prompt": "completed prompt",
                "finished_at": store.utcnow_iso(),
            }
        ],
    )
    job_id = jobs[0]["job_id"]
    asset = store.create_or_update_asset(
        {
            "job_id": job_id,
            "batch_id": batch["batch_id"],
            "model_key": "nano-banana-2",
            "generation_kind": "image",
            "status": "completed",
            "prompt_summary": "completed prompt",
            "hero_thumb_path": "outputs/thumb.png",
            "hero_original_path": "outputs/original.png",
        }
    )

    dismiss_response = client.post(f"/media/assets/{asset['asset_id']}/dismiss")
    assert dismiss_response.status_code == 200, dismiss_response.text
    assert dismiss_response.json()["dismissed"] is True

    refreshed_job = store.get_job(job_id)
    assert refreshed_job is not None
    assert refreshed_job["dismissed"] is True

    jobs_response = client.get("/media/jobs")
    assert jobs_response.status_code == 200, jobs_response.text
    assert all(item["job_id"] != job_id for item in jobs_response.json()["items"])

    batches_response = client.get("/media/batches")
    assert batches_response.status_code == 200, batches_response.text
    matching_batch = next((item for item in batches_response.json()["items"] if item["batch_id"] == batch["batch_id"]), None)
    assert matching_batch is not None
    assert matching_batch["jobs"] == []

    single_batch_response = client.get(f"/media/batches/{batch['batch_id']}")
    assert single_batch_response.status_code == 200, single_batch_response.text
    assert single_batch_response.json()["jobs"] == []


def test_reconcile_repairs_invalid_active_jobs(client, app_modules) -> None:
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Repair test prompt.",
            "output_count": 2,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    jobs = submit_response.json()["jobs"]
    store = app_modules["store"]
    runner = app_modules["runner"].runner

    store.update_job(jobs[0]["job_id"], {"status": "submitted", "provider_task_id": None, "queue_position": None})
    store.update_job(jobs[1]["job_id"], {"status": "running", "provider_task_id": None, "queue_position": None})

    runner.reconcile()

    repaired_a = store.get_job(jobs[0]["job_id"])
    repaired_b = store.get_job(jobs[1]["job_id"])
    assert repaired_a["status"] == "queued"
    assert repaired_b["status"] == "queued"
    assert repaired_a["queue_position"] is not None
    assert repaired_b["queue_position"] is not None


def test_retry_job_replays_original_request_shape(client, app_modules) -> None:
    store = app_modules["store"]
    service = app_modules["service"]

    source_dir = service.settings.data_root / "generated"
    source_dir.mkdir(parents=True, exist_ok=True)
    source_path = source_dir / "retry-source.png"
    source_path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    source_asset = store.create_or_update_asset(
        {
            "asset_id": "asset-retry-source-helper",
            "job_id": "job-retry-source-helper",
            "created_at": "2026-04-11T00:00:00+00:00",
            "model_key": "nano-banana-pro",
            "status": "completed",
            "generation_kind": "image",
            "prompt_summary": "retry source helper",
            "hero_original_path": str(Path("generated") / source_path.name),
        }
    )
    system_prompt = store.create_or_update_system_prompt(
        {
            "prompt_id": "prompt-retry-shared",
            "key": "retry-shared",
            "label": "Retry shared",
            "status": "active",
            "content": "Keep the lighting consistent.",
            "applies_to_models_json": ["nano-banana-pro"],
            "applies_to_task_modes_json": ["text_to_image"],
            "applies_to_input_patterns_json": ["multimodal_reference"],
        }
    )
    preset = store.create_or_update_preset(
        {
            "preset_id": "preset-retry-shared",
            "key": "retry-shared-preset",
            "label": "Retry shared preset",
            "description": "Preset used to verify retry fidelity.",
            "status": "active",
            "model_key": "nano-banana-pro",
            "source_kind": "custom",
            "applies_to_models_json": ["nano-banana-pro"],
            "applies_to_task_modes_json": ["text_to_image"],
            "applies_to_input_patterns_json": ["multimodal_reference"],
            "prompt_template": "Portrait of {{subject}} with [[subject_image]].",
            "system_prompt_template": "",
            "system_prompt_ids_json": [],
            "default_options_json": {"aspect_ratio": "3:4"},
            "rules_json": {},
            "requires_image": 0,
            "requires_video": 0,
            "requires_audio": 0,
            "input_schema_json": [{"key": "subject", "label": "Subject", "required": True}],
            "input_slots_json": [{"key": "subject_image", "label": "Subject image", "required": True}],
            "choice_groups_json": [],
            "version": "v1",
            "priority": 100,
        }
    )

    batch = {
        "batch_id": "batch-retry-helper",
        "request_summary_json": {
            "preset_text_values": {"subject": "A founder"},
            "preset_image_slots": {
                "subject_image": [{"path": "/tmp/preset-subject.png", "mime_type": "image/png"}]
            },
        },
    }
    job = {
        "job_id": "job-retry-helper",
        "batch_id": batch["batch_id"],
        "model_key": "nano-banana-pro",
        "task_mode": "text_to_image",
        "raw_prompt": "ignored raw prompt",
        "source_asset_id": source_asset["asset_id"],
        "requested_preset_key": preset["key"],
        "resolved_preset_key": preset["key"],
        "selected_system_prompt_ids_json": [system_prompt["prompt_id"]],
        "resolved_options_json": {"aspect_ratio": "3:4", "resolution": "2k"},
        "normalized_request_json": {
            "model_key": "nano-banana-pro",
            "task_mode": "text_to_image",
            "prompt": "Portrait of A founder with [1 image(s)].",
            "images": [
                {"path": str(source_path), "filename": source_path.name, "mime_type": "image/png"},
                {"path": "/tmp/direct-ref.png", "mime_type": "image/png", "role": "reference"},
                {"path": "/tmp/preset-subject.png", "mime_type": "image/png"},
            ],
            "videos": [],
            "audios": [],
            "options": {"aspect_ratio": "3:4", "resolution": "2k"},
            "prompt_policy": "off",
        },
    }

    replay = service.build_retry_submit_request(job, batch=batch)

    assert replay.model_key == "nano-banana-pro"
    assert replay.task_mode == "text_to_image"
    assert replay.prompt == "ignored raw prompt"
    assert replay.source_asset_id == source_asset["asset_id"]
    assert replay.preset_id == preset["preset_id"]
    assert replay.selected_system_prompt_ids == [system_prompt["prompt_id"]]
    assert replay.options == {"aspect_ratio": "3:4", "resolution": "2k"}
    assert replay.preset_text_values == {"subject": "A founder"}
    assert {key: [item.model_dump(exclude_none=True) for item in value] for key, value in replay.preset_image_slots.items()} == {
        "subject_image": [{"path": "/tmp/preset-subject.png", "mime_type": "image/png"}]
    }
    assert [item.model_dump(exclude_none=True) for item in replay.images] == [
        {"path": "/tmp/direct-ref.png", "mime_type": "image/png", "role": "reference"}
    ]
    assert replay.output_count == 1


def test_retry_job_replays_source_asset_request_shape(client, app_modules) -> None:
    store = app_modules["store"]
    service = app_modules["service"]

    source_dir = service.settings.data_root / "generated"
    source_dir.mkdir(parents=True, exist_ok=True)
    source_path = source_dir / "retry-source.png"
    source_path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    source_asset = store.create_or_update_asset(
        {
            "asset_id": "asset-retry-source",
            "job_id": "job-retry-source",
            "created_at": "2026-04-11T00:00:00+00:00",
            "model_key": "nano-banana-2",
            "status": "completed",
            "generation_kind": "image",
            "prompt_summary": "retry source",
            "hero_original_path": str(Path("generated") / source_path.name),
        }
    )

    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "image_edit",
            "prompt": "Use the selected source image.",
            "options": {"aspect_ratio": "1:1"},
            "source_asset_id": source_asset["asset_id"],
            "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    original_job = submit_response.json()["jobs"][0]

    retry_response = client.post(f"/media/jobs/{original_job['job_id']}/retry")
    assert retry_response.status_code == 200, retry_response.text
    retried_job = retry_response.json()["jobs"][0]

    assert retried_job["source_asset_id"] == source_asset["asset_id"]
    assert retried_job["normalized_request_json"] == original_job["normalized_request_json"]


def test_runner_resumes_existing_provider_task_without_resubmit(client, app_modules, monkeypatch) -> None:
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Resume provider task without duplicate submit.",
            "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    job = submit_response.json()["jobs"][0]
    store = app_modules["store"]
    runner = app_modules["runner"].runner

    store.update_job(job["job_id"], {"provider_task_id": "existing-task-123", "status": "queued"})

    def _raise_if_submit(*args, **kwargs):
        raise AssertionError("submit_request should not be called for an existing provider task")

    monkeypatch.setattr(app_modules["runner"].kie_adapter, "submit_request", _raise_if_submit)

    runner.tick()

    updated = store.get_job(job["job_id"])
    assert updated["status"] == "running"
    assert updated["provider_task_id"] == "existing-task-123"


def test_runner_fails_job_after_repeated_poll_errors(client, app_modules, monkeypatch) -> None:
    update = client.patch("/media/queue/settings", json={"max_retry_attempts": 2})
    assert update.status_code == 200, update.text

    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Trigger repeated poll failures.",
            "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    job = submit_response.json()["jobs"][0]
    store = app_modules["store"]
    runner = app_modules["runner"].runner
    monkeypatch.setattr(app_modules["runner"].settings, "media_enable_live_submit", True)
    monkeypatch.setattr(app_modules["runner"].settings, "kie_api_key", "test-kie-key")

    store.update_job(job["job_id"], {"provider_task_id": "broken-task-123", "status": "running"})

    def _raise_poll_error(*args, **kwargs):
        raise RuntimeError("provider timeout")

    monkeypatch.setattr(app_modules["runner"].kie_adapter, "poll_task", _raise_poll_error)

    runner.tick()
    after_first = store.get_job(job["job_id"])
    assert after_first["status"] == "running"
    assert after_first["error"] == "Poll failed: provider timeout"
    assert store.count_job_events(job["job_id"], "poll_error") == 1

    runner.tick()
    after_second = store.get_job(job["job_id"])
    assert after_second["status"] == "failed"
    assert after_second["error"] == "Poll failed: provider timeout"
    assert after_second["finished_at"] is not None
    assert store.count_job_events(job["job_id"], "poll_error") == 1
    failed_events = [event for event in store.list_job_events(job["job_id"]) if event["event_type"] == "failed"]
    assert any(event["payload_json"].get("reason") == "poll_error_retry_limit" for event in failed_events)


def test_finalize_job_is_idempotent_after_artifact_publish(client, app_modules, monkeypatch) -> None:
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Idempotent finalize test.",
            "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    job = submit_response.json()["jobs"][0]
    store = app_modules["store"]
    runner = app_modules["runner"].runner

    store.update_job(job["job_id"], {"provider_task_id": "task-idempotent-123", "status": "running"})

    def _fake_download(_url: str, destination: str) -> None:
        Path(destination).write_bytes(
          b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
          b"\x00\x00\x00\x0cIDAT\x08\x99c```\x00\x00\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB`\x82"
        )

    publish_calls = {"count": 0}
    original_publish = app_modules["runner"].service.publish_job_artifact

    def _count_publish(*args, **kwargs):
        publish_calls["count"] += 1
        return original_publish(*args, **kwargs)

    monkeypatch.setattr(app_modules["runner"].kie_adapter, "download_output_file", _fake_download)
    monkeypatch.setattr(app_modules["runner"].service, "publish_job_artifact", _count_publish)

    status = {"state": "succeeded", "output_urls": ["https://example.com/output.png"]}
    first = runner._finalize_job_from_status(store.get_job(job["job_id"]), status)
    second = runner._finalize_job_from_status(store.get_job(job["job_id"]), status)

    assert first["status"] == "completed"
    assert second["status"] == "completed"
    assert publish_calls["count"] == 1
    assert store.get_job(job["job_id"])["artifact_json"]


def test_finalize_suno_job_publishes_audio_tracks_with_cover_art(client, app_modules, monkeypatch) -> None:
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "suno-generate-music",
            "task_mode": "text_to_music",
            "prompt": "Instrumental deep house meets drum and bass techno.",
            "output_count": 1,
            "options": {"suno_model": "V5", "instrumental": True},
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    job = submit_response.json()["jobs"][0]
    store = app_modules["store"]
    runner = app_modules["runner"].runner

    store.update_job(job["job_id"], {"provider_task_id": "task-suno-multi-123", "status": "running"})

    def _fake_download(source_url: str, destination: str) -> None:
        if source_url.endswith(".mp3"):
            Path(destination).write_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x21test audio")
            return
        Path(destination).write_bytes(
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
            b"\x00\x00\x00\x0cIDAT\x08\x99c```\x00\x00\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB`\x82"
        )

    monkeypatch.setattr(app_modules["runner"].kie_adapter, "download_output_file", _fake_download)

    status = {
        "state": "succeeded",
        "output_urls": ["https://example.com/song-a.mp3", "https://example.com/song-b.mp3"],
        "raw_response": {
            "suno_output_metadata": [
                {
                    "audio_url": "https://example.com/song-a.mp3",
                    "image_url": "https://example.com/cover-a.png",
                    "title": "First track",
                },
                {
                    "audio_url": "https://example.com/song-b.mp3",
                    "image_url": "https://example.com/cover-b.png",
                    "title": "Second track",
                },
                {"image_url": "https://example.com/cover-shared.png", "title": "Shared cover"},
            ]
        },
    }
    updated = runner._finalize_job_from_status(store.get_job(job["job_id"]), status)

    assert updated["status"] == "completed"
    assets = store.get_assets_by_job_id(job["job_id"])
    assert [asset["generation_kind"] for asset in assets].count("audio") == 2
    assert [asset["generation_kind"] for asset in assets].count("image") == 0
    for asset in assets:
        assert asset["hero_thumb_path"]
        assert asset["hero_poster_path"]
        assert any(output.get("role") == "cover_image" for output in asset["payload_json"]["outputs"])
    assert store.deduplicate_assets_by_job_id() == 0
    events = [event for event in store.list_job_events(job["job_id"]) if event["event_type"] == "completed"]
    assert events[-1]["payload_json"]["audio_asset_ids"]
    assert events[-1]["payload_json"]["associated_cover_count"] == 2


def test_finalize_job_marks_failed_when_artifact_publish_fails(client, app_modules, monkeypatch) -> None:
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Artifact publish failure test.",
            "output_count": 1,
        },
    )
    assert submit_response.status_code == 200, submit_response.text
    job = submit_response.json()["jobs"][0]
    store = app_modules["store"]
    runner = app_modules["runner"].runner

    store.update_job(job["job_id"], {"provider_task_id": "task-publish-fail-123", "status": "running"})

    def _fake_download(_url: str, destination: str) -> None:
        Path(destination).write_bytes(b"not a real mp4")

    def _raise_publish_error(*args, **kwargs):
        raise RuntimeError("ffprobe is required for video derivative generation")

    monkeypatch.setattr(app_modules["runner"].kie_adapter, "download_output_file", _fake_download)
    monkeypatch.setattr(app_modules["runner"].service, "publish_job_artifact", _raise_publish_error)

    status = {"state": "succeeded", "output_urls": ["https://example.com/output.png"]}
    updated = runner._finalize_job_from_status(store.get_job(job["job_id"]), status)

    assert updated["status"] == "failed"
    assert updated["finished_at"] is not None
    assert updated["error"] == "Artifact publish failed: ffprobe is required for video derivative generation"
    assert store.count_job_events(job["job_id"], "artifact_publish_failed") == 1
    failed_events = [event for event in store.list_job_events(job["job_id"]) if event["event_type"] == "failed"]
    assert any(event["payload_json"].get("reason") == "artifact_publish_failed" for event in failed_events)
