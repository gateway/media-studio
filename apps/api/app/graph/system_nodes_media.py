from __future__ import annotations

from typing import List

from .schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort

from .. import store

SAVE_VIDEO_FORMAT_OPTIONS = [
    {"value": "source_original", "label": "Source Original"},
    {"value": "mp4_h264_browser", "label": "MP4 H.264 Browser"},
    {"value": "mp4_h265", "label": "MP4 H.265"},
    {"value": "webm_vp9", "label": "WebM VP9"},
]
SAVE_VIDEO_CODEC_OPTIONS = [
    {"value": "auto", "label": "Auto"},
    {"value": "h264", "label": "H.264"},
    {"value": "h265", "label": "H.265"},
    {"value": "vp9", "label": "VP9"},
]
SAVE_VIDEO_AUDIO_POLICY_OPTIONS = [
    {"value": "keep_video_audio", "label": "Keep Video Audio"},
    {"value": "replace", "label": "Replace With Audio Input"},
    {"value": "mix", "label": "Mix With Audio Input"},
    {"value": "mute", "label": "Mute Video"},
]
SAVE_VIDEO_AUDIO_FIT_OPTIONS = [
    {"value": "trim_to_video", "label": "Trim To Video"},
    {"value": "loop_to_video", "label": "Loop To Video"},
    {"value": "pad_silence", "label": "Pad Silence"},
]
SAVE_AUDIO_FORMAT_OPTIONS = [
    {"value": "source_original", "label": "Source Original"},
    {"value": "mp3", "label": "MP3"},
    {"value": "wav", "label": "WAV"},
    {"value": "m4a_aac", "label": "M4A AAC"},
]


def _project_options() -> List[dict[str, str]]:
    return [
        {"value": str(item["project_id"]), "label": str(item.get("name") or item["project_id"])}
        for item in store.list_projects(status="active")
    ]


def _save_media_fields() -> List[GraphNodeField]:
    return [
        GraphNodeField(id="project_id", label="Group", type="select", required=False, options=_project_options(), help_text="Optional Media Studio group/project for the saved output."),
        GraphNodeField(id="label", label="Label", type="text", required=False, hidden=True),
    ]


def _save_video_fields() -> List[GraphNodeField]:
    return [
        GraphNodeField(id="project_id", label="Group", type="select", required=False, options=_project_options(), help_text="Optional Media Studio group/project for the saved video."),
        GraphNodeField(id="filename_prefix", label="Filename Prefix", type="text", required=False, default="graph-video", hidden=True),
        GraphNodeField(id="format", label="Format", type="select", required=True, default="source_original", options=SAVE_VIDEO_FORMAT_OPTIONS, help_text="Use Source Original unless a bounded transcode is needed."),
        GraphNodeField(id="codec", label="Codec", type="select", required=False, default="auto", options=SAVE_VIDEO_CODEC_OPTIONS, hidden=True),
        GraphNodeField(id="crf", label="CRF", type="integer", required=False, default=23, min=0, max=51, advanced=True, hidden=True),
        GraphNodeField(id="audio_policy", label="Audio", type="select", required=False, default="keep_video_audio", options=SAVE_VIDEO_AUDIO_POLICY_OPTIONS, help_text="Use a connected audio input to replace or mix the saved video's audio."),
        GraphNodeField(id="audio_fit", label="Audio Fit", type="select", required=False, default="trim_to_video", options=SAVE_VIDEO_AUDIO_FIT_OPTIONS, visible_if={"field": "audio_policy", "in": ["replace", "mix"]}),
        GraphNodeField(id="audio_offset_seconds", label="Audio Offset", type="float", required=False, default=0, min=0, max=600, visible_if={"field": "audio_policy", "in": ["replace", "mix"]}),
        GraphNodeField(id="audio_volume", label="Audio Volume", type="float", required=False, default=1, min=0, max=4, visible_if={"field": "audio_policy", "in": ["replace", "mix"]}),
        GraphNodeField(id="video_audio_volume", label="Video Audio Volume", type="float", required=False, default=1, min=0, max=4, visible_if={"field": "audio_policy", "equals": "mix"}),
        GraphNodeField(id="include_metadata", label="Include Metadata", type="boolean", required=False, default=True, advanced=True, hidden=True),
        GraphNodeField(id="label", label="Label", type="text", required=False, hidden=True),
    ]


def _save_audio_fields() -> List[GraphNodeField]:
    return [
        GraphNodeField(id="project_id", label="Group", type="select", required=False, options=_project_options(), help_text="Optional Media Studio group/project for the saved audio."),
        GraphNodeField(id="filename_prefix", label="Filename Prefix", type="text", required=False, default="graph-audio", hidden=True),
        GraphNodeField(id="format", label="Format", type="select", required=False, default="source_original", options=SAVE_AUDIO_FORMAT_OPTIONS, help_text="Use Source Original unless a bounded audio transcode is needed."),
        GraphNodeField(id="include_metadata", label="Include Metadata", type="boolean", required=False, default=True, advanced=True, hidden=True),
        GraphNodeField(id="label", label="Label", type="text", required=False, hidden=True),
    ]


def media_node_definitions() -> List[GraphNodeDefinition]:
    return [
        GraphNodeDefinition(
            type="media.load_image",
            title="Load Image",
            description="Load an existing Media Studio asset or reference image.",
            category="Media",
            search_aliases=["asset", "reference", "input", "image"],
            tags=["media", "image", "input"],
            source={"kind": "system"},
            execution={"executor": "media.load_image", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_file_bytes": 104857600, "media_types": ["image"]},
            ui={"default_size": {"width": 280, "height": 260}, "accent": "green", "icon": "image"},
            ports={
                "inputs": [],
                "outputs": [GraphNodePort(id="image", label="Image", type="image")],
            },
            fields=[
                GraphNodeField(id="asset_id", label="Asset ID", type="asset_picker", required=False),
                GraphNodeField(id="reference_id", label="Reference ID", type="reference_media_picker", required=False),
            ],
        ),
        GraphNodeDefinition(
            type="media.load_video",
            title="Load Video",
            description="Load an existing Media Studio video asset or reference video.",
            category="Media",
            search_aliases=["asset", "reference", "input", "video"],
            tags=["media", "video", "input"],
            source={"kind": "system"},
            execution={"executor": "media.load_video", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_file_bytes": 524288000, "media_types": ["video"]},
            ui={"default_size": {"width": 300, "height": 280}, "accent": "cyan", "icon": "video"},
            ports={"inputs": [], "outputs": [GraphNodePort(id="video", label="Video", type="video")]},
            fields=[
                GraphNodeField(id="asset_id", label="Asset ID", type="asset_picker", required=False),
                GraphNodeField(id="reference_id", label="Reference ID", type="reference_media_picker", required=False),
            ],
        ),
        GraphNodeDefinition(
            type="media.load_audio",
            title="Load Audio",
            description="Load an existing Media Studio audio reference.",
            category="Media",
            search_aliases=["reference", "input", "audio", "sound"],
            tags=["media", "audio", "input"],
            source={"kind": "system"},
            execution={"executor": "media.load_audio", "mode": "sync", "cacheable": True, "output_node": False},
            limits={"max_file_bytes": 104857600, "media_types": ["audio"]},
            ui={"default_size": {"width": 300, "height": 220}, "accent": "cyan", "icon": "audio"},
            ports={"inputs": [], "outputs": [GraphNodePort(id="audio", label="Audio", type="audio")]},
            fields=[
                GraphNodeField(id="reference_id", label="Reference ID", type="reference_media_picker", required=False),
            ],
        ),
        GraphNodeDefinition(
            type="media.save_image",
            title="Save Image",
            description="Expose an image as a normal Media Studio graph output.",
            category="Media",
            search_aliases=["save", "output", "asset"],
            tags=["media", "image", "output"],
            source={"kind": "system"},
            execution={"executor": "media.save_image", "mode": "sync", "cacheable": False, "output_node": True},
            limits={"max_inputs": 25, "media_types": ["image"]},
            ui={"default_size": {"width": 280, "height": 320}, "accent": "yellow", "icon": "save"},
            ports={
                "inputs": [GraphNodePort(id="image", label="Image", type="image", array=True, required=True, min=1, max=25, accepts=["image"])],
                "outputs": [GraphNodePort(id="asset", label="Asset", type="asset", array=True)],
            },
            fields=_save_media_fields(),
        ),
        GraphNodeDefinition(
            type="media.save_images",
            title="Save Images",
            description="Save an array of images as normal Media Studio gallery assets.",
            category="Media",
            search_aliases=["save", "output", "asset", "images", "batch"],
            tags=["media", "image", "output", "batch"],
            source={"kind": "system"},
            execution={"executor": "media.save_images", "mode": "sync", "cacheable": False, "output_node": True},
            limits={"max_inputs": 25, "media_types": ["image"]},
            ui={"default_size": {"width": 320, "height": 360}, "accent": "yellow", "icon": "save", "preview": True},
            ports={
                "inputs": [GraphNodePort(id="images", label="Images", type="image", array=True, required=True, min=1, max=25, accepts=["image"])],
                "outputs": [GraphNodePort(id="assets", label="Assets", type="asset", array=True)],
            },
            fields=[
                *_save_media_fields(),
                GraphNodeField(
                    id="naming_pattern",
                    label="Naming Pattern",
                    type="text",
                    required=False,
                    default="Slice {index}",
                    help_text="Use {index}, {row}, and {column} when slice metadata is available.",
                ),
            ],
        ),
        GraphNodeDefinition(
            type="media.save_video",
            title="Save Video",
            description="Expose a video as a normal Media Studio graph output.",
            category="Media",
            search_aliases=["save", "output", "asset", "video"],
            tags=["media", "video", "output"],
            source={"kind": "system"},
            execution={"executor": "media.save_video", "mode": "sync", "cacheable": False, "output_node": True},
            limits={"max_inputs": 2, "media_types": ["video", "audio"], "max_audio_bytes": 104857600, "max_duration_seconds": 600},
            ui={"default_size": {"width": 320, "height": 520}, "accent": "yellow", "icon": "save"},
            ports={
                "inputs": [
                    GraphNodePort(id="video", label="Video", type="video", required=True, min=1, max=1, accepts=["video"]),
                    GraphNodePort(id="audio", label="Audio", type="audio", required=False, min=0, max=1, accepts=["audio"]),
                ],
                "outputs": [
                    GraphNodePort(id="asset", label="Asset", type="asset"),
                    GraphNodePort(id="video", label="Video", type="video"),
                ],
            },
            fields=_save_video_fields(),
        ),
        GraphNodeDefinition(
            type="media.save_audio",
            title="Save Audio",
            description="Expose an audio file as a graph output.",
            category="Media",
            search_aliases=["save", "output", "asset", "audio"],
            tags=["media", "audio", "output"],
            source={"kind": "system"},
            execution={"executor": "media.save_audio", "mode": "sync", "cacheable": False, "output_node": True},
            limits={"max_inputs": 1, "media_types": ["audio"]},
            ui={"default_size": {"width": 300, "height": 260}, "accent": "yellow", "icon": "save"},
            ports={
                "inputs": [GraphNodePort(id="audio", label="Audio", type="audio", required=True, min=1, max=1, accepts=["audio"])],
                "outputs": [GraphNodePort(id="asset", label="Asset", type="asset")],
            },
            fields=_save_audio_fields(),
        ),
    ]
