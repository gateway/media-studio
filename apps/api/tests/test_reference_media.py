from __future__ import annotations

import importlib
import json
import sqlite3
import subprocess
from hashlib import sha256
from pathlib import Path

import pytest
from PIL import Image

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


def test_list_reference_media_searches_source_records_and_respects_kind(client, app_modules) -> None:
    store = app_modules["store"]
    service = app_modules["service"]
    store.bootstrap_schema()

    image_path = service.settings.data_root / "reference-media" / "images" / "sadie-reference.png"
    video_path = service.settings.data_root / "reference-media" / "videos" / "sadie-driving.mp4"
    image_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(PNG_1X1_BYTES)
    video_path.write_bytes(b"fake video bytes")

    image = store.create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": "sadie-reference.png",
            "stored_path": "reference-media/images/sadie-reference.png",
            "mime_type": "image/png",
            "file_size_bytes": image_path.stat().st_size,
            "sha256": "sadie-image-hash",
            "usage_count": 0,
            "metadata_json": {},
        },
        increment_usage=False,
    )
    video = store.create_or_reuse_reference_media(
        {
            "kind": "video",
            "original_filename": "sadie-driving.mp4",
            "stored_path": "reference-media/videos/sadie-driving.mp4",
            "mime_type": "video/mp4",
            "file_size_bytes": video_path.stat().st_size,
            "sha256": "sadie-video-hash",
            "usage_count": 0,
            "metadata_json": {},
        },
        increment_usage=False,
    )

    response = client.get("/media/reference-media?kind=image&q=sadie")
    assert response.status_code == 200, response.text
    payload = response.json()

    assert [item["reference_id"] for item in payload["items"]] == [image["reference_id"]]
    assert video["reference_id"] not in [item["reference_id"] for item in payload["items"]]


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
    assert "width" not in first_image
    assert "height" not in first_image


@pytest.fixture(params=["bytes", "file"])
def import_reference(request, app_modules, tmp_path):
    service = importlib.import_module("app.service_reference_media")

    def run(content, *, name="portrait.png", mime_type=None):
        if request.param == "bytes":
            return service.import_reference_media_bytes(
                source_bytes=content, source_name=name, source_mime_type=mime_type,
            )
        source = tmp_path / "source.upload"
        source.write_bytes(content)
        return service.import_reference_media_file(
            source_path=source, source_digest=sha256(content).hexdigest(),
            source_size_bytes=len(content), source_name=name, source_mime_type=mime_type,
        )

    return run


def test_image_import_fields_and_existing_file_reuse(import_reference, app_modules):
    service = app_modules["service"]
    first = import_reference(PNG_1X1_BYTES)
    digest = sha256(PNG_1X1_BYTES).hexdigest()
    expected = {
        "kind": "image", "status": "active", "original_filename": "portrait.png",
        "stored_path": f"reference-media/images/{digest}.png", "mime_type": "image/png",
        "file_size_bytes": len(PNG_1X1_BYTES), "sha256": digest,
        "width": 1, "height": 1, "duration_seconds": None,
        "thumb_path": f"reference-media/thumbs/{digest}.webp", "poster_path": None,
        "usage_count": 1, "metadata_json": {},
    }
    assert {key: first[key] for key in expected} == expected
    assert first["created_at"] and first["updated_at"] and first["last_used_at"]
    assert (service.settings.data_root / first["stored_path"]).read_bytes() == PNG_1X1_BYTES
    assert (service.settings.data_root / first["thumb_path"]).is_file()

    second = import_reference(PNG_1X1_BYTES, name="renamed.jpg", mime_type="image/jpeg")
    assert {key: second[key] for key in expected} == {**expected, "usage_count": 2}
    assert second["reference_id"] == first["reference_id"]
    assert second["created_at"] == first["created_at"]
    assert second["updated_at"] >= first["updated_at"]
    assert second["last_used_at"] >= first["last_used_at"]
    assert len(app_modules["store"].list_reference_media()) == 1


def test_missing_image_file_restores_existing_record_and_accounting(import_reference, app_modules):
    store = app_modules["store"]
    digest = sha256(PNG_1X1_BYTES).hexdigest()
    old = store.create_or_update_reference_media({
        "kind": "image", "status": "hidden", "sha256": digest,
        "file_size_bytes": len(PNG_1X1_BYTES), "stored_path": "missing.png",
        "original_filename": "old.png", "usage_count": 7,
        "created_at": "2020-01-01T00:00:00+00:00", "updated_at": "2020-01-02T00:00:00+00:00",
        "last_used_at": "2020-01-03T00:00:00+00:00", "metadata_json": {"old": True},
    })
    result = import_reference(PNG_1X1_BYTES, name=None, mime_type="image/png")
    assert result["reference_id"] == old["reference_id"]
    assert result["usage_count"] == 8
    assert result["created_at"] == old["created_at"]
    assert result["updated_at"] >= old["updated_at"]
    assert result["last_used_at"] > old["last_used_at"]
    assert result["original_filename"] == f"{digest}.png"
    assert result["status"] == "active"
    assert result["metadata_json"] == {}
    assert result["width"] == result["height"] == 1
    assert result["thumb_path"] == f"reference-media/thumbs/{digest}.webp"
    assert store.get_reference_media(result["reference_id"]) == {**result, "attached_project_ids": []}


@pytest.fixture()
def media_tools(monkeypatch):
    # Mock the external media binaries; exercise the real probe/preview logic.
    state = {"poster_available": False, "commands": []}

    def run(command, **kwargs):
        state["commands"].append(command[0])
        if command[0] == "ffprobe":
            return subprocess.CompletedProcess(command, 0, stdout=json.dumps({
                "streams": [{"codec_type": "video", "codec_name": "h264", "width": 640, "height": 360}],
                "format": {"duration": "1.25", "format_name": "mov,mp4", "size": "999"},
            }).encode())
        if not state["poster_available"]:
            raise subprocess.CalledProcessError(1, command)
        Image.new("RGB", (640, 360), "white").save(command[-1])
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr("shutil.which", lambda binary: binary)
    monkeypatch.setattr("subprocess.run", run)
    return state


def test_video_import_metadata_and_preview_repair(import_reference, app_modules, media_tools):
    first = import_reference(b"video", name="clip.mp4", mime_type="video/mp4")
    assert first["kind"] == "video"
    assert (first["width"], first["height"], first["duration_seconds"]) == (640, 360, 1.25)
    assert first["file_size_bytes"] == 5
    assert first["metadata_json"] == {
        "codec": "h264", "width": 640, "height": 360, "duration_seconds": 1.25,
        "format_name": "mov,mp4", "file_size_bytes": 999, "has_audio": False,
        "audio": {"codec": None, "sample_rate": None, "channels": None, "bitrate": None},
    }
    assert first["thumb_path"] is first["poster_path"] is None
    assert media_tools["commands"] == ["ffprobe", "ffmpeg"]

    media_tools["poster_available"] = True
    repaired = import_reference(b"video", name="copy.mp4", mime_type="video/mp4")
    assert repaired["reference_id"] == first["reference_id"]
    assert repaired["usage_count"] == 2
    assert repaired["created_at"] == first["created_at"]
    assert repaired["metadata_json"] == first["metadata_json"]
    root = app_modules["service"].settings.data_root
    assert (root / repaired["poster_path"]).is_file()
    assert (root / repaired["thumb_path"]).is_file()
    assert media_tools["commands"] == ["ffprobe", "ffmpeg", "ffmpeg"]


def test_video_restoration_and_complete_preview_reuse(import_reference, app_modules, media_tools):
    media_tools["poster_available"] = True
    repaired = import_reference(b"video", name="clip.mp4", mime_type="video/mp4")
    root = app_modules["service"].settings.data_root
    (root / repaired["stored_path"]).unlink()
    app_modules["store"].create_or_update_reference_media({**repaired, "poster_path": None})
    restored = import_reference(b"video", name="restored.mp4", mime_type="video/mp4")
    assert restored["reference_id"] == repaired["reference_id"]
    assert restored["usage_count"] == 2
    assert restored["created_at"] == repaired["created_at"]
    assert restored["thumb_path"] == repaired["thumb_path"]
    assert restored["poster_path"] == repaired["poster_path"]
    assert restored["original_filename"] == "restored.mp4"
    assert media_tools["commands"] == ["ffprobe", "ffmpeg", "ffprobe"]

    reused = import_reference(b"video", name="copy.mp4", mime_type="video/mp4")
    assert reused["usage_count"] == 3
    assert reused["poster_path"] == restored["poster_path"]
    assert media_tools["commands"] == ["ffprobe", "ffmpeg", "ffprobe"]


@pytest.mark.parametrize(("content", "name", "message", "stored"), [
    (b"", "empty.png", "Choose a reference file to import.", False),
    (b"invalid", "broken.png", "cannot identify image file", True),
    (b"invalid", "broken.ogg", "wav, mp3, m4a, or aac", False),
    (b"invalid", "broken.wav", "Audio media has no readable audio stream.", True),
])
def test_failed_import_preserves_error_and_write_order(
    import_reference, app_modules, media_tools, content, name, message, stored,
):
    from app.service_errors import ServiceError

    with pytest.raises((ServiceError, Image.UnidentifiedImageError), match=message):
        import_reference(content, name=name)
    assert app_modules["store"].list_reference_media() == []
    root = app_modules["service"].settings.data_root / "reference-media"
    originals = [path for path in root.rglob("*") if path.is_file()]
    assert len(originals) == int(stored)
    if stored:
        assert originals[0].read_bytes() == content


def test_file_import_uses_supplied_digest_and_size_without_rehashing(app_modules, tmp_path):
    from app.service_reference_media import import_reference_media_file

    source = tmp_path / "source.upload"
    source.write_bytes(PNG_1X1_BYTES)
    result = import_reference_media_file(
        source_path=source, source_digest="upload-digest", source_size_bytes=123,
        source_name="input.png", source_mime_type="image/png",
    )
    assert result["sha256"] == "upload-digest"
    assert result["file_size_bytes"] == 123
    assert result["stored_path"] == "reference-media/images/upload-digest.png"
    assert not source.exists()
    root = app_modules["service"].settings.data_root
    assert (root / result["stored_path"]).read_bytes() == PNG_1X1_BYTES

    source.write_bytes(PNG_1X1_BYTES)
    reused = import_reference_media_file(
        source_path=source, source_digest="upload-digest", source_size_bytes=123,
        source_name="copy.png", source_mime_type="image/png",
    )
    assert reused["reference_id"] == result["reference_id"]
    assert reused["usage_count"] == 2
    assert source.read_bytes() == PNG_1X1_BYTES


def test_failed_image_restoration_does_not_increment_usage(import_reference, app_modules):
    store = app_modules["store"]
    old = store.create_or_update_reference_media({
        "kind": "image", "sha256": sha256(b"invalid").hexdigest(),
        "file_size_bytes": 7, "stored_path": "missing.png", "usage_count": 7,
        "last_used_at": "2020-01-01T00:00:00+00:00",
    })
    with pytest.raises(Image.UnidentifiedImageError):
        import_reference(b"invalid")
    assert store.get_reference_media(old["reference_id"]) == {**old, "attached_project_ids": []}


@pytest.mark.parametrize("size", [0, -1, 104857601])
def test_invalid_file_size_is_rejected_before_moving_source(app_modules, tmp_path, size):
    from app.service_errors import ServiceError
    from app.service_reference_media import import_reference_media_file

    source = tmp_path / "source.wav"
    source.write_bytes(b"audio")
    message = "100 MB or smaller" if size > 0 else "Choose a reference file"
    with pytest.raises(ServiceError, match=message):
        import_reference_media_file(
            source_path=source, source_digest="upload-digest", source_size_bytes=size,
            source_name="source.wav", source_mime_type="audio/wav",
        )
    assert source.read_bytes() == b"audio"
    assert app_modules["store"].list_reference_media() == []
    assert not (app_modules["service"].settings.data_root / "reference-media").exists()
