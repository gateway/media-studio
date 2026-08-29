from __future__ import annotations

import importlib


def test_workflow_collection_reuses_catalogs_while_preserving_normalization(client, monkeypatch) -> None:
    routes = importlib.import_module("app.graph.routes")
    stored_workflow = {
        "workflow_id": "graphwf-listing",
        "name": "Saved graph",
        "description": None,
        "status": "active",
        "schema_version": 1,
        "workflow_json": {
            "schema_version": 1,
            "workflow_id": "graphwf-listing",
            "name": "Saved graph",
            "nodes": [
                {"id": "image", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {}},
                {"id": "video", "type": "model.kie.seedance_2_0", "position": {"x": 320, "y": 0}, "fields": {}},
            ],
            "edges": [
                {"id": "legacy", "source": "image", "source_port": "image", "target": "video", "target_port": "image_refs"}
            ],
        },
        "created_at": "2026-08-29T00:00:00+00:00",
        "updated_at": "2026-08-29T00:00:00+00:00",
    }
    monkeypatch.setattr(routes.store, "list_graph_workflows", lambda: [stored_workflow, {**stored_workflow, "workflow_id": "graphwf-listing-2"}])
    counts = {"recipes": 0, "presets": 0}
    original_recipes = routes.prompt_recipe_catalog
    original_presets = routes.media_preset_catalog

    def counted_recipes(*, status):
        counts["recipes"] += 1
        return original_recipes(status=status)

    def counted_presets(*, status):
        counts["presets"] += 1
        return original_presets(status=status)

    monkeypatch.setattr(routes, "prompt_recipe_catalog", counted_recipes)
    monkeypatch.setattr(routes, "media_preset_catalog", counted_presets)

    response = client.get("/media/graph/workflows")

    assert response.status_code == 200
    assert counts == {"recipes": 1, "presets": 1}
    items = response.json()["items"]
    assert len(items) == 2
    assert items[0]["workflow_json"]["edges"][0]["target_port"] == "reference_images"
    assert items[1]["workflow_json"]["workflow_id"] == "graphwf-listing-2"
