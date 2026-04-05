import pytest
import time


def test_media_routes_require_internal_control_token(unauthenticated_client) -> None:
    response = unauthenticated_client.get("/media/pricing")
    assert response.status_code == 403
    assert "control API token" in response.text


def test_health_endpoint(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["kie_api_repo_connected"] is True
    assert payload["kie_api_key_configured"] is False
    assert payload["live_submit_enabled"] is False
    assert payload["openrouter_api_key_configured"] is False
    assert payload["queue_enabled"] is True
    assert payload["runner_name"] == "Media Studio Runner"
    assert payload["runner_mode"] == "embedded"
    assert payload["runner_attached_to"] == "Media Studio API"
    assert payload["runner_process_name"] == "media-studio-runner"
    assert payload["runner_launch_mode"] == "manual"
    assert payload["runner_active"] is False
    assert payload["runner_health"] == "needs_attention"
    assert isinstance(payload["heartbeat_max_age_seconds"], int)


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


def test_seeded_shared_nano_presets_exist(client) -> None:
    response = client.get("/media/presets")
    assert response.status_code == 200
    presets = response.json()
    shared = {item["key"]: item for item in presets if item["key"] in {
        "3d-caricature-style-nano-banana",
        "selfie-with-movie-character-nano-banana",
    }}
    assert set(shared.keys()) == {
        "3d-caricature-style-nano-banana",
        "selfie-with-movie-character-nano-banana",
    }
    for preset in shared.values():
        assert sorted(preset["applies_to_models"]) == ["nano-banana-2", "nano-banana-pro"]
        assert sorted(preset["applies_to_models_json"]) == ["nano-banana-2", "nano-banana-pro"]


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


def test_create_fails_when_no_nano_model_scope_selected(client) -> None:
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
    assert "Select at least one Nano Banana model" in response.text


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
    assert payload["final_prompt"] == "Portrait of [1 image(s)] with studio lighting"


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


def test_runner_drains_queue_over_ten_outputs(client, app_modules) -> None:
    client.patch("/media/queue/settings", json={"max_concurrent_jobs": 2})
    submit_response = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "task_mode": "text_to_image",
            "prompt": "Blade Runner inspired neon archive district with chrome rain and off-world market lights.",
            "output_count": 12,
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
    assert batch["queued_count"] == 10
    assert batch["running_count"] == 0

    for _ in range(5):
        runner.tick()

    batch = store.get_batch(batch_id)
    assert batch["completed_count"] == 12
    assert batch["queued_count"] == 0
    assert batch["running_count"] == 0
    assert batch["status"] == "completed"
    assert len(store.list_assets(limit=20)) == 12


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
