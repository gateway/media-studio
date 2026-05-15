from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from time import perf_counter
from typing import Dict, List

from ... import service
from ...settings import settings
from ..media_probe import AUDIO_MAX_DURATION_SECONDS, AUDIO_MAX_FILE_BYTES, ffmpeg_binary, probe_audio
from ..media_refs import graph_ref_path
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


AUDIO_TRANSFORM_FORMATS = {"mp3", "wav", "m4a_aac"}
AUDIO_TRANSFORM_TIMEOUT_SECONDS = 180


def _float_field(value: object, default: float) -> float:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        parsed = default
    return parsed


def _graph_tmp_dir() -> Path:
    root = settings.data_root / "tmp" / "graph-audio"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _validate_audio_source(path: Path) -> Dict:
    metadata = probe_audio(path)
    if int(metadata.get("file_size_bytes") or path.stat().st_size) > AUDIO_MAX_FILE_BYTES:
        raise ValueError("Audio Transform source is larger than the 100 MB limit.")
    if float(metadata.get("duration_seconds") or 0) > AUDIO_MAX_DURATION_SECONDS:
        raise ValueError("Audio Transform source is longer than the 10 minute limit.")
    return metadata


def _run_ffmpeg(args: List[str]) -> None:
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=AUDIO_TRANSFORM_TIMEOUT_SECONDS, check=False)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip().splitlines()
        raise ValueError(stderr[-1] if stderr else "Audio Transform ffmpeg failed.")


def _suffix_for_format(format_preset: str) -> str:
    return ".m4a" if format_preset == "m4a_aac" else f".{format_preset}"


def _mime_for_suffix(suffix: str) -> str:
    return {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
    }.get(suffix, "audio/wav")


def _codec_args(format_preset: str) -> List[str]:
    if format_preset == "mp3":
        return ["-acodec", "libmp3lame", "-q:a", "3"]
    if format_preset == "m4a_aac":
        return ["-c:a", "aac", "-b:a", "192k"]
    if format_preset == "wav":
        return ["-c:a", "pcm_s16le"]
    raise ValueError("Audio Transform format must be mp3, wav, or m4a_aac.")


def _import_audio(path: Path, node: GraphWorkflowNode, source_ref: GraphOutputRef, *, transform_type: str, transform_params: Dict) -> GraphOutputRef:
    record = service.import_reference_media_bytes(
        source_bytes=path.read_bytes(),
        source_name=f"graph-audio-transform-{node.id}{path.suffix}",
        source_mime_type=_mime_for_suffix(path.suffix.lower()),
    )
    metadata = probe_audio(path, enforce_limits=False)
    return GraphOutputRef(
        kind="reference_media",
        media_type="audio",
        reference_id=record["reference_id"],
        metadata={
            **source_ref.metadata,
            "stored_path": record.get("stored_path"),
            "audio": metadata,
            "parent_asset_id": source_ref.asset_id or source_ref.metadata.get("parent_asset_id"),
            "parent_reference_id": source_ref.reference_id or source_ref.metadata.get("parent_reference_id"),
            "source_artifact_id": source_ref.metadata.get("artifact_id"),
            "lineage": {
                "parent_artifact_id": source_ref.metadata.get("artifact_id"),
                "parent_asset_id": source_ref.asset_id or source_ref.metadata.get("parent_asset_id"),
                "parent_reference_id": source_ref.reference_id or source_ref.metadata.get("parent_reference_id"),
                "transform_type": transform_type,
                "transform_params": transform_params,
            },
        },
    )


class AudioTransformExecutor(GraphExecutor):
    node_type = "audio.transform"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "audio")
        if not refs:
            raise ValueError("Audio Transform requires an audio input.")
        source_ref = refs[0]
        source_path = graph_ref_path(source_ref, expected_media_type="audio")
        source_metadata = _validate_audio_source(source_path)
        operation = str(node.fields.get("operation") or "extract_metadata")
        started = perf_counter()
        metadata: Dict = {"operation": operation, "source": source_metadata}
        outputs: Dict[str, List[GraphOutputRef]] = {}

        if operation == "extract_metadata":
            outputs["audio"] = [source_ref]
        else:
            format_preset = str(node.fields.get("format") or "mp3")
            if format_preset not in AUDIO_TRANSFORM_FORMATS:
                raise ValueError("Audio Transform format must be mp3, wav, or m4a_aac.")
            suffix = _suffix_for_format(format_preset)
            with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
                output_path = Path(tmp) / f"output{suffix}"
                command = [ffmpeg_binary(), "-y", "-i", str(source_path), "-vn"]
                transform_params: Dict = {"operation": operation, "format": format_preset}
                if operation == "trim":
                    start_seconds = max(0.0, _float_field(node.fields.get("start_seconds"), 0))
                    duration_seconds = max(0.1, min(AUDIO_MAX_DURATION_SECONDS, _float_field(node.fields.get("duration_seconds"), 5)))
                    command = [
                        ffmpeg_binary(),
                        "-y",
                        "-ss",
                        str(start_seconds),
                        "-i",
                        str(source_path),
                        "-t",
                        str(duration_seconds),
                        "-vn",
                    ]
                    transform_params.update({"start_seconds": start_seconds, "duration_seconds": duration_seconds})
                elif operation == "normalize":
                    target_lufs = max(-30.0, min(-6.0, _float_field(node.fields.get("target_lufs"), -16)))
                    command.extend(["-af", f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11"])
                    transform_params["target_lufs"] = target_lufs
                elif operation != "convert_format":
                    raise ValueError("Audio Transform operation must be trim, convert_format, normalize, or extract_metadata.")
                command.extend(_codec_args(format_preset))
                command.append(str(output_path))
                _run_ffmpeg(command)
                outputs["audio"] = [_import_audio(output_path, node, source_ref, transform_type=f"audio.transform.{operation}", transform_params=transform_params)]
                metadata.update(transform_params)

        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        outputs["metadata"] = [GraphOutputRef(kind="value", media_type="json", value=metadata)]
        return outputs
