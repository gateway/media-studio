from __future__ import annotations

import time
from pathlib import Path

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


def _workflow(reference_id: str) -> dict:
    return {
        "schema_version": 1,
        "name": "Graph smoke",
        "nodes": [
            {
                "id": "load",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": reference_id},
            },
            {
                "id": "model",
                "type": "model.kie.nano_banana_pro",
                "position": {"x": 360, "y": 0},
                "fields": {"prompt": "Create a cinematic editorial image.", "resolution": "1K"},
            },
            {
                "id": "save",
                "type": "media.save_image",
                "position": {"x": 760, "y": 0},
                "fields": {"label": "Final"},
            },
        ],
        "edges": [
            {"id": "edge-load-model", "source": "load", "source_port": "image", "target": "model", "target_port": "image_refs"},
            {"id": "edge-model-save", "source": "model", "source_port": "image", "target": "save", "target_port": "image"},
        ],
    }


def test_graph_node_definitions_include_first_slice_nodes(client) -> None:
    response = client.get("/media/graph/node-definitions")
    assert response.status_code == 200, response.text
    node_types = {item["type"] for item in response.json()["items"]}
    assert {"media.load_image", "model.kie.nano_banana_pro", "media.save_image"}.issubset(node_types)


def test_graph_validation_rejects_invalid_connections(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    workflow["edges"][0]["source_port"] = "missing"

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    workflow_id = created.json()["workflow_id"]

    response = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is False
    assert any(error["code"] == "missing_source_port" for error in payload["errors"])


def test_graph_validation_detects_cycles(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    workflow["edges"].append({"id": "cycle", "source": "save", "source_port": "asset", "target": "model", "target_port": "image_refs"})

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)

    assert response.status_code == 200, response.text
    assert any(error["code"] == "cycle_detected" for error in response.json()["errors"])


def test_graph_load_image_nano_save_runs_offline_and_creates_asset(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    create_response = client.post("/media/graph/workflows", json=_workflow(reference_id))
    assert create_response.status_code == 200, create_response.text
    workflow_id = create_response.json()["workflow_id"]

    run_response = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
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
    events = client.get(f"/media/graph/runs/{run_id}/events").json()["items"]
    assert any(event["event_type"] == "run.completed" for event in events)
    assets = app_modules["store"].list_assets(limit=20)
    assert any(asset["model_key"] == "nano-banana-pro" for asset in assets)
