from __future__ import annotations

import shutil
import subprocess
import tempfile
from hashlib import sha256
from pathlib import Path
from time import perf_counter
from typing import Dict, List, Tuple
import json

from ... import service, store
from ...settings import settings
from ..events import emit
from ..media_probe import AUDIO_MAX_FILE_BYTES, AUDIO_MAX_DURATION_SECONDS, probe_audio, probe_media, probe_video
from ..media_refs import graph_ref_path, graph_ref_metadata
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


SAVE_VIDEO_FORMATS = {"source_original", "mp4_h264_browser", "mp4_h265", "webm_vp9"}
SAVE_VIDEO_CODECS = {"auto", "h264", "h265", "vp9"}
SAVE_VIDEO_AUDIO_POLICIES = {"keep_video_audio", "replace", "mix", "mute"}
SAVE_VIDEO_AUDIO_FITS = {"trim_to_video", "loop_to_video", "pad_silence"}
SAVE_VIDEO_MAX_FILE_BYTES = 524288000
SAVE_VIDEO_MAX_DURATION_SECONDS = 600
SAVE_VIDEO_TRANSCODE_TIMEOUT_SECONDS = 300
SAVE_AUDIO_FORMATS = {"source_original", "mp3", "wav", "m4a_aac"}
SAVE_AUDIO_TRANSCODE_TIMEOUT_SECONDS = 180


def _codec_for_format(format_preset: str) -> str:
    return {
        "mp4_h264_browser": "h264",
        "mp4_h265": "h265",
        "webm_vp9": "vp9",
    }.get(format_preset, "auto")


def _ffmpeg() -> str:
    binary = shutil.which("ffmpeg")
    if not binary:
        raise ValueError("ffmpeg is required to transcode Save Video outputs.")
    return binary


def _ffprobe() -> str:
    binary = shutil.which("ffprobe")
    if not binary:
        raise ValueError("ffprobe is required to validate Save Video transcodes.")
    return binary


def _graph_tmp_dir() -> Path:
    root = settings.data_root / "tmp" / "graph-save-video"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _int_field(value: object, default: int) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        parsed = default
    return max(0, parsed)


def _float_field(value: object, default: float) -> float:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        parsed = default
    return max(0.0, parsed)


def _probe_video_duration_seconds(path: Path) -> float:
    result = subprocess.run(
        [_ffprobe(), "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip()
        raise ValueError(stderr or "ffprobe failed while validating Save Video source.")
    try:
        return float(result.stdout.decode("utf-8", errors="ignore").strip() or 0)
    except ValueError as exc:
        raise ValueError("ffprobe returned an invalid duration for Save Video source.") from exc


def _validate_transcode_source(path: Path) -> None:
    size = path.stat().st_size
    if size > SAVE_VIDEO_MAX_FILE_BYTES:
        raise ValueError("Save Video source is larger than the 500 MB transcode limit.")
    duration = _probe_video_duration_seconds(path)
    if duration > SAVE_VIDEO_MAX_DURATION_SECONDS:
        raise ValueError("Save Video source is longer than the 10 minute transcode limit.")


def _validate_audio_source(path: Path) -> Dict:
    metadata = probe_audio(path)
    size = int(metadata.get("file_size_bytes") or path.stat().st_size)
    duration = float(metadata.get("duration_seconds") or 0)
    if size > AUDIO_MAX_FILE_BYTES:
        raise ValueError("Audio source is larger than the 100 MB limit.")
    if duration > AUDIO_MAX_DURATION_SECONDS:
        raise ValueError("Audio source is longer than the 10 minute limit.")
    return metadata


def _transcode_command(source_path: Path, output_path: Path, *, format_preset: str, codec: str, crf: int) -> List[str]:
    resolved_codec = codec if codec != "auto" else _codec_for_format(format_preset)
    if format_preset == "webm_vp9":
        return [
            _ffmpeg(),
            "-y",
            "-i",
            str(source_path),
            "-c:v",
            "libvpx-vp9",
            "-b:v",
            "0",
            "-crf",
            str(crf),
            "-c:a",
            "libopus",
            str(output_path),
        ]
    video_codec = "libx265" if resolved_codec == "h265" else "libx264"
    return [
        _ffmpeg(),
        "-y",
        "-i",
        str(source_path),
        "-c:v",
        video_codec,
        "-preset",
        "veryfast",
        "-crf",
        str(crf),
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        str(output_path),
    ]


def _run_ffmpeg(args: List[str]) -> None:
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=SAVE_VIDEO_TRANSCODE_TIMEOUT_SECONDS, check=False)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip().splitlines()
        raise ValueError(stderr[-1] if stderr else "Save Video transcode failed.")


def _run_audio_ffmpeg(args: List[str]) -> None:
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=SAVE_AUDIO_TRANSCODE_TIMEOUT_SECONDS, check=False)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip().splitlines()
        raise ValueError(stderr[-1] if stderr else "Save Audio transcode failed.")


def _import_transcoded_video(path: Path, node: GraphWorkflowNode, source_ref: GraphOutputRef, *, format_preset: str, codec: str, crf: int) -> GraphOutputRef:
    record = service.import_reference_media_bytes(
        source_bytes=path.read_bytes(),
        source_name=f"graph-save-video-{node.id}{path.suffix}",
        source_mime_type="video/webm" if path.suffix == ".webm" else "video/mp4",
    )
    return GraphOutputRef(
        kind="reference_media",
        media_type="video",
        reference_id=record["reference_id"],
        metadata={
            **source_ref.metadata,
            "stored_path": record.get("stored_path"),
            "parent_asset_id": source_ref.asset_id or source_ref.metadata.get("parent_asset_id"),
            "parent_reference_id": source_ref.reference_id or source_ref.metadata.get("parent_reference_id"),
            "source_artifact_id": source_ref.metadata.get("artifact_id"),
            "lineage": {
                "parent_artifact_id": source_ref.metadata.get("artifact_id"),
                "parent_asset_id": source_ref.asset_id or source_ref.metadata.get("parent_asset_id"),
                "parent_reference_id": source_ref.reference_id or source_ref.metadata.get("parent_reference_id"),
                "transform_type": "media.save_video.transcode",
                "transform_params": {"format": format_preset, "codec": codec, "crf": crf},
            },
        },
    )


def _transcode_video_ref(ref: GraphOutputRef, node: GraphWorkflowNode, *, format_preset: str, codec: str, crf: int) -> GraphOutputRef:
    source_path = graph_ref_path(ref, expected_media_type="video")
    _validate_transcode_source(source_path)
    suffix = ".webm" if format_preset == "webm_vp9" else ".mp4"
    with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
        output_path = Path(tmp) / f"output{suffix}"
        _run_ffmpeg(_transcode_command(source_path, output_path, format_preset=format_preset, codec=codec, crf=crf))
        return _import_transcoded_video(output_path, node, ref, format_preset=format_preset, codec=codec, crf=crf)


def _import_processed_audio(path: Path, node: GraphWorkflowNode, source_ref: GraphOutputRef, *, format_preset: str) -> GraphOutputRef:
    mime_type = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".wav": "audio/wav",
    }.get(path.suffix.lower(), "audio/wav")
    record = service.import_reference_media_bytes(
        source_bytes=path.read_bytes(),
        source_name=f"graph-save-audio-{node.id}{path.suffix}",
        source_mime_type=mime_type,
    )
    metadata = probe_audio(path, enforce_limits=False)
    return GraphOutputRef(
        kind="reference_media",
        media_type="audio",
        reference_id=record["reference_id"],
        metadata={
            **source_ref.metadata,
            "stored_path": record.get("stored_path"),
            "parent_asset_id": source_ref.asset_id or source_ref.metadata.get("parent_asset_id"),
            "parent_reference_id": source_ref.reference_id or source_ref.metadata.get("parent_reference_id"),
            "source_artifact_id": source_ref.metadata.get("artifact_id"),
            "audio": metadata,
            "lineage": {
                "parent_artifact_id": source_ref.metadata.get("artifact_id"),
                "parent_asset_id": source_ref.asset_id or source_ref.metadata.get("parent_asset_id"),
                "parent_reference_id": source_ref.reference_id or source_ref.metadata.get("parent_reference_id"),
                "transform_type": "media.save_audio.transcode",
                "transform_params": {"format": format_preset},
            },
        },
    )


def _audio_transcode_command(source_path: Path, output_path: Path, *, format_preset: str) -> List[str]:
    command = [_ffmpeg(), "-y", "-i", str(source_path), "-vn"]
    if format_preset == "mp3":
        command.extend(["-acodec", "libmp3lame", "-q:a", "3"])
    elif format_preset == "m4a_aac":
        command.extend(["-c:a", "aac", "-b:a", "192k"])
    elif format_preset == "wav":
        command.extend(["-c:a", "pcm_s16le"])
    else:
        raise ValueError(f"Save Audio format must be one of: {', '.join(sorted(SAVE_AUDIO_FORMATS))}.")
    command.append(str(output_path))
    return command


def _transcode_audio_ref(ref: GraphOutputRef, node: GraphWorkflowNode, *, format_preset: str) -> GraphOutputRef:
    source_path = graph_ref_path(ref, expected_media_type="audio")
    _validate_audio_source(source_path)
    suffix = ".m4a" if format_preset == "m4a_aac" else f".{format_preset}"
    with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
        output_path = Path(tmp) / f"output{suffix}"
        _run_audio_ffmpeg(_audio_transcode_command(source_path, output_path, format_preset=format_preset))
        return _import_processed_audio(output_path, node, ref, format_preset=format_preset)


def _import_muxed_video(
    path: Path,
    node: GraphWorkflowNode,
    video_ref: GraphOutputRef,
    audio_ref: GraphOutputRef | None,
    *,
    audio_policy: str,
    audio_fit: str,
    audio_offset_seconds: float,
    audio_volume: float,
    video_audio_volume: float,
) -> GraphOutputRef:
    record = service.import_reference_media_bytes(
        source_bytes=path.read_bytes(),
        source_name=f"graph-save-video-audio-{node.id}.mp4",
        source_mime_type="video/mp4",
    )
    video_metadata = probe_video(path)
    return GraphOutputRef(
        kind="reference_media",
        media_type="video",
        reference_id=record["reference_id"],
        metadata={
            **video_ref.metadata,
            "stored_path": record.get("stored_path"),
            "parent_asset_id": video_ref.asset_id or video_ref.metadata.get("parent_asset_id"),
            "parent_reference_id": video_ref.reference_id or video_ref.metadata.get("parent_reference_id"),
            "source_artifact_id": video_ref.metadata.get("artifact_id"),
            "video": video_metadata,
            "audio_source": graph_ref_metadata(audio_ref) if audio_ref else None,
            "lineage": {
                "parent_artifact_id": video_ref.metadata.get("artifact_id"),
                "parent_asset_id": video_ref.asset_id or video_ref.metadata.get("parent_asset_id"),
                "parent_reference_id": video_ref.reference_id or video_ref.metadata.get("parent_reference_id"),
                "audio_artifact_id": audio_ref.metadata.get("artifact_id") if audio_ref else None,
                "audio_asset_id": audio_ref.asset_id if audio_ref else None,
                "audio_reference_id": audio_ref.reference_id if audio_ref else None,
                "transform_type": "media.save_video.audio_mux",
                "transform_params": {
                    "audio_policy": audio_policy,
                    "audio_fit": audio_fit,
                    "audio_offset_seconds": audio_offset_seconds,
                    "audio_volume": audio_volume,
                    "video_audio_volume": video_audio_volume,
                },
            },
        },
    )


def _mux_filter(audio_fit: str, *, audio_offset_seconds: float, audio_volume: float) -> List[str]:
    filters: List[str] = []
    if audio_offset_seconds > 0:
        delay_ms = int(audio_offset_seconds * 1000)
        filters.append(f"adelay={delay_ms}:all=1")
    if audio_fit == "pad_silence":
        filters.append("apad")
    if audio_volume != 1:
        filters.append(f"volume={audio_volume}")
    return filters


def _mux_audio_ref(
    video_ref: GraphOutputRef,
    audio_ref: GraphOutputRef | None,
    node: GraphWorkflowNode,
    *,
    audio_policy: str,
    audio_fit: str,
    audio_offset_seconds: float,
    audio_volume: float,
    video_audio_volume: float,
) -> GraphOutputRef:
    source_video_path = graph_ref_path(video_ref, expected_media_type="video")
    _validate_transcode_source(source_video_path)
    source_metadata = probe_media(source_video_path)
    if audio_policy not in SAVE_VIDEO_AUDIO_POLICIES:
        raise ValueError(f"Save Video audio policy must be one of: {', '.join(sorted(SAVE_VIDEO_AUDIO_POLICIES))}.")
    if audio_fit not in SAVE_VIDEO_AUDIO_FITS:
        raise ValueError(f"Save Video audio fit must be one of: {', '.join(sorted(SAVE_VIDEO_AUDIO_FITS))}.")
    with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
        output_path = Path(tmp) / "output.mp4"
        if audio_policy == "mute":
            command = [_ffmpeg(), "-y", "-i", str(source_video_path), "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", str(output_path)]
        else:
            if not audio_ref:
                raise ValueError("Save Video audio policy requires an audio input.")
            source_audio_path = graph_ref_path(audio_ref, expected_media_type="audio")
            _validate_audio_source(source_audio_path)
            input_args: List[str] = []
            if audio_fit == "loop_to_video":
                input_args.extend(["-stream_loop", "-1"])
            command = [_ffmpeg(), "-y", "-i", str(source_video_path), *input_args, "-i", str(source_audio_path)]
            external_filters = _mux_filter(audio_fit, audio_offset_seconds=audio_offset_seconds, audio_volume=audio_volume)
            if audio_policy == "mix" and source_metadata.get("has_audio"):
                filter_parts: List[str] = []
                if video_audio_volume != 1:
                    filter_parts.append(f"[0:a]volume={video_audio_volume}[basea]")
                    base_label = "[basea]"
                else:
                    base_label = "[0:a]"
                if external_filters:
                    filter_parts.append(f"[1:a]{','.join(external_filters)}[exta]")
                    ext_label = "[exta]"
                else:
                    ext_label = "[1:a]"
                filter_parts.append(f"{base_label}{ext_label}amix=inputs=2:duration=first:dropout_transition=0[aout]")
                command.extend(["-filter_complex", ";".join(filter_parts), "-map", "0:v:0", "-map", "[aout]"])
            elif external_filters:
                command.extend(["-filter_complex", f"[1:a]{','.join(external_filters)}[aout]", "-map", "0:v:0", "-map", "[aout]"])
            else:
                command.extend(["-map", "0:v:0", "-map", "1:a:0"])
            command.extend(["-c:v", "copy", "-c:a", "aac"])
            if audio_fit in {"trim_to_video", "loop_to_video"}:
                command.append("-shortest")
            command.extend(["-movflags", "+faststart", str(output_path)])
        _run_ffmpeg(command)
        return _import_muxed_video(
            output_path,
            node,
            video_ref,
            audio_ref,
            audio_policy=audio_policy,
            audio_fit=audio_fit,
            audio_offset_seconds=audio_offset_seconds,
            audio_volume=audio_volume,
            video_audio_volume=video_audio_volume,
        )


def _format_name(pattern: str, index: int, ref: GraphOutputRef) -> str:
    row = ref.metadata.get("row") or index
    column = ref.metadata.get("column") or index
    try:
        return pattern.format(index=index, row=row, column=column)
    except (KeyError, ValueError):
        return f"Graph output {index}"


def _stable_save_identity(*, context: GraphExecutionContext, node: GraphWorkflowNode, ref: GraphOutputRef, media_type: str, index: int) -> Dict:
    return {
        "schema_version": 1,
        "workflow_id": context.workflow.workflow_id,
        "node_id": node.id,
        "node_type": node.type,
        "media_type": media_type,
        "output_index": index,
        "source_asset_id": ref.asset_id,
        "source_reference_id": ref.reference_id,
    }


def _stable_graph_id(prefix: str, identity: Dict) -> str:
    digest = sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()[:24]
    return f"{prefix}_{digest}"


def _asset_payload_from_reference(
    *,
    context: GraphExecutionContext,
    node: GraphWorkflowNode,
    ref: GraphOutputRef,
    media_type: str,
    project_id: str,
    label: str,
    index: int = 1,
) -> Dict:
    reference = store.get_reference_media(str(ref.reference_id or ""))
    if not reference:
        raise ValueError("Save node could not find reference media.")
    if str(reference.get("kind") or media_type) != media_type:
        raise ValueError(f"Save node expected {media_type} reference media.")
    stored_path = reference.get("stored_path")
    if not stored_path:
        raise ValueError("Save node reference media has no stored path.")
    identity = _stable_save_identity(context=context, node=node, ref=ref, media_type=media_type, index=index)
    payload_json = {
        "graph": {
            "workflow_id": context.workflow.workflow_id,
            "run_id": context.run_id,
            "node_id": node.id,
            "node_type": node.type,
            "output_index": index,
            "source_reference_id": ref.reference_id,
            "source_artifact_id": ref.metadata.get("artifact_id"),
            "save_identity": identity,
            "transform": ref.metadata.get("lineage") or {},
        },
        "outputs": [
            {
                "kind": media_type,
                "role": "output",
                "width": reference.get("width"),
                "height": reference.get("height"),
                "duration_seconds": reference.get("duration_seconds"),
                "original_path": stored_path,
                "web_path": stored_path,
                "thumb_path": reference.get("thumb_path"),
                "poster_path": reference.get("poster_path"),
                "metadata": {key: value for key, value in ref.metadata.items() if key != "lineage"},
            }
        ],
    }
    asset_id = _stable_graph_id("asset_graph", identity)
    return {
        "asset_id": asset_id,
        "job_id": _stable_graph_id("graph_save", identity),
        "project_id": project_id or None,
        "run_id": context.run_id,
        "source_asset_id": ref.metadata.get("parent_asset_id"),
        "generation_kind": media_type,
        "model_key": "graph-derived",
        "status": "completed",
        "task_mode": node.type,
        "prompt_summary": label or f"Graph {media_type} output",
        "hero_original_path": stored_path,
        "hero_web_path": stored_path,
        "hero_thumb_path": reference.get("thumb_path"),
        "hero_poster_path": reference.get("poster_path") if media_type == "video" else None,
        "preset_source": "graph",
        "tags_json": ["graph", "derived"],
        "payload_json": payload_json,
    }


def _promote_reference_to_asset(
    *,
    context: GraphExecutionContext,
    node: GraphWorkflowNode,
    ref: GraphOutputRef,
    media_type: str,
    project_id: str,
    label: str,
    index: int = 1,
) -> Tuple[Dict, bool]:
    payload = _asset_payload_from_reference(
        context=context,
        node=node,
        ref=ref,
        media_type=media_type,
        project_id=project_id,
        label=label,
        index=index,
    )
    existing = store.get_asset(str(payload["asset_id"]))
    return store.create_or_update_asset(payload), existing is None


class _SaveMediaExecutor(GraphExecutor):
    node_type = ""
    media_type = "image"
    input_port = "image"
    title = "Save Media"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        media_refs = context.inputs_for(node, self.input_port)
        return self._execute_with_refs(node, context, media_refs)

    def _execute_with_refs(self, node: GraphWorkflowNode, context: GraphExecutionContext, media_refs: List[GraphOutputRef]) -> Dict[str, List[GraphOutputRef]]:
        if not media_refs:
            raise ValueError(f"{self.title} requires a {self.media_type} input.")
        project_id = str(node.fields.get("project_id") or "").strip()
        if project_id and not store.get_project(project_id):
            raise ValueError(f"{self.title} group does not exist.")
        label_base = str(node.fields.get("label") or self.title).strip()
        output_refs: List[GraphOutputRef] = []
        saved_count = 0
        reused_count = 0
        updated_count = 0
        for index, ref in enumerate(media_refs, start=1):
            if ref.media_type and ref.media_type != self.media_type:
                raise ValueError(f"{self.title} expected {self.media_type} input.")
            output_ref = ref
            label = _format_name(
                label_base if "{index}" in label_base or "{row}" in label_base or "{column}" in label_base else f"{label_base} {{index}}",
                index,
                ref,
            ) if len(media_refs) > 1 else label_base
            if ref.asset_id:
                if project_id:
                    asset = store.get_asset(ref.asset_id)
                    if not asset:
                        raise ValueError(f"{self.title} could not find output asset.")
                    if asset.get("project_id") != project_id:
                        store.create_or_update_asset({**asset, "project_id": project_id})
                        updated_count += 1
                    else:
                        reused_count += 1
                    output_ref = ref.model_copy(update={"metadata": {**ref.metadata, "project_id": project_id}})
                else:
                    reused_count += 1
                emit(context.run_id, "asset.reused", {"asset_id": ref.asset_id, "project_id": project_id or None}, node_id=node.id)
                output_refs.append(output_ref)
                continue
            if not ref.reference_id:
                raise ValueError(f"{self.title} input is not stored media.")
            asset, created = _promote_reference_to_asset(
                context=context,
                node=node,
                ref=ref,
                media_type=self.media_type,
                project_id=project_id,
                label=label,
                index=index,
            )
            if created:
                saved_count += 1
            else:
                reused_count += 1
            output_refs.append(
                GraphOutputRef(
                    kind="asset",
                    media_type=self.media_type,
                    asset_id=asset["asset_id"],
                    job_id=asset["job_id"],
                    metadata={
                        **ref.metadata,
                        "project_id": project_id or None,
                        "source_reference_id": ref.reference_id,
                        "source_artifact_id": ref.metadata.get("artifact_id"),
                        "lineage": {
                            "parent_artifact_id": ref.metadata.get("artifact_id"),
                            "parent_reference_id": ref.reference_id,
                            "transform_type": self.node_type,
                            "transform_params": {**dict(node.fields), "output_index": index},
                        },
                    },
                )
            )
            emit(context.run_id, "asset.created" if created else "asset.reused", {"asset_id": asset["asset_id"], "project_id": project_id or None}, node_id=node.id)
        context.record_node_metric(node, "saved_asset_count", saved_count)
        context.record_node_metric(node, "reused_asset_count", reused_count)
        context.record_node_metric(node, "updated_asset_count", updated_count)
        return {"asset": output_refs, self.input_port: output_refs}


class SaveImageExecutor(_SaveMediaExecutor):
    node_type = "media.save_image"
    media_type = "image"
    input_port = "image"
    title = "Save Image"


class SaveVideoExecutor(_SaveMediaExecutor):
    node_type = "media.save_video"
    media_type = "video"
    input_port = "video"
    title = "Save Video"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        format_preset = str(node.fields.get("format") or "source_original")
        codec = str(node.fields.get("codec") or "auto")
        crf = min(51, _int_field(node.fields.get("crf"), 23))
        audio_refs = context.inputs_for(node, "audio")
        requested_audio_policy = str(node.fields.get("audio_policy") or "keep_video_audio")
        audio_policy = "replace" if audio_refs and requested_audio_policy == "keep_video_audio" else requested_audio_policy
        audio_fit = str(node.fields.get("audio_fit") or "trim_to_video")
        audio_offset_seconds = _float_field(node.fields.get("audio_offset_seconds"), 0)
        audio_volume = min(4.0, _float_field(node.fields.get("audio_volume"), 1))
        video_audio_volume = min(4.0, _float_field(node.fields.get("video_audio_volume"), 1))
        if format_preset not in SAVE_VIDEO_FORMATS:
            raise ValueError(f"Save Video format must be one of: {', '.join(sorted(SAVE_VIDEO_FORMATS))}.")
        if codec not in SAVE_VIDEO_CODECS:
            raise ValueError(f"Save Video codec must be one of: {', '.join(sorted(SAVE_VIDEO_CODECS))}.")
        if audio_policy not in SAVE_VIDEO_AUDIO_POLICIES:
            raise ValueError(f"Save Video audio policy must be one of: {', '.join(sorted(SAVE_VIDEO_AUDIO_POLICIES))}.")
        if audio_fit not in SAVE_VIDEO_AUDIO_FITS:
            raise ValueError(f"Save Video audio fit must be one of: {', '.join(sorted(SAVE_VIDEO_AUDIO_FITS))}.")
        if len(audio_refs) > 1:
            raise ValueError("Save Video accepts at most one audio input.")
        media_refs = context.inputs_for(node, self.input_port)
        needs_audio_processing = audio_policy != "keep_video_audio"
        if needs_audio_processing:
            if audio_policy != "mute" and not audio_refs:
                raise ValueError("Save Video audio policy requires an audio input.")
            started = perf_counter()
            media_refs = [
                _mux_audio_ref(
                    ref,
                    audio_refs[0] if audio_refs else None,
                    node,
                    audio_policy=audio_policy,
                    audio_fit=audio_fit,
                    audio_offset_seconds=audio_offset_seconds,
                    audio_volume=audio_volume,
                    video_audio_volume=video_audio_volume,
                )
                for ref in media_refs
            ]
            context.record_node_metric(node, "video_audio_mux_duration_seconds", round(perf_counter() - started, 4))
            context.record_node_metric(node, "video_audio_mux_count", len(media_refs))
        if format_preset != "source_original":
            started = perf_counter()
            if codec == "auto":
                node = node.model_copy(update={"fields": {**dict(node.fields), "codec": _codec_for_format(format_preset)}})
            transcoded_refs = [
                _transcode_video_ref(ref, node, format_preset=format_preset, codec=str(node.fields.get("codec") or codec), crf=crf)
                for ref in media_refs
            ]
            context.record_node_metric(node, "video_transcode_duration_seconds", round(perf_counter() - started, 4))
            context.record_node_metric(node, "video_transcode_count", len(transcoded_refs))
            result = self._execute_with_refs(node, context, transcoded_refs)
        else:
            result = self._execute_with_refs(node, context, media_refs)
        enhanced = [
            ref.model_copy(
                update={
                    "metadata": {
                        **ref.metadata,
                        "save_video": {
                            "format": format_preset,
                            "codec": str(node.fields.get("codec") or "auto"),
                            "crf": crf,
                            "include_metadata": bool(node.fields.get("include_metadata", True)),
                            "filename_prefix": str(node.fields.get("filename_prefix") or "graph-video"),
                            "audio_policy": audio_policy,
                            "audio_fit": audio_fit,
                        },
                    }
                }
            )
            for ref in result.get("video", [])
        ]
        return {"asset": enhanced or result.get("asset", []), "video": enhanced or result.get("video", [])}


class SaveAudioExecutor(_SaveMediaExecutor):
    node_type = "media.save_audio"
    media_type = "audio"
    input_port = "audio"
    title = "Save Audio"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        format_preset = str(node.fields.get("format") or "source_original")
        if format_preset not in SAVE_AUDIO_FORMATS:
            raise ValueError(f"Save Audio format must be one of: {', '.join(sorted(SAVE_AUDIO_FORMATS))}.")
        media_refs = context.inputs_for(node, self.input_port)
        if format_preset != "source_original":
            started = perf_counter()
            media_refs = [_transcode_audio_ref(ref, node, format_preset=format_preset) for ref in media_refs]
            context.record_node_metric(node, "audio_transcode_duration_seconds", round(perf_counter() - started, 4))
            context.record_node_metric(node, "audio_transcode_count", len(media_refs))
        result = self._execute_with_refs(node, context, media_refs)
        enhanced = [
            ref.model_copy(
                update={
                    "metadata": {
                        **ref.metadata,
                        "save_audio": {
                            "format": format_preset,
                            "include_metadata": bool(node.fields.get("include_metadata", True)),
                            "filename_prefix": str(node.fields.get("filename_prefix") or "graph-audio"),
                        },
                    }
                }
            )
            for ref in result.get("audio", [])
        ]
        return {"asset": enhanced or result.get("asset", []), "audio": enhanced or result.get("audio", [])}


def _music_track_value(ref: GraphOutputRef) -> Dict:
    if ref.media_type != "music_track" or not isinstance(ref.value, dict):
        raise ValueError("Save Music Track expected a music track input.")
    return ref.value


def _music_track_audio_asset_id(track: Dict, ref: GraphOutputRef) -> str:
    audio = track.get("audio") if isinstance(track.get("audio"), dict) else {}
    asset_id = str(audio.get("asset_id") or ref.metadata.get("audio_asset_id") or "").strip()
    if not asset_id:
        raise ValueError("Save Music Track could not find the generated audio asset.")
    return asset_id


class SaveMusicTrackExecutor(GraphExecutor):
    node_type = "media.save_music_track"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "track")
        if not refs:
            raise ValueError("Save Music Track requires a music track input.")
        if len(refs) > 1:
            raise ValueError("Save Music Track accepts one music track at a time.")
        project_id = str(node.fields.get("project_id") or "").strip()
        if project_id and not store.get_project(project_id):
            raise ValueError("Save Music Track group does not exist.")
        source_ref = refs[0]
        track = _music_track_value(source_ref)
        asset_id = _music_track_audio_asset_id(track, source_ref)
        asset = store.get_asset(asset_id)
        if not asset:
            raise ValueError("Save Music Track could not find the generated audio asset.")
        if str(asset.get("generation_kind") or "") != "audio":
            raise ValueError("Save Music Track expected an audio asset.")
        updated_count = 0
        if project_id and asset.get("project_id") != project_id:
            asset = store.create_or_update_asset({**asset, "project_id": project_id})
            updated_count = 1
        metadata = {
            **source_ref.metadata,
            "project_id": project_id or asset.get("project_id"),
            "music_track": {
                "track_index": track.get("track_index"),
                "title": track.get("title"),
                "cover_image": track.get("cover_image"),
                "include_metadata": bool(node.fields.get("include_metadata", True)),
                "filename_prefix": str(node.fields.get("filename_prefix") or "graph-music"),
            },
            "lineage": {
                "parent_job_id": source_ref.job_id,
                "parent_asset_id": asset_id,
                "transform_type": self.node_type,
                "transform_params": {**dict(node.fields), "track_index": track.get("track_index")},
            },
        }
        output_ref = GraphOutputRef(
            kind="asset",
            media_type="audio",
            asset_id=asset["asset_id"],
            job_id=asset.get("job_id") or source_ref.job_id,
            metadata=metadata,
        )
        context.record_node_metric(node, "saved_asset_count", 0)
        context.record_node_metric(node, "reused_asset_count", 1)
        context.record_node_metric(node, "updated_asset_count", updated_count)
        context.record_node_metric(node, "music_track_index", track.get("track_index"))
        emit(context.run_id, "asset.reused", {"asset_id": asset["asset_id"], "project_id": project_id or asset.get("project_id")}, node_id=node.id)
        return {"asset": [output_ref], "audio": [output_ref]}


class SaveImagesExecutor(GraphExecutor):
    node_type = "media.save_images"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        media_refs = context.inputs_for(node, "images")
        if not media_refs:
            raise ValueError("Save Images requires image inputs.")
        project_id = str(node.fields.get("project_id") or "").strip()
        if project_id and not store.get_project(project_id):
            raise ValueError("Save Images group does not exist.")
        naming_pattern = str(node.fields.get("naming_pattern") or node.fields.get("label") or "Slice {index}")
        output_refs: List[GraphOutputRef] = []
        saved_count = 0
        reused_count = 0
        updated_count = 0
        for index, ref in enumerate(media_refs, start=1):
            if ref.media_type and ref.media_type != "image":
                raise ValueError("Save Images expected image inputs.")
            if ref.asset_id:
                if project_id:
                    asset = store.get_asset(ref.asset_id)
                    if not asset:
                        raise ValueError("Save Images could not find output asset.")
                    if asset.get("project_id") != project_id:
                        store.create_or_update_asset({**asset, "project_id": project_id})
                        updated_count += 1
                    else:
                        reused_count += 1
                else:
                    reused_count += 1
                output_refs.append(ref.model_copy(update={"metadata": {**ref.metadata, "project_id": project_id or None}}))
                emit(context.run_id, "asset.reused", {"asset_id": ref.asset_id, "project_id": project_id or None}, node_id=node.id)
                continue
            if not ref.reference_id:
                raise ValueError("Save Images input is not stored media.")
            label = _format_name(naming_pattern, index, ref)
            asset, created = _promote_reference_to_asset(
                context=context,
                node=node,
                ref=ref,
                media_type="image",
                project_id=project_id,
                label=label,
                index=index,
            )
            if created:
                saved_count += 1
            else:
                reused_count += 1
            output_refs.append(
                GraphOutputRef(
                    kind="asset",
                    media_type="image",
                    asset_id=asset["asset_id"],
                    job_id=asset["job_id"],
                    metadata={
                        **ref.metadata,
                        "project_id": project_id or None,
                        "source_reference_id": ref.reference_id,
                        "source_artifact_id": ref.metadata.get("artifact_id"),
                        "lineage": {
                            "parent_artifact_id": ref.metadata.get("artifact_id"),
                            "parent_reference_id": ref.reference_id,
                            "transform_type": "media.save_images",
                            "transform_params": {**dict(node.fields), "output_index": index},
                        },
                    },
                )
            )
            emit(context.run_id, "asset.created" if created else "asset.reused", {"asset_id": asset["asset_id"], "project_id": project_id or None}, node_id=node.id)
        context.record_node_metric(node, "saved_asset_count", saved_count)
        context.record_node_metric(node, "reused_asset_count", reused_count)
        context.record_node_metric(node, "updated_asset_count", updated_count)
        return {"assets": output_refs, "images": output_refs}
