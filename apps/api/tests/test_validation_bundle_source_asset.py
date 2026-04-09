from pathlib import Path


def test_source_asset_is_first_image_in_validation_bundle(app_modules) -> None:
    schemas = app_modules["schemas"]
    service = app_modules["service"]
    store = app_modules["store"]

    store.bootstrap_schema()
    generated_dir = service.settings.data_root / "generated"
    generated_dir.mkdir(parents=True, exist_ok=True)
    source_path = generated_dir / "selected-source.png"
    source_path.write_bytes(b"fake-png")

    asset = store.create_or_update_asset(
        {
            "asset_id": "asset-selected-source",
            "job_id": "job-selected-source",
            "created_at": "2026-04-09T00:00:00+00:00",
            "model_key": "nano-banana-2",
            "status": "completed",
            "generation_kind": "image",
            "prompt_summary": "Selected source asset",
            "hero_original_path": str(Path("generated") / source_path.name),
        }
    )

    request = schemas.ValidateRequest(
        model_key="nano-banana-2",
        task_mode="image_edit",
        prompt="Use the selected source image, not the stale attachment.",
        source_asset_id=asset["asset_id"],
        images=[schemas.MediaRefInput(path="/tmp/stale-ref.png", mime_type="image/png")],
    )

    bundle = service.build_validation_bundle(request)
    raw_request = bundle["raw_request"]

    assert raw_request["images"][0]["filename"] == source_path.name
    assert raw_request["images"][0]["path"] == str(source_path)
    assert raw_request["images"][1]["path"] == "/tmp/stale-ref.png"
