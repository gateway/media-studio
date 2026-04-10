from __future__ import annotations

import sqlite3
from pathlib import Path


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
    duplicate_a.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
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


def test_list_reference_media_auto_backfills_existing_uploads_once(client, app_modules) -> None:
    service = app_modules["service"]
    store = app_modules["store"]
    store.bootstrap_schema()

    upload_dir = service.settings.uploads_dir / "legacy-user" / "portrait.png"
    upload_dir.parent.mkdir(parents=True, exist_ok=True)
    upload_dir.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )

    response = client.get("/media/reference-media?kind=image")
    assert response.status_code == 200
    payload = response.json()

    assert len(payload["items"]) == 1
    assert payload["items"][0]["original_filename"] == "portrait.png"

    second = client.get("/media/reference-media?kind=image")
    assert second.status_code == 200
    assert len(second.json()["items"]) == 1


def test_validation_bundle_resolves_reference_id_without_leaking_provider_extra_fields(app_modules) -> None:
    schemas = app_modules["schemas"]
    service = app_modules["service"]
    store = app_modules["store"]
    store.bootstrap_schema()

    uploads_dir = service.settings.uploads_dir / "uuid-reference"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    reference_path = uploads_dir / "portrait.png"
    reference_path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
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
