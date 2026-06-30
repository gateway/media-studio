from __future__ import annotations

import time


PNG_1X1_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _create_reference_image(app_modules) -> str:
    data_root = app_modules["main"].settings.data_root
    target = data_root / "reference-media" / "images" / "graph-source.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(PNG_1X1_BYTES)
    record = app_modules["store"].create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": "graph-source.png",
            "stored_path": "reference-media/images/graph-source.png",
            "mime_type": "image/png",
            "file_size_bytes": len(PNG_1X1_BYTES),
            "sha256": "graph-source-hash",
            "width": 1,
            "height": 1,
            "metadata_json": {},
        },
        increment_usage=False,
    )
    return record["reference_id"]


def test_graph_image_resize_and_metadata_run_sync(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = {
        "schema_version": 1,
        "name": "Resize utility",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "resize",
                "type": "image.transform",
                "position": {"x": 320, "y": 0},
                "fields": {"operation": "resize", "width": 4, "height": 3, "fit": "stretch", "format": "png"},
            },
            {"id": "metadata", "type": "debug.metadata", "position": {"x": 680, "y": 0}, "fields": {}},
            {"id": "preview", "type": "preview.image", "position": {"x": 680, "y": 260}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-load-resize", "source": "load", "source_port": "image", "target": "resize", "target_port": "image"},
            {"id": "edge-resize-metadata", "source": "resize", "source_port": "image", "target": "metadata", "target_port": "image"},
            {"id": "edge-resize-preview", "source": "resize", "source_port": "image", "target": "preview", "target_port": "image"},
        ],
    }

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True

    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]
    final_payload = None
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    resize_output = final_payload["nodes"][1]["output_snapshot_json"]["image"][0]
    resized_reference = app_modules["store"].get_reference_media(resize_output["reference_id"])
    assert resized_reference["width"] == 4
    assert resized_reference["height"] == 3
    assert final_payload["nodes"][1]["metrics_json"]["utility_processing_duration_seconds"] >= 0


def test_graph_image_crop_pad_convert_and_extract_metadata_run_sync(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = {
        "schema_version": 1,
        "name": "Image utility chain",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {"id": "pad", "type": "image.transform", "position": {"x": 280, "y": 0}, "fields": {"operation": "pad", "width": 4, "height": 4, "color": "#000000", "format": "png"}},
            {"id": "crop", "type": "image.transform", "position": {"x": 560, "y": 0}, "fields": {"operation": "crop", "x": 0, "y": 0, "width": 2, "height": 2, "format": "png"}},
            {"id": "convert", "type": "image.transform", "position": {"x": 840, "y": 0}, "fields": {"operation": "convert_format", "format": "webp"}},
            {"id": "metadata", "type": "image.transform", "position": {"x": 1120, "y": 0}, "fields": {"operation": "extract_metadata"}},
        ],
        "edges": [
            {"id": "edge-load-pad", "source": "load", "source_port": "image", "target": "pad", "target_port": "image"},
            {"id": "edge-pad-crop", "source": "pad", "source_port": "image", "target": "crop", "target_port": "image"},
            {"id": "edge-crop-convert", "source": "crop", "source_port": "image", "target": "convert", "target_port": "image"},
            {"id": "edge-convert-metadata", "source": "convert", "source_port": "image", "target": "metadata", "target_port": "image"},
        ],
    }

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]
    final_payload = None
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    metadata_node = next(node for node in final_payload["nodes"] if node["node_id"] == "metadata")
    assert metadata_node["output_snapshot_json"]["metadata"][0]["value"]["width"] == 2
    assert metadata_node["output_snapshot_json"]["metadata"][0]["value"]["height"] == 2


def test_graph_node_definitions_auto_invalidate_after_prompt_recipe_save(client) -> None:
    initial = client.get("/media/graph/node-definitions")
    assert initial.status_code == 200, initial.text

    created = client.post(
        "/prompt-recipes",
        json={
            "key": "auto_refresh_prompt_recipe",
            "label": "Auto Refresh Prompt Recipe",
            "description": "Created after the definition cache was primed.",
            "category": "utility",
            "status": "active",
            "system_prompt_template": "Turn {{user_prompt}} into one stronger prompt.",
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text"},
            "input_variables": [{"key": "user_prompt", "label": "User Prompt", "enabled": True, "required": True, "default_value": "", "description": ""}],
            "custom_fields": [],
            "image_input": {"enabled": False, "required": False, "mode": "none", "analysis_variable": "image_analysis", "max_files": 0},
            "default_options_json": {"temperature": 0.2, "max_output_tokens": 800},
            "rules_json": {"allow_external_variables": True, "return_only_final_output": True},
            "notes": "",
            "source_kind": "custom",
            "version": "1",
            "priority": 0,
        },
    )
    assert created.status_code == 200, created.text

    refreshed = client.get("/media/graph/node-definitions")
    assert refreshed.status_code == 200, refreshed.text
    prompt_definition = next(item for item in refreshed.json()["items"] if item["type"] == "prompt.recipe")
    recipe_picker = next(field for field in prompt_definition["fields"] if field["id"] == "recipe_id")
    assert any(option["label"] == "Auto Refresh Prompt Recipe" for option in recipe_picker["options"])


def test_graph_node_definitions_auto_invalidate_after_preset_save(client) -> None:
    initial = client.get("/media/graph/node-definitions")
    assert initial.status_code == 200, initial.text

    created = client.post(
        "/media/presets",
        json={
            "key": "auto-refresh-preset",
            "label": "Auto Refresh Preset",
            "description": "Created after the definition cache was primed.",
            "status": "active",
            "model_key": "nano-banana-2",
            "source_kind": "custom",
            "applies_to_models": ["nano-banana-2"],
            "applies_to_task_modes": [],
            "applies_to_input_patterns": [],
            "prompt_template": "Create a {{style}} portrait from [[subject]].",
            "system_prompt_template": "",
            "default_options_json": {},
            "input_schema_json": [{"key": "style", "label": "Style", "required": True}],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True, "max_files": 1}],
            "thumbnail_path": None,
            "thumbnail_url": None,
            "notes": "",
            "requires_image": True,
            "requires_video": False,
            "requires_audio": False,
        },
    )
    assert created.status_code == 200, created.text

    refreshed = client.get("/media/graph/node-definitions")
    assert refreshed.status_code == 200, refreshed.text
    definitions = refreshed.json()["items"]
    dynamic_definition = next(item for item in definitions if item["type"] == "preset.render")
    assert dynamic_definition["source"]["kind"] == "media_preset"
    assert dynamic_definition["source"]["lazy_catalog"] is True
    assert dynamic_definition["source"]["search_endpoint"] == "/api/control/media-presets"
    preset_picker = next(field for field in dynamic_definition["fields"] if field["id"] == "preset_id")
    assert preset_picker["options"] == []
    assert not any(field["id"].startswith("text__") for field in dynamic_definition["fields"])
    subject_port = next(port for port in dynamic_definition["ports"]["inputs"] if port["id"] == "slot__subject")
    assert created.json()["preset_id"] in subject_port["visible_if"]["in"]
    assert any(port["id"] == "image" and port["type"] == "image" for port in dynamic_definition["ports"]["outputs"])
    assert not any(port["id"] in {"prompt", "image_refs", "preset"} for port in dynamic_definition["ports"]["outputs"])
