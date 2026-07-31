from __future__ import annotations

from app.graph.normalization import materialize_workflow_defaults
from app.graph.schemas import GraphWorkflow


def test_graph_materialize_workflow_defaults_remaps_legacy_seedance_ports() -> None:
    workflow = {
        "schema_version": 1,
        "name": "Legacy Seedance ports",
        "nodes": [
            {"id": "image", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": "ref-image"}},
            {"id": "video", "type": "media.load_video", "position": {"x": 0, "y": 180}, "fields": {"reference_id": "ref-video"}},
            {"id": "audio", "type": "media.load_audio", "position": {"x": 0, "y": 360}, "fields": {"reference_id": "ref-audio"}},
            {"id": "model", "type": "model.kie.seedance_2_0", "position": {"x": 360, "y": 120}, "fields": {"duration": 5}},
        ],
        "edges": [
            {"id": "edge-image", "source": "image", "source_port": "image", "target": "model", "target_port": "image_refs"},
            {"id": "edge-video", "source": "video", "source_port": "video", "target": "model", "target_port": "video_refs"},
            {"id": "edge-audio", "source": "audio", "source_port": "audio", "target": "model", "target_port": "audio_refs"},
        ],
    }

    normalized = materialize_workflow_defaults(GraphWorkflow.model_validate(workflow))
    target_ports = {edge.target_port for edge in normalized.edges}
    assert target_ports == {"reference_images", "reference_videos", "reference_audios"}


def test_graph_materialize_workflow_defaults_remaps_legacy_save_asset_outputs() -> None:
    workflow = {
        "schema_version": 1,
        "name": "Legacy save output ports",
        "nodes": [
            {"id": "save-image", "type": "media.save_image", "position": {"x": 0, "y": 0}, "fields": {}},
            {"id": "save-images", "type": "media.save_images", "position": {"x": 0, "y": 200}, "fields": {}},
            {"id": "save-video", "type": "media.save_video", "position": {"x": 0, "y": 400}, "fields": {}},
            {"id": "save-audio", "type": "media.save_audio", "position": {"x": 0, "y": 600}, "fields": {}},
            {"id": "save-track", "type": "media.save_music_track", "position": {"x": 0, "y": 800}, "fields": {}},
            {"id": "display", "type": "display.any", "position": {"x": 360, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-image", "source": "save-image", "source_port": "asset", "target": "display", "target_port": "value"},
            {"id": "edge-images", "source": "save-images", "source_port": "assets", "target": "display", "target_port": "value"},
            {"id": "edge-video", "source": "save-video", "source_port": "asset", "target": "display", "target_port": "value"},
            {"id": "edge-audio", "source": "save-audio", "source_port": "asset", "target": "display", "target_port": "value"},
            {"id": "edge-track", "source": "save-track", "source_port": "asset", "target": "display", "target_port": "value"},
        ],
    }

    normalized = materialize_workflow_defaults(GraphWorkflow.model_validate(workflow))
    assert [edge.source_port for edge in normalized.edges] == ["image", "images", "video", "audio", "audio"]
