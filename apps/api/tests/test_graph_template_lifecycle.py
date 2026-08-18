from __future__ import annotations


def test_archived_graph_template_is_omitted_from_active_list(client) -> None:
    response = client.post(
        "/media/graph/templates",
        json={
            "name": "Temporary Template",
            "description": None,
            "tags": ["graph-studio"],
            "thumbnail_path": None,
            "workflow_json": {"schema_version": 1, "name": "Temporary", "nodes": [], "edges": []},
        },
    )
    assert response.status_code == 200, response.text
    template_id = response.json()["template_id"]

    archived = client.delete(f"/media/graph/templates/{template_id}")
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "archived"
    listed = client.get("/media/graph/templates")
    assert listed.status_code == 200, listed.text
    assert template_id not in {
        item["template_id"] for item in listed.json()["items"]
    }
