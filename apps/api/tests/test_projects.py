PNG_1X1_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc``\x00\x00\x00"
    b"\x02\x00\x01\xe2!\xbc3\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_project_crud_archive_restore_and_delete(client) -> None:
    create = client.post(
        "/media/projects",
        json={"name": "Launch Assets", "description": "Scoped campaign workspace."},
    )
    assert create.status_code == 200
    project = create.json()
    project_id = project["project_id"]
    assert project["status"] == "active"

    listed = client.get("/media/projects")
    assert listed.status_code == 200
    assert [item["project_id"] for item in listed.json()["items"]] == [project_id]

    archived = client.post(f"/media/projects/{project_id}/archive")
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    active_list = client.get("/media/projects")
    assert active_list.status_code == 200
    assert active_list.json()["items"] == []

    restored = client.post(f"/media/projects/{project_id}/unarchive")
    assert restored.status_code == 200
    assert restored.json()["status"] == "active"

    deleted = client.delete(f"/media/projects/{project_id}?permanent=true")
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    missing = client.get(f"/media/projects/{project_id}")
    assert missing.status_code == 404


def test_project_reference_attachment_and_submit_propagation(client, app_modules) -> None:
    store = app_modules["store"]
    service = app_modules["service"]

    project_response = client.post("/media/projects", json={"name": "Project One", "description": "Primary workspace"})
    assert project_response.status_code == 200
    project_id = project_response.json()["project_id"]

    reference_path = service.settings.data_root / "reference-media" / "images" / "project-ref.png"
    reference_path.parent.mkdir(parents=True, exist_ok=True)
    reference_path.write_bytes(PNG_1X1_BYTES)
    reference = store.create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": "project-ref.png",
            "stored_path": str(reference_path.relative_to(service.settings.data_root)).replace("\\", "/"),
            "mime_type": "image/png",
            "file_size_bytes": reference_path.stat().st_size,
            "sha256": "project-reference-hash",
            "width": 1,
            "height": 1,
            "usage_count": 0,
        },
        increment_usage=False,
    )

    attach = client.post(f"/media/projects/{project_id}/references/{reference['reference_id']}")
    assert attach.status_code == 200
    assert attach.json()["attached_project_ids"] == [project_id]

    project_refs = client.get(f"/media/projects/{project_id}/references")
    assert project_refs.status_code == 200
    assert [item["reference_id"] for item in project_refs.json()["items"]] == [reference["reference_id"]]

    filtered_refs = client.get(f"/media/reference-media?project_id={project_id}&kind=image")
    assert filtered_refs.status_code == 200
    assert [item["reference_id"] for item in filtered_refs.json()["items"]] == [reference["reference_id"]]

    submit = client.post(
        "/media/jobs",
        json={
            "model_key": "nano-banana-2",
            "prompt": "Project scoped render",
            "project_id": project_id,
            "output_count": 1,
        },
    )
    assert submit.status_code == 200
    payload = submit.json()
    assert payload["batch"]["project_id"] == project_id
    assert payload["jobs"][0]["project_id"] == project_id

    job_id = payload["jobs"][0]["job_id"]
    job = store.get_job(job_id)
    assert job is not None
    assert job["project_id"] == project_id

    service.simulate_job_completion(job, service.settings.downloads_dir)
    asset = store.get_asset_by_job_id(job_id)
    assert asset is not None
    assert asset["project_id"] == project_id

    project_assets = client.get(f"/media/assets?project_id={project_id}")
    assert project_assets.status_code == 200
    assert [item["asset_id"] for item in project_assets.json()["items"]] == [asset["asset_id"]]

    detach = client.delete(f"/media/projects/{project_id}/references/{reference['reference_id']}")
    assert detach.status_code == 200
    assert detach.json()["attached_project_ids"] == []
