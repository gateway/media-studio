from __future__ import annotations

import time


PNG_1X1_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _create_reference_image(app_modules) -> str:
    return _create_named_reference_image(app_modules, name="graph-source.png", sha="graph-source-hash")


def _create_named_reference_image(app_modules, *, name: str, sha: str | None = None) -> str:
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
            "sha256": sha or f"sha-{name}",
            "width": 1,
            "height": 1,
            "metadata_json": {},
        },
        increment_usage=False,
    )
    return record["reference_id"]


def test_graph_preset_render_validates_required_slots_and_runs(client, app_modules, monkeypatch) -> None:
    store = app_modules["store"]
    reference_id = _create_reference_image(app_modules)
    preset = store.create_or_update_preset(
        {
            "preset_id": "graph-preset-test",
            "key": "graph-preset-test",
            "label": "Graph Preset Test",
            "description": "Graph preset test",
            "status": "active",
            "model_key": "nano-banana-pro",
            "source_kind": "custom",
            "applies_to_models_json": ["nano-banana-pro"],
            "prompt_template": "Create a {{style}} editorial image from [[subject]].",
            "input_schema_json": [{"key": "style", "label": "Style", "required": True}],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True, "max_files": 1}],
            "default_options_json": {"aspect_ratio": "1:1"},
            "rules_json": {},
        }
    )
    missing_slot_workflow = {
        "schema_version": 1,
        "name": "Preset missing slot",
        "nodes": [
            {
                "id": "preset",
                "type": "preset.render",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "preset_id": preset["preset_id"],
                    "text__style": "cinematic",
                    "preset_model_key": "nano-banana-pro",
                    "option__aspect_ratio": "16:9",
                    "option__resolution": "4K",
                },
            }
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=missing_slot_workflow)
    assert created.status_code == 200, created.text
    invalid = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=missing_slot_workflow)
    assert invalid.status_code == 200, invalid.text
    assert invalid.json()["valid"] is False
    assert any(error["code"] == "missing_preset_image_slot" for error in invalid.json()["errors"])

    empty_loader_workflow = {
        "schema_version": 1,
        "name": "Preset empty connected loader",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {}},
            {
                "id": "preset",
                "type": "preset.render",
                "position": {"x": 320, "y": 0},
                "fields": {
                    "preset_id": preset["preset_id"],
                    "text__style": "cinematic",
                    "preset_model_key": "nano-banana-pro",
                    "option__aspect_ratio": "16:9",
                    "option__resolution": "4K",
                },
            },
        ],
        "edges": [
            {"id": "edge-load-preset", "source": "load", "source_port": "image", "target": "preset", "target_port": "slot__subject"},
        ],
    }
    created = client.post("/media/graph/workflows", json=empty_loader_workflow)
    assert created.status_code == 200, created.text
    invalid = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=empty_loader_workflow)
    assert invalid.status_code == 200, invalid.text
    assert invalid.json()["valid"] is False
    assert any(error["code"] == "missing_media_reference" for error in invalid.json()["errors"])
    assert not any(warning["code"] == "empty_optional_media_input" for warning in invalid.json()["warnings"])

    muted_slot_workflow = {
        "schema_version": 1,
        "name": "Preset muted slot",
        "nodes": [
                {
                    "id": "load",
                    "type": "media.load_image",
                    "position": {"x": 0, "y": 0},
                    "fields": {"reference_id": reference_id},
                    "metadata": {"execution": {"mode": "muted"}},
                },
                {
                    "id": "preset",
                    "type": "preset.render",
                    "position": {"x": 320, "y": 0},
                    "fields": {
                        "preset_id": preset["preset_id"],
                        "text__style": "cinematic",
                        "preset_model_key": "nano-banana-pro",
                        "option__aspect_ratio": "16:9",
                        "option__resolution": "4K",
                    },
                },
        ],
        "edges": [
            {"id": "edge-load-preset", "source": "load", "source_port": "image", "target": "preset", "target_port": "slot__subject"},
        ],
    }
    created = client.post("/media/graph/workflows", json=muted_slot_workflow)
    assert created.status_code == 200, created.text
    invalid = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=muted_slot_workflow)
    assert invalid.status_code == 200, invalid.text
    assert invalid.json()["valid"] is False
    assert any(error["code"] == "missing_preset_image_slot" for error in invalid.json()["errors"])

    workflow = {
        "schema_version": 1,
        "name": "Preset render",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "preset",
                "type": "preset.render",
                "position": {"x": 320, "y": 0},
                "fields": {
                    "preset_id": preset["preset_id"],
                    "text__style": "cinematic",
                    "preset_model_key": "nano-banana-pro",
                    "option__aspect_ratio": "16:9",
                    "option__resolution": "4K",
                },
            },
            {"id": "save", "type": "media.save_image", "position": {"x": 720, "y": 0}, "fields": {"label": "Preset final"}},
        ],
        "edges": [],
    }
    workflow["edges"] = [
        {"id": "edge-load-preset", "source": "load", "source_port": "image", "target": "preset", "target_port": "slot__subject"},
        {"id": "edge-preset-save", "source": "preset", "source_port": "image", "target": "save", "target_port": "image"},
    ]
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True

    captured_options = []
    captured_text_values = []
    original_build_validation_bundle = app_modules["service"].build_validation_bundle

    def capture_build_validation_bundle(request):
        captured_options.append(dict(request.options or {}))
        captured_text_values.append(dict(request.preset_text_values or {}))
        return original_build_validation_bundle(request)

    monkeypatch.setattr(app_modules["service"], "build_validation_bundle", capture_build_validation_bundle)

    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]
    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    assert captured_options
    assert captured_options[-1]["aspect_ratio"] == "16:9"
    assert captured_options[-1]["resolution"] == "4K"
    assert captured_text_values[-1]["style"] == "cinematic"
    preset_node = next(node for node in final_payload["nodes"] if node["node_id"] == "preset")
    assert preset_node["metrics_json"]["preset_image_ref_count"] == 1
    assert "image" in preset_node["output_snapshot_json"]


def test_graph_dynamic_preset_node_renders_fields_and_slots(client, app_modules) -> None:
    store = app_modules["store"]
    reference_id = _create_reference_image(app_modules)
    second_reference_id = _create_named_reference_image(app_modules, name="graph-source-second.png", sha="graph-source-second-hash")
    preset = store.create_or_update_preset(
        {
            "preset_id": "graph-dynamic-preset-test",
            "key": "graph-dynamic-preset-test",
            "label": "Graph Dynamic Preset Test",
            "description": "Graph dynamic preset test",
            "status": "active",
            "model_key": "nano-banana-pro",
            "source_kind": "custom",
            "applies_to_models_json": ["nano-banana-pro"],
            "prompt_template": "Create a {{style}} portrait from [[subject]].",
            "input_schema_json": [{"key": "style", "label": "Style", "required": True}],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True, "max_files": 3}],
            "default_options_json": {},
            "rules_json": {},
        }
    )
    definitions = client.post("/media/graph/node-definitions/refresh").json()["items"]
    dynamic_definition = next(item for item in definitions if item["type"] == "preset.render")
    assert not any(item["type"].startswith("preset.render.") for item in definitions)
    assert dynamic_definition["source"]["kind"] == "media_preset"
    assert dynamic_definition["source"]["lazy_catalog"] is True
    assert dynamic_definition["source"]["search_endpoint"] == "/api/control/media-presets"
    assert dynamic_definition["source"]["detail_endpoint"] == "/api/control/media-presets/{preset_id}"
    option_fields = dynamic_definition["source"]["model_option_fields_by_model"]["nano-banana-pro"]
    option_field_ids = {field["id"] for field in option_fields}
    assert "option__aspect_ratio" in option_field_ids
    assert "option__resolution" in option_field_ids
    preset_picker = next(field for field in dynamic_definition["fields"] if field["id"] == "preset_id")
    assert preset_picker["options"] == []
    model_picker = next(field for field in dynamic_definition["fields"] if field["id"] == "preset_model_key")
    assert any(option["value"] == "nano-banana-pro" for option in model_picker["options"])
    assert not any(field["id"].startswith("text__") for field in dynamic_definition["fields"])
    subject_port = next(port for port in dynamic_definition["ports"]["inputs"] if port["id"] == "slot__subject")
    assert subject_port["visible_if"]["field"] == "preset_id"
    assert preset["preset_id"] in subject_port["visible_if"]["in"]
    assert subject_port["max"] >= 3
    assert any(port["id"] == "image" and port["type"] == "image" for port in dynamic_definition["ports"]["outputs"])
    assert not any(port["id"] in {"prompt", "image_refs", "preset"} for port in dynamic_definition["ports"]["outputs"])

    workflow = {
        "schema_version": 1,
        "name": "Dynamic preset",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {"id": "load-2", "type": "media.load_image", "position": {"x": 0, "y": 180}, "fields": {"reference_id": second_reference_id}},
            {
                "id": "preset",
                "type": "preset.render",
                "position": {"x": 320, "y": 0},
                "fields": {"preset_id": preset["preset_id"], "preset_model_key": "nano-banana-pro", "text__style": "cinematic"},
            },
            {"id": "save", "type": "media.save_image", "position": {"x": 700, "y": 0}, "fields": {"label": "Dynamic preset final"}},
        ],
        "edges": [
            {"id": "edge-load-preset", "source": "load", "source_port": "image", "target": "preset", "target_port": "slot__subject"},
            {"id": "edge-load-2-preset", "source": "load-2", "source_port": "image", "target": "preset", "target_port": "slot__subject"},
            {"id": "edge-preset-save", "source": "preset", "source_port": "image", "target": "save", "target_port": "image"},
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
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    preset_node = next(node for node in final_payload["nodes"] if node["node_id"] == "preset")
    assert preset_node["metrics_json"]["preset_image_ref_count"] == 2
    assert "image" in preset_node["output_snapshot_json"]
    save_node = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    assert save_node["output_snapshot_json"]["image"][0]["asset_id"]
