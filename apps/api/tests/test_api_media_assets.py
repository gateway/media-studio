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
            "payload_json": {"outputs": [{"width": 1024, "height": 1024}], "large": "detail-only"},
            "artifact_run_dir": "/tmp/detail-only-run",
            "manifest_path": "/tmp/detail-only-manifest.json",
            "run_json_path": "/tmp/detail-only-run.json",
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
            "payload_json": {"outputs": [{"duration_seconds": 5.25, "width": 1280, "height": 720}]},
            "created_at": "2026-04-04T02:00:00+00:00",
        }
    )
    store.create_or_update_asset(
        {
            "asset_id": "asset-audio-1",
            "job_id": "job-audio-1",
            "provider_task_id": "provider-audio-1",
            "model_key": "music-generator",
            "status": "completed",
            "generation_kind": "audio",
            "preset_key": "preset-c",
            "favorited": False,
            "hero_original_path": "outputs/audio-a.wav",
            "created_at": "2026-04-04T03:00:00+00:00",
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
    assert payload["items"][0]["payload_json"]["large"] == "detail-only"
    assert payload["items"][0]["artifact_run_dir"] == "/tmp/detail-only-run"
    assert payload["items"][0]["manifest_path"] == "/tmp/detail-only-manifest.json"
    assert payload["items"][0]["run_json_path"] == "/tmp/detail-only-run.json"
    assert payload["items"][0]["width"] == 1024
    assert payload["items"][0]["height"] == 1024

    compact_response = client.get(
        "/media/assets",
        params={
            "favorites": "true",
            "media_type": "image",
            "model_key": "nano-banana-2",
            "status": "completed",
            "preset_key": "preset-a",
            "compact": "true",
        },
    )
    assert compact_response.status_code == 200, compact_response.text
    compact_payload = compact_response.json()
    assert [item["asset_id"] for item in compact_payload["items"]] == ["asset-image-1"]
    assert compact_payload["items"][0]["width"] == 1024
    assert compact_payload["items"][0]["height"] == 1024
    assert compact_payload["items"][0]["payload_json"] == {}
    assert compact_payload["items"][0]["artifact_run_dir"] is None
    assert compact_payload["items"][0]["manifest_path"] is None
    assert compact_payload["items"][0]["run_json_path"] is None

    video_response = client.get(
        "/media/assets",
        params={
            "media_type": "video",
            "status": "completed",
            "compact": "true",
        },
    )
    assert video_response.status_code == 200, video_response.text
    video_payload = video_response.json()
    assert [item["asset_id"] for item in video_payload["items"]] == [
        "asset-video-1"
    ]
    assert video_payload["items"][0]["duration_seconds"] == 5.25
    assert video_payload["items"][0]["payload_json"] == {}

    audio_response = client.get(
        "/media/assets",
        params={
            "media_type": "audio",
            "status": "completed",
            "compact": "true",
        },
    )
    assert audio_response.status_code == 200, audio_response.text
    audio_payload = audio_response.json()
    assert [item["asset_id"] for item in audio_payload["items"]] == [
        "asset-audio-1"
    ]
    assert audio_payload["items"][0]["generation_kind"] == "audio"


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
