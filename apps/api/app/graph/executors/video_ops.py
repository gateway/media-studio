from __future__ import annotations

import shutil
import subprocess
import tempfile
import json
from pathlib import Path
from time import perf_counter
from typing import Dict, List, Tuple

from ... import service
from ...settings import settings
from ..media_refs import graph_ref_path
from ..schemas import GraphOutputRef, GraphWorkflowNode
from .base import GraphExecutionContext, GraphExecutor


def _ffmpeg() -> str:
    binary = shutil.which("ffmpeg")
    if not binary:
        raise ValueError("ffmpeg is required for this video graph node.")
    return binary


def _float_field(value: object, default: float) -> float:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        parsed = default
    return max(0.0, parsed)


def _int_field(value: object, default: int) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        parsed = default
    return max(1, parsed)


def _graph_tmp_dir() -> Path:
    root = settings.data_root / "tmp" / "graph-video"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _run_ffmpeg(args: List[str], *, timeout_seconds: int = 300) -> None:
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout_seconds, check=False)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="ignore").strip().splitlines()
        raise ValueError(stderr[-1] if stderr else "ffmpeg failed.")


def _ffprobe() -> str:
    binary = shutil.which("ffprobe")
    if not binary:
        raise ValueError("ffprobe is required for this video graph node.")
    return binary


def _probe_video(path: Path) -> Dict[str, float | int | str | None]:
    result = subprocess.run(
        [
            _ffprobe(),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,r_frame_rate:format=duration,size",
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
        raise ValueError(stderr or "ffprobe failed while inspecting video.")
    payload = json.loads(result.stdout.decode("utf-8", errors="ignore") or "{}")
    stream = (payload.get("streams") or [{}])[0]
    fmt = payload.get("format") or {}
    fps = _parse_fps(str(stream.get("r_frame_rate") or "30/1"))
    return {
        "width": int(stream.get("width") or 0) or None,
        "height": int(stream.get("height") or 0) or None,
        "fps": fps,
        "duration_seconds": float(fmt.get("duration") or 0),
        "size_bytes": int(fmt.get("size") or path.stat().st_size),
    }


def _parse_fps(value: str) -> float:
    if "/" in value:
        numerator, denominator = value.split("/", 1)
        try:
            return max(1.0, min(120.0, float(numerator) / max(1.0, float(denominator))))
        except ValueError:
            return 30.0
    try:
        return max(1.0, min(120.0, float(value)))
    except ValueError:
        return 30.0


def _import_video(path: Path, node: GraphWorkflowNode, prefix: str) -> GraphOutputRef:
    record = service.import_reference_media_bytes(
        source_bytes=path.read_bytes(),
        source_name=f"graph-{prefix}-{node.id}{path.suffix}",
        source_mime_type="video/webm" if path.suffix == ".webm" else "video/mp4",
    )
    return GraphOutputRef(kind="reference_media", media_type="video", reference_id=record["reference_id"], metadata={"stored_path": record.get("stored_path")})


VIDEO_COMBINE_MAX_CLIPS = 12
VIDEO_COMBINE_MAX_SOURCE_BYTES = 524288000
VIDEO_COMBINE_MAX_TOTAL_DURATION_SECONDS = 600
VIDEO_COMBINE_TIMEOUT_SECONDS = 600


def _video_slot_refs(node: GraphWorkflowNode, context: GraphExecutionContext, clip_count: int) -> List[GraphOutputRef]:
    refs: List[GraphOutputRef] = []
    missing_slots: List[str] = []
    for index in range(1, clip_count + 1):
        slot_refs = context.inputs_for(node, f"video_{index}")
        if not slot_refs:
            missing_slots.append(f"video_{index}")
            continue
        refs.append(slot_refs[0])
    if missing_slots:
        raise ValueError(f"Video Combine is missing required clip slots: {', '.join(missing_slots)}.")
    if len(refs) < 2:
        raise ValueError("Video Combine requires at least 2 video inputs.")
    return refs


def _combine_dimensions(node: GraphWorkflowNode, first_probe: Dict[str, float | int | str | None]) -> Tuple[int, int]:
    policy = str(node.fields.get("resolution_policy") or "first_clip")
    if policy == "custom":
        width = min(4096, _int_field(node.fields.get("width"), 1080))
        height = min(4096, _int_field(node.fields.get("height"), 1920))
        return width, height
    width = int(first_probe.get("width") or 1080)
    height = int(first_probe.get("height") or 1920)
    return min(4096, max(2, width)), min(4096, max(2, height))


def _combine_fps(node: GraphWorkflowNode, first_probe: Dict[str, float | int | str | None]) -> float:
    policy = str(node.fields.get("fps_policy") or "first_clip")
    if policy == "fps_24":
        return 24.0
    if policy == "fps_30":
        return 30.0
    if policy == "fps_60":
        return 60.0
    return float(first_probe.get("fps") or 30.0)


def _combine_output_codec_args(output_format: str, crf: int) -> List[str]:
    if output_format == "webm":
        return ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", str(crf), "-an"]
    return ["-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"]


def _video_filter_inputs(count: int, *, width: int, height: int, fps: float) -> List[str]:
    return [
        f"[{index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps:.3f},format=yuv420p[v{index}]"
        for index in range(count)
    ]


class VideoCombineExecutor(GraphExecutor):
    node_type = "video.combine"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        started = perf_counter()
        clip_count = min(VIDEO_COMBINE_MAX_CLIPS, _int_field(node.fields.get("clip_count"), 4))
        refs = _video_slot_refs(node, context, clip_count)
        transition = str(node.fields.get("transition") or "crossfade")
        if transition not in {"hard_cut", "crossfade", "fade_to_black"}:
            raise ValueError("Video Combine transition must be hard_cut, crossfade, or fade_to_black.")
        output_format = str(node.fields.get("output_format") or "mp4").lower()
        if output_format not in {"mp4", "webm"}:
            raise ValueError("Video Combine output format must be mp4 or webm.")
        quality_crf = min(51, max(0, _int_field(node.fields.get("quality_crf"), 18)))

        source_paths = [graph_ref_path(ref, expected_media_type="video") for ref in refs]
        probes = [_probe_video(path) for path in source_paths]
        for probe in probes:
            if int(probe.get("size_bytes") or 0) > VIDEO_COMBINE_MAX_SOURCE_BYTES:
                raise ValueError("Video Combine source is larger than the 500 MB per-clip limit.")
        total_duration = sum(float(probe.get("duration_seconds") or 0) for probe in probes)
        if total_duration > VIDEO_COMBINE_MAX_TOTAL_DURATION_SECONDS:
            raise ValueError("Video Combine total input duration is longer than the 10 minute limit.")
        width, height = _combine_dimensions(node, probes[0])
        fps = _combine_fps(node, probes[0])
        transition_duration = min(5.0, _float_field(node.fields.get("transition_duration_seconds"), 0.5))
        shortest_clip = min(float(probe.get("duration_seconds") or 0) for probe in probes)
        if transition != "hard_cut":
            transition_duration = min(transition_duration, max(0.1, shortest_clip / 2))

        with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
            output_path = Path(tmp) / f"combined.{output_format}"
            command = [_ffmpeg(), "-y"]
            for path in source_paths:
                command.extend(["-i", str(path)])

            filter_parts = _video_filter_inputs(len(source_paths), width=width, height=height, fps=fps)
            if transition == "hard_cut":
                filter_parts.append("".join(f"[v{index}]" for index in range(len(source_paths))) + f"concat=n={len(source_paths)}:v=1:a=0[outv]")
            else:
                xfade_name = "fadeblack" if transition == "fade_to_black" else "fade"
                current_label = "v0"
                current_duration = float(probes[0].get("duration_seconds") or 0)
                for index in range(1, len(source_paths)):
                    next_label = f"xv{index}"
                    offset = max(0.0, current_duration - transition_duration)
                    filter_parts.append(f"[{current_label}][v{index}]xfade=transition={xfade_name}:duration={transition_duration:.3f}:offset={offset:.3f}[{next_label}]")
                    current_label = next_label
                    current_duration = current_duration + float(probes[index].get("duration_seconds") or 0) - transition_duration
                filter_parts.append(f"[{current_label}]copy[outv]")

            command.extend(["-filter_complex", ";".join(filter_parts), "-map", "[outv]"])
            command.extend(_combine_output_codec_args(output_format, quality_crf))
            command.append(str(output_path))
            _run_ffmpeg(command, timeout_seconds=VIDEO_COMBINE_TIMEOUT_SECONDS)
            output_ref = _import_video(output_path, node, "video-combine")

        metadata = {
            "title": str(node.fields.get("title") or "Combined Video"),
            "clip_count": len(refs),
            "clips": [
                {
                    "slot": index,
                    "asset_id": ref.asset_id,
                    "reference_id": ref.reference_id,
                    "artifact_id": ref.metadata.get("artifact_id"),
                    "duration_seconds": probes[index - 1].get("duration_seconds"),
                }
                for index, ref in enumerate(refs, start=1)
            ],
            "transition": transition,
            "transition_duration_seconds": transition_duration if transition != "hard_cut" else 0,
            "resolution_policy": str(node.fields.get("resolution_policy") or "first_clip"),
            "width": width,
            "height": height,
            "fps": fps,
            "fps_policy": str(node.fields.get("fps_policy") or "first_clip"),
            "output_format": output_format,
            "quality_crf": quality_crf,
            "audio_policy": "stubbed_no_external_audio_v1",
            "duration_seconds": max(0.0, total_duration - (transition_duration * (len(refs) - 1) if transition != "hard_cut" else 0)),
        }
        output_ref = output_ref.model_copy(
            update={
                "metadata": {
                    **output_ref.metadata,
                    "width": width,
                    "height": height,
                    "duration_seconds": metadata["duration_seconds"],
                    "lineage": {
                        "parent_artifact_id": refs[0].metadata.get("artifact_id"),
                        "parent_asset_id": refs[0].asset_id,
                        "parent_reference_id": refs[0].reference_id,
                        "transform_type": "video.combine",
                        "transform_params": metadata,
                    },
                }
            }
        )
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        context.record_node_metric(node, "combined_clip_count", len(refs))
        return {"video": [output_ref], "metadata": [GraphOutputRef(kind="value", media_type="json", value=metadata)]}


def _import_audio(path: Path, node: GraphWorkflowNode, prefix: str) -> GraphOutputRef:
    record = service.import_reference_media_bytes(
        source_bytes=path.read_bytes(),
        source_name=f"graph-{prefix}-{node.id}{path.suffix}",
        source_mime_type="audio/mpeg" if path.suffix == ".mp3" else "audio/wav",
    )
    return GraphOutputRef(kind="reference_media", media_type="audio", reference_id=record["reference_id"], metadata={"stored_path": record.get("stored_path")})


def _import_image(path: Path, node: GraphWorkflowNode, prefix: str) -> GraphOutputRef:
    record = service.import_reference_media_bytes(
        source_bytes=path.read_bytes(),
        source_name=f"graph-{prefix}-{node.id}{path.suffix}",
        source_mime_type="image/jpeg" if path.suffix in {".jpg", ".jpeg"} else "image/png",
    )
    return GraphOutputRef(
        kind="reference_media",
        media_type="image",
        reference_id=record["reference_id"],
        metadata={"stored_path": record.get("stored_path"), "width": record.get("width"), "height": record.get("height")},
    )


class VideoResizeExecutor(GraphExecutor):
    node_type = "video.resize"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "video")
        if not refs:
            raise ValueError("Resize Video requires a video input.")
        started = perf_counter()
        width = min(4096, _int_field(node.fields.get("width"), 1280))
        height = min(4096, _int_field(node.fields.get("height"), 720))
        source_path = graph_ref_path(refs[0], expected_media_type="video")
        with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
            output_path = Path(tmp) / "output.mp4"
            _run_ffmpeg([_ffmpeg(), "-y", "-i", str(source_path), "-vf", f"scale={width}:{height}", "-c:v", "libx264", "-preset", "veryfast", "-movflags", "+faststart", str(output_path)])
            output_ref = _import_video(output_path, node, "video-resize")
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        return {"video": [output_ref]}


class VideoTransformExecutor(GraphExecutor):
    node_type = "video.transform"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "video")
        if not refs:
            raise ValueError("Video Transform requires a video input.")
        started = perf_counter()
        operation = str(node.fields.get("operation") or "resize")
        source_path = graph_ref_path(refs[0], expected_media_type="video")
        metadata = {"operation": operation}
        with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
            output_path = Path(tmp) / "output.mp4"
            if operation == "resize":
                width = min(4096, _int_field(node.fields.get("width"), 1280))
                height = min(4096, _int_field(node.fields.get("height"), 720))
                metadata.update({"width": width, "height": height})
                command = [
                    _ffmpeg(),
                    "-y",
                    "-i",
                    str(source_path),
                    "-vf",
                    f"scale={width}:{height}",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-movflags",
                    "+faststart",
                    str(output_path),
                ]
            elif operation == "trim":
                start = _float_field(node.fields.get("start_seconds"), 0)
                duration = _float_field(node.fields.get("duration_seconds"), 3)
                if duration <= 0:
                    raise ValueError("Video Transform trim duration must be greater than zero.")
                metadata.update({"start_seconds": start, "duration_seconds": duration})
                command = [
                    _ffmpeg(),
                    "-y",
                    "-ss",
                    str(start),
                    "-i",
                    str(source_path),
                    "-t",
                    str(duration),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                    str(output_path),
                ]
            elif operation == "convert_container":
                output_format = str(node.fields.get("format") or "mp4").lower()
                if output_format not in {"mp4", "webm"}:
                    raise ValueError("Video Transform format must be mp4 or webm.")
                output_path = Path(tmp) / f"output.{output_format}"
                metadata["format"] = output_format
                if output_format == "webm":
                    command = [_ffmpeg(), "-y", "-i", str(source_path), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus", str(output_path)]
                else:
                    command = [_ffmpeg(), "-y", "-i", str(source_path), "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", str(output_path)]
            else:
                raise ValueError("Video Transform operation must be resize, trim, or convert_container.")
            _run_ffmpeg(command)
            output_ref = _import_video(output_path, node, f"video-transform-{operation}")

        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        return {
            "video": [
                output_ref.model_copy(
                    update={
                        "metadata": {
                            **output_ref.metadata,
                            "lineage": {
                                "transform_type": f"video.transform.{operation}",
                                "transform_params": metadata,
                            },
                        }
                    }
                )
            ],
            "metadata": [GraphOutputRef(kind="value", media_type="json", value=metadata)],
        }


class VideoTrimExecutor(GraphExecutor):
    node_type = "video.trim"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "video")
        if not refs:
            raise ValueError("Trim Video requires a video input.")
        started = perf_counter()
        start = _float_field(node.fields.get("start_seconds"), 0)
        duration = _float_field(node.fields.get("duration_seconds"), 3)
        if duration <= 0:
            raise ValueError("Trim duration must be greater than zero.")
        source_path = graph_ref_path(refs[0], expected_media_type="video")
        with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
            output_path = Path(tmp) / "output.mp4"
            _run_ffmpeg([
                _ffmpeg(),
                "-y",
                "-ss",
                str(start),
                "-i",
                str(source_path),
                "-t",
                str(duration),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
                str(output_path),
            ])
            output_ref = _import_video(output_path, node, "video-trim")
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        return {"video": [output_ref]}


class VideoExtractExecutor(GraphExecutor):
    node_type = "video.extract"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "video")
        if not refs:
            raise ValueError("Video Extract requires a video input.")
        started = perf_counter()
        operation = str(node.fields.get("operation") or "poster_frame")
        source_path = graph_ref_path(refs[0], expected_media_type="video")
        metadata = {"operation": operation}
        outputs: Dict[str, List[GraphOutputRef]] = {}
        with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
            tmp_path = Path(tmp)
            if operation == "poster_frame":
                at = _float_field(node.fields.get("at_seconds"), 0)
                image_format = str(node.fields.get("format") or "jpg").lower()
                suffix = ".png" if image_format == "png" else ".jpg"
                output_path = tmp_path / f"poster{suffix}"
                _run_ffmpeg([_ffmpeg(), "-y", "-ss", str(at), "-i", str(source_path), "-frames:v", "1", "-q:v", "2", str(output_path)])
                outputs["image"] = [_import_image(output_path, node, "video-extract-poster")]
                metadata.update({"at_seconds": at, "format": image_format})
            elif operation == "extract_frames":
                fps = max(0.1, min(30.0, _float_field(node.fields.get("fps"), 1)))
                max_frames = min(120, _int_field(node.fields.get("max_frames"), 8))
                image_format = str(node.fields.get("format") or "jpg").lower()
                suffix = "png" if image_format == "png" else "jpg"
                output_pattern = str(tmp_path / f"frame_%03d.{suffix}")
                _run_ffmpeg([_ffmpeg(), "-y", "-i", str(source_path), "-vf", f"fps={fps}", "-frames:v", str(max_frames), "-q:v", "2", output_pattern])
                outputs["images"] = [_import_image(path, node, "video-extract-frame") for path in sorted(tmp_path.glob(f"frame_*.{suffix}"))]
                metadata.update({"fps": fps, "max_frames": max_frames, "frame_count": len(outputs["images"]), "format": image_format})
                context.record_node_metric(node, "output_frame_count", len(outputs["images"]))
            elif operation == "extract_audio":
                audio_format = str(node.fields.get("audio_format") or "mp3").lower()
                if audio_format not in {"mp3", "wav"}:
                    raise ValueError("Video Extract audio format must be mp3 or wav.")
                output_path = tmp_path / f"audio.{audio_format}"
                command = [_ffmpeg(), "-y", "-i", str(source_path), "-vn"]
                if audio_format == "mp3":
                    command.extend(["-acodec", "libmp3lame", "-q:a", "4"])
                command.append(str(output_path))
                _run_ffmpeg(command)
                outputs["audio"] = [_import_audio(output_path, node, "video-extract-audio")]
                metadata["audio_format"] = audio_format
            elif operation == "extract_metadata":
                metadata["source_path"] = str(source_path.name)
            else:
                raise ValueError("Video Extract operation must be poster_frame, extract_frames, extract_audio, or extract_metadata.")

        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        outputs["metadata"] = [GraphOutputRef(kind="value", media_type="json", value=metadata)]
        return outputs


class VideoPosterFrameExecutor(GraphExecutor):
    node_type = "video.poster_frame"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "video")
        if not refs:
            raise ValueError("Poster Frame requires a video input.")
        started = perf_counter()
        at = _float_field(node.fields.get("at_seconds"), 0)
        source_path = graph_ref_path(refs[0], expected_media_type="video")
        with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
            output_path = Path(tmp) / "poster.jpg"
            _run_ffmpeg([_ffmpeg(), "-y", "-ss", str(at), "-i", str(source_path), "-frames:v", "1", "-q:v", "2", str(output_path)])
            output_ref = _import_image(output_path, node, "video-poster")
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        return {"image": [output_ref]}


class VideoExtractFramesExecutor(GraphExecutor):
    node_type = "video.extract_frames"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "video")
        if not refs:
            raise ValueError("Extract Frames requires a video input.")
        started = perf_counter()
        fps = max(0.1, min(30.0, _float_field(node.fields.get("fps"), 1)))
        max_frames = min(120, _int_field(node.fields.get("max_frames"), 8))
        source_path = graph_ref_path(refs[0], expected_media_type="video")
        with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
            output_pattern = str(Path(tmp) / "frame_%03d.jpg")
            _run_ffmpeg([_ffmpeg(), "-y", "-i", str(source_path), "-vf", f"fps={fps}", "-frames:v", str(max_frames), "-q:v", "2", output_pattern])
            output_refs = [_import_image(path, node, "video-frame") for path in sorted(Path(tmp).glob("frame_*.jpg"))]
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        context.record_node_metric(node, "output_frame_count", len(output_refs))
        return {"image": output_refs}


class VideoExtractAudioExecutor(GraphExecutor):
    node_type = "video.extract_audio"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "video")
        if not refs:
            raise ValueError("Extract Audio requires a video input.")
        started = perf_counter()
        source_path = graph_ref_path(refs[0], expected_media_type="video")
        with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
            output_path = Path(tmp) / "audio.mp3"
            _run_ffmpeg([_ffmpeg(), "-y", "-i", str(source_path), "-vn", "-acodec", "libmp3lame", "-q:a", "4", str(output_path)])
            output_ref = _import_audio(output_path, node, "video-audio")
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        return {"audio": [output_ref]}


class VideoConvertContainerExecutor(GraphExecutor):
    node_type = "video.convert_container"

    def execute(self, node: GraphWorkflowNode, context: GraphExecutionContext) -> Dict[str, List[GraphOutputRef]]:
        refs = context.inputs_for(node, "video")
        if not refs:
            raise ValueError("Convert Video Container requires a video input.")
        started = perf_counter()
        output_format = str(node.fields.get("format") or "mp4").lower()
        if output_format not in {"mp4", "webm"}:
            raise ValueError("Video container must be mp4 or webm.")
        source_path = graph_ref_path(refs[0], expected_media_type="video")
        with tempfile.TemporaryDirectory(dir=_graph_tmp_dir()) as tmp:
            output_path = Path(tmp) / f"output.{output_format}"
            if output_format == "webm":
                command = [_ffmpeg(), "-y", "-i", str(source_path), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus", str(output_path)]
            else:
                command = [_ffmpeg(), "-y", "-i", str(source_path), "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", str(output_path)]
            _run_ffmpeg(command)
            output_ref = _import_video(output_path, node, "video-convert")
        context.record_node_metric(node, "utility_processing_duration_seconds", round(perf_counter() - started, 4))
        return {"video": [output_ref]}
