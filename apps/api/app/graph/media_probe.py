from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional


AUDIO_MAX_FILE_BYTES = 104857600
AUDIO_MAX_DURATION_SECONDS = 600
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac"}
AUDIO_MIME_HINTS = {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/x-aac"}


def ffprobe_binary() -> str:
    binary = shutil.which("ffprobe")
    if not binary:
        raise ValueError("ffprobe is required to inspect media.")
    return binary


def ffmpeg_binary() -> str:
    binary = shutil.which("ffmpeg")
    if not binary:
        raise ValueError("ffmpeg is required to process media.")
    return binary


def _run_ffprobe(path: Path) -> Dict[str, Any]:
    result = subprocess.run(
        [
            ffprobe_binary(),
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip()
        raise ValueError(stderr or "ffprobe failed while inspecting media.")
    return json.loads(result.stdout.decode("utf-8", errors="ignore") or "{}")


def _float_value(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _int_value(value: Any) -> Optional[int]:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def audio_extension_supported(source_name: Optional[str], mime_type: Optional[str]) -> bool:
    suffix = Path(source_name or "").suffix.lower()
    if suffix:
        return suffix in AUDIO_EXTENSIONS
    normalized = str(mime_type or "").lower()
    return normalized in AUDIO_MIME_HINTS


def probe_media(path: Path) -> Dict[str, Any]:
    payload = _run_ffprobe(path)
    streams = payload.get("streams") or []
    fmt = payload.get("format") or {}
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    return {
        "duration_seconds": _float_value(fmt.get("duration")),
        "format_name": fmt.get("format_name"),
        "file_size_bytes": _int_value(fmt.get("size")) or path.stat().st_size,
        "has_video": video_stream is not None,
        "has_audio": audio_stream is not None,
        "video": {
            "codec": video_stream.get("codec_name") if video_stream else None,
            "width": _int_value(video_stream.get("width")) if video_stream else None,
            "height": _int_value(video_stream.get("height")) if video_stream else None,
        },
        "audio": {
            "codec": audio_stream.get("codec_name") if audio_stream else None,
            "sample_rate": _int_value(audio_stream.get("sample_rate")) if audio_stream else None,
            "channels": _int_value(audio_stream.get("channels")) if audio_stream else None,
            "bitrate": _int_value(audio_stream.get("bit_rate")) if audio_stream else _int_value(fmt.get("bit_rate")),
        },
    }


def probe_audio(path: Path, *, enforce_limits: bool = True) -> Dict[str, Any]:
    metadata = probe_media(path)
    if not metadata.get("has_audio"):
        raise ValueError("Audio media has no readable audio stream.")
    size = int(metadata.get("file_size_bytes") or path.stat().st_size)
    duration = float(metadata.get("duration_seconds") or 0)
    if enforce_limits and size > AUDIO_MAX_FILE_BYTES:
        raise ValueError("Audio file is larger than the 100 MB limit.")
    if enforce_limits and duration > AUDIO_MAX_DURATION_SECONDS:
        raise ValueError("Audio file is longer than the 10 minute limit.")
    return {
        **metadata["audio"],
        "duration_seconds": metadata.get("duration_seconds"),
        "format_name": metadata.get("format_name"),
        "file_size_bytes": size,
        "has_audio": True,
    }


def probe_video(path: Path) -> Dict[str, Any]:
    metadata = probe_media(path)
    if not metadata.get("has_video"):
        raise ValueError("Video media has no readable video stream.")
    return {
        **metadata["video"],
        "duration_seconds": metadata.get("duration_seconds"),
        "format_name": metadata.get("format_name"),
        "file_size_bytes": metadata.get("file_size_bytes"),
        "has_audio": metadata.get("has_audio"),
        "audio": metadata.get("audio"),
    }
