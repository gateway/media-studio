from __future__ import annotations

import logging
import mimetypes
import shutil
import subprocess
from hashlib import sha256
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Any, Dict, Iterable, List, Optional, Tuple

from PIL import Image, ImageOps

from . import store
from .graph.media_probe import AUDIO_MAX_FILE_BYTES, audio_extension_supported, probe_audio, probe_video
from .service_errors import ServiceError
from .settings import settings

logger = logging.getLogger(__name__)
REFERENCE_MEDIA_ROOT = settings.data_root / "reference-media"
REFERENCE_IMAGES_ROOT = REFERENCE_MEDIA_ROOT / "images"
REFERENCE_VIDEOS_ROOT = REFERENCE_MEDIA_ROOT / "videos"
REFERENCE_AUDIOS_ROOT = REFERENCE_MEDIA_ROOT / "audios"
REFERENCE_THUMBS_ROOT = REFERENCE_MEDIA_ROOT / "thumbs"
_reference_media_backfill_lock = Lock()

def _reference_kind_for_path(file_path: Path) -> Optional[str]:
    mime_type, _ = mimetypes.guess_type(file_path.name)
    normalized = str(mime_type or "").lower()
    if normalized.startswith("image/"):
        return "image"
    if normalized.startswith("video/"):
        return "video"
    if normalized.startswith("audio/"):
        return "audio"
    return None


def _reference_kind_from_source(source_mime_type: Optional[str], source_name: Optional[str]) -> str:
    normalized = str(source_mime_type or "").lower().strip()
    if normalized.startswith("video/"):
        return "video"
    if normalized.startswith("audio/"):
        return "audio"
    if normalized.startswith("image/"):
        return "image"
    guessed, _ = mimetypes.guess_type(source_name or "")
    guessed = str(guessed or "").lower()
    if guessed.startswith("video/"):
        return "video"
    if guessed.startswith("audio/"):
        return "audio"
    return "image"


def _reference_extension_from_source(kind: str, source_name: Optional[str], source_mime_type: Optional[str]) -> str:
    explicit = Path(source_name or "").suffix.lower()
    if explicit:
        return explicit
    normalized = str(source_mime_type or "").lower()
    if kind == "video" and "mp4" in normalized:
        return ".mp4"
    if kind == "audio" and "wav" in normalized:
        return ".wav"
    if kind == "audio" and "mpeg" in normalized:
        return ".mp3"
    if kind == "audio" and "mp4" in normalized:
        return ".m4a"
    if kind == "audio" and "aac" in normalized:
        return ".aac"
    if "jpeg" in normalized:
        return ".jpg"
    if "png" in normalized:
        return ".png"
    if "webp" in normalized:
        return ".webp"
    if kind == "video":
        return ".mp4"
    if kind == "audio":
        return ".wav"
    return ".png"


def _reference_root_for_kind(kind: str) -> Path:
    if kind == "video":
        return REFERENCE_VIDEOS_ROOT
    if kind == "audio":
        return REFERENCE_AUDIOS_ROOT
    return REFERENCE_IMAGES_ROOT


def _relative_data_path(path_value: Path) -> str:
    return str(path_value.relative_to(settings.data_root)).replace("\\", "/")


def _write_reference_thumb(source_path: Path, digest: str) -> Optional[str]:
    REFERENCE_THUMBS_ROOT.mkdir(parents=True, exist_ok=True)
    thumb_path = REFERENCE_THUMBS_ROOT / f"{digest}.webp"
    if not thumb_path.exists():
        with Image.open(source_path) as image:
            normalized = ImageOps.exif_transpose(image)
            if normalized.mode not in {"RGB", "RGBA"}:
                normalized = normalized.convert("RGB")
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
            normalized.thumbnail((512, 512), resampling)
            normalized.save(thumb_path, "WEBP", quality=82, method=6)
    return _relative_data_path(thumb_path)


def _write_reference_video_poster_and_thumb(source_path: Path, digest: str) -> Tuple[Optional[str], Optional[str]]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None, None
    REFERENCE_THUMBS_ROOT.mkdir(parents=True, exist_ok=True)
    poster_path = REFERENCE_THUMBS_ROOT / f"{digest}-poster.jpg"
    try:
        if not poster_path.exists():
            subprocess.run(
                [
                    ffmpeg,
                    "-y",
                    "-ss",
                    "0",
                    "-i",
                    str(source_path),
                    "-frames:v",
                    "1",
                    "-q:v",
                    "3",
                    str(poster_path),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=True,
            )
        thumb_path = _write_reference_thumb(poster_path, digest)
        return thumb_path, _relative_data_path(poster_path)
    except Exception:
        logger.debug("reference video poster generation failed", exc_info=True)
        return None, None


def _ensure_video_reference_previews(record: Dict[str, Any]) -> Dict[str, Any]:
    if str(record.get("kind") or "") != "video":
        return record
    if record.get("thumb_path") and record.get("poster_path"):
        return record
    stored_path = str(record.get("stored_path") or "")
    digest = str(record.get("sha256") or "")
    if not stored_path or not digest:
        return record
    source_path = settings.data_root / stored_path
    if not source_path.exists():
        return record
    thumb_path, poster_path = _write_reference_video_poster_and_thumb(source_path, digest)
    if not thumb_path and not poster_path:
        return record
    return store.create_or_update_reference_media(
        {
            **record,
            "thumb_path": record.get("thumb_path") or thumb_path,
            "poster_path": record.get("poster_path") or poster_path,
        }
    )


def _probe_reference_media_metadata(file_path: Path, kind: str) -> Tuple[Optional[int], Optional[int], Optional[float], Dict[str, Any]]:
    if kind == "video":
        try:
            metadata = probe_video(file_path)
            return (
                metadata.get("width"),
                metadata.get("height"),
                metadata.get("duration_seconds"),
                metadata,
            )
        except Exception:
            logger.debug("reference video metadata probe failed", exc_info=True)
            return None, None, None, {}
    if kind == "audio":
        metadata = probe_audio(file_path)
        return None, None, metadata.get("duration_seconds"), metadata
    if kind != "image":
        return None, None, None, {}
    try:
        with Image.open(file_path) as image:
            width, height = image.size
        return width, height, None, {}
    except Exception:
        return None, None, None, {}


def _reference_media_path_exists(relative_path: Optional[str]) -> bool:
    if not relative_path:
        return False
    return (settings.data_root / relative_path).exists()


def sanitize_reference_media_record(record: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    stored_path = str(record.get("stored_path") or "").strip()
    if not stored_path or not _reference_media_path_exists(stored_path):
        return None

    normalized = dict(record)
    thumb_path = str(normalized.get("thumb_path") or "").strip()
    poster_path = str(normalized.get("poster_path") or "").strip()
    if thumb_path and not _reference_media_path_exists(thumb_path):
        normalized["thumb_path"] = None
    if poster_path and not _reference_media_path_exists(poster_path):
        normalized["poster_path"] = None
    return normalized


def list_available_reference_media(*, kind: Optional[str], limit: int, offset: int, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
    page_size = max(limit * 2, 40)
    skipped_live_offset = 0
    raw_offset = 0
    items: List[Dict[str, Any]] = []

    while len(items) < limit:
        batch = store.list_reference_media(kind=kind, limit=page_size, offset=raw_offset, project_id=project_id)
        if not batch:
            break
        raw_offset += len(batch)
        for record in batch:
            normalized = sanitize_reference_media_record(record)
            if normalized is None:
                continue
            if skipped_live_offset < offset:
                skipped_live_offset += 1
                continue
            items.append(normalized)
            if len(items) >= limit:
                break

    return items


def import_reference_media_bytes(
    *,
    source_bytes: bytes,
    source_name: Optional[str] = None,
    source_mime_type: Optional[str] = None,
) -> Dict[str, Any]:
    if not source_bytes:
        raise ServiceError("Choose a reference file to import.")

    kind = _reference_kind_from_source(source_mime_type, source_name)
    file_size_bytes = len(source_bytes)
    if kind == "audio":
        if file_size_bytes > AUDIO_MAX_FILE_BYTES:
            raise ServiceError("Audio reference files must be 100 MB or smaller.")
        if not audio_extension_supported(source_name, source_mime_type):
            raise ServiceError("Audio reference files must be wav, mp3, m4a, or aac.")
    digest = sha256(source_bytes).hexdigest()
    existing = store.get_reference_media_by_hash(kind, digest, file_size_bytes)
    if existing:
        existing_path = settings.data_root / str(existing.get("stored_path") or "")
        if existing.get("stored_path") and existing_path.exists():
            return _ensure_video_reference_previews(store.mark_reference_media_used(str(existing["reference_id"])))

    extension = _reference_extension_from_source(kind, source_name, source_mime_type)
    root = _reference_root_for_kind(kind)
    root.mkdir(parents=True, exist_ok=True)
    stored_path = root / f"{digest}{extension}"
    if not stored_path.exists():
        stored_path.write_bytes(source_bytes)

    try:
        width, height, duration_seconds, metadata_json = _probe_reference_media_metadata(stored_path, kind)
    except ValueError as exc:
        raise ServiceError(str(exc)) from exc
    thumb_path = _write_reference_thumb(stored_path, digest) if kind == "image" else None
    poster_path = None
    if kind == "video":
        thumb_path, poster_path = _write_reference_video_poster_and_thumb(stored_path, digest)
    mime_type = source_mime_type or mimetypes.guess_type(source_name or stored_path.name)[0]

    payload = {
        "kind": kind,
        "status": "active",
        "original_filename": source_name or stored_path.name,
        "stored_path": _relative_data_path(stored_path),
        "mime_type": mime_type,
        "file_size_bytes": file_size_bytes,
        "sha256": digest,
        "width": width,
        "height": height,
        "duration_seconds": duration_seconds,
        "thumb_path": thumb_path,
        "poster_path": poster_path,
        "usage_count": 1,
        "metadata_json": metadata_json,
    }

    if existing:
        updated_existing = store.mark_reference_media_used(str(existing["reference_id"]))
        return _ensure_video_reference_previews(store.create_or_update_reference_media(
            {
                **updated_existing,
                **payload,
                "reference_id": updated_existing["reference_id"],
                "usage_count": updated_existing["usage_count"],
                "last_used_at": updated_existing.get("last_used_at"),
            }
        ))

    return store.create_or_reuse_reference_media(payload, increment_usage=True)


def import_reference_media_file(
    *,
    source_path: Path,
    source_digest: str,
    source_size_bytes: int,
    source_name: Optional[str] = None,
    source_mime_type: Optional[str] = None,
) -> Dict[str, Any]:
    if source_size_bytes <= 0:
        raise ServiceError("Choose a reference file to import.")

    kind = _reference_kind_from_source(source_mime_type, source_name)
    if kind == "audio":
        if source_size_bytes > AUDIO_MAX_FILE_BYTES:
            raise ServiceError("Audio reference files must be 100 MB or smaller.")
        if not audio_extension_supported(source_name, source_mime_type):
            raise ServiceError("Audio reference files must be wav, mp3, m4a, or aac.")
    existing = store.get_reference_media_by_hash(kind, source_digest, source_size_bytes)
    if existing:
        existing_path = settings.data_root / str(existing.get("stored_path") or "")
        if existing.get("stored_path") and existing_path.exists():
            return _ensure_video_reference_previews(store.mark_reference_media_used(str(existing["reference_id"])))

    extension = _reference_extension_from_source(kind, source_name, source_mime_type)
    root = _reference_root_for_kind(kind)
    root.mkdir(parents=True, exist_ok=True)
    stored_path = root / f"{source_digest}{extension}"
    if not stored_path.exists():
        shutil.move(str(source_path), stored_path)

    try:
        width, height, duration_seconds, metadata_json = _probe_reference_media_metadata(stored_path, kind)
    except ValueError as exc:
        raise ServiceError(str(exc)) from exc
    thumb_path = _write_reference_thumb(stored_path, source_digest) if kind == "image" else None
    poster_path = None
    if kind == "video":
        thumb_path, poster_path = _write_reference_video_poster_and_thumb(stored_path, source_digest)
    mime_type = source_mime_type or mimetypes.guess_type(source_name or stored_path.name)[0]

    payload = {
        "kind": kind,
        "status": "active",
        "original_filename": source_name or stored_path.name,
        "stored_path": _relative_data_path(stored_path),
        "mime_type": mime_type,
        "file_size_bytes": source_size_bytes,
        "sha256": source_digest,
        "width": width,
        "height": height,
        "duration_seconds": duration_seconds,
        "thumb_path": thumb_path,
        "poster_path": poster_path,
        "usage_count": 1,
        "metadata_json": metadata_json,
    }

    if existing:
        updated_existing = store.mark_reference_media_used(str(existing["reference_id"]))
        return _ensure_video_reference_previews(store.create_or_update_reference_media(
            {
                **updated_existing,
                **payload,
                "reference_id": updated_existing["reference_id"],
                "usage_count": updated_existing["usage_count"],
                "last_used_at": updated_existing.get("last_used_at"),
            }
        ))

    return store.create_or_reuse_reference_media(payload, increment_usage=True)


def import_reference_media_streamed_upload(
    *,
    source_digest: str,
    source_size_bytes: int,
    temp_path: Path,
    source_name: Optional[str] = None,
    source_mime_type: Optional[str] = None,
) -> Dict[str, Any]:
    try:
        return import_reference_media_file(
            source_path=temp_path,
            source_digest=source_digest,
            source_size_bytes=source_size_bytes,
            source_name=source_name,
            source_mime_type=source_mime_type,
        )
    finally:
        if temp_path.exists():
            temp_path.unlink()


def _sha256_file(file_path: Path) -> str:
    digest = sha256()
    with file_path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def iter_existing_upload_files() -> Iterable[Path]:
    uploads_dir = settings.uploads_dir
    if not uploads_dir.exists():
        return []
    return (path for path in uploads_dir.rglob("*") if path.is_file())


def backfill_reference_media() -> Dict[str, Any]:
    started = perf_counter()
    scanned = 0
    imported = 0
    reused = 0
    skipped = 0
    errors: List[str] = []

    with _reference_media_backfill_lock:
        for file_path in iter_existing_upload_files():
            scanned += 1
            kind = _reference_kind_for_path(file_path)
            if not kind:
                skipped += 1
                continue
            try:
                digest = _sha256_file(file_path)
                relative_path = str(file_path.relative_to(settings.data_root)).replace("\\", "/")
                file_size_bytes = file_path.stat().st_size
                existing = store.get_reference_media_by_hash(kind, digest, file_size_bytes)
                width, height, duration_seconds, probed_metadata = _probe_reference_media_metadata(file_path, kind)
                record = store.create_or_reuse_reference_media(
                    {
                        "kind": kind,
                        "status": "active",
                        "original_filename": file_path.name,
                        "stored_path": relative_path,
                        "mime_type": mimetypes.guess_type(file_path.name)[0],
                        "file_size_bytes": file_size_bytes,
                        "sha256": digest,
                        "width": width,
                        "height": height,
                        "duration_seconds": duration_seconds,
                        "thumb_path": None,
                        "poster_path": None,
                        "usage_count": 0,
                        "metadata_json": {"backfilled": True, **probed_metadata},
                    },
                    increment_usage=False,
                )
                if existing or record.get("stored_path") != relative_path:
                    reused += 1
                else:
                    imported += 1
            except Exception as exc:
                skipped += 1
                errors.append(f"{file_path}: {exc}")

    duration_seconds = round(perf_counter() - started, 3)
    result = {
        "scanned": scanned,
        "imported": imported,
        "reused": reused,
        "skipped": skipped,
        "errors": errors,
        "duration_seconds": duration_seconds,
    }
    logger.info(
        "reference_media_backfill scanned=%s imported=%s reused=%s skipped=%s errors=%s duration_seconds=%s",
        scanned,
        imported,
        reused,
        skipped,
        len(errors),
        duration_seconds,
    )
    return result
