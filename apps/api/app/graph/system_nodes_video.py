from __future__ import annotations

from typing import List

from .schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort

def _video_combine_input_ports(max_inputs: int = 12) -> List[GraphNodePort]:
    ports = [
        GraphNodePort(id=f"video_{index}", label=f"Video {index}", type="video", required=index <= 2, min=1 if index <= 2 else 0, max=1, accepts=["video"], description=f"Ordered video clip slot {index}.", advanced=index > 4)
        for index in range(1, max_inputs + 1)
    ]
    ports.append(GraphNodePort(id="audio", label="Audio", type="audio", required=False, max=1, accepts=["audio"], description="Reserved for a future external audio mix pass.", advanced=True))
    return ports


def video_node_definitions() -> List[GraphNodeDefinition]:
    return [
        GraphNodeDefinition(
            type="video.transform",
            title="Video Transform",
            description="Resize, trim, or convert a video with bounded ffmpeg operations.",
            category="Video",
            search_aliases=["video", "resize", "scale", "trim", "convert", "mp4", "webm", "utility"],
            tags=["video", "utility", "ffmpeg"],
            source={"kind": "system"},
            execution={"executor": "video.transform", "mode": "sync", "cacheable": True, "output_node": False, "bypass_mode": {"input": "video", "output": "video"}},
            limits={"max_dimension": 4096, "timeout_seconds": 300},
            ui={"default_size": {"width": 340, "height": 420}, "accent": "cyan", "icon": "video"},
            ports={
                "inputs": [GraphNodePort(id="video", label="Video", type="video", required=True, min=1, max=1, accepts=["video"])],
                "outputs": [
                    GraphNodePort(id="video", label="Video", type="video"),
                    GraphNodePort(id="metadata", label="Metadata", type="json"),
                ],
            },
            fields=[
                GraphNodeField(
                    id="operation",
                    label="Operation",
                    type="select",
                    required=True,
                    default="resize",
                    options=[
                        {"value": "resize", "label": "Resize"},
                        {"value": "trim", "label": "Trim"},
                        {"value": "convert_container", "label": "Convert Container"},
                    ],
                ),
                GraphNodeField(id="width", label="Width", type="integer", required=False, default=1280, min=1, max=4096),
                GraphNodeField(id="height", label="Height", type="integer", required=False, default=720, min=1, max=4096),
                GraphNodeField(id="start_seconds", label="Start", type="float", required=False, default=0, min=0),
                GraphNodeField(id="duration_seconds", label="Duration", type="float", required=False, default=3, min=0.1),
                GraphNodeField(id="format", label="Format", type="select", required=True, default="mp4", options=["mp4", "webm"]),
            ],
        ),
        GraphNodeDefinition(
            type="video.combine",
            title="Video Combine",
            description="Combine ordered video clips into one derived reference video with optional transitions.",
            category="Video",
            search_aliases=["video", "combine", "concat", "concatenate", "merge", "stitch", "edit", "transition", "utility"],
            tags=["video", "utility", "ffmpeg", "combine"],
            source={"kind": "system"},
            execution={"executor": "video.combine", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_clips": 12, "max_total_duration_seconds": 600, "max_source_bytes": 524288000, "timeout_seconds": 600},
            ui={"default_size": {"width": 360, "height": 560}, "accent": "cyan", "icon": "video", "preview": True},
            ports={
                "inputs": _video_combine_input_ports(),
                "outputs": [
                    GraphNodePort(id="video", label="Video", type="video"),
                    GraphNodePort(id="metadata", label="Metadata", type="json"),
                ],
            },
            fields=[
                GraphNodeField(
                    id="clip_count",
                    label="Clip Count",
                    type="integer",
                    required=True,
                    default=4,
                    min=2,
                    max=12,
                    help_text="Numbered clip slots to require and show.",
                ),
                GraphNodeField(
                    id="transition",
                    label="Transition",
                    type="select",
                    required=True,
                    default="crossfade",
                    options=[
                        {"value": "hard_cut", "label": "Hard Cut"},
                        {"value": "crossfade", "label": "Crossfade"},
                        {"value": "fade_to_black", "label": "Fade To Black"},
                    ],
                ),
                GraphNodeField(
                    id="transition_duration_seconds",
                    label="Transition Seconds",
                    type="float",
                    required=False,
                    default=0.5,
                    min=0,
                    max=5,
                    visible_if={"field": "transition", "not_equals": "hard_cut"},
                ),
                GraphNodeField(
                    id="resolution_policy",
                    label="Resolution",
                    type="select",
                    required=True,
                    default="first_clip",
                    options=[
                        {"value": "first_clip", "label": "Use First Clip"},
                        {"value": "custom", "label": "Custom"},
                    ],
                ),
                GraphNodeField(id="width", label="Width", type="integer", required=False, default=1080, min=2, max=4096, visible_if={"field": "resolution_policy", "equals": "custom"}),
                GraphNodeField(id="height", label="Height", type="integer", required=False, default=1920, min=2, max=4096, visible_if={"field": "resolution_policy", "equals": "custom"}),
                GraphNodeField(
                    id="fps_policy",
                    label="FPS",
                    type="select",
                    required=True,
                    default="first_clip",
                    options=[
                        {"value": "first_clip", "label": "Use First Clip"},
                        {"value": "fps_24", "label": "24 fps"},
                        {"value": "fps_30", "label": "30 fps"},
                        {"value": "fps_60", "label": "60 fps"},
                    ],
                ),
                GraphNodeField(id="output_format", label="Output", type="select", required=True, default="mp4", options=["mp4", "webm"]),
                GraphNodeField(id="quality_crf", label="Quality CRF", type="integer", required=False, default=18, min=0, max=51),
                GraphNodeField(id="title", label="Title", type="text", required=False, default="Combined Video"),
                GraphNodeField(id="audio_policy", label="Audio Policy", type="select", required=False, default="stub_v1", options=["stub_v1"], advanced=True, hidden=True),
            ],
        ),
        GraphNodeDefinition(
            type="video.extract",
            title="Video Extract",
            description="Extract a poster frame, still frames, audio, or metadata from a video.",
            category="Video",
            search_aliases=["video", "extract", "poster", "frame", "frames", "audio", "metadata", "utility"],
            tags=["video", "image", "audio", "utility", "ffmpeg"],
            source={"kind": "system"},
            execution={"executor": "video.extract", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_frames": 120, "timeout_seconds": 300},
            ui={"default_size": {"width": 340, "height": 420}, "accent": "cyan", "icon": "video"},
            ports={
                "inputs": [GraphNodePort(id="video", label="Video", type="video", required=True, min=1, max=1, accepts=["video"])],
                "outputs": [
                    GraphNodePort(id="image", label="Image", type="image"),
                    GraphNodePort(id="images", label="Frames", type="image", array=True),
                    GraphNodePort(id="audio", label="Audio", type="audio"),
                    GraphNodePort(id="metadata", label="Metadata", type="json"),
                ],
            },
            fields=[
                GraphNodeField(
                    id="operation",
                    label="Operation",
                    type="select",
                    required=True,
                    default="poster_frame",
                    options=[
                        {"value": "poster_frame", "label": "Poster Frame"},
                        {"value": "extract_frames", "label": "Extract Frames"},
                        {"value": "extract_audio", "label": "Extract Audio"},
                        {"value": "extract_metadata", "label": "Extract Metadata"},
                    ],
                ),
                GraphNodeField(id="at_seconds", label="At", type="float", required=False, default=0, min=0),
                GraphNodeField(id="fps", label="FPS", type="float", required=False, default=1, min=0.1, max=30),
                GraphNodeField(id="max_frames", label="Max Frames", type="integer", required=False, default=8, min=1, max=120),
                GraphNodeField(id="format", label="Image Format", type="select", required=False, default="jpg", options=["jpg", "png"]),
                GraphNodeField(id="audio_format", label="Audio Format", type="select", required=False, default="mp3", options=["mp3", "wav"]),
            ],
        ),
    ]
