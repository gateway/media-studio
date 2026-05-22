from __future__ import annotations

from typing import List

from .schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort


def audio_node_definitions() -> List[GraphNodeDefinition]:
    return [
        GraphNodeDefinition(
            type="audio.transform",
            title="Audio Transform",
            description="Trim, convert, normalize, or inspect an audio reference.",
            category="Audio",
            search_aliases=["audio", "sound", "trim", "convert", "normalize", "metadata", "utility"],
            tags=["audio", "utility", "ffmpeg"],
            source={"kind": "system"},
            execution={"executor": "audio.transform", "mode": "sync", "cacheable": True, "output_node": False, "bypass_mode": {"input": "audio", "output": "audio"}},
            limits={"max_file_bytes": 104857600, "max_duration_seconds": 600, "timeout_seconds": 180},
            ui={"default_size": {"width": 320, "height": 380}, "accent": "cyan", "icon": "audio"},
            ports={
                "inputs": [GraphNodePort(id="audio", label="Audio", type="audio", required=True, min=1, max=1, accepts=["audio"])],
                "outputs": [
                    GraphNodePort(id="audio", label="Audio", type="audio"),
                    GraphNodePort(id="metadata", label="Metadata", type="json"),
                ],
            },
            fields=[
                GraphNodeField(
                    id="operation",
                    label="Operation",
                    type="select",
                    required=False,
                    default="extract_metadata",
                    options=[
                        {"value": "trim", "label": "Trim"},
                        {"value": "convert_format", "label": "Convert Format"},
                        {"value": "normalize", "label": "Normalize"},
                        {"value": "extract_metadata", "label": "Extract Metadata"},
                    ],
                ),
                GraphNodeField(id="start_seconds", label="Start", type="float", required=False, default=0, min=0, visible_if={"field": "operation", "equals": "trim"}),
                GraphNodeField(id="duration_seconds", label="Duration", type="float", required=False, default=5, min=0.1, max=600, visible_if={"field": "operation", "equals": "trim"}),
                GraphNodeField(
                    id="format",
                    label="Format",
                    type="select",
                    required=False,
                    default="mp3",
                    options=[{"value": "mp3", "label": "MP3"}, {"value": "wav", "label": "WAV"}, {"value": "m4a_aac", "label": "M4A AAC"}],
                    visible_if={"field": "operation", "in": ["trim", "convert_format", "normalize"]},
                ),
                GraphNodeField(id="target_lufs", label="Target LUFS", type="float", required=False, default=-16, min=-30, max=-6, visible_if={"field": "operation", "equals": "normalize"}),
            ],
        ),
    ]
