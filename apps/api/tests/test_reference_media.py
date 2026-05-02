from __future__ import annotations

import sqlite3
from pathlib import Path

PNG_1X1_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def test_reference_media_schema_bootstrap_creates_table_and_dedupe_index(app_modules, tmp_path: Path) -> None:
    store = app_modules["store"]
    db_path = tmp_path / "reference-media.sqlite"

    store.bootstrap_schema(db_path)

    connection = sqlite3.connect(db_path)
    try:
        table_names = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        indexes = {
            row[1]: row[2]
            for row in connection.execute("PRAGMA index_list(reference_media)").fetchall()
        }
    finally:
        connection.close()

    assert "reference_media" in table_names
    assert "idx_reference_media_dedupe" in indexes
    assert int(indexes["idx_reference_media_dedupe"]) == 1


def test_create_or_reuse_reference_media_deduplicates_exact_matches(app_modules) -> None:
    store = app_modules["store"]
    store.bootstrap_schema()

    payload = {
        "kind": "image",
        "original_filename": "one.jpg",
        "stored_path": "uploads/one.jpg",
        "mime_type": "image/jpeg",
        "file_size_bytes": 8,
        "sha256": "abc123",
        "usage_count": 0,
        "metadata_json": {},
    }

    first = store.create_or_reuse_reference_media(payload, increment_usage=False)
    second = store.create_or_reuse_reference_media(
        {
            **payload,
            "original_filename": "same-bytes-different-name.jpg",
            "stored_path": "uploads/two.jpg",
        },
        increment_usage=False,
    )
    third = store.create_or_reuse_reference_media(
        {
            **payload,
            "original_filename": "same-name-new-bytes.jpg",
            "sha256": "different",
        },
        increment_usage=False,
    )

    assert first["reference_id"] == second["reference_id"]
    assert third["reference_id"] != first["reference_id"]


def test_mark_reference_media_used_updates_usage_metadata(client) -> None:
    register_response = client.post(
        "/media/reference-media/register",
        json={
            "kind": "image",
            "original_filename": "portrait.png",
            "stored_path": "reference-media/images/portrait.png",
            "mime_type": "image/png",
            "file_size_bytes": 123,
            "sha256": "hash-portrait",
            "usage_count": 0,
            "metadata_json": {},
        },
    )
    assert register_response.status_code == 200
    reference_id = register_response.json()["reference_id"]

    use_response = client.post(f"/media/reference-media/{reference_id}/use")
    assert use_response.status_code == 200
    payload = use_response.json()

    assert payload["reference_id"] == reference_id
    assert payload["usage_count"] == 2
    assert payload["last_used_at"] is not None


def test_import_reference_media_upload_stores_file_and_deduplicates(client, app_modules) -> None:
    service = app_modules["service"]

    first = client.post(
        "/media/reference-media/import",
        files={"file": ("portrait.png", PNG_1X1_BYTES, "image/png")},
    )
    assert first.status_code == 200, first.text
    first_payload = first.json()

    stored_path = service.settings.data_root / first_payload["stored_path"]
    thumb_path = service.settings.data_root / first_payload["thumb_path"]

    assert first_payload["kind"] == "image"
    assert first_payload["original_filename"] == "portrait.png"
    assert first_payload["width"] == 1
    assert first_payload["height"] == 1
    assert stored_path.exists()
    assert thumb_path.exists()

    second = client.post(
        "/media/reference-media/import",
        files={"file": ("portrait-copy.png", PNG_1X1_BYTES, "image/png")},
    )
    assert second.status_code == 200, second.text
    second_payload = second.json()

    assert second_payload["reference_id"] == first_payload["reference_id"]
    assert second_payload["usage_count"] == first_payload["usage_count"] + 1
    assert second_payload["stored_path"] == first_payload["stored_path"]
    assert second_payload["thumb_path"] == first_payload["thumb_path"]


def test_import_reference_media_upload_rejects_empty_file(client) -> None:
    response = client.post(
        "/media/reference-media/import",
        files={"file": ("empty.png", b"", "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Choose a reference file to import."


def test_import_reference_media_upload_rejects_oversize_and_cleans_temp(client, app_modules, monkeypatch) -> None:
    main = app_modules["main"]
    service = app_modules["service"]
    monkeypatch.setattr(main.settings, "media_reference_import_max_bytes", 4)

    response = client.post(
        "/media/reference-media/import",
        files={"file": ("large.png", b"12345", "image/png")},
    )

    assert response.status_code == 413
    assert list(service.settings.uploads_dir.glob("reference-import-*.upload")) == []


def test_delete_reference_media_hides_item_without_removing_record(client, app_modules) -> None:
    file_path = app_modules["service"].settings.data_root / "reference-media" / "images" / "delete-me.png"
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(PNG_1X1_BYTES)
    register_response = client.post(
        "/media/reference-media/register",
        json={
            "kind": "image",
            "original_filename": "delete-me.png",
            "stored_path": "reference-media/images/delete-me.png",
            "mime_type": "image/png",
            "file_size_bytes": 321,
            "sha256": "hash-delete-me",
            "usage_count": 0,
            "metadata_json": {},
        },
    )
    assert register_response.status_code == 200
    reference_id = register_response.json()["reference_id"]

    delete_response = client.delete(f"/media/reference-media/{reference_id}")
    assert delete_response.status_code == 200
    deleted = delete_response.json()

    assert deleted["reference_id"] == reference_id
    assert deleted["status"] == "hidden"

    list_response = client.get("/media/reference-media?kind=image")
    assert list_response.status_code == 200
    assert [item["reference_id"] for item in list_response.json()["items"]] == []

    detail_response = client.get(f"/media/reference-media/{reference_id}")
    assert detail_response.status_code == 200
    assert detail_response.json()["status"] == "hidden"


def test_list_reference_media_filters_missing_files_and_clears_missing_thumbs(client, app_modules) -> None:
    store = app_modules["store"]
    service = app_modules["service"]
    store.bootstrap_schema()

    good_image = service.settings.data_root / "reference-media" / "images" / "good.png"
    good_thumb = service.settings.data_root / "reference-media" / "thumbs" / "good.webp"
    thumbless_image = service.settings.data_root / "reference-media" / "images" / "thumbless.png"
    good_image.parent.mkdir(parents=True, exist_ok=True)
    good_thumb.parent.mkdir(parents=True, exist_ok=True)
    good_image.write_bytes(PNG_1X1_BYTES)
    good_thumb.write_bytes(PNG_1X1_BYTES)
    thumbless_image.write_bytes(PNG_1X1_BYTES)

    store.create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": "good.png",
            "stored_path": "reference-media/images/good.png",
            "mime_type": "image/png",
            "file_size_bytes": good_image.stat().st_size,
            "sha256": "good-hash",
            "thumb_path": "reference-media/thumbs/good.webp",
            "usage_count": 0,
            "metadata_json": {},
        },
        increment_usage=False,
    )
    store.create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": "missing.png",
            "stored_path": "reference-media/images/missing.png",
            "mime_type": "image/png",
            "file_size_bytes": 123,
            "sha256": "missing-hash",
            "thumb_path": "reference-media/thumbs/missing.webp",
            "usage_count": 0,
            "metadata_json": {},
        },
        increment_usage=False,
    )
    thumbless = store.create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": "thumbless.png",
            "stored_path": "reference-media/images/thumbless.png",
            "mime_type": "image/png",
            "file_size_bytes": thumbless_image.stat().st_size,
            "sha256": "thumbless-hash",
            "thumb_path": "reference-media/thumbs/thumbless.webp",
            "usage_count": 0,
            "metadata_json": {},
        },
        increment_usage=False,
    )

    response = client.get("/media/reference-media?kind=image")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["original_filename"] for item in payload["items"]] == ["thumbless.png", "good.png"]
    thumbless_payload = next(item for item in payload["items"] if item["reference_id"] == thumbless["reference_id"])
    assert thumbless_payload["thumb_path"] is None


def test_backfill_reference_media_scans_uploads_and_is_idempotent(app_modules) -> None:
    service = app_modules["service"]
    store = app_modules["store"]
    store.bootstrap_schema()

    duplicate_a = service.settings.uploads_dir / "uuid-a" / "one.jpg"
    duplicate_b = service.settings.uploads_dir / "uuid-b" / "same-content.jpg"
    unique = service.settings.uploads_dir / "uuid-c" / "different.jpg"
    duplicate_a.parent.mkdir(parents=True, exist_ok=True)
    duplicate_b.parent.mkdir(parents=True, exist_ok=True)
    unique.parent.mkdir(parents=True, exist_ok=True)
    duplicate_a.write_bytes(PNG_1X1_BYTES)
    duplicate_b.write_bytes(duplicate_a.read_bytes())
    unique.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc`\xf8\xcf\xc0\x00\x00\x03\x01\x01\x00\xf1g\xae\x8d"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    first = service.backfill_reference_media()
    second = service.backfill_reference_media()

    records = store.list_reference_media(limit=20)
    assert first["scanned"] == 3
    assert first["imported"] == 2
    assert first["reused"] == 1
    assert second["imported"] == 0
    assert second["reused"] == 3
    assert len(records) == 2
    assert first["duration_seconds"] >= 0


def test_list_reference_media_does_not_auto_backfill_existing_uploads(client, app_modules) -> None:
    service = app_modules["service"]
    store = app_modules["store"]
    store.bootstrap_schema()

    upload_dir = service.settings.uploads_dir / "legacy-user" / "portrait.png"
    upload_dir.parent.mkdir(parents=True, exist_ok=True)
    upload_dir.write_bytes(PNG_1X1_BYTES)

    response = client.get("/media/reference-media?kind=image")
    assert response.status_code == 200
    payload = response.json()

    assert payload["items"] == []

    backfill = client.post("/media/reference-media/backfill")
    assert backfill.status_code == 200
    assert backfill.json()["imported"] == 1

    second = client.get("/media/reference-media?kind=image")
    assert second.status_code == 200
    assert len(second.json()["items"]) == 1
    assert second.json()["items"][0]["original_filename"] == "portrait.png"


def test_validation_bundle_resolves_reference_id_without_leaking_provider_extra_fields(app_modules) -> None:
    schemas = app_modules["schemas"]
    service = app_modules["service"]
    store = app_modules["store"]
    store.bootstrap_schema()

    uploads_dir = service.settings.uploads_dir / "uuid-reference"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    reference_path = uploads_dir / "portrait.png"
    reference_path.write_bytes(PNG_1X1_BYTES)
    reference = store.create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": "portrait.png",
            "stored_path": str(reference_path.relative_to(service.settings.data_root)).replace("\\", "/"),
            "mime_type": "image/png",
            "file_size_bytes": reference_path.stat().st_size,
            "sha256": "hash-reference",
            "width": 1,
            "height": 1,
            "usage_count": 0,
            "metadata_json": {},
        },
        increment_usage=False,
    )

    request = schemas.ValidateRequest(
        model_key="nano-banana-2",
        prompt="Use the reusable portrait as the active reference.",
        images=[schemas.MediaRefInput(reference_id=reference["reference_id"], mime_type="image/png")],
    )

    bundle = service.build_validation_bundle(request)
    first_image = bundle["raw_request"]["images"][0]

    assert first_image["path"] == str(reference_path)
    assert first_image["filename"] == "portrait.png"
    assert "reference_id" not in first_image
