from __future__ import annotations

import base64
import json
import time
import shutil
import subprocess
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from app.graph.definition_validator import (
    GraphNodeDefinitionError,
    compatible_node_definitions,
    validate_node_definition,
)
from app.graph.executors.base import GraphExecutionContext
from app.graph.schemas import GraphOutputRef
from app.graph.executors.prompt_ops import _build_prompt_recipe_values, _is_storyboard_v2_recipe, _normalize_prompt_recipe_result, _prompt_recipe_image_refs, _sanitize_storyboard_v2_prompt_text
from app.graph.prompt_shaping import _extract_title, shape_kie_graph_prompt
from app.graph.prompt_recipe_catalog import prompt_recipe_input_ports, prompt_recipe_catalog
from app.graph.schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort, GraphWorkflow, GraphWorkflowEdge, GraphWorkflowNode

PNG_1X1_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _create_reference_image(app_modules) -> str:
    return _create_named_reference_image(app_modules, name="graph-source.png", sha="graph-source-hash")


def _create_named_reference_image(app_modules, *, name: str, sha: str | None = None) -> str:
    data_root = app_modules["main"].settings.data_root
    target = data_root / "reference-media" / "images" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(PNG_1X1_BYTES)
    record = app_modules["store"].create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": name,
            "stored_path": f"reference-media/images/{name}",
            "mime_type": "image/png",
            "file_size_bytes": len(PNG_1X1_BYTES),
            "sha256": sha or f"sha-{name}",
            "width": 1,
            "height": 1,
            "metadata_json": {},
        },
        increment_usage=False,
    )
    return record["reference_id"]


def _create_grid_reference_image(app_modules) -> str:
    image = Image.new("RGB", (4, 4), "white")
    pixels = image.load()
    colors = {
        (0, 0): (255, 0, 0),
        (1, 0): (0, 255, 0),
        (0, 1): (0, 0, 255),
        (1, 1): (255, 255, 0),
    }
    for row in range(2):
        for column in range(2):
            color = colors[(column, row)]
            for y in range(row * 2, row * 2 + 2):
                for x in range(column * 2, column * 2 + 2):
                    pixels[x, y] = color
    buffer = BytesIO()
    image.save(buffer, "PNG")
    record = app_modules["service"].import_reference_media_bytes(
        source_bytes=buffer.getvalue(),
        source_name="graph-grid.png",
        source_mime_type="image/png",
    )
    return record["reference_id"]


def _create_colored_reference_image(app_modules, *, name: str, color: tuple[int, int, int]) -> str:
    image = Image.new("RGB", (2, 2), color)
    buffer = BytesIO()
    image.save(buffer, "PNG")
    record = app_modules["service"].import_reference_media_bytes(
        source_bytes=buffer.getvalue(),
        source_name=name,
        source_mime_type="image/png",
    )
    return record["reference_id"]


def _create_reference_video(app_modules, *, color: str = "0x101414", name: str = "graph-video-source.mp4", duration: float = 1) -> str:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("ffmpeg is required for video transcode tests")
    data_root = app_modules["main"].settings.data_root
    target = data_root / name
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s=320x180:d={duration:g}",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(target),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    record = app_modules["service"].import_reference_media_bytes(
        source_bytes=target.read_bytes(),
        source_name=name,
        source_mime_type="video/mp4",
    )
    return record["reference_id"]


def _create_reference_audio(app_modules, *, name: str = "graph-audio-source.wav") -> str:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("ffmpeg is required for audio graph tests")
    data_root = app_modules["main"].settings.data_root
    target = data_root / name
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-ac",
            "1",
            "-ar",
            "44100",
            str(target),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    record = app_modules["service"].import_reference_media_bytes(
        source_bytes=target.read_bytes(),
        source_name=name,
        source_mime_type="audio/wav",
    )
    return record["reference_id"]


def _create_reference_video_with_audio(app_modules, *, name: str = "graph-video-with-audio.mp4") -> str:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        pytest.skip("ffmpeg is required for video audio graph tests")
    data_root = app_modules["main"].settings.data_root
    target = data_root / name
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0x24245a:s=320x180:d=1",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            "-movflags",
            "+faststart",
            str(target),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    record = app_modules["service"].import_reference_media_bytes(
        source_bytes=target.read_bytes(),
        source_name=name,
        source_mime_type="video/mp4",
    )
    return record["reference_id"]


def _run_graph_workflow(client, workflow: dict) -> dict:
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]
    final_payload = None
    for _ in range(80):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert final_payload is not None
    return final_payload


def _workflow(reference_id: str) -> dict:
    return {
        "schema_version": 1,
        "name": "Graph smoke",
        "nodes": [
            {
                "id": "load",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": reference_id},
            },
            {
                "id": "model",
                "type": "model.kie.nano_banana_pro",
                "position": {"x": 360, "y": 0},
                "fields": {"prompt": "Create a cinematic editorial image.", "resolution": "1K"},
            },
            {
                "id": "save",
                "type": "media.save_image",
                "position": {"x": 760, "y": 0},
                "fields": {"label": "Final"},
            },
        ],
        "edges": [
            {"id": "edge-load-model", "source": "load", "source_port": "image", "target": "model", "target_port": "image_refs"},
            {"id": "edge-model-save", "source": "model", "source_port": "image", "target": "save", "target_port": "image"},
        ],
    }


def _video_workflow(reference_id: str) -> dict:
    return {
        "schema_version": 1,
        "name": "Kling video smoke",
        "nodes": [
            {
                "id": "load",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": reference_id},
            },
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 260, "y": -220},
                "fields": {
                    "text": "A cinematic 5-second fashion-film shot of the woman stepping through a neon rain-soaked alley."
                },
            },
            {
                "id": "model",
                "type": "model.kie.kling_2_6_i2v",
                "position": {"x": 360, "y": 0},
                "fields": {"duration": 5, "sound": False},
            },
            {
                "id": "save",
                "type": "media.save_video",
                "position": {"x": 760, "y": 0},
                "fields": {
                    "filename_prefix": "kling-smoke",
                    "format": "source_original",
                    "codec": "auto",
                    "include_metadata": True,
                },
            },
        ],
        "edges": [
            {"id": "edge-load-model", "source": "load", "source_port": "image", "target": "model", "target_port": "image_refs"},
            {"id": "edge-prompt-model", "source": "prompt", "source_port": "text", "target": "model", "target_port": "prompt"},
            {"id": "edge-model-save", "source": "model", "source_port": "video", "target": "save", "target_port": "video"},
        ],
    }


def _save_reference_video_workflow(reference_id: str, *, format_preset: str = "mp4_h264_browser") -> dict:
    return {
        "schema_version": 1,
        "name": "Save reference video transcode",
        "nodes": [
            {
                "id": "load",
                "type": "media.load_video",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": reference_id},
            },
            {
                "id": "save",
                "type": "media.save_video",
                "position": {"x": 360, "y": 0},
                "fields": {
                    "filename_prefix": "reference-video",
                    "format": format_preset,
                    "codec": "auto",
                    "crf": 28,
                    "include_metadata": True,
                },
            },
        ],
        "edges": [
            {"id": "edge-load-save", "source": "load", "source_port": "video", "target": "save", "target_port": "video"},
        ],
    }


def _combine_video_workflow(reference_ids: list[str], *, transition: str = "hard_cut", save: bool = False) -> dict:
    nodes = [
        {
            "id": f"load-{index}",
            "type": "media.load_video",
            "position": {"x": 0, "y": index * 180},
            "fields": {"reference_id": reference_id},
        }
        for index, reference_id in enumerate(reference_ids, start=1)
    ]
    nodes.append(
        {
            "id": "combine",
            "type": "video.combine",
            "position": {"x": 420, "y": 0},
            "fields": {
                "clip_count": len(reference_ids),
                "transition": transition,
                "transition_duration_seconds": 0.25,
                "resolution_policy": "first_clip",
                "fps_policy": "fps_24",
                "output_format": "mp4",
                "quality_crf": 24,
                "title": "Combined fixture video",
            },
        }
    )
    edges = [
        {
            "id": f"edge-load-{index}-combine",
            "source": f"load-{index}",
            "source_port": "video",
            "target": "combine",
            "target_port": f"video_{index}",
        }
        for index in range(1, len(reference_ids) + 1)
    ]
    if save:
        nodes.append(
            {
                "id": "save",
                "type": "media.save_video",
                "position": {"x": 820, "y": 0},
                "fields": {
                    "filename_prefix": "combined-fixture",
                    "format": "source_original",
                    "codec": "auto",
                    "include_metadata": True,
                    "label": "Combined Fixture Video",
                },
            }
        )
        edges.append({"id": "edge-combine-save", "source": "combine", "source_port": "video", "target": "save", "target_port": "video"})
    return {
        "schema_version": 1,
        "name": "Video combine fixture",
        "nodes": nodes,
        "edges": edges,
    }


def test_graph_node_definitions_include_first_slice_nodes(client) -> None:
    response = client.get("/media/graph/node-definitions")
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    node_types = {item["type"] for item in items}
    assert {"prompt.text", "media.load_image", "model.kie.nano_banana_pro", "media.save_image"}.issubset(node_types)
    assert {
        "media.load_video",
        "media.save_video",
        "image.transform",
        "image.grid_slice",
        "image.split",
        "video.transform",
        "video.combine",
        "video.extract",
        "preview.image",
        "display.any",
        "debug.inspect",
        "debug.metadata",
        "utility.note",
        "preset.render",
        "prompt.concat",
        "prompt.image_analyzer",
        "prompt.recipe",
        "prompt.parse",
        "media.save_images",
    }.issubset(node_types)
    assert not {
        "image.resize",
        "image.crop",
        "image.pad",
        "image.convert_format",
        "image.extract_metadata",
        "video.resize",
        "video.trim",
        "video.extract_frames",
        "video.extract_audio",
        "video.poster_frame",
        "video.convert_container",
    }.intersection(node_types)
    nano = next(item for item in items if item["type"] == "model.kie.nano_banana_pro")
    assert nano["execution"]["mode"] == "async"
    assert "max_input_images" in nano["limits"]
    image_transform = next(item for item in items if item["type"] == "image.transform")
    assert image_transform["limits"]["max_dimension"] == 4096
    assert next(field for field in image_transform["fields"] if field["id"] == "operation")["default"] == "resize"
    image_analyzer = next(item for item in items if item["type"] == "prompt.image_analyzer")
    assert image_analyzer["execution"]["executor"] == "prompt.image_analyzer"
    assert image_analyzer["source"]["supports_images"] == "required"
    assert image_analyzer["limits"]["max_image_inputs"] == 1
    assert image_analyzer["ports"]["inputs"][0]["id"] == "image"
    assert image_analyzer["ports"]["inputs"][0]["required"] is True
    assert {port["id"] for port in image_analyzer["ports"]["outputs"]} == {"text", "result"}
    assert next(field for field in image_analyzer["fields"] if field["id"] == "mode")["default"] == "full_analysis"
    display_any = next(item for item in items if item["type"] == "display.any")
    assert display_any["category"] == "Preview"
    display_any_input = display_any["ports"]["inputs"][0]
    assert display_any_input["type"] == "any"
    assert display_any_input["array"] is False
    assert display_any_input["max"] == 1
    assert {"value", "json"} == {port["id"] for port in display_any["ports"]["outputs"]}
    assert display_any["ui"]["default_size"] == {"width": 460, "height": 520}
    assert display_any["ui"]["min_size"] == {"width": 360, "height": 320}
    assert display_any["ui"]["max_size"] == {"width": 2400, "height": 3200}
    note = next(item for item in items if item["type"] == "utility.note")
    assert note["category"] == "Utility"
    assert note["ports"] == {"inputs": [], "outputs": []}
    assert note["execution"]["executor"] == "utility.note"
    assert note["ui"]["markdown_preview_field"] == "body"
    note_body = next(field for field in note["fields"] if field["id"] == "body")
    assert note_body["type"] == "textarea"
    assert note_body["placeholder"] == "Write notes in Markdown..."
    video_extract = next(item for item in items if item["type"] == "video.extract")
    assert next(field for field in video_extract["fields"] if field["id"] == "operation")["default"] == "poster_frame"
    video_combine = next(item for item in items if item["type"] == "video.combine")
    assert next(field for field in video_combine["fields"] if field["id"] == "clip_count")["default"] == 4
    assert next(field for field in video_combine["fields"] if field["id"] == "transition")["default"] == "crossfade"
    assert any(port["id"] == "video_12" and port["advanced"] is True for port in video_combine["ports"]["inputs"])
    assert any(port["id"] == "video" and port["type"] == "video" for port in video_combine["ports"]["outputs"])
    generated_model_nodes = [item for item in items if item["type"].startswith("model.kie.")]
    assert generated_model_nodes
    assert all(item["source"]["kind"] == "kie_model" for item in generated_model_nodes)
    assert all(item.get("help_text") for item in generated_model_nodes)
    gpt_t2i = next(item for item in items if item["type"] == "model.kie.gpt_image_2_text_to_image")
    assert gpt_t2i["category"] == "Models/Image"
    assert gpt_t2i["source"]["output_media_type"] == "image"
    assert any(port["id"] == "image" and port["type"] == "image" for port in gpt_t2i["ports"]["outputs"])
    assert not any(port["type"] == "image" for port in gpt_t2i["ports"]["inputs"])
    save_image = next(item for item in items if item["type"] == "media.save_image")
    assert any(field["id"] == "project_id" and field["type"] == "select" for field in save_image["fields"])
    save_image_input = next(port for port in save_image["ports"]["inputs"] if port["id"] == "image")
    assert save_image_input["array"] is True
    assert save_image_input["max"] == 25
    split = next(item for item in items if item["type"] == "image.split")
    assert next(field for field in split["fields"] if field["id"] == "outputs")["default"] == 4
    assert len(split["ports"]["outputs"]) == 25
    assert split["ports"]["outputs"][0]["id"] == "image_1"
    assert split["ports"]["outputs"][3]["id"] == "image_4"
    kling = next(item for item in items if item["type"] == "model.kie.kling_2_6_i2v")
    assert kling["category"] == "Models/Video"
    assert kling["source"]["output_media_type"] == "video"
    assert any(port["id"] == "image_refs" and port["required"] is True and port["max"] == 1 for port in kling["ports"]["inputs"])
    assert not any(port["id"] == "video_refs" for port in kling["ports"]["inputs"])
    assert any(port["id"] == "video" and port["type"] == "video" for port in kling["ports"]["outputs"])
    kling_sound = next(field for field in kling["fields"] if field["id"] == "sound")
    kling_duration = next(field for field in kling["fields"] if field["id"] == "duration")
    assert kling_sound["type"] == "boolean"
    assert kling_sound["default"] is False
    assert kling_duration["options"] == [5, 10]
    assert kling_duration["default"] == 5
    kling_t2v = next(item for item in items if item["type"] == "model.kie.kling_2_6_t2v")
    assert next(field for field in kling_t2v["fields"] if field["id"] == "sound")["default"] is False
    assert next(field for field in kling_t2v["fields"] if field["id"] == "aspect_ratio")["default"] == "1:1"
    assert next(field for field in kling_t2v["fields"] if field["id"] == "duration")["default"] == 5
    kling_3 = next(item for item in items if item["type"] == "model.kie.kling_3_0_i2v")
    kling_3_inputs = kling_3["ports"]["inputs"]
    assert any(port["id"] == "start_frame" and port["label"] == "Start Frame" and port["required"] is True and port["max"] == 1 for port in kling_3_inputs)
    assert any(port["id"] == "end_frame" and port["label"] == "End Frame" and port["required"] is False and port["max"] == 1 for port in kling_3_inputs)
    assert not any(port["id"] == "image_refs" for port in kling_3_inputs)
    assert next(field for field in kling_3["fields"] if field["id"] == "duration")["default"] == 5
    kling_turbo = next(item for item in items if item["type"] == "model.kie.kling_3_0_turbo_i2v")
    kling_turbo_inputs = kling_turbo["ports"]["inputs"]
    assert kling_turbo["source"]["model_key"] == "kling-3.0-turbo-i2v"
    assert kling_turbo["source"]["output_media_type"] == "video"
    assert any(port["id"] == "image_refs" and port["label"] == "Reference Image" and port["required"] is True and port["max"] == 1 for port in kling_turbo_inputs)
    assert next(field for field in kling_turbo["fields"] if field["id"] == "duration")["default"] == 5
    assert "1080p" in next(field for field in kling_turbo["fields"] if field["id"] == "resolution")["options"]
    kling_3_motion = next(item for item in items if item["type"] == "model.kie.kling_3_0_motion")
    assert not any(field["id"] == "background_source" for field in kling_3_motion["fields"])
    seedance = next(item for item in items if item["type"] == "model.kie.seedance_2_0")
    seedance_inputs = seedance["ports"]["inputs"]
    assert any(port["id"] == "start_frame" and port["type"] == "image" and port["max"] == 1 for port in seedance_inputs)
    assert any(port["id"] == "end_frame" and port["type"] == "image" and port["max"] == 1 for port in seedance_inputs)
    assert any(port["id"] == "reference_images" and port["array"] is True and port["max"] == 9 for port in seedance_inputs)
    assert any(port["id"] == "reference_videos" and port["array"] is True and port["max"] == 3 for port in seedance_inputs)
    assert any(port["id"] == "reference_audios" and port["array"] is True and port["max"] == 3 for port in seedance_inputs)
    assert not any(port["id"] == "image_refs" for port in seedance_inputs)
    assert not any(port["id"] == "video_refs" for port in seedance_inputs)
    assert not any(port["id"] == "audio_refs" for port in seedance_inputs)
    seedance_outputs = seedance["ports"]["outputs"]
    assert any(port["id"] == "video" and port["type"] == "video" for port in seedance_outputs)
    assert any(
        port["id"] == "image"
        and port["label"] == "Last Frame"
        and port["type"] == "image"
        and port["visible_if"] == {"field": "return_last_frame", "equals": True}
        for port in seedance_outputs
    )
    assert next(field for field in seedance["fields"] if field["id"] == "duration")["default"] == 5
    assert next(field for field in seedance["fields"] if field["id"] == "return_last_frame")["label"] == "Output Last Frame"
    seedance_fast = next(item for item in items if item["type"] == "model.kie.seedance_2_0_fast")
    seedance_fast_inputs = seedance_fast["ports"]["inputs"]
    assert seedance_fast["source"]["model_key"] == "seedance-2.0-fast"
    assert any(port["id"] == "start_frame" and port["type"] == "image" and port["max"] == 1 for port in seedance_fast_inputs)
    assert any(port["id"] == "end_frame" and port["type"] == "image" and port["max"] == 1 for port in seedance_fast_inputs)
    assert any(port["id"] == "reference_images" and port["array"] is True and port["max"] == 9 for port in seedance_fast_inputs)
    assert any(port["id"] == "reference_videos" and port["array"] is True and port["max"] == 3 for port in seedance_fast_inputs)
    assert any(port["id"] == "reference_audios" and port["array"] is True and port["max"] == 3 for port in seedance_fast_inputs)
    assert any(port["id"] == "image" and port["label"] == "Last Frame" for port in seedance_fast["ports"]["outputs"])
    assert "720p" in next(field for field in seedance_fast["fields"] if field["id"] == "resolution")["options"]
    seedance_mini = next(item for item in items if item["type"] == "model.kie.seedance_2_0_mini")
    seedance_mini_inputs = seedance_mini["ports"]["inputs"]
    assert seedance_mini["source"]["model_key"] == "seedance-2.0-mini"
    assert any(port["id"] == "start_frame" and port["type"] == "image" and port["max"] == 1 for port in seedance_mini_inputs)
    assert any(port["id"] == "reference_images" and port["array"] is True and port["max"] == 9 for port in seedance_mini_inputs)
    assert any(port["id"] == "reference_videos" and port["array"] is True and port["max"] == 3 for port in seedance_mini_inputs)
    assert any(port["id"] == "reference_audios" and port["array"] is True and port["max"] == 3 for port in seedance_mini_inputs)
    assert any(port["id"] == "image" and port["label"] == "Last Frame" for port in seedance_mini["ports"]["outputs"])
    assert "480p" in next(field for field in seedance_mini["fields"] if field["id"] == "resolution")["options"]
    save_video = next(item for item in items if item["type"] == "media.save_video")
    assert any(field["id"] == "format" and field["default"] == "source_original" for field in save_video["fields"])
    assert any(port["id"] == "video" and port["type"] == "video" for port in save_video["ports"]["outputs"])
    assert any(port["id"] == "audio" and port["type"] == "audio" and port["required"] is False for port in save_video["ports"]["inputs"])
    assert any(field["id"] == "audio_policy" and field["default"] == "keep_video_audio" for field in save_video["fields"])
    save_audio = next(item for item in items if item["type"] == "media.save_audio")
    assert any(field["id"] == "format" and field["default"] == "source_original" for field in save_audio["fields"])
    save_music = next(item for item in items if item["type"] == "media.save_music_track")
    assert any(port["id"] == "track" and port["type"] == "music_track" and port["max"] == 1 for port in save_music["ports"]["inputs"])
    assert any(port["id"] == "audio" and port["type"] == "audio" for port in save_music["ports"]["outputs"])
    audio_transform = next(item for item in items if item["type"] == "audio.transform")
    assert any(field["id"] == "operation" and field["default"] == "extract_metadata" for field in audio_transform["fields"])
    suno = next(item for item in items if item["type"] == "model.kie.suno_generate_music")
    assert suno["category"] == "Models/Audio"
    assert suno["source"]["output_media_type"] == "audio"
    assert suno["source"]["task_modes"] == ["text_to_music"]
    assert any(port["id"] == "track_1" and port["type"] == "music_track" for port in suno["ports"]["outputs"])
    assert any(port["id"] == "track_2" and port["type"] == "music_track" for port in suno["ports"]["outputs"])
    assert not any(port["id"] == "cover_images" for port in suno["ports"]["outputs"])
    assert any(port["id"] == "song_description" and port["type"] == "text" for port in suno["ports"]["inputs"])
    assert any(port["id"] == "lyrics" and port["type"] == "text" for port in suno["ports"]["inputs"])
    assert not any(port["id"] == "prompt" for port in suno["ports"]["inputs"])
    assert not any(port["type"] in {"image", "video", "audio"} for port in suno["ports"]["inputs"])
    suno_fields = {field["id"]: field for field in suno["fields"]}
    assert "prompt" not in suno_fields
    assert suno_fields["suno_model"]["type"] == "select"
    assert "V5" in suno_fields["suno_model"]["options"]
    assert suno_fields["custom_mode"]["type"] == "boolean"
    assert suno_fields["song_description"]["type"] == "textarea"
    assert suno_fields["song_description"]["visible_if"] == {"field": "custom_mode", "not_equals": True}
    assert suno_fields["instrumental"]["type"] == "boolean"
    assert suno_fields["style"]["type"] == "textarea"
    assert suno_fields["style"]["visible_if"] == {"field": "custom_mode", "equals": True}
    assert suno_fields["title"]["type"] == "text"
    assert suno_fields["title"]["visible_if"] == {"field": "custom_mode", "equals": True}
    assert suno_fields["lyrics"]["type"] == "textarea"
    assert suno_fields["lyrics"]["visible_if"] == {"field": "custom_mode", "equals": True}
    assert suno_fields["vocal_gender"]["options"] == ["m", "f"]
    assert suno_fields["audio_weight"]["type"] == "float"


def test_graph_note_node_runs_without_ports(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Notes only",
        "nodes": [
            {
                "id": "note",
                "type": "utility.note",
                "position": {"x": 0, "y": 0},
                "fields": {"body": "# Plan\n\n- Connect source image\n- Run final model"},
            }
        ],
        "edges": [],
    }
    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed"
    note_node = next(node for node in final_payload["nodes"] if node["node_id"] == "note")
    assert note_node["status"] == "completed"
    assert note_node["output_snapshot_json"] == {}
    assert note_node["metrics_json"]["note_character_count"] == len("# Plan\n\n- Connect source image\n- Run final model")


def test_graph_run_summary_lists_do_not_embed_full_run_payloads(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Summary payload guard",
        "nodes": [
            {
                "id": "note",
                "type": "utility.note",
                "position": {"x": 0, "y": 0},
                "fields": {"body": "Keep history lightweight."},
            }
        ],
        "edges": [],
    }
    final_payload = _run_graph_workflow(client, workflow)

    summary = client.get(f"/media/graph/workflows/{final_payload['workflow_id']}/runs/summary?limit=10")
    assert summary.status_code == 200, summary.text
    item = next(run for run in summary.json()["items"] if run["run_id"] == final_payload["run_id"])

    assert item["node_count"] == 1
    assert item["artifact_count"] == 0
    assert "workflow_json" not in item
    assert "compiled_graph_json" not in item
    assert "output_snapshot_json" not in item
    assert "nodes" not in item


def test_failed_graph_run_summary_reports_provider_credits_from_persisted_run_node(client, app_modules, monkeypatch) -> None:
    from app.graph.runtime import runtime

    workflow = {
        "schema_version": 1,
        "name": "Provider credit history",
        "nodes": [
            {
                "id": "model",
                "type": "model.kie.gpt_image_2_text_to_image",
                "position": {"x": 0, "y": 0},
                "fields": {"prompt": "A steel travel mug.", "aspect_ratio": "1:1", "resolution": "1K"},
            },
            {"id": "preview", "type": "preview.image", "position": {"x": 420, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-model-preview", "source": "model", "source_port": "image", "target": "preview", "target_port": "image"}
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow).json()
    run = runtime.create_run(created["workflow_id"], GraphWorkflow(**workflow), start=False)
    _, jobs = app_modules["store"].create_batch_and_jobs(
        {"status": "completed", "model_key": "gpt-image-2-text-to-image", "task_mode": "text_to_image"},
        [
            {
                "model_key": "gpt-image-2-text-to-image",
                "task_mode": "text_to_image",
                "status": "completed",
                "final_status_json": {"raw_response": {"data": {"creditsConsumed": 6}}},
            }
        ],
    )
    node_metrics = {"model": {"job_id": jobs[0]["job_id"]}}
    app_modules["store"].update_graph_run_node(
        run.run_id,
        "model",
        {"status": "completed", "metrics_json": node_metrics["model"]},
    )
    app_modules["store"].update_graph_run(run.run_id, {"status": "failed", "metrics_json": {"actual_cost_usd": 0.0}})
    queried_job_ids: list[list[str]] = []
    list_job_statuses_by_ids = app_modules["store"].list_job_statuses_by_ids
    monkeypatch.setattr(
        app_modules["store"],
        "list_job_statuses_by_ids",
        lambda job_ids: queried_job_ids.append(job_ids) or list_job_statuses_by_ids(job_ids),
    )
    monkeypatch.setattr(
        app_modules["store"],
        "get_job",
        lambda _job_id: pytest.fail("summary hydration must not query provider jobs individually"),
    )

    response = client.get(f"/media/graph/workflows/{created['workflow_id']}/runs/summary?limit=10")

    assert response.status_code == 200, response.text
    item = next(candidate for candidate in response.json()["items"] if candidate["run_id"] == run.run_id)
    assert item["status"] == "failed"
    assert item["metrics_json"]["actual_credits"] == 6
    assert item["metrics_json"]["actual_cost_usd"] == 0
    assert queried_job_ids == [[jobs[0]["job_id"]]]


def test_graph_node_definitions_include_valid_layout_metadata(client) -> None:
    response = client.get("/media/graph/node-definitions")
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    for item in items:
        definition = GraphNodeDefinition.model_validate(item)
        validate_node_definition(definition)
        assert {"default_size", "min_size", "max_size", "color", "accent", "icon", "preview", "field_layout"}.issubset(
            definition.ui.keys()
        )
        assert definition.ui["default_size"]["width"] >= definition.ui["min_size"]["width"]
        assert definition.ui["default_size"]["height"] >= definition.ui["min_size"]["height"]


def test_graph_save_nodes_expose_typed_media_outputs_not_asset_handles(client) -> None:
    response = client.get("/media/graph/node-definitions")
    assert response.status_code == 200, response.text
    definitions = {item["type"]: item for item in response.json()["items"]}

    expected_outputs = {
        "media.save_image": [("image", "image", True)],
        "media.save_images": [("images", "image", True)],
        "media.save_video": [("video", "video", False)],
        "media.save_audio": [("audio", "audio", True)],
        "media.save_music_track": [("audio", "audio", False)],
    }
    for node_type, expected in expected_outputs.items():
        outputs = definitions[node_type]["ports"]["outputs"]
        assert all(output["type"] != "asset" for output in outputs)
        assert [(output["id"], output["type"], output["array"]) for output in outputs] == expected


def test_graph_prompt_llm_definition_exposes_provider_image_and_text_contract(client) -> None:
    response = client.get("/media/graph/node-definitions")
    assert response.status_code == 200, response.text
    prompt_text = next(item for item in response.json()["items"] if item["type"] == "prompt.text")
    assert prompt_text["help_text"]
    assert any(port["id"] == "text" and port["type"] == "text" and port["required"] is False for port in prompt_text["ports"]["inputs"])
    prompt_text_fields = {field["id"]: field for field in prompt_text["fields"]}
    assert prompt_text_fields["mode"]["default"] == "replace"
    assert prompt_text_fields["text"]["connectable"] is True
    assert prompt_text_fields["text"]["port_type"] == "text"
    assert prompt_text["ui"]["default_size"] == {"width": 420, "height": 420}
    assert prompt_text["ui"]["min_size"] == {"width": 340, "height": 320}
    assert prompt_text["ui"]["max_size"] == {"width": 1100, "height": 1400}

    definition = next(item for item in response.json()["items"] if item["type"] == "prompt.llm")
    assert definition["category"] == "Prompt"
    assert definition["source"]["kind"] == "external_llm"
    assert definition["help_text"]
    assert any(port["id"] == "user_prompt" and port["type"] == "text" for port in definition["ports"]["inputs"])
    assert any(port["id"] == "image" and port["type"] == "image" and port["required"] is False for port in definition["ports"]["inputs"])
    assert any(port["id"] == "text" and port["type"] == "text" for port in definition["ports"]["outputs"])
    fields = {field["id"]: field for field in definition["fields"]}
    assert fields["provider"]["default"] == "studio_default"
    assert fields["model_id"]["visible_if"] == {"field": "provider", "not_equals": "studio_default"}
    assert fields["model_id"]["type"] == "provider_model_picker"
    assert fields["provider_model_label"]["hidden"] is True
    assert fields["provider_supports_images"]["hidden"] is True
    assert fields["provider_capabilities_json"]["hidden"] is True
    assert fields["temperature"]["required"] is False
    assert fields["temperature"]["default"] == ""
    assert fields["temperature"]["visible_if"] == {"field": "provider", "not_equals": "codex_local"}
    assert fields["max_tokens"]["required"] is False
    assert fields["max_tokens"]["default"] == ""
    assert fields["max_tokens"]["visible_if"] == {"field": "provider", "not_equals": "codex_local"}
    assert "[user_prompt]" in fields["system_prompt"]["help_text"]
    provider_options = {item["value"] for item in fields["provider"]["options"]}
    assert "codex_local" in provider_options


def test_graph_prompt_llm_runs_text_only_image_and_connected_prompt_workflows(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules)
    calls = []

    def fake_prompt_node(**kwargs):
        calls.append(kwargs)
        return {
            "provider_kind": kwargs["provider_kind"],
            "provider_model_id": kwargs["model_id"],
            "generated_text": f"generated::{kwargs['mode']}::{kwargs['user_prompt'] or 'image'}",
            "warnings": [],
        }

    monkeypatch.setattr(
        "app.graph.executors.prompt_ops.enhancement_provider.run_openai_compatible_prompt_node",
        fake_prompt_node,
    )

    workflows = [
        {
            "schema_version": 1,
            "name": "LLM Prompt text-only smoke",
            "nodes": [
                {
                    "id": "llm",
                    "type": "prompt.llm",
                    "position": {"x": 0, "y": 0},
                    "fields": {
                        "provider": "local_openai",
                    "model_id": "local-text-model",
                    "mode": "rewrite_prompt",
                    "system_prompt": "Make [user_prompt] cinematic.",
                    "user_prompt": "a neon city street",
                },
            }
        ],
            "edges": [],
        },
        {
            "schema_version": 1,
            "name": "LLM Prompt image smoke",
            "nodes": [
                {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
                {
                    "id": "llm",
                    "type": "prompt.llm",
                    "position": {"x": 360, "y": 0},
                    "fields": {
                        "provider": "local_openai",
                        "model_id": "local-vision-model",
                        "provider_supports_images": True,
                        "provider_capabilities_json": {"supports_images": True, "input_modalities": ["text", "image"]},
                        "mode": "describe_image",
                        "system_prompt": "Describe the attached image for a video model.",
                        "image_instruction": "Call out subject, composition, lighting, and style.",
                        "temperature": 0.1,
                        "max_tokens": 300,
                    },
                },
            ],
            "edges": [{"id": "edge-load-llm", "source": "load", "source_port": "image", "target": "llm", "target_port": "image"}],
        },
        {
            "schema_version": 1,
            "name": "LLM Prompt connected text smoke",
            "nodes": [
                {
                    "id": "prompt",
                    "type": "prompt.text",
                    "position": {"x": 0, "y": 0},
                    "fields": {"text": "turn this into sci-fi fantasy"},
                },
                {
                    "id": "llm",
                    "type": "prompt.llm",
                    "position": {"x": 360, "y": 0},
                    "fields": {
                        "provider": "local_openai",
                        "model_id": "local-text-model",
                        "mode": "custom",
                        "system_prompt": "Use {user_prompt} as the idea and output one final prompt.",
                        "user_prompt": "this fallback should be ignored",
                        "temperature": 0.3,
                        "max_tokens": 512,
                    },
                },
            ],
            "edges": [
                {
                    "id": "edge-prompt-llm",
                    "source": "prompt",
                    "source_port": "text",
                    "target": "llm",
                    "target_port": "user_prompt",
                }
            ],
        },
    ]

    saved_workflow_ids = []
    for workflow in workflows:
        final_payload = _run_graph_workflow(client, workflow)
        assert final_payload["status"] == "completed", final_payload.get("error")
        saved_workflow_ids.append(final_payload["workflow_id"])
        llm_node = next(node for node in final_payload["nodes"] if node["node_id"] == "llm")
        assert llm_node["status"] == "completed"
        assert llm_node["output_snapshot_json"]["text"][0]["value"].startswith("generated::")

    assert len(saved_workflow_ids) == 3
    assert calls[0]["image_paths"] == []
    assert calls[0]["user_prompt"] == "a neon city street"
    assert calls[0]["temperature"] is None
    assert calls[0]["max_tokens"] is None
    assert len(calls[1]["image_paths"]) == 1
    assert calls[1]["mode"] == "describe_image"
    assert calls[2]["user_prompt"] == "turn this into sci-fi fantasy"


def test_graph_prompt_llm_runs_with_codex_local_provider(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.graph.executors.prompt_ops.enhancement_provider.run_codex_local_prompt_node",
        lambda **kwargs: {
            "provider_kind": "codex_local",
            "provider_model_id": kwargs["model_id"],
            "generated_text": "codex local prompt output",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            "warnings": [],
        },
    )

    workflow = {
        "schema_version": 1,
        "name": "LLM Prompt codex local smoke",
        "nodes": [
            {
                "id": "llm",
                "type": "prompt.llm",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "provider": "codex_local",
                    "model_id": "gpt-5.4",
                    "mode": "rewrite_prompt",
                    "system_prompt": "Make [user_prompt] sharper.",
                    "user_prompt": "a foggy harbor at sunrise",
                },
            }
        ],
        "edges": [],
    }

    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed", final_payload.get("error")
    llm_node = next(node for node in final_payload["nodes"] if node["node_id"] == "llm")
    assert llm_node["output_snapshot_json"]["text"][0]["value"] == "codex local prompt output"


def test_graph_image_analyzer_runs_with_required_image_and_outputs_text_result(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules)
    calls = []

    def fake_chat(**kwargs):
        calls.append(kwargs)
        return {
            "provider_kind": kwargs["provider_kind"],
            "provider_model_id": kwargs["model_id"],
            "provider_base_url": kwargs["base_url"],
            "generated_text": "Detailed visible analysis for the connected reference image.",
            "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
        }

    monkeypatch.setattr("app.graph.executors.prompt_ops.enhancement_provider.run_openai_compatible_chat", fake_chat)

    workflow = {
        "schema_version": 1,
        "name": "Image Analyzer smoke",
        "nodes": [
            {
                "id": "load",
                "type": "media.load_image",
                "position": {"x": -320, "y": 0},
                "fields": {"reference_id": reference_id},
            },
            {
                "id": "analyze",
                "type": "prompt.image_analyzer",
                "position": {"x": 80, "y": 0},
                "fields": {
                    "provider": "local_openai",
                    "model_id": "local-vision-model",
                    "provider_supports_images": True,
                    "mode": "full_analysis",
                    "analysis_goal": "Focus on reusable style traits.",
                    "system_prompt": "Analyze visible traits for Media Studio.",
                    "temperature": 0.1,
                    "max_tokens": 900,
                },
            },
        ],
        "edges": [
            {"id": "edge-load-analyze", "source": "load", "source_port": "image", "target": "analyze", "target_port": "image"},
        ],
    }

    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed", final_payload.get("error")
    analyze_node = next(node for node in final_payload["nodes"] if node["node_id"] == "analyze")
    assert analyze_node["output_snapshot_json"]["text"][0]["value"] == "Detailed visible analysis for the connected reference image."
    result = analyze_node["output_snapshot_json"]["result"][0]["value"]
    assert result["mode"] == "full_analysis"
    assert result["type"] == "image_analysis"
    assert result["provider_model_id"] == "local-vision-model"
    assert result["analysis_goal"] == "Focus on reusable style traits."
    assert calls[0]["error_context"] == "image analyzer"
    assert calls[0]["temperature"] == 0.1
    assert calls[0]["max_tokens"] == 900
    user_message = calls[0]["messages"][1]["content"]
    assert any(item.get("type") == "image_url" for item in user_message)


def test_graph_image_analyzer_validation_requires_image_input(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Image Analyzer invalid",
        "nodes": [
            {
                "id": "analyze",
                "type": "prompt.image_analyzer",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "provider": "local_openai",
                    "model_id": "local-vision-model",
                    "provider_supports_images": True,
                },
            }
        ],
        "edges": [],
    }

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert payload["valid"] is False
    assert any("image" in issue["message"].lower() for issue in payload["errors"])


def test_graph_estimate_treats_codex_local_prompt_nodes_as_subscription_included(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Codex pricing smoke",
        "nodes": [
            {
                "id": "llm",
                "type": "prompt.llm",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "provider": "codex_local",
                    "model_id": "gpt-5.4",
                    "mode": "rewrite_prompt",
                    "system_prompt": "Rewrite [user_prompt].",
                    "user_prompt": "cinematic skyline",
                },
            }
        ],
        "edges": [],
    }

    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["pricing_summary"]["pricing_status"] == "subscription_included"
    assert payload["pricing_summary"]["has_unknown_pricing"] is False
    assert payload["nodes"]["llm"]["pricing_summary"]["pricing_status"] == "subscription_included"


def test_graph_prompt_text_accepts_connected_text_input(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Prompt Text connected input smoke",
        "nodes": [
            {"id": "source", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "upstream prompt"}},
            {"id": "replace", "type": "prompt.text", "position": {"x": 360, "y": 0}, "fields": {"mode": "replace", "text": "typed fallback"}},
            {"id": "append", "type": "prompt.text", "position": {"x": 360, "y": 360}, "fields": {"mode": "append", "text": "typed suffix"}},
            {"id": "inspect", "type": "debug.inspect", "position": {"x": 760, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-source-replace", "source": "source", "source_port": "text", "target": "replace", "target_port": "text"},
            {"id": "edge-source-append", "source": "source", "source_port": "text", "target": "append", "target_port": "text"},
            {"id": "edge-replace-inspect", "source": "replace", "source_port": "text", "target": "inspect", "target_port": "value"},
            {"id": "edge-append-inspect", "source": "append", "source_port": "text", "target": "inspect", "target_port": "value"},
        ],
    }

    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed", final_payload.get("error")
    replace_node = next(node for node in final_payload["nodes"] if node["node_id"] == "replace")
    append_node = next(node for node in final_payload["nodes"] if node["node_id"] == "append")
    assert replace_node["output_snapshot_json"]["text"][0]["value"] == "upstream prompt"
    assert replace_node["output_snapshot_json"]["text"][0]["metadata"]["connected_input_count"] == 1
    assert append_node["output_snapshot_json"]["text"][0]["value"] == "upstream prompt\n\ntyped suffix"
    inspect_node = next(node for node in final_payload["nodes"] if node["node_id"] == "inspect")
    inspected_values = [item["value"] for item in inspect_node["output_snapshot_json"]["json"][0]["value"]]
    assert inspected_values == ["upstream prompt", "upstream prompt\n\ntyped suffix"]


def test_graph_prompt_recipe_definitions_include_generic_node_catalog(client, app_modules) -> None:
    store = app_modules["store"]
    store.create_or_update_prompt_recipe(
        {
            "recipe_id": "prompt-recipe-archived-graph-test",
            "key": "archived-graph-test",
            "label": "Archived Graph Test",
            "description": "Archived graph recipe definition smoke",
            "category": "utility",
            "status": "archived",
            "system_prompt_template": "SOURCE PROMPT:\n{{source_prompt}}\n\nReturn only the shortened prompt.",
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text"},
            "input_variables_json": [
                {
                    "key": "source_prompt",
                    "token": "{{source_prompt}}",
                    "label": "Source Prompt",
                    "enabled": True,
                    "required": True,
                    "default_value": "",
                    "description": "Prompt to shorten.",
                }
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": False, "required": False, "mode": "none", "analysis_variable": "image_analysis", "max_files": 0},
            "default_options_json": {"temperature": 0.2, "max_output_tokens": 800},
            "rules_json": {"allow_external_variables": True, "return_only_final_output": True},
            "validation_warnings_json": [],
            "source_kind": "custom",
            "version": "1",
            "priority": 1,
        }
    )

    response = client.post("/media/graph/node-definitions/refresh")
    assert response.status_code == 200, response.text
    items = response.json()["items"]

    generic = next(item for item in items if item["type"] == "prompt.recipe")
    assert generic["source"]["kind"] == "external_llm"
    assert generic["source"]["recipe_backed"] is True
    assert any(field["id"] == "recipe_category" for field in generic["fields"])
    assert any(field["id"] == "recipe_id" and field["type"] == "prompt_recipe_picker" for field in generic["fields"])
    assert any(field["id"] == "provider" and field["advanced"] is True for field in generic["fields"])
    assert any(field["id"] == "temperature" and field["advanced"] is True for field in generic["fields"])
    assert any(field["id"] == "max_tokens" and field["advanced"] is True for field in generic["fields"])
    assert generic["source"]["recipe_catalog"]
    assert any(item["recipe_id"] == "prompt-recipe-archived-graph-test" and item["status"] == "archived" for item in generic["source"]["recipe_catalog"])
    assert any(item["recipe_id"] == "prompt-recipe-image-prompt-director" and item["selection_summary"]["title"] == "Image Prompt Director" for item in generic["source"]["recipe_catalog"])
    assert any(
        port["id"] == "image_refs"
        and port["type"] == "image"
        and port["array"] is True
        and int(port["max"] or 0) >= 4
        for port in generic["ports"]["inputs"]
    )
    assert not any(item["type"].startswith("prompt.recipe.") for item in items)

    parse = next(item for item in items if item["type"] == "prompt.parse")
    parse_output_ids = {port["id"] for port in parse["ports"]["outputs"]}
    assert {"result", "prompt_1", "prompt_12"}.issubset(parse_output_ids)


def test_graph_prompt_recipe_nodes_require_saved_recipe_id(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Prompt Recipe saved recipe",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-image-prompt-director",
                    "user_prompt": "Create a cinematic portrait prompt.",
                    "style_direction": "cinematic realism",
                    "aspect_ratio": "16:9",
                    "provider": "openrouter",
                    "model_id": "openai/gpt-4o-mini",
                    "provider_supports_images": True,
                },
            }
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    payload = created.json()
    recipe_node = next(node for node in payload["workflow_json"]["nodes"] if node["id"] == "recipe")
    assert recipe_node["type"] == "prompt.recipe"
    assert recipe_node["fields"]["recipe_id"] == "prompt-recipe-image-prompt-director"
    assert recipe_node["fields"]["recipe_category"] == "image"

    templates = client.get("/media/graph/templates")
    assert templates.status_code == 200, templates.text
    single_image_template = next(item for item in templates.json()["items"] if item["template_id"] == "graph-template-prompt-recipe-single-image-director")
    template_recipe = next(node for node in single_image_template["workflow_json"]["nodes"] if node["id"] == "recipe")
    assert template_recipe["type"] == "prompt.recipe"
    assert template_recipe["fields"]["recipe_id"] == "prompt-recipe-image-prompt-director"


def test_graph_prompt_recipe_runs_text_multi_image_and_structured_parse_workflows(client, app_modules, monkeypatch) -> None:
    store = app_modules["store"]
    data_root = app_modules["main"].settings.data_root
    red_ref = _create_colored_reference_image(app_modules, name="prompt-recipe-red.png", color=(255, 0, 0))
    green_ref = _create_colored_reference_image(app_modules, name="prompt-recipe-green.png", color=(0, 255, 0))
    blue_ref = _create_colored_reference_image(app_modules, name="prompt-recipe-blue.png", color=(0, 0, 255))
    ordered_ref_ids = [green_ref, red_ref, blue_ref]
    expected_image_urls = []
    for reference_id in ordered_ref_ids:
        record = store.get_reference_media(reference_id)
        assert record is not None
        stored_path = data_root / str(record["stored_path"])
        mime_type = str(record["mime_type"] or "image/png")
        encoded = base64.b64encode(stored_path.read_bytes()).decode("ascii")
        expected_image_urls.append(f"data:{mime_type};base64,{encoded}")

    calls = []

    def fake_chat(**kwargs):
        calls.append(kwargs)
        if kwargs["error_context"] == "prompt recipe image analysis":
            return {
                "provider_kind": kwargs["provider_kind"],
                "provider_model_id": kwargs["model_id"],
                "generated_text": "Reference analysis for prompt recipe smoke.",
                "warnings": [],
            }
        if kwargs["response_format"]:
            return {
                "provider_kind": kwargs["provider_kind"],
                "provider_model_id": kwargs["model_id"],
                "generated_text": '{"shots":[{"shot_number":1,"title":"Shot 1","caption":"Start","camera":"wide","action":"advance","prompt":"Prompt 1"},{"shot_number":2,"title":"Shot 2","caption":"Turn","camera":"medium","action":"pivot","prompt":"Prompt 2"},{"shot_number":3,"title":"Shot 3","caption":"Rush","camera":"close","action":"run","prompt":"Prompt 3"},{"shot_number":4,"title":"Shot 4","caption":"Exit","camera":"tracking","action":"escape","prompt":"Prompt 4"}]}',
                "warnings": [],
            }
        return {
            "provider_kind": kwargs["provider_kind"],
            "provider_model_id": kwargs["model_id"],
            "generated_text": "Prompt recipe final text output.",
            "warnings": [],
        }

    monkeypatch.setattr("app.graph.executors.prompt_ops.enhancement_provider.run_openai_compatible_chat", fake_chat)

    text_workflow = {
        "schema_version": 1,
        "name": "Prompt Recipe text smoke",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-image-prompt-director",
                    "user_prompt": "Create a cinematic portrait prompt for a lone explorer.",
                    "external_variables_json": '{"aspect_ratio":"16:9","style_direction":"cinematic realism"}',
                    "provider": "local_openai",
                    "model_id": "local-text-model",
                    "temperature": 0.2,
                    "max_tokens": 600,
                },
            }
        ],
        "edges": [],
    }
    text_payload = _run_graph_workflow(client, text_workflow)
    assert text_payload["status"] == "completed", text_payload.get("error")
    recipe_node = next(node for node in text_payload["nodes"] if node["node_id"] == "recipe")
    assert recipe_node["output_snapshot_json"]["text"][0]["value"] == "Prompt recipe final text output."

    multi_image_workflow = {
        "schema_version": 1,
        "name": "Prompt Recipe multi image smoke",
        "nodes": [
            {"id": "load_green", "type": "media.load_image", "position": {"x": -400, "y": -200}, "fields": {"reference_id": green_ref}},
            {"id": "load_red", "type": "media.load_image", "position": {"x": -400, "y": 0}, "fields": {"reference_id": red_ref}},
            {"id": "load_blue", "type": "media.load_image", "position": {"x": -400, "y": 200}, "fields": {"reference_id": blue_ref}},
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 40, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-image-prompt-director",
                    "recipe_category": "image",
                    "user_prompt": "Use the references in order for face, body, and product continuity.",
                    "style_direction": "premium editorial realism",
                    "aspect_ratio": "16:9",
                    "provider": "local_openai",
                    "model_id": "local-vision-model",
                    "provider_supports_images": True,
                    "provider_capabilities_json": {"supports_images": True, "input_modalities": ["text", "image"]},
                    "temperature": 0.25,
                    "max_tokens": 800,
                },
            },
        ],
        "edges": [
            {"id": "edge-green", "source": "load_green", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
            {"id": "edge-red", "source": "load_red", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
            {"id": "edge-blue", "source": "load_blue", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
        ],
    }
    multi_payload = _run_graph_workflow(client, multi_image_workflow)
    assert multi_payload["status"] == "completed", multi_payload.get("error")
    multi_recipe_node = next(node for node in multi_payload["nodes"] if node["node_id"] == "recipe")
    assert multi_recipe_node["metrics_json"]["image_count"] == 3

    structured_workflow = {
        "schema_version": 1,
        "name": "Prompt Recipe parse smoke",
        "nodes": [
            {"id": "load_green", "type": "media.load_image", "position": {"x": -400, "y": -100}, "fields": {"reference_id": green_ref}},
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-video-director-multi-shot-json",
                    "recipe_category": "video",
                    "user_prompt": "Create four prompts for a cinematic escape scene.",
                    "style_direction": "cinematic sci-fi realism",
                    "shot_count": "4",
                    "duration_seconds": "5",
                    "provider": "local_openai",
                    "model_id": "local-vision-model",
                    "provider_supports_images": True,
                    "provider_capabilities_json": {"supports_images": True, "input_modalities": ["text", "image"]},
                    "temperature": 0.2,
                    "max_tokens": 1200,
                },
            },
            {"id": "parse", "type": "prompt.parse", "position": {"x": 420, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-green-recipe", "source": "load_green", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
            {"id": "edge-recipe-parse", "source": "recipe", "source_port": "result", "target": "parse", "target_port": "result"},
        ],
    }
    structured_payload = _run_graph_workflow(client, structured_workflow)
    assert structured_payload["status"] == "completed", structured_payload.get("error")
    parse_node = next(node for node in structured_payload["nodes"] if node["node_id"] == "parse")
    assert parse_node["output_snapshot_json"]["prompt_1"][0]["value"] == "Prompt 1"
    assert parse_node["output_snapshot_json"]["prompt_4"][0]["value"] == "Prompt 4"
    recipe_result = next(node for node in structured_payload["nodes"] if node["node_id"] == "recipe")
    assert "Shot 1" in recipe_result["output_snapshot_json"]["text"][0]["value"]
    assert "Prompt 4" in recipe_result["output_snapshot_json"]["text"][0]["value"]
    assert recipe_result["output_snapshot_json"]["result"][0]["value"]["prompts"] == ["Prompt 1", "Prompt 2", "Prompt 3", "Prompt 4"]

    assert len(calls) == 5
    text_call = calls[0]
    assert text_call["error_context"] == "prompt recipe execution"
    assert text_call["response_format"] is None
    assert isinstance(text_call["messages"][1]["content"], list)
    assert len([item for item in text_call["messages"][1]["content"] if item["type"] == "image_url"]) == 0
    assert "16:9" in str(text_call["messages"][0]["content"])
    assert "cinematic realism" in str(text_call["messages"][0]["content"])

    multi_analysis_call = calls[1]
    multi_final_call = calls[2]
    assert multi_analysis_call["error_context"] == "prompt recipe image analysis"
    assert multi_final_call["error_context"] == "prompt recipe execution"
    analysis_urls = [item["image_url"]["url"] for item in multi_analysis_call["messages"][1]["content"] if item["type"] == "image_url"]
    final_urls = [item["image_url"]["url"] for item in multi_final_call["messages"][1]["content"] if item["type"] == "image_url"]
    assert analysis_urls == expected_image_urls
    assert final_urls == expected_image_urls

    structured_final_call = calls[4]
    assert structured_final_call["response_format"] == {"type": "json_object"}


def test_graph_storyboard_continuation_recipe_runs_with_previous_board_context(client, app_modules, monkeypatch) -> None:
    character_sheet_ref = _create_colored_reference_image(app_modules, name="story-continuation-character.png", color=(20, 180, 120))
    previous_board_ref = _create_colored_reference_image(app_modules, name="story-continuation-board.png", color=(70, 40, 160))
    calls = []

    def fake_chat(**kwargs):
        calls.append(kwargs)
        return {
            "provider_kind": kwargs["provider_kind"],
            "provider_model_id": kwargs["model_id"],
            "generated_text": (
                "Storyboard Segment 2 prompt. Previous-board read: the character ended at the open portal. "
                "Continuation brief: she escapes the dungeon. SHOT: 01 setup. CAMERA: tracking. "
                "FRAMING: medium. ACTION: the character uses the amulet. MOTION: sparks pull the chains apart. "
                "DIALOG: . NOTES: handoff to battlements."
            ),
            "warnings": [],
        }

    monkeypatch.setattr("app.graph.executors.prompt_ops.enhancement_provider.run_openai_compatible_chat", fake_chat)

    workflow = {
        "schema_version": 1,
        "name": "Storyboard Continuation Recipe smoke",
        "nodes": [
            {"id": "character-sheet", "type": "media.load_image", "position": {"x": -420, "y": -140}, "fields": {"reference_id": character_sheet_ref}},
            {"id": "previous-board", "type": "media.load_image", "position": {"x": -420, "y": 180}, "fields": {"reference_id": previous_board_ref}},
            {
                "id": "continuation",
                "type": "prompt.recipe",
                "position": {"x": 80, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-storyboard-continuation-v1",
                    "recipe_category": "image",
                    "previous_storyboard_prompt": "Storyboard 1 ends with the character trapped at an open dungeon portal.",
                    "continuation_brief": "The character uses the green amulet to melt the chains, escapes the cell, and reaches the battlements.",
                    "segment_number": "2",
                    "total_segments": "3",
                    "target_duration_seconds": "15",
                    "panel_count": "6",
                    "dialogue_mode": "light",
                    "style_direction": "dark cinematic fantasy storyboard",
                    "provider": "local_openai",
                    "model_id": "local-vision-model",
                    "provider_supports_images": True,
                    "provider_capabilities_json": {"supports_images": True, "input_modalities": ["text", "image"]},
                    "temperature": 0.2,
                    "max_tokens": 1200,
                },
            },
        ],
        "edges": [
            {"id": "edge-character-continuation", "source": "character-sheet", "source_port": "image", "target": "continuation", "target_port": "character_ref"},
            {"id": "edge-board-continuation", "source": "previous-board", "source_port": "image", "target": "continuation", "target_port": "additional_refs"},
        ],
    }

    payload = _run_graph_workflow(client, workflow)

    assert payload["status"] == "completed", payload.get("error")
    assert len(calls) == 1
    call = calls[0]
    assert call["error_context"] == "prompt recipe execution"
    rendered_template = call["messages"][0]["content"]
    assert "PREVIOUS STORYBOARD PROMPT OR HANDOFF" in rendered_template
    assert "Storyboard 1 ends with the character trapped at an open dungeon portal." in rendered_template
    assert "CONTINUATION BRIEF" in rendered_template
    assert "uses the green amulet to melt the chains" in rendered_template
    assert "SEGMENT NUMBER:\n2" in rendered_template
    assert "TOTAL SEGMENTS:\n3" in rendered_template
    assert "TARGET DURATION SECONDS:\n15" in rendered_template
    assert "PANEL COUNT:\n6" in rendered_template
    assert "DIALOGUE MODE:\nlight" in rendered_template
    assert "End with a clear visual handoff into the next storyboard segment" in rendered_template
    assert "Use SHOT once as the heading above each image: a two-digit number and short title" in rendered_template
    assert "Do not repeat SHOT below the image" in rendered_template
    assert "Do not include raw assistant debug language" in rendered_template
    final_content = call["messages"][1]["content"]
    assert len([item for item in final_content if item["type"] == "image_url"]) == 2
    continuation_node = next(node for node in payload["nodes"] if node["node_id"] == "continuation")
    assert "Storyboard Segment 2 prompt" in continuation_node["output_snapshot_json"]["text"][0]["value"]
    assert continuation_node["metrics_json"]["image_count"] == 2


def test_graph_storyboard_v2_recipe_runs_with_character_only_context(client, app_modules, monkeypatch) -> None:
    character_sheet_ref = _create_colored_reference_image(app_modules, name="storyboard-v2-character-only.png", color=(180, 40, 120))
    calls = []

    def fake_chat(**kwargs):
        calls.append(kwargs)
        return {
            "provider_kind": kwargs["provider_kind"],
            "provider_model_id": kwargs["model_id"],
            "generated_text": (
                "Create a 3x2 storyboard sheet where Sadi escapes the moonlit corridor. "
                "SHOT: 01 Setup. CAMERA: wide tracking. FRAMING: full body. "
                "ACTION: Sadi checks the locked archway. MOTION: torch smoke drifts. "
                "DIALOG: . NOTES: corridor geometry stays consistent."
            ),
            "warnings": [],
        }

    monkeypatch.setattr("app.graph.executors.prompt_ops.enhancement_provider.run_openai_compatible_chat", fake_chat)

    workflow = {
        "schema_version": 1,
        "name": "Storyboard v2 character-only smoke",
        "nodes": [
            {"id": "character-sheet", "type": "media.load_image", "position": {"x": -420, "y": 0}, "fields": {"reference_id": character_sheet_ref}},
            {
                "id": "storyboard",
                "type": "prompt.recipe",
                "position": {"x": 80, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-storyboard-v2-gpt-image-2",
                    "recipe_category": "image",
                    "user_prompt": "Create a 6-panel storyboard for a character named Sadi escaping a moonlit corridor.",
                    "previous_output": "No previous board handoff provided.",
                    "style_direction": "dark cinematic fantasy storyboard",
                    "shot_count": "6",
                    "aspect_ratio": "16:9",
                    "dialogue_mode": "light",
                    "provider": "local_openai",
                    "model_id": "local-vision-model",
                    "provider_supports_images": True,
                    "provider_capabilities_json": {"supports_images": True, "input_modalities": ["text", "image"]},
                    "temperature": 0.2,
                    "max_tokens": 1200,
                },
            },
        ],
        "edges": [
            {"id": "edge-character-storyboard", "source": "character-sheet", "source_port": "image", "target": "storyboard", "target_port": "character_ref"},
        ],
    }

    payload = _run_graph_workflow(client, workflow)

    assert payload["status"] == "completed", payload.get("error")
    assert len(calls) == 1
    call = calls[0]
    assert call["error_context"] == "prompt recipe execution"
    rendered_template = call["messages"][0]["content"]
    assert "When no Environment Sheet or location reference is connected" in rendered_template
    assert "derive the environment from USER STORY BRIEF" in rendered_template
    assert "OPTIONAL TEMPORAL EFFECT RULE PACK" in rendered_template
    assert "Use time-freeze rules only when USER STORY BRIEF explicitly requests" in rendered_template
    assert "NORMAL -> FREEZE TRIGGER -> FROZEN INTERVENTION -> UNFREEZE TRIGGER -> RESUMED" in rendered_template
    assert "For all other stories, do not mention time freeze" in rendered_template
    final_content = call["messages"][1]["content"]
    assert len([item for item in final_content if item["type"] == "image_url"]) == 1
    storyboard_node = next(node for node in payload["nodes"] if node["node_id"] == "storyboard")
    final_text = storyboard_node["output_snapshot_json"]["text"][0]["value"]
    assert "the character" in final_text
    assert "Sadi" not in final_text
    assert storyboard_node["metrics_json"]["image_count"] == 1


def test_graph_storyboard_v2_recipe_uses_environment_sheet_as_location_lock_only(client, app_modules, monkeypatch) -> None:
    character_sheet_ref = _create_colored_reference_image(app_modules, name="storyboard-v2-character.png", color=(180, 40, 120))
    environment_sheet_ref = _create_colored_reference_image(app_modules, name="storyboard-v2-environment.png", color=(30, 90, 160))
    calls = []

    def fake_chat(**kwargs):
        calls.append(kwargs)
        return {
            "provider_kind": kwargs["provider_kind"],
            "provider_model_id": kwargs["model_id"],
            "generated_text": (
                "Create a 3x2 storyboard sheet where Sadi crosses the clockwork observatory. "
                "SHOT: 01 Setup. CAMERA: overhead establishing. FRAMING: full body in the central aisle. "
                "ACTION: Sadi studies the brass star map. MOTION: gears rotate around the room. "
                "DIALOG: . NOTES: preserve observatory entrances and balcony geography."
            ),
            "warnings": [],
        }

    monkeypatch.setattr("app.graph.executors.prompt_ops.enhancement_provider.run_openai_compatible_chat", fake_chat)

    workflow = {
        "schema_version": 1,
        "name": "Storyboard v2 environment lock smoke",
        "nodes": [
            {"id": "character-sheet", "type": "media.load_image", "position": {"x": -420, "y": -140}, "fields": {"reference_id": character_sheet_ref}},
            {"id": "environment-sheet", "type": "media.load_image", "position": {"x": -420, "y": 180}, "fields": {"reference_id": environment_sheet_ref}},
            {
                "id": "storyboard",
                "type": "prompt.recipe",
                "position": {"x": 80, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-storyboard-v2-gpt-image-2",
                    "recipe_category": "image",
                    "user_prompt": "Create a 6-panel storyboard for a character named Sadi crossing a clockwork observatory.",
                    "previous_output": "No previous board handoff provided.",
                    "style_direction": "dark cinematic fantasy storyboard",
                    "shot_count": "6",
                    "aspect_ratio": "16:9",
                    "dialogue_mode": "light",
                    "provider": "local_openai",
                    "model_id": "local-vision-model",
                    "provider_supports_images": True,
                    "provider_capabilities_json": {"supports_images": True, "input_modalities": ["text", "image"]},
                    "temperature": 0.2,
                    "max_tokens": 1200,
                },
            },
        ],
        "edges": [
            {"id": "edge-character-storyboard", "source": "character-sheet", "source_port": "image", "target": "storyboard", "target_port": "character_ref"},
            {"id": "edge-environment-storyboard", "source": "environment-sheet", "source_port": "image", "target": "storyboard", "target_port": "environment_ref"},
        ],
    }

    payload = _run_graph_workflow(client, workflow)

    assert payload["status"] == "completed", payload.get("error")
    assert len(calls) == 1
    call = calls[0]
    assert call["error_context"] == "prompt recipe execution"
    rendered_template = call["messages"][0]["content"]
    assert "If an Environment Sheet or location reference is connected" in rendered_template
    assert "use it for spatial continuity only" in rendered_template
    assert "Never use an Environment Sheet for face, body, wardrobe" in rendered_template
    assert "Do not let them override a declared primary character identity" in rendered_template
    final_content = call["messages"][1]["content"]
    assert len([item for item in final_content if item["type"] == "image_url"]) == 2
    storyboard_node = next(node for node in payload["nodes"] if node["node_id"] == "storyboard")
    final_text = storyboard_node["output_snapshot_json"]["text"][0]["value"]
    assert "preserve observatory entrances and balcony geography" in final_text
    assert "the character" in final_text
    assert "Sadi" not in final_text
    assert storyboard_node["metrics_json"]["image_count"] == 2


def test_graph_prompt_recipe_typed_reference_ports_render_ordered_role_block(client, app_modules, monkeypatch) -> None:
    recipe = app_modules["service"].upsert_prompt_recipe(
        app_modules["schemas"].PromptRecipeUpsertRequest(
            key="typed_reference_role_block_recipe",
            label="Typed Reference Role Block Recipe",
            description="Typed reference role smoke recipe.",
            category="image",
            status="active",
            system_prompt_template=(
                "Use refs:\n{{reference_role_block}}\n\n"
                "Priority:\n{{reference_priority_rule}}\n\n"
                "Brief: {{user_prompt}}"
            ),
            image_analysis_prompt="",
            input_variables_json=[{"key": "user_prompt", "label": "Brief", "required": True}],
            image_input_json={
                "enabled": True,
                "required": False,
                "mode": "direct_reference",
                "max_files": 4,
                "reference_roles": ["character", "environment"],
            },
        )
    )
    ports = prompt_recipe_input_ports(
        [
            {
                "recipe_id": "recipe-generic-image-input",
                "image_input": {"enabled": True, "required": False, "mode": "direct_reference", "max_files": 4, "reference_roles": []},
                "input_variables": [{"key": "user_prompt", "label": "Brief"}],
                "custom_fields": [],
            },
            {
                "recipe_id": "recipe-typed-image-input",
                "image_input": {
                    "enabled": True,
                    "required": False,
                    "mode": "direct_reference",
                    "max_files": 4,
                    "reference_roles": ["character", "environment"],
                },
                "input_variables": [{"key": "user_prompt", "label": "Brief"}],
                "custom_fields": [],
            },
        ]
    )
    ports_by_id = {port.id: port for port in ports}
    port_ids = set(ports_by_id)
    assert {"character_ref", "environment_ref", "image_refs"}.issubset(port_ids)
    assert not {"prop_refs", "style_ref", "additional_refs"}.intersection(port_ids)
    assert "recipe-typed-image-input" in ports_by_id["character_ref"].visible_if["in"]
    assert "recipe-typed-image-input" in ports_by_id["environment_ref"].visible_if["in"]
    assert "recipe-generic-image-input" not in ports_by_id["character_ref"].visible_if["in"]
    assert "recipe-generic-image-input" not in ports_by_id["environment_ref"].visible_if["in"]
    assert "recipe-generic-image-input" in ports_by_id["image_refs"].visible_if["in"]

    character_sheet_ref = _create_colored_reference_image(app_modules, name="typed-character-ref.png", color=(190, 50, 140))
    environment_sheet_ref = _create_colored_reference_image(app_modules, name="typed-environment-ref.png", color=(20, 90, 150))
    calls = []

    def fake_chat(**kwargs):
        calls.append(kwargs)
        return {
            "provider_kind": kwargs["provider_kind"],
            "provider_model_id": kwargs["model_id"],
            "generated_text": (
                "Create a 3x2 storyboard sheet. SHOT: 01. CAMERA: wide. ACTION: the character crosses the lobby. "
                "MOTION: frozen objects stay suspended. DIALOG: . NOTES: preserve environment geography."
            ),
            "warnings": [],
        }

    monkeypatch.setattr("app.graph.executors.prompt_ops.enhancement_provider.run_openai_compatible_chat", fake_chat)

    workflow = {
        "schema_version": 1,
        "name": "Typed Prompt Recipe refs",
        "nodes": [
            {"id": "character-sheet", "type": "media.load_image", "position": {"x": -420, "y": -140}, "fields": {"reference_id": character_sheet_ref}},
            {"id": "environment-sheet", "type": "media.load_image", "position": {"x": -420, "y": 180}, "fields": {"reference_id": environment_sheet_ref}},
            {
                "id": "storyboard",
                "type": "prompt.recipe",
                "position": {"x": 80, "y": 0},
                "fields": {
                    "recipe_id": recipe["recipe_id"],
                    "recipe_category": "image",
                    "user_prompt": "Create a 6-panel storyboard where the lead crosses a frozen hotel lobby.",
                    "provider": "local_openai",
                    "model_id": "local-vision-model",
                    "provider_supports_images": True,
                    "provider_capabilities_json": {"supports_images": True, "input_modalities": ["text", "image"]},
                    "temperature": 0.2,
                    "max_tokens": 1200,
                },
            },
        ],
        "edges": [
            {"id": "edge-character-storyboard", "source": "character-sheet", "source_port": "image", "target": "storyboard", "target_port": "character_ref"},
            {"id": "edge-environment-storyboard", "source": "environment-sheet", "source_port": "image", "target": "storyboard", "target_port": "environment_ref"},
        ],
    }

    payload = _run_graph_workflow(client, workflow)

    assert payload["status"] == "completed", payload.get("error")
    assert len(calls) == 1
    rendered_template = calls[0]["messages"][0]["content"]
    assert "[image reference 1] = Character Sheet or primary character/person reference (@image1)" in rendered_template
    assert "[image reference 2] = Environment Sheet or location reference (@image2)" in rendered_template
    assert "Environment geography, lighting, landmarks" in rendered_template
    final_content = calls[0]["messages"][1]["content"]
    assert len([item for item in final_content if item["type"] == "image_url"]) == 2
    storyboard_node = next(node for node in payload["nodes"] if node["node_id"] == "storyboard")
    assert storyboard_node["metrics_json"]["image_count"] == 2


def test_graph_prompt_recipe_typed_ports_only_include_role_configured_recipes(app_modules) -> None:
    from app.graph.prompt_recipe_catalog import prompt_recipe_catalog as current_prompt_recipe_catalog
    from app.graph.prompt_recipe_catalog import prompt_recipe_input_ports as current_prompt_recipe_input_ports

    catalog = current_prompt_recipe_catalog(status="active")
    ports = current_prompt_recipe_input_ports(catalog)
    ports_by_id = {port.id: port for port in ports}
    recipes_by_id = {str(recipe["recipe_id"]): recipe for recipe in catalog}

    for port_id in ("character_ref", "environment_ref", "prop_refs", "style_ref", "storyboard_ref", "additional_refs"):
        port = ports_by_id.get(port_id)
        if not port:
            continue
        recipe_ids = set((port.visible_if or {}).get("in") or [])
        assert recipe_ids
        for recipe_id in recipe_ids:
            image_input = recipes_by_id[recipe_id].get("image_input") or {}
            assert image_input.get("reference_roles"), recipe_id

    storyboard_recipe_id = "prompt-recipe-storyboard-v2-gpt-image-2"
    continuation_recipe_id = "prompt-recipe-storyboard-continuation-v1"
    character_recipe_ids = set((ports_by_id["character_ref"].visible_if or {}).get("in") or [])
    environment_recipe_ids = set((ports_by_id["environment_ref"].visible_if or {}).get("in") or [])
    additional_port = ports_by_id.get("additional_refs")
    storyboard_port = ports_by_id.get("storyboard_ref")
    assert storyboard_port is not None, "Storyboard Continuation must declare the previous-storyboard reference role"
    assert additional_port is not None, "Storyboard Continuation must declare the existing additional reference role"
    storyboard_recipe_ids = set((storyboard_port.visible_if or {}).get("in") or [])
    additional_recipe_ids = set((additional_port.visible_if or {}).get("in") or [])
    generic_recipe_ids = set((ports_by_id["image_refs"].visible_if or {}).get("in") or [])

    assert {storyboard_recipe_id, continuation_recipe_id}.issubset(character_recipe_ids)
    assert {storyboard_recipe_id, continuation_recipe_id}.issubset(environment_recipe_ids)
    assert continuation_recipe_id in storyboard_recipe_ids
    assert storyboard_recipe_id not in storyboard_recipe_ids
    assert continuation_recipe_id in additional_recipe_ids
    assert storyboard_recipe_id not in additional_recipe_ids
    assert storyboard_recipe_id not in generic_recipe_ids
    assert continuation_recipe_id not in generic_recipe_ids


def test_graph_prompt_recipe_field_level_image_input_ports_feed_runtime_context(client, app_modules) -> None:
    recipe = app_modules["service"].upsert_prompt_recipe(
        app_modules["schemas"].PromptRecipeUpsertRequest(
            key="field_level_input_test",
            label="Field Level Input Test",
            description="Tests dynamic field-level text and image ports.",
            category="image",
            status="active",
            system_prompt_template=(
                "Story: {{story_brief}}\n"
                "Setting: {{setting}}\n"
                "Image analysis: {{image_analysis}}\n"
                "{{reference_role_block}}\n"
                "{{reference_priority_rule}}\n"
                "Return only the final prompt."
            ),
            image_analysis_prompt="Describe the connected field image as a reusable location reference.",
            user_prompt_placeholder="{{story_brief}}",
            output_format="single_prompt",
            input_variables_json=[
                {
                    "key": "story_brief",
                    "token": "{{story_brief}}",
                    "label": "Story Brief",
                    "enabled": True,
                    "required": True,
                    "default_value": "",
                    "description": "Creative story direction.",
                    "input_kind": "text",
                },
                {
                    "key": "image_analysis",
                    "token": "{{image_analysis}}",
                    "label": "Image Analysis",
                    "enabled": True,
                    "required": False,
                    "default_value": "",
                    "description": "Analyzed image context.",
                    "input_kind": "none",
                },
            ],
            custom_fields_json=[
                {
                    "key": "setting",
                    "label": "Setting",
                    "type": "textarea",
                    "placeholder": "Describe or connect a location image.",
                    "default_value": "",
                    "required": False,
                    "help_text": "Location source.",
                    "options": [],
                    "input_kind": "image",
                    "reference_role": "environment",
                }
            ],
            image_input_json={"enabled": True, "required": False, "mode": "both", "analysis_variable": "image_analysis", "max_files": 1},
            default_options_json={"temperature": 0.2, "max_output_tokens": 800},
            rules_json={"allow_external_variables": True, "return_only_final_output": True},
            source_kind="custom",
            version="1",
            priority=1,
        )
    )

    response = client.post("/media/graph/node-definitions/refresh")
    assert response.status_code == 200, response.text
    generic = next(item for item in response.json()["items"] if item["type"] == "prompt.recipe")
    ports_by_id = {port["id"]: port for port in generic["ports"]["inputs"]}
    fields_by_id = {field["id"]: field for field in generic["fields"]}
    assert ports_by_id["story_brief"]["type"] == "text"
    assert ports_by_id["setting"]["type"] == "image"
    assert fields_by_id["story_brief"]["connectable"] is True
    assert fields_by_id["story_brief"]["port_type"] == "text"
    assert fields_by_id["setting"]["connectable"] is True
    assert fields_by_id["setting"]["port_type"] == "image"
    assert fields_by_id["setting"]["reference_role"] == "environment"

    setting_ref = _create_colored_reference_image(app_modules, name="field-level-setting-ref.png", color=(20, 90, 150))
    recipe_record = app_modules["store"].get_prompt_recipe(recipe["recipe_id"])
    setting_field = next(field for field in recipe_record["custom_fields_json"] if field["key"] == "setting")
    assert setting_field["reference_role"] == "environment"
    recipe_node = GraphWorkflowNode(
        id="recipe",
        type="prompt.recipe",
        position={"x": 80, "y": 0},
        fields={
            "recipe_id": recipe["recipe_id"],
            "recipe_category": "image",
            "story_brief": "A time-stop hotel escape.",
            "setting": "Keep the same hotel lobby geography in every panel.",
        },
    )
    workflow = GraphWorkflow(
        schema_version=1,
        name="Field-level Prompt Recipe image refs",
        nodes=[
            GraphWorkflowNode(id="setting-image", type="media.load_image", position={"x": -420, "y": 0}, fields={"reference_id": setting_ref}),
            recipe_node,
        ],
        edges=[
            GraphWorkflowEdge(id="edge-setting-recipe", source="setting-image", source_port="image", target="recipe", target_port="setting"),
        ],
    )
    context = GraphExecutionContext(
        run_id="field-level-input-test",
        workflow=workflow,
        edge_outputs={
            "edge-setting-recipe": [
                GraphOutputRef(kind="reference_media", media_type="image", reference_id=setting_ref),
            ]
        },
    )

    values = _build_prompt_recipe_values(recipe_node, recipe_record, context)
    image_refs = _prompt_recipe_image_refs(recipe_node, context, recipe_record)

    assert "[image reference 1] = Environment Sheet or location reference from Setting field image input (@image1)" in values["setting"]
    assert "Field text/notes: Keep the same hotel lobby geography in every panel." in values["setting"]
    assert "[image reference 1] = Environment Sheet or location reference from Setting field image input (@image1)" in values["reference_role_block"]
    assert "Environment geography, lighting, landmarks" in values["reference_priority_rule"]
    assert "Field-level image inputs control only their matching recipe fields" in values["reference_priority_rule"]
    assert values["reference_role_warnings"] == ""
    assert image_refs == [GraphOutputRef(kind="reference_media", media_type="image", reference_id=setting_ref)]

    duplicate_environment_ref = _create_colored_reference_image(app_modules, name="top-environment-ref.png", color=(80, 20, 120))
    duplicate_workflow = GraphWorkflow(
        schema_version=1,
        name="Field-level Prompt Recipe duplicate image refs",
        nodes=[
            GraphWorkflowNode(id="setting-image", type="media.load_image", position={"x": -420, "y": 0}, fields={"reference_id": setting_ref}),
            GraphWorkflowNode(id="environment-image", type="media.load_image", position={"x": -420, "y": 220}, fields={"reference_id": duplicate_environment_ref}),
            recipe_node,
        ],
        edges=[
            GraphWorkflowEdge(id="edge-setting-recipe", source="setting-image", source_port="image", target="recipe", target_port="setting"),
            GraphWorkflowEdge(id="edge-environment-recipe", source="environment-image", source_port="image", target="recipe", target_port="environment_ref"),
        ],
    )
    duplicate_context = GraphExecutionContext(
        run_id="field-level-input-duplicate-test",
        workflow=duplicate_workflow,
        edge_outputs={
            "edge-setting-recipe": [
                GraphOutputRef(kind="reference_media", media_type="image", reference_id=setting_ref),
            ],
            "edge-environment-recipe": [
                GraphOutputRef(kind="reference_media", media_type="image", reference_id=duplicate_environment_ref),
            ],
        },
    )
    duplicate_values = _build_prompt_recipe_values(recipe_node, recipe_record, duplicate_context)
    duplicate_image_refs = _prompt_recipe_image_refs(recipe_node, duplicate_context, recipe_record)

    assert duplicate_values["reference_role_block"].count("Environment Sheet or location reference") == 1
    assert "Environment Ref ignored because Setting image input is connected." in duplicate_values["reference_role_warnings"]
    assert duplicate_image_refs == [GraphOutputRef(kind="reference_media", media_type="image", reference_id=setting_ref)]


def test_graph_prompt_recipe_reference_role_metadata_normalizes_safely(app_modules) -> None:
    recipe = app_modules["service"].upsert_prompt_recipe(
        app_modules["schemas"].PromptRecipeUpsertRequest(
            key="reference_role_normalize_test",
            label="Reference Role Normalize Test",
            description="Tests reference role metadata normalization.",
            category="image",
            status="active",
            system_prompt_template="{{user_prompt}} {{setting}} {{style_notes}}",
            image_analysis_prompt="Describe the connected image.",
            user_prompt_placeholder="{{user_prompt}}",
            output_format="single_prompt",
            input_variables_json=[
                {
                    "key": "user_prompt",
                    "token": "{{user_prompt}}",
                    "label": "User Prompt",
                    "enabled": True,
                    "required": True,
                    "default_value": "",
                    "description": "Creative story direction.",
                    "input_kind": "text",
                    "reference_role": "character",
                }
            ],
            custom_fields_json=[
                {
                    "key": "setting",
                    "label": "Setting",
                    "type": "textarea",
                    "default_value": "",
                    "required": False,
                    "options": [],
                    "input_kind": "image",
                    "reference_role": "environment",
                },
                {
                    "key": "style_notes",
                    "label": "Style Notes",
                    "type": "textarea",
                    "default_value": "",
                    "required": False,
                    "options": [],
                    "input_kind": "image",
                    "reference_role": "bogus",
                },
            ],
            image_input_json={"enabled": True, "required": False, "mode": "both", "analysis_variable": "image_analysis", "max_files": 1},
            default_options_json={},
            rules_json={"allow_external_variables": True},
            source_kind="custom",
            version="1",
            priority=1,
        )
    )

    recipe_record = app_modules["store"].get_prompt_recipe(recipe["recipe_id"])
    variables_by_key = {item["key"]: item for item in recipe_record["input_variables_json"]}
    fields_by_key = {item["key"]: item for item in recipe_record["custom_fields_json"]}
    assert variables_by_key["user_prompt"]["reference_role"] == "none"
    assert fields_by_key["setting"]["reference_role"] == "environment"
    assert fields_by_key["style_notes"]["reference_role"] == "none"


def test_graph_prompt_recipe_validation_rejects_inactive_missing_variables_and_image_capability(client, app_modules) -> None:
    store = app_modules["store"]
    reference_id = _create_reference_image(app_modules)
    store.create_or_update_prompt_recipe(
        {
            "recipe_id": "prompt-recipe-inactive-validation-test",
            "key": "inactive-validation-test",
            "label": "Inactive Validation Test",
            "description": "Inactive graph validation recipe",
            "category": "utility",
            "status": "archived",
            "system_prompt_template": "USER:\n{{user_prompt}}\n\nReturn only the final prompt.",
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text"},
            "input_variables_json": [
                {
                    "key": "user_prompt",
                    "token": "{{user_prompt}}",
                    "label": "User Prompt",
                    "enabled": True,
                    "required": True,
                    "default_value": "",
                    "description": "Creative direction.",
                }
            ],
            "custom_fields_json": [],
            "image_input_json": {"enabled": False, "required": False, "mode": "none", "analysis_variable": "image_analysis", "max_files": 0},
            "default_options_json": {"temperature": 0.2, "max_output_tokens": 800},
            "rules_json": {"allow_external_variables": True, "return_only_final_output": True},
            "validation_warnings_json": [],
            "source_kind": "custom",
            "version": "1",
            "priority": 1,
        }
    )
    client.post("/media/graph/node-definitions/refresh")

    invalid_generic = {
        "schema_version": 1,
        "name": "Prompt Recipe invalid generic",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-image-prompt-director",
                    "provider": "local_openai",
                    "model_id": "local-text-model",
                    "external_variables_json": '{"aspect_ratio":"16:9","style_direction":"cinematic realism"',
                },
            }
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=invalid_generic)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=invalid_generic)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert payload["valid"] is False
    assert any(error["code"] == "invalid_prompt_recipe_external_variables" for error in payload["errors"])
    assert any(error["code"] == "missing_prompt_recipe_variable" for error in payload["errors"])

    inactive_workflow = {
        "schema_version": 1,
        "name": "Prompt Recipe inactive validation",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {"recipe_id": "prompt-recipe-inactive-validation-test", "recipe_category": "utility", "user_prompt": "ignored"},
            },
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=inactive_workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=inactive_workflow)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert payload["valid"] is False
    assert any(error["code"] == "inactive_prompt_recipe" for error in payload["errors"])

    too_many_images = {
        "schema_version": 1,
        "name": "Prompt Recipe too many images",
        "nodes": [
            {"id": "load_1", "type": "media.load_image", "position": {"x": -480, "y": -160}, "fields": {"reference_id": reference_id}},
            {"id": "load_2", "type": "media.load_image", "position": {"x": -480, "y": 0}, "fields": {"reference_id": reference_id}},
            {"id": "load_3", "type": "media.load_image", "position": {"x": -480, "y": 160}, "fields": {"reference_id": reference_id}},
            {"id": "load_4", "type": "media.load_image", "position": {"x": -480, "y": 320}, "fields": {"reference_id": reference_id}},
            {"id": "load_5", "type": "media.load_image", "position": {"x": -480, "y": 480}, "fields": {"reference_id": reference_id}},
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 120},
                "fields": {
                    "recipe_id": "prompt-recipe-image-prompt-director",
                    "recipe_category": "image",
                    "user_prompt": "Use all references.",
                    "provider": "local_openai",
                    "model_id": "local-text-model",
                    "style_direction": "cinematic realism",
                    "aspect_ratio": "16:9",
                },
            },
        ],
        "edges": [
            {"id": "edge-1", "source": "load_1", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
            {"id": "edge-2", "source": "load_2", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
            {"id": "edge-3", "source": "load_3", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
            {"id": "edge-4", "source": "load_4", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
            {"id": "edge-5", "source": "load_5", "source_port": "image", "target": "recipe", "target_port": "image_refs"},
        ],
    }
    created = client.post("/media/graph/workflows", json=too_many_images)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=too_many_images)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert payload["valid"] is False
    assert any(error["code"] == "prompt_recipe_image_limit_exceeded" for error in payload["errors"])

    image_capability_workflow = {
        "schema_version": 1,
        "name": "Prompt Recipe image capability",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": -320, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-image-prompt-director",
                    "recipe_category": "image",
                    "user_prompt": "Create a refined prompt from the image.",
                    "provider": "local_openai",
                    "model_id": "local-text-model",
                    "provider_supports_images": False,
                    "provider_capabilities_json": {"supports_images": False, "input_modalities": ["text"]},
                    "style_direction": "cinematic realism",
                    "aspect_ratio": "16:9",
                },
            },
        ],
        "edges": [{"id": "edge-load-recipe", "source": "load", "source_port": "image", "target": "recipe", "target_port": "image_refs"}],
    }
    created = client.post("/media/graph/workflows", json=image_capability_workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=image_capability_workflow)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert payload["valid"] is False
    assert any(error["code"] == "prompt_recipe_model_not_image_capable" for error in payload["errors"])


def test_graph_prompt_recipe_validation_warns_when_image_recipe_has_no_image_refs(client, app_modules) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Prompt Recipe missing image refs warning",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-image-prompt-director",
                    "recipe_category": "image",
                    "user_prompt": "Use [image reference 1] as the identity source.",
                    "provider": "codex_local",
                    "model_id": "gpt-5.4",
                    "provider_supports_images": True,
                    "style_direction": "cinematic realism",
                    "aspect_ratio": "16:9",
                },
            }
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert not any(warning["code"] == "prompt_recipe_images_not_connected" for warning in payload["warnings"])
    assert any(warning["code"] == "prompt_recipe_image_reference_unwired" for warning in payload["warnings"])


def test_graph_prompt_recipe_validation_allows_optional_image_recipe_without_image_refs(client, app_modules) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Optional image recipe without refs",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-environment-sheet-v1",
                    "recipe_category": "image",
                    "user_prompt": "luxury hotel lobby with frozen guests and chandelier light",
                    "provider": "codex_local",
                    "model_id": "gpt-5.4",
                    "provider_supports_images": True,
                },
            }
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert payload["valid"] is True
    assert not any(warning["code"] == "prompt_recipe_images_not_connected" for warning in payload["warnings"])
    assert not any(warning["code"] == "prompt_recipe_image_reference_unwired" for warning in payload["warnings"])


def test_graph_prompt_recipe_validation_allows_downstream_ordered_image_refs(client, app_modules) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Seedance director downstream image refs",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-seedance-storyboard-video-director-v1",
                    "recipe_category": "video",
                    "source_prompt": "Use @image1 as the character sheet, @image2 as the optional environment lock, and @image3 as the storyboard.",
                    "user_prompt": "Keep the time-stop action contiguous.",
                    "provider": "codex_local",
                    "model_id": "gpt-5.4",
                    "duration_seconds": "15",
                    "aspect_ratio": "16:9",
                    "dialogue_mode": "brief",
                    "style_direction": "cinematic realism",
                },
            }
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert payload["valid"] is True
    assert not any(warning["code"] == "prompt_recipe_image_reference_unwired" for warning in payload["warnings"])


def test_graph_prompt_recipe_validation_blocks_missing_required_custom_field(client, app_modules) -> None:
    store = app_modules["store"]
    store.create_or_update_prompt_recipe(
        {
            "recipe_id": "prompt-recipe-required-custom-field-test",
            "key": "required_custom_field_test",
            "label": "Required Custom Field Test",
            "description": "Graph validation custom field test",
            "category": "utility",
            "status": "active",
            "system_prompt_template": "USER:\n{{user_prompt}}\nMOOD:\n{{mood}}\nReturn one prompt.",
            "image_analysis_prompt": "",
            "user_prompt_placeholder": "{{user_prompt}}",
            "output_format": "single_prompt",
            "output_contract_json": {"type": "text"},
            "input_variables_json": [
                {
                    "key": "user_prompt",
                    "token": "{{user_prompt}}",
                    "label": "User Prompt",
                    "enabled": True,
                    "required": True,
                    "default_value": "Make a poster.",
                    "description": "Creative direction.",
                }
            ],
            "custom_fields_json": [
                {"key": "mood", "label": "Mood", "type": "text", "default_value": "", "required": True, "options": []}
            ],
            "image_input_json": {"enabled": False, "required": False, "mode": "none", "analysis_variable": "image_analysis", "max_files": 0},
            "default_options_json": {"temperature": 0.2, "max_output_tokens": 800},
            "rules_json": {"allow_external_variables": False, "return_only_final_output": True},
            "validation_warnings_json": [],
            "source_kind": "custom",
            "version": "1",
            "priority": 1,
        }
    )
    client.post("/media/graph/node-definitions/refresh")
    workflow = {
        "schema_version": 1,
        "name": "Prompt Recipe required custom validation",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {"recipe_id": "prompt-recipe-required-custom-field-test", "recipe_category": "utility"},
            }
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert payload["valid"] is False
    assert any(error["code"] == "missing_prompt_recipe_custom_field" for error in payload["errors"])


def test_graph_kie_poll_interval_backs_off_for_long_jobs() -> None:
    from app.graph.executors.kie_model import _adaptive_graph_kie_poll_interval

    assert _adaptive_graph_kie_poll_interval(0) == 0.5
    assert _adaptive_graph_kie_poll_interval(20) == 1.0
    assert _adaptive_graph_kie_poll_interval(60) == 2.0
    assert _adaptive_graph_kie_poll_interval(240) == 4.0


def test_graph_prompt_llm_validation_requires_confirmed_image_capability(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = {
        "schema_version": 1,
        "name": "LLM Prompt image capability validation",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": -320, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "llm",
                "type": "prompt.llm",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "provider": "local_openai",
                    "model_id": "local-unknown-model",
                    "mode": "describe_image",
                    "system_prompt": "Describe the attached image.",
                },
            },
        ],
        "edges": [{"id": "edge-load-llm", "source": "load", "source_port": "image", "target": "llm", "target_port": "image"}],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    payload = validation.json()
    assert payload["valid"] is False
    assert any(error["code"] == "prompt_llm_image_capability_unknown" for error in payload["errors"])


def test_prompt_recipe_result_normalization_keeps_structured_json_and_readable_text() -> None:
    structured = _normalize_prompt_recipe_result(
        {"output_format": "structured_shot_sequence"},
        '{"shots":[{"shot_number":1,"title":"Arrival","camera":"wide","action":"enter","prompt":"Prompt 1"}]}',
    )
    assert structured["parsed_json"]["shots"][0]["prompt"] == "Prompt 1"
    assert "Arrival" in structured["final_text"]
    assert "Prompt 1" in structured["final_text"]

    prompt_batch = _normalize_prompt_recipe_result(
        {"output_format": "json_prompt_batch"},
        '{"prompts":["Prompt 1","Prompt 2"],"notes":"Fast montage"}',
    )
    assert prompt_batch["prompts"] == ["Prompt 1", "Prompt 2"]
    assert "Prompt 1" in prompt_batch["final_text"]
    assert "Prompt 2" in prompt_batch["final_text"]

    image_analysis = _normalize_prompt_recipe_result(
        {"output_format": "image_analysis"},
        '{"subject":"Explorer","composition":"wide frame","lighting":"foggy dawn"}',
    )
    assert image_analysis["parsed_json"]["subject"] == "Explorer"
    assert "Subject: Explorer" in image_analysis["final_text"]
    assert "Lighting: foggy dawn" in image_analysis["final_text"]

    structured_without_prompt_array = _normalize_prompt_recipe_result(
        {"output_format": "structured_shot_sequence"},
        '{"shots":[{"shot_number":1,"title":"Arrival","camera":"wide","action":"enter"}]}',
    )
    assert structured_without_prompt_array["prompts"]
    assert "Arrival" in structured_without_prompt_array["prompts"][0]
    assert "Camera: wide" in structured_without_prompt_array["final_text"]


def test_storyboard_v2_prompt_sanitizer_removes_private_character_labels() -> None:
    raw_text = (
        "Create a 3x2 board for a rogue woman named Sadi.\n"
        "REFERENCE: Use the Sadi's recognizable identity.\n"
        "FRAMING: Sadi being pulled through a portal.\n"
        "ACTION: Sadi's expression shifts as Sadi escapes."
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "The local workflow label is Sadi, but no visible character name was requested.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "Sadi" not in sanitized
    assert "the character the character" not in sanitized
    assert "the the character" not in sanitized
    assert "character character" not in sanitized
    assert "the character's character" not in sanitized
    assert "dark near-black production storyboard board background" in sanitized
    assert not sanitized.startswith("Do not copy visible name")
    assert "Text guard: use neutral subject labels" in sanitized
    assert "the character being pulled through a portal" in sanitized
    assert "the character's expression shifts as the character escapes" in sanitized


def test_storyboard_v2_prompt_sanitizer_does_not_replace_lowercase_guard_words() -> None:
    raw_text = (
        "Create a storyboard for a private workflow label named Sadi.\n"
        "ACTION: Sadi inspects the ship controls.\n"
        "Text guard: use neutral subject labels in titles; do not copy visible names from reference images."
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "The private label is Sadi. Do not show visible names.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "Sadi" not in sanitized
    assert "the character character" not in sanitized
    assert "character character" not in sanitized
    assert "visible names" in sanitized
    assert "the character names" not in sanitized


def test_storyboard_v2_user_owned_directives_survive_sanitizing_and_compaction() -> None:
    values = {
        "user_prompt": "Create a three-board relay story without visible private names.",
        "board_title": "BOARD 3 OF 3 — RELAY DEPARTURE",
        "production_metadata": "PROJECT: MOUNTAIN RELAY; SEQUENCE: BOARD 3 OF 3; LOCATION: SUMMIT STATION",
        "handoff_advance": "Begin one step later with a wider rear angle toward the departure gate.",
        "dialogue_cues": 'COURIER [quiet voice] — "Signal received."',
        "wardrobe_cues": "Weatherproof indigo courier coat with a sealed waist and opaque underlayer.",
        "subject_design_cues": "Small four-legged brass relay animal; never humanoid or bipedal.",
    }
    panels = "\n\n".join(
        f"PANEL {index:02d}\nSHOT: {index:02d} RELAY\nCAMERA: wide\nFRAMING: station\n"
        f"ACTION: Courier advances beat {index}\nMOTION: deliberate\nDIALOG:\nNOTES: continue"
        for index in range(1, 7)
    )
    sanitized = _sanitize_storyboard_v2_prompt_text(f"Use @image1, @image2, and @image3.\n\n{panels}", values)
    shaped = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image",
        sanitized + ("\nPreserve the complete board design." * 180),
        task_mode="image_edit",
        max_chars=20000,
    ).prompt.lower()

    for required in (
        "board 3 of 3 — relay departure",
        "project: mountain relay",
        "begin one step later",
        "signal received",
        "sealed waist and opaque underlayer",
        "four-legged brass relay animal",
    ):
        assert required in shaped
    assert "never humanoid or bipedal" not in shaped


def test_storyboard_continuation_uses_the_same_sanitizer_boundary() -> None:
    assert _is_storyboard_v2_recipe({"key": "storyboard-continuation-v1"})
    assert _is_storyboard_v2_recipe({"recipe_id": "prompt-recipe-storyboard-continuation-v1"})


def test_storyboard_v2_prompt_sanitizer_preserves_board_as_action_and_production_term() -> None:
    raw_text = (
        "Create Board 1 of 3 and use the same production layout for Boards 1-3.\n"
        "The private workflow label is Sadi.\n"
        "ACTION: The pilot checks the loading manifest.\n"
        "NOTES: The pilot never boards the ship, enters the cockpit, or launches yet."
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "Board 1 has no dialogue. The private character label is Sadi.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "Sadi" not in sanitized
    assert "Board 1 of 3" in sanitized
    assert "for Boards 1-3" in sanitized
    assert "never boards the ship" in sanitized
    assert "never the character" not in sanitized


def test_storyboard_v2_prompt_sanitizer_does_not_append_negative_or_reference_instructions_as_action_beats() -> None:
    raw_text = (
        "PANEL 06 — final exterior handoff.\n"
        "ACTION: The pilot follows the amber diagnostic cue to the closed service panel.\n"
        "NOTES: End outside with the panel still closed."
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": (
                "End at the reachable closed engine service panel. Do not board, enter the cockpit, or find the capacitor. "
                "Use the connected character image only for face identity. "
                "Use the environment sheet only as the geography and lighting lock."
            ),
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "enter the cockpit" not in sanitized
    assert "find the capacitor" not in sanitized
    assert "Use the connected character image" not in sanitized
    assert "Use the environment sheet" not in sanitized
    assert "closed service panel" in sanitized


def test_storyboard_v2_prompt_sanitizer_removes_private_name_from_title_footer() -> None:
    raw_text = (
        "Create a single 4K-quality 16:9 cinematic storyboard sheet. "
        "Title at top: “SADI: SYSTEM CHECK”. "
        "Footer: “PROJECT: SADI / VERSION: STORYBOARD V2 / STYLE: CINEMATIC MOVIE PREVIS / BOARD: 01”.\n"
        "ACTION: SADI checks the cybernetic hand."
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "The local workflow label is Sadi, but visible metadata should not show character names.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "SADI" not in sanitized
    assert "Sadi" not in sanitized
    assert "Title at top: “SYSTEM CHECK”" in sanitized
    assert "PROJECT: CHARACTER STORY" in sanitized
    assert "ACTION: the character checks the cybernetic hand" in sanitized


def test_storyboard_v2_prompt_sanitizer_preserves_explicit_visible_name_request() -> None:
    raw_text = "SHOT: Sadi enters the dungeon. NOTES: Display the name Sadi on the title card."

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "Show the character name as visible text on the board.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert sanitized == raw_text


def test_storyboard_v2_prompt_sanitizer_blanks_non_spoken_dialogue_rows() -> None:
    raw_text = "\n".join(
        [
            "SHOT 01",
            "DIALOG: Silence",
            "SHOT 02",
            "DIALOG: No dialogue",
            "SHOT 03",
            'DIALOG: "I found the key."',
        ]
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "Use no dialogue for this wordless board.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "DIALOG: Silence" not in sanitized
    assert "DIALOG: No dialogue" not in sanitized
    assert 'DIALOG: "I found the key."' not in sanitized
    assert "DIALOG: \nSHOT 02" in sanitized
    assert "DIALOG: \nSHOT 03" in sanitized


def test_storyboard_v2_prompt_sanitizer_extracts_json_prompt_before_guard() -> None:
    raw_text = json.dumps(
        {
            "prompt": (
                "Create a 3x2 storyboard. "
                "Panel 04 ACTION: the character melts chains with an amulet. "
                "Panel 05 ACTION: the character kills two guards. "
                "Panel 06 ACTION: the character runs down the hallway."
            )
        }
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "Include sparse dialogue where it makes sense.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert sanitized.startswith("Use a dark near-black production storyboard board background")
    assert "Text guard: use neutral subject labels" in sanitized
    assert '{"prompt"' not in sanitized
    assert "kills two guards" in sanitized
    assert "runs down the hallway" in sanitized


def test_storyboard_v2_prompt_sanitizer_flattens_structured_shot_json() -> None:
    raw_text = json.dumps(
        {
            "title": "Escape from the Dungeon",
            "shots": [
                {
                    "shot": "06 - Escape Down the Hallway",
                    "camera": "overhead shot",
                    "framing": "the woman running down the hallway",
                    "action": "She runs past the defeated guards.",
                    "motion": "fast movement",
                    "dialog": "",
                    "notes": "two guards defeated",
                }
            ],
        }
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "She kills two guards, and runs down the hallway.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert sanitized.startswith("Use a dark near-black production storyboard board background")
    assert '{"title"' not in sanitized
    assert "Panel 01 - 06 - Escape Down the Hallway" in sanitized
    assert "ACTION: She runs past the defeated guards." in sanitized
    assert "runs down the hallway" in sanitized


def test_storyboard_v2_prompt_sanitizer_preserves_requested_action_quantities() -> None:
    raw_text = "\n".join(
        [
            "Create a 3x2 storyboard.",
            "Panel 05 ACTION: She swiftly takes down one guard.",
            "Panel 06 ACTION: She runs down the hallway.",
        ]
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "She breaks out of the cell, kills two guards, and runs down the hallway.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "one guard" not in sanitized.lower()
    assert "two guards" in sanitized.lower()


def test_storyboard_v2_prompt_sanitizer_preserves_terminal_action_beats_from_scaffold() -> None:
    raw_text = "\n".join(
        [
            "Create a 3x2 storyboard.",
            "Panel 04 ACTION: The amulet melts the chains.",
            "Panel 05 ACTION: She lunges forward, ready to fight.",
            "Panel 06 ACTION: She defeats two guards and stands victorious.",
        ]
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "\n".join(
                [
                    "Story / scene brief: she has been captured in a dungeon by an evil wizard, watched by ogre guards. She tries to break free, uses the green glowing amulet to melt off her chains, breaks out of the cell, kills two guards, and runs down the hallway.",
                    "Mandatory story beats, do not omit: she has been captured in a dungeon by an evil wizard, watched by ogre guards. She tries to break free, uses the green glowing amulet to melt off her chains, breaks out of the cell, kills two guards, and runs down the hallway. If there are more beats than panels, combine nearby atmosphere or setup beats first.",
                    "Quantity precision: preserve exact quantities from the user's story brief in the final panel ACTION/NOTES text; for example, two guards must remain two guards and must not be reduced to one guard.",
                ]
            ),
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "STORY BEATS" not in sanitized
    assert "kills two guards" in sanitized


def test_storyboard_v2_prompt_sanitizer_removes_existing_story_beats_tail() -> None:
    raw_text = "\n".join(
        [
            "Create a 3x2 storyboard.",
            "Panel 06 ACTION: She studies the orbital relay.",
            "",
            "STORY BEATS: The storyboard panel ACTION/NOTES rows should clearly cover: discovers the signal.",
        ]
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "She discovers the signal.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "STORY BEATS" not in sanitized
    assert "Panel 06 ACTION: She studies the orbital relay." in sanitized


def test_storyboard_v2_prompt_sanitizer_removes_internal_negative_note_terms() -> None:
    raw_text = (
        "Create a storyboard sheet.\n"
        "TEXT RULES: Do not add speech bubbles, character bios, stat blocks, model notes, provider notes, node notes, pricing notes, or internal planning text."
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "Create a clean storyboard.",
            "previous_output": "",
            "style_direction": "dark cinematic storyboard",
        },
    )

    assert "model notes" not in sanitized.lower()
    assert "provider notes" not in sanitized.lower()
    assert "node notes" not in sanitized.lower()
    assert "pricing notes" not in sanitized.lower()
    assert "speech bubbles" in sanitized
    assert "two guards and must not be reduced" not in sanitized


def test_graph_cancel_stops_downstream_after_current_node(client, app_modules, monkeypatch) -> None:
    from app.graph.runtime import runtime

    downstream_calls: list[str] = []

    def fake_prompt_text_execute(node, context):
        if node.id == "first":
            deadline = time.time() + 1
            while not context.is_cancel_requested() and time.time() < deadline:
                time.sleep(0.01)
            return {"text": [GraphOutputRef(kind="value", value="first node output", metadata={"type": "text"})]}
        downstream_calls.append(node.id)
        return {"text": [GraphOutputRef(kind="value", value="second node output", metadata={"type": "text"})]}

    monkeypatch.setattr(runtime.executors["prompt.text"], "execute", fake_prompt_text_execute)

    workflow = {
        "schema_version": 1,
        "name": "Cancel between nodes",
        "nodes": [
            {"id": "first", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "first"}},
            {"id": "second", "type": "prompt.text", "position": {"x": 280, "y": 0}, "fields": {"text": "second"}},
        ],
        "edges": [{"id": "edge-first-second", "source": "first", "source_port": "text", "target": "second", "target_port": "text"}],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    running_payload = None
    for _ in range(80):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200, current.text
        running_payload = current.json()
        node_statuses = {item["node_id"]: item["status"] for item in running_payload["nodes"]}
        if node_statuses.get("first") == "running":
            break
        time.sleep(0.02)
    assert running_payload is not None

    cancel_response = client.post(f"/media/graph/runs/{run_id}/cancel")
    assert cancel_response.status_code == 200, cancel_response.text
    assert cancel_response.json()["status"] == "cancelling"

    final_payload = None
    for _ in range(120):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200, current.text
        final_payload = current.json()
        if final_payload["status"] in {"cancelled", "failed", "completed"}:
            break
        time.sleep(0.02)
    assert final_payload is not None
    assert final_payload["status"] == "cancelled"
    nodes_by_id = {item["node_id"]: item for item in final_payload["nodes"]}
    assert nodes_by_id["first"]["status"] == "completed"
    assert nodes_by_id["second"]["status"] == "cancelled"
    assert downstream_calls == []


def test_graph_cancel_finalizes_queued_run_without_worker(client) -> None:
    from app.graph.runtime import runtime

    workflow = {
        "schema_version": 1,
        "name": "Cancel queued graph run",
        "nodes": [
            {"id": "prompt", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "queued cancel"}},
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run = runtime.create_run(created.json()["workflow_id"], GraphWorkflow(**workflow), start=False)

    cancel_response = client.post(f"/media/graph/runs/{run.run_id}/cancel")
    assert cancel_response.status_code == 200, cancel_response.text
    assert cancel_response.json()["status"] == "cancelled"
    nodes_by_id = {item["node_id"]: item for item in cancel_response.json()["nodes"]}
    assert nodes_by_id["prompt"]["status"] == "cancelled"


def test_graph_cancel_cancels_kie_batch_and_marks_run_cancelled(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules)

    monkeypatch.setattr(app_modules["service"], "build_validation_bundle", lambda request: {"validation": "ok"})

    def fake_submit_jobs(request):
        return app_modules["store"].create_batch_and_jobs(
            {"project_id": None, "status": "processing", "model_key": request.model_key, "task_mode": request.task_mode},
            [
                {
                    "model_key": request.model_key,
                    "task_mode": request.task_mode,
                    "prompt_text": request.prompt,
                    "status": "running",
                    "output_count": request.output_count,
                    "options_json": request.options,
                    "resolved_options_json": {},
                    "prompt_context_json": {},
                    "validation_json": {},
                    "preflight_json": {},
                    "normalized_request_json": {},
                    "prepared_json": {},
                    "submit_response_json": {},
                    "final_status_json": {},
                    "artifact_json": {},
                }
            ],
        )

    monkeypatch.setattr(app_modules["service"], "submit_jobs", fake_submit_jobs)
    monkeypatch.setattr(app_modules["runner"].runner, "tick", lambda: None)

    workflow = {
        "schema_version": 1,
        "name": "Cancel active KIE run",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "model",
                "type": "model.kie.nano_banana_pro",
                "position": {"x": 320, "y": 0},
                "fields": {"prompt": "Create a clean studio beauty shot.", "resolution": "1K"},
            },
            {"id": "save", "type": "media.save_image", "position": {"x": 680, "y": 0}, "fields": {"label": "Final"}},
        ],
        "edges": [
            {"id": "edge-load-model", "source": "load", "source_port": "image", "target": "model", "target_port": "image_refs"},
            {"id": "edge-model-save", "source": "model", "source_port": "image", "target": "save", "target_port": "image"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    submitted_batch_id = None
    for _ in range(120):
        events = app_modules["store"].list_graph_run_events(run_id)
        for event in events:
            if event["event_type"] == "kie.submitted":
                submitted_batch_id = str((event.get("payload_json") or {}).get("batch_id") or "")
                break
        if submitted_batch_id:
            break
        time.sleep(0.02)
    assert submitted_batch_id

    cancel_response = client.post(f"/media/graph/runs/{run_id}/cancel")
    assert cancel_response.status_code == 200, cancel_response.text
    assert cancel_response.json()["status"] == "cancelling"

    final_payload = None
    for _ in range(160):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200, current.text
        final_payload = current.json()
        if final_payload["status"] in {"cancelled", "failed", "completed"}:
            break
        time.sleep(0.02)
    assert final_payload is not None
    assert final_payload["status"] == "cancelled"

    nodes_by_id = {item["node_id"]: item for item in final_payload["nodes"]}
    assert nodes_by_id["load"]["status"] == "completed"
    assert nodes_by_id["model"]["status"] == "cancelled"
    assert nodes_by_id["save"]["status"] == "cancelled"

    batch = app_modules["store"].get_batch(submitted_batch_id)
    assert batch is not None
    assert batch["status"] == "cancelled"
    jobs = app_modules["store"].list_jobs_for_batches([submitted_batch_id], include_dismissed=True)
    assert jobs
    assert jobs[0]["status"] == "cancelled"


def test_builtin_prompt_recipe_seed_defaults_are_refreshed(client, app_modules) -> None:
    store = app_modules["store"]

    image_director = store.get_prompt_recipe_by_key("image-prompt-director")
    assert image_director is not None
    image_director_defaults = {str(item["key"]): str(item.get("default_value") or "") for item in image_director["input_variables_json"]}
    assert image_director_defaults["source_prompt"] == "No source prompt provided."
    assert image_director_defaults["image_analysis"] == "No reference images provided."

    video_director = store.get_prompt_recipe_by_key("video-director-multi-shot-json")
    assert video_director is not None
    video_director_defaults = {str(item["key"]): str(item.get("default_value") or "") for item in video_director["input_variables_json"]}
    assert video_director_defaults["source_prompt"] == "No source prompt provided."
    assert video_director_defaults["image_analysis"] == "No reference images provided."


def test_graph_prompt_recipe_template_instantiation_materializes_defaults_and_runs(client, monkeypatch) -> None:
    def fake_chat(**kwargs):
        return {
            "provider_kind": kwargs["provider_kind"],
            "provider_model_id": kwargs["model_id"],
            "generated_text": "Prompt recipe template output.",
            "warnings": [],
        }

    monkeypatch.setattr("app.graph.executors.prompt_ops.enhancement_provider.run_openai_compatible_chat", fake_chat)

    instantiate = client.post("/media/graph/templates/graph-template-prompt-recipe-text-single-prompt/instantiate")
    assert instantiate.status_code == 200, instantiate.text
    workflow_id = instantiate.json()["workflow_id"]

    record = client.get(f"/media/graph/workflows/{workflow_id}")
    assert record.status_code == 200, record.text
    workflow_json = record.json()["workflow_json"]
    recipe_node = next(node for node in workflow_json["nodes"] if node["type"] == "prompt.recipe")
    assert recipe_node["fields"]["provider"] == "studio_default"
    assert recipe_node["fields"]["model_id"] == ""
    assert recipe_node["fields"]["temperature"] == ""
    assert recipe_node["fields"]["max_tokens"] == ""
    assert recipe_node["fields"]["external_variables_json"] == '{"aspect_ratio":"16:9","style_direction":"cinematic realism"}'
    recipe_node["fields"]["provider"] = "local_openai"
    recipe_node["fields"]["model_id"] = "local-text-model"

    updated = client.patch(f"/media/graph/workflows/{workflow_id}", json=workflow_json)
    assert updated.status_code == 200, updated.text

    run_response = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(80):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200, current.text
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload.get("error")
    run_recipe_node = next(node for node in final_payload["nodes"] if node["node_id"] == recipe_node["id"])
    assert run_recipe_node["output_snapshot_json"]["text"][0]["value"] == "Prompt recipe template output."


def test_graph_display_any_passes_through_and_inspects_text(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Display Any text smoke",
        "nodes": [
            {"id": "source", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "display this"}},
            {"id": "display", "type": "display.any", "position": {"x": 360, "y": 0}, "fields": {}},
            {"id": "inspect", "type": "debug.inspect", "position": {"x": 720, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-source-display", "source": "source", "source_port": "text", "target": "display", "target_port": "value"},
            {"id": "edge-display-inspect", "source": "display", "source_port": "value", "target": "inspect", "target_port": "value"},
        ],
    }

    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed", final_payload.get("error")
    display_node = next(node for node in final_payload["nodes"] if node["node_id"] == "display")
    assert display_node["output_snapshot_json"]["value"][0]["value"] == "display this"
    assert display_node["output_snapshot_json"]["json"][0]["value"][0]["value"] == "display this"
    inspect_node = next(node for node in final_payload["nodes"] if node["node_id"] == "inspect")
    assert inspect_node["output_snapshot_json"]["json"][0]["value"][0]["value"] == "display this"


def test_graph_estimate_prices_openrouter_prompt_llm_nodes(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.graph.pricing.enhancement_provider.list_openrouter_models",
        lambda force_refresh=False: [
            {
                "id": "openai/gpt-4o-mini",
                "label": "GPT-4o mini",
                "provider": "openrouter",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {"pricing": {"prompt": "0.0000004", "completion": "0.0000016"}},
            }
        ],
    )
    workflow = {
        "schema_version": 1,
        "name": "LLM pricing",
        "nodes": [
            {
                "id": "llm",
                "type": "prompt.llm",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "provider": "openrouter",
                    "model_id": "openai/gpt-4o-mini",
                    "mode": "rewrite_prompt",
                    "system_prompt": "Rewrite [user_prompt].",
                    "user_prompt": "a robot painter",
                },
            }
        ],
        "edges": [],
    }
    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["pricing_summary"]["has_unknown_pricing"] is False
    assert payload["pricing_summary"]["pricing_status"] == "estimated_external_llm"
    assert payload["pricing_summary"]["total"]["estimated_cost_usd"] > 0
    assert payload["nodes"]["llm"]["pricing_summary"]["pricing_status"] == "estimated_external_llm"
    assert payload["nodes"]["llm"]["pricing_summary"]["estimated_completion_tokens"] > 0
    assert not any(warning["code"] == "unknown_external_llm_pricing" for warning in payload["warnings"])


def test_graph_estimate_prices_openrouter_prompt_recipe_nodes(client, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.graph.pricing.enhancement_provider.list_openrouter_models",
        lambda force_refresh=False: [
            {
                "id": "openai/gpt-4o-mini",
                "label": "GPT-4o mini",
                "provider": "openrouter",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {"pricing": {"prompt": "0.0000004", "completion": "0.0000016"}},
            }
        ],
    )
    workflow = {
        "schema_version": 1,
        "name": "Prompt recipe pricing",
        "nodes": [
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": "prompt-recipe-prompt-shortener",
                    "provider": "openrouter",
                    "model_id": "openai/gpt-4o-mini",
                    "source_prompt": "Shorten this into one concise prompt.",
                },
            }
        ],
        "edges": [],
    }
    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["pricing_summary"]["has_unknown_pricing"] is False
    assert payload["pricing_summary"]["pricing_status"] == "estimated_external_llm"
    assert payload["pricing_summary"]["total"]["estimated_cost_usd"] > 0
    assert payload["nodes"]["recipe"]["pricing_summary"]["pricing_status"] == "estimated_external_llm"
    assert payload["nodes"]["recipe"]["pricing_summary"]["estimated_request_count"] == 1


def test_graph_estimate_counts_typed_prompt_recipe_image_refs(client, app_modules, monkeypatch) -> None:
    recipe = app_modules["service"].upsert_prompt_recipe(
        app_modules["schemas"].PromptRecipeUpsertRequest(
            key="typed_ref_pricing_recipe",
            label="Typed Ref Pricing Recipe",
            description="Pricing smoke for typed recipe refs.",
            category="image",
            status="active",
            system_prompt_template="Use refs: {{reference_role_block}}\nBrief: {{user_prompt}}",
            image_analysis_prompt="Summarize connected visual references.",
            input_variables_json=[{"key": "user_prompt", "label": "Brief", "required": True}],
            image_input_json={
                "enabled": True,
                "required": False,
                "mode": "both",
                "max_files": 4,
                "reference_roles": ["character", "environment"],
            },
        )
    )
    monkeypatch.setattr(
        "app.graph.pricing.enhancement_provider.list_openrouter_models",
        lambda force_refresh=False: [
            {
                "id": "openai/gpt-4o-mini",
                "label": "GPT-4o mini",
                "provider": "openrouter",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {"pricing": {"prompt": "0.0000004", "completion": "0.0000016"}},
            }
        ],
    )
    workflow = {
        "schema_version": 1,
        "name": "Typed prompt recipe pricing",
        "nodes": [
            {"id": "character", "type": "media.load_image", "position": {"x": -500, "y": 0}, "fields": {}},
            {"id": "environment", "type": "media.load_image", "position": {"x": -500, "y": 420}, "fields": {}},
            {
                "id": "recipe",
                "type": "prompt.recipe",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "recipe_id": recipe["recipe_id"],
                    "provider": "openrouter",
                    "model_id": "openai/gpt-4o-mini",
                    "user_prompt": "A character moves through a locked location.",
                },
            },
        ],
        "edges": [
            {"id": "edge-character-recipe", "source": "character", "source_port": "image", "target": "recipe", "target_port": "character_ref"},
            {"id": "edge-environment-recipe", "source": "environment", "source_port": "image", "target": "recipe", "target_port": "environment_ref"},
        ],
    }

    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    recipe_summary = response.json()["nodes"]["recipe"]["pricing_summary"]
    assert recipe_summary["estimated_request_count"] == 2
    assert recipe_summary["estimated_image_count"] == 4
    assert recipe_summary["pricing_status"] == "estimated_external_llm"


def test_graph_estimate_keeps_local_prompt_nodes_unknown(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Local LLM pricing",
        "nodes": [
            {
                "id": "llm",
                "type": "prompt.llm",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "provider": "local_openai",
                    "model_id": "qwen/local-vl",
                    "mode": "rewrite_prompt",
                    "system_prompt": "Rewrite [user_prompt].",
                    "user_prompt": "a robot painter",
                },
            }
        ],
        "edges": [],
    }
    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["pricing_summary"]["has_unknown_pricing"] is True
    assert payload["nodes"]["llm"]["pricing_summary"]["pricing_status"] == "unknown_external"
    assert any(warning["code"] == "unknown_external_llm_pricing" for warning in payload["warnings"])


def test_graph_kie_pricing_multiplier_fields_are_covered(client) -> None:
    from app import kie_adapter
    from app.graph.registry import registry

    definitions = {
        definition.source.get("model_key"): definition
        for definition in registry.list_definitions(refresh=True)
        if definition.type.startswith("model.kie.") and definition.source.get("model_key")
    }
    derived_multiplier_coverage = {
        "kling-2.6-motion": {"duration"},
        "kling-3.0-motion": {"duration"},
        "kling-3.0-t2v": {"pricing_variant"},
        "kling-3.0-i2v": {"pricing_variant"},
        "seedance-2.0": {"pricing_variant"},
        "seedance-2.0-fast": {"pricing_variant"},
        "seedance-2.0-mini": {"pricing_variant"},
    }

    missing_coverage = []
    for rule in kie_adapter.pricing_snapshot(force_refresh=False).get("rules") or []:
        if not isinstance(rule, dict):
            continue
        model_key = str(rule.get("model_key") or "")
        definition = definitions.get(model_key)
        if not definition:
            continue
        fields = {field.id for field in definition.fields}
        multipliers = rule.get("multipliers") if isinstance(rule.get("multipliers"), dict) else {}
        covered_derived = derived_multiplier_coverage.get(model_key, set())
        for multiplier_key in multipliers:
            if multiplier_key in fields or multiplier_key in covered_derived:
                continue
            missing_coverage.append(f"{model_key}:{multiplier_key}")

    assert missing_coverage == []


def _graph_model_pricing_total(client, node_type: str, fields: dict) -> dict:
    workflow = {
        "schema_version": 1,
        "name": "Graph pricing matrix",
        "nodes": [
            {
                "id": "model",
                "type": node_type,
                "position": {"x": 0, "y": 0},
                "fields": {"prompt": "Graph pricing matrix", **fields},
            }
        ],
        "edges": [],
    }
    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    summary = response.json()["nodes"]["model"]["pricing_summary"]
    assert summary["has_numeric_estimate"] is True
    return summary["total"]


@pytest.mark.parametrize(
    ("node_type", "base_fields", "changed_fields"),
    [
        ("model.kie.kling_2_6_t2v", {"duration": 5, "sound": False}, {"duration": 10, "sound": False}),
        ("model.kie.kling_2_6_t2v", {"duration": 10, "sound": False}, {"duration": 10, "sound": True}),
        ("model.kie.kling_2_6_i2v", {"duration": 5, "sound": False}, {"duration": 10, "sound": False}),
        ("model.kie.kling_2_6_i2v", {"duration": 10, "sound": False}, {"duration": 10, "sound": True}),
        ("model.kie.kling_3_0_t2v", {"duration": 5, "mode": "720p", "sound": False}, {"duration": 10, "mode": "720p", "sound": False}),
        ("model.kie.kling_3_0_t2v", {"duration": 10, "mode": "720p", "sound": False}, {"duration": 10, "mode": "1080p", "sound": False}),
        ("model.kie.kling_3_0_t2v", {"duration": 10, "mode": "1080p", "sound": False}, {"duration": 10, "mode": "4K", "sound": False}),
        ("model.kie.kling_3_0_t2v", {"duration": 10, "mode": "720p", "sound": False}, {"duration": 10, "mode": "720p", "sound": True}),
        ("model.kie.kling_3_0_i2v", {"duration": 5, "mode": "720p", "sound": False}, {"duration": 10, "mode": "720p", "sound": False}),
        ("model.kie.kling_3_0_i2v", {"duration": 10, "mode": "720p", "sound": False}, {"duration": 10, "mode": "1080p", "sound": False}),
        ("model.kie.kling_3_0_i2v", {"duration": 10, "mode": "1080p", "sound": False}, {"duration": 10, "mode": "4K", "sound": False}),
        ("model.kie.kling_3_0_i2v", {"duration": 10, "mode": "720p", "sound": False}, {"duration": 10, "mode": "720p", "sound": True}),
        ("model.kie.kling_3_0_turbo_i2v", {"duration": 5, "resolution": "720p"}, {"duration": 10, "resolution": "720p"}),
        ("model.kie.kling_3_0_turbo_i2v", {"duration": 10, "resolution": "720p"}, {"duration": 10, "resolution": "1080p"}),
        ("model.kie.seedance_2_0", {"duration": 5, "resolution": "480p", "aspect_ratio": "16:9"}, {"duration": 10, "resolution": "480p", "aspect_ratio": "16:9"}),
        ("model.kie.seedance_2_0", {"duration": 10, "resolution": "480p", "aspect_ratio": "16:9"}, {"duration": 10, "resolution": "720p", "aspect_ratio": "16:9"}),
        ("model.kie.seedance_2_0", {"duration": 10, "resolution": "720p", "aspect_ratio": "16:9"}, {"duration": 10, "resolution": "1080p", "aspect_ratio": "16:9"}),
        ("model.kie.seedance_2_0_fast", {"duration": 5, "resolution": "480p", "aspect_ratio": "16:9"}, {"duration": 10, "resolution": "480p", "aspect_ratio": "16:9"}),
        ("model.kie.seedance_2_0_fast", {"duration": 10, "resolution": "480p", "aspect_ratio": "16:9"}, {"duration": 10, "resolution": "720p", "aspect_ratio": "16:9"}),
        ("model.kie.seedance_2_0_mini", {"duration": 5, "resolution": "480p", "aspect_ratio": "16:9"}, {"duration": 10, "resolution": "480p", "aspect_ratio": "16:9"}),
        ("model.kie.seedance_2_0_mini", {"duration": 10, "resolution": "480p", "aspect_ratio": "16:9"}, {"duration": 10, "resolution": "720p", "aspect_ratio": "16:9"}),
    ],
)
def test_graph_video_model_pricing_matrix_responds_to_option_changes(client, node_type, base_fields, changed_fields) -> None:
    base_total = _graph_model_pricing_total(client, node_type, base_fields)
    changed_total = _graph_model_pricing_total(client, node_type, changed_fields)

    assert changed_total["estimated_credits"] > base_total["estimated_credits"]
    assert changed_total["estimated_cost_usd"] > base_total["estimated_cost_usd"]


def test_graph_estimate_sums_enabled_kie_model_nodes(client, monkeypatch) -> None:
    def fake_estimate_request_cost(raw_request):
        model_key = raw_request["model_key"]
        if model_key == "nano-banana-pro":
            assert raw_request["images"][0]["url"].startswith("https://example.com/")
        if model_key == "kling-2.6-i2v":
            assert raw_request["images"][0]["url"].startswith("https://example.com/")
        credits = 10 if model_key == "nano-banana-pro" else 25
        return {
            "model_key": model_key,
            "estimated_credits": credits,
            "estimated_cost_usd": credits / 100,
            "currency": "USD",
            "is_known": True,
            "has_numeric_estimate": True,
            "is_authoritative": True,
            "pricing_source_kind": "verified_provider",
            "pricing_status": "verified_provider",
        }

    monkeypatch.setattr("app.graph.pricing.kie_adapter.estimate_request_cost", fake_estimate_request_cost)
    monkeypatch.setattr(
        "app.graph.pricing.kie_adapter.pricing_snapshot",
        lambda force_refresh=False: {
            "currency": "USD",
            "is_authoritative": True,
            "is_stale": False,
            "priced_model_keys": ["nano-banana-pro", "kling-2.6-i2v"],
            "missing_model_keys": [],
            "source_kind": "verified_provider",
            "pricing_status": "verified_provider",
            "version": "test",
        },
    )
    workflow = {
        "schema_version": 1,
        "name": "Estimate fanout",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": -360, "y": 0}, "fields": {"reference_id": "ref-test"}},
            {"id": "nano", "type": "model.kie.nano_banana_pro", "position": {"x": 0, "y": 0}, "fields": {"prompt": "Make a 2x2 sheet."}},
            {"id": "split", "type": "image.split", "position": {"x": 360, "y": 0}, "fields": {"outputs": 4}},
            *[
                {
                    "id": f"kling_{index}",
                    "type": "model.kie.kling_2_6_i2v",
                    "position": {"x": 720, "y": index * 160},
                    "fields": {"prompt": "Animate this panel.", "duration": 5},
                }
                for index in range(1, 5)
            ],
        ],
        "edges": [
            {"id": "edge-load-nano", "source": "load", "source_port": "image", "target": "nano", "target_port": "image_refs"},
            {"id": "edge-nano-split", "source": "nano", "source_port": "image", "target": "split", "target_port": "images"},
            *[
                {
                    "id": f"edge-split-kling-{index}",
                    "source": "split",
                    "source_port": f"image_{index}",
                    "target": f"kling_{index}",
                    "target_port": "image_refs",
                }
                for index in range(1, 5)
            ],
        ],
    }
    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["pricing_summary"]["total"]["estimated_credits"] == 110
    assert payload["nodes"]["nano"]["pricing_summary"]["total"]["estimated_credits"] == 10
    assert payload["nodes"]["kling_4"]["pricing_summary"]["total"]["estimated_credits"] == 25
    assert payload["nodes"]["kling_1"]["task_mode"] in {"image_to_video", "i2v"}


@pytest.mark.parametrize(
    ("model_key", "node_type", "estimated_credits", "estimated_cost_usd"),
    [
        ("kling-3.0-motion", "model.kie.kling_3_0_motion", 420, 2.1),
        ("kling-2.6-motion", "model.kie.kling_2_6_motion", 231, 1.155),
    ],
)
def test_graph_estimate_carries_load_video_reference_duration(
    client,
    monkeypatch,
    model_key,
    node_type,
    estimated_credits,
    estimated_cost_usd,
) -> None:
    captured_requests = []

    def fake_get_reference_media(reference_id):
        if reference_id == "ref-video":
            return {
                "reference_id": "ref-video",
                "kind": "video",
                "stored_path": "reference-media/videos/ref-video.mp4",
                "duration_seconds": 20.083333,
            }
        if reference_id == "ref-image":
            return {
                "reference_id": "ref-image",
                "kind": "image",
                "stored_path": "reference-media/images/ref-image.png",
            }
        return None

    def fake_estimate_request_cost(raw_request):
        captured_requests.append(raw_request)
        assert raw_request["model_key"] == model_key
        assert raw_request["task_mode"] == "motion_control"
        assert raw_request["videos"][0]["duration_seconds"] == 20.083333
        return {
            "model_key": raw_request["model_key"],
            "estimated_credits": estimated_credits,
            "estimated_cost_usd": estimated_cost_usd,
            "currency": "USD",
            "is_known": True,
            "has_numeric_estimate": True,
            "is_authoritative": True,
            "pricing_source_kind": "verified_provider",
            "pricing_status": "verified_provider",
        }

    monkeypatch.setattr("app.graph.pricing.store.get_reference_media", fake_get_reference_media)
    monkeypatch.setattr("app.graph.pricing.kie_adapter.estimate_request_cost", fake_estimate_request_cost)
    monkeypatch.setattr(
        "app.graph.pricing.kie_adapter.pricing_snapshot",
        lambda force_refresh=False: {
            "currency": "USD",
            "is_authoritative": True,
            "is_stale": False,
            "priced_model_keys": [model_key],
            "missing_model_keys": [],
            "source_kind": "verified_provider",
            "pricing_status": "verified_provider",
            "version": "test",
        },
    )
    workflow = {
        "schema_version": 1,
        "name": "Motion estimate",
        "nodes": [
            {"id": "image", "type": "media.load_image", "position": {"x": -360, "y": 0}, "fields": {"reference_id": "ref-image"}},
            {"id": "video", "type": "media.load_video", "position": {"x": -360, "y": 220}, "fields": {"reference_id": "ref-video"}},
            {
                "id": "motion",
                "type": node_type,
                "position": {"x": 0, "y": 0},
                "fields": {"prompt": "Match the driving video.", "character_orientation": "video", "mode": "720p"},
            },
        ],
        "edges": [
            {"id": "edge-image-motion", "source": "image", "source_port": "image", "target": "motion", "target_port": "image_refs"},
            {"id": "edge-video-motion", "source": "video", "source_port": "video", "target": "motion", "target_port": "video_refs"},
        ],
    }

    response = client.post("/media/graph/estimate", json=workflow)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert captured_requests
    assert payload["nodes"]["motion"]["pricing_summary"]["total"]["estimated_credits"] == estimated_credits
    assert payload["nodes"]["motion"]["pricing_summary"]["total"]["estimated_cost_usd"] == estimated_cost_usd


@pytest.mark.parametrize(
    ("model_key", "node_type", "estimated_credits", "estimated_cost_usd"),
    [
        ("kling-3.0-motion", "model.kie.kling_3_0_motion", 100, 0.5),
        ("kling-2.6-motion", "model.kie.kling_2_6_motion", 55, 0.275),
    ],
)
def test_graph_estimate_carries_video_transform_trim_duration(
    client,
    monkeypatch,
    model_key,
    node_type,
    estimated_credits,
    estimated_cost_usd,
) -> None:
    captured_requests = []

    def fake_get_reference_media(reference_id):
        if reference_id == "ref-video":
            return {
                "reference_id": "ref-video",
                "kind": "video",
                "stored_path": "reference-media/videos/ref-video.mp4",
                "duration_seconds": 20.083333,
            }
        if reference_id == "ref-image":
            return {
                "reference_id": "ref-image",
                "kind": "image",
                "stored_path": "reference-media/images/ref-image.png",
            }
        return None

    def fake_estimate_request_cost(raw_request):
        captured_requests.append(raw_request)
        assert raw_request["model_key"] == model_key
        assert raw_request["task_mode"] == "motion_control"
        assert raw_request["videos"][0]["duration_seconds"] == 5
        return {
            "model_key": raw_request["model_key"],
            "estimated_credits": estimated_credits,
            "estimated_cost_usd": estimated_cost_usd,
            "currency": "USD",
            "is_known": True,
            "has_numeric_estimate": True,
            "is_authoritative": True,
            "pricing_source_kind": "verified_provider",
            "pricing_status": "verified_provider",
        }

    monkeypatch.setattr("app.graph.pricing.store.get_reference_media", fake_get_reference_media)
    monkeypatch.setattr("app.graph.pricing.kie_adapter.estimate_request_cost", fake_estimate_request_cost)
    monkeypatch.setattr(
        "app.graph.pricing.kie_adapter.pricing_snapshot",
        lambda force_refresh=False: {
            "currency": "USD",
            "is_authoritative": True,
            "is_stale": False,
            "priced_model_keys": [model_key],
            "missing_model_keys": [],
            "source_kind": "verified_provider",
            "pricing_status": "verified_provider",
            "version": "test",
        },
    )
    workflow = {
        "schema_version": 1,
        "name": "Motion trim estimate",
        "nodes": [
            {"id": "image", "type": "media.load_image", "position": {"x": -720, "y": 0}, "fields": {"reference_id": "ref-image"}},
            {"id": "video", "type": "media.load_video", "position": {"x": -720, "y": 220}, "fields": {"reference_id": "ref-video"}},
            {
                "id": "trim",
                "type": "video.transform",
                "position": {"x": -360, "y": 220},
                "fields": {"operation": "trim", "start_seconds": 0, "duration_seconds": 5, "format": "mp4"},
            },
            {
                "id": "motion",
                "type": node_type,
                "position": {"x": 0, "y": 0},
                "fields": {"prompt": "Match the five second trimmed driving video.", "character_orientation": "video", "mode": "720p"},
            },
        ],
        "edges": [
            {"id": "edge-image-motion", "source": "image", "source_port": "image", "target": "motion", "target_port": "image_refs"},
            {"id": "edge-video-trim", "source": "video", "source_port": "video", "target": "trim", "target_port": "video"},
            {"id": "edge-trim-motion", "source": "trim", "source_port": "video", "target": "motion", "target_port": "video_refs"},
        ],
    }

    response = client.post("/media/graph/estimate", json=workflow)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert captured_requests
    assert payload["nodes"]["motion"]["pricing_summary"]["total"]["estimated_credits"] == estimated_credits
    assert payload["nodes"]["motion"]["pricing_summary"]["total"]["estimated_cost_usd"] == estimated_cost_usd


def test_graph_video_transform_trim_outputs_requested_duration(client, app_modules) -> None:
    reference_id = _create_reference_video(app_modules, name="graph-video-trim-source.mp4", duration=6)
    workflow = {
        "schema_version": 1,
        "name": "Video transform trim duration",
        "nodes": [
            {"id": "load", "type": "media.load_video", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "trim",
                "type": "video.transform",
                "position": {"x": 360, "y": 0},
                "fields": {"operation": "trim", "start_seconds": 0, "duration_seconds": 5, "format": "mp4"},
            },
            {"id": "preview", "type": "preview.video", "position": {"x": 720, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-load-trim", "source": "load", "source_port": "video", "target": "trim", "target_port": "video"},
            {"id": "edge-trim-preview", "source": "trim", "source_port": "video", "target": "preview", "target_port": "video"},
        ],
    }

    final_payload = _run_graph_workflow(client, workflow)

    assert final_payload["status"] == "completed", final_payload
    trim_node = next(node for node in final_payload["nodes"] if node["node_id"] == "trim")
    output_ref = trim_node["output_snapshot_json"]["video"][0]
    record = app_modules["store"].get_reference_media(output_ref["reference_id"])
    assert record["duration_seconds"] >= 4.9
    assert record["duration_seconds"] <= 5.05
    assert output_ref["metadata"]["lineage"]["transform_type"] == "video.transform.trim"
    assert output_ref["metadata"]["lineage"]["transform_params"]["duration_seconds"] == 5


def test_graph_estimate_prices_media_preset_render_nodes(client, monkeypatch) -> None:
    captured_requests = []

    created = client.post(
        "/media/presets",
        json={
            "key": "graph-pricing-preset",
            "label": "Graph Pricing Preset",
            "description": "Pricing regression preset.",
            "status": "active",
            "model_key": "gpt-image-2-image-to-image",
            "source_kind": "custom",
            "applies_to_models": ["gpt-image-2-image-to-image"],
            "applies_to_task_modes": [],
            "applies_to_input_patterns": [],
            "prompt_template": "Render {{subject}} as a poster using [[subject]].",
            "system_prompt_template": "",
            "default_options_json": {"aspect_ratio": "auto"},
            "input_schema_json": [{"key": "subject", "label": "Subject", "required": True}],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True, "max_files": 1}],
            "thumbnail_path": None,
            "thumbnail_url": None,
            "notes": "",
            "requires_image": True,
            "requires_video": False,
            "requires_audio": False,
        },
    )
    assert created.status_code == 200, created.text
    preset_id = created.json()["preset_id"]

    monkeypatch.setattr(
        "app.graph.pricing.kie_adapter.list_models",
        lambda: [
            {
                "key": "gpt-image-2-image-to-image",
                "task_modes": ["image_edit"],
                "raw": {"options": {"aspect_ratio": {}, "resolution": {}}},
            }
        ],
    )

    def fake_estimate_request_cost(raw_request):
        captured_requests.append(raw_request)
        return {
            "model_key": raw_request["model_key"],
            "estimated_credits": 16,
            "estimated_cost_usd": 0.08,
            "currency": "USD",
            "is_known": True,
            "has_numeric_estimate": True,
            "is_authoritative": True,
            "pricing_source_kind": "verified_provider",
            "pricing_status": "verified_provider",
        }

    monkeypatch.setattr("app.graph.pricing.kie_adapter.estimate_request_cost", fake_estimate_request_cost)
    monkeypatch.setattr(
        "app.graph.pricing.kie_adapter.pricing_snapshot",
        lambda force_refresh=False: {
            "currency": "USD",
            "is_authoritative": True,
            "is_stale": False,
            "priced_model_keys": ["gpt-image-2-image-to-image"],
            "missing_model_keys": [],
            "source_kind": "verified_provider",
            "pricing_status": "verified_provider",
            "version": "test",
        },
    )
    workflow = {
        "schema_version": 1,
        "name": "Preset pricing",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": -360, "y": 0}, "fields": {"reference_id": "ref-test"}},
            {
                "id": "preset",
                "type": "preset.render",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "preset_id": preset_id,
                    "preset_model_key": "gpt-image-2-image-to-image",
                    "text__subject": "Jeep poster",
                    "option__resolution": "auto",
                },
            },
        ],
        "edges": [
            {"id": "edge-load-preset", "source": "load", "source_port": "image", "target": "preset", "target_port": "slot__subject"}
        ],
    }
    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(captured_requests) == 1
    assert captured_requests[0]["model_key"] == "gpt-image-2-image-to-image"
    assert captured_requests[0]["task_mode"] == "image_edit"
    assert len(captured_requests[0]["images"]) == 1
    assert captured_requests[0]["images"][0]["role"] == "reference"
    assert captured_requests[0]["options"] == {"aspect_ratio": "auto", "resolution": "1K"}
    assert captured_requests[0]["preset_id"] == preset_id
    assert payload["pricing_summary"]["total"]["estimated_credits"] == 16, payload
    assert payload["nodes"]["preset"]["pricing_summary"]["total"]["estimated_cost_usd"] == 0.08
    assert payload["nodes"]["preset"]["task_mode"] == "image_edit"


def test_graph_estimate_warns_unknown_pricing_and_skips_frozen_nodes(client, monkeypatch) -> None:
    calls = []

    def fake_estimate_request_cost(raw_request):
        calls.append(raw_request["model_key"])
        return {
            "model_key": raw_request["model_key"],
            "estimated_credits": None,
            "estimated_cost_usd": None,
            "currency": "USD",
            "is_known": False,
            "has_numeric_estimate": False,
            "is_authoritative": False,
        }

    monkeypatch.setattr("app.graph.pricing.kie_adapter.estimate_request_cost", fake_estimate_request_cost)
    monkeypatch.setattr(
        "app.graph.pricing.kie_adapter.pricing_snapshot",
        lambda force_refresh=False: {
            "currency": "USD",
            "is_authoritative": False,
            "is_stale": True,
            "priced_model_keys": [],
            "missing_model_keys": ["nano-banana-pro"],
            "source_kind": "resource_snapshot",
            "pricing_status": "unknown",
            "version": "test",
        },
    )
    workflow = _workflow("missing-reference")
    next(node for node in workflow["nodes"] if node["id"] == "model")["metadata"] = {"execution": {"mode": "frozen"}}
    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert calls == []
    assert payload["nodes"]["model"]["pricing_summary"]["total"]["estimated_credits"] == 0

    next(node for node in workflow["nodes"] if node["id"] == "model")["metadata"] = {"execution": {"mode": "enabled"}}
    response = client.post("/media/graph/estimate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert calls == ["nano-banana-pro"]
    assert payload["pricing_summary"]["has_unknown_pricing"] is True
    assert any(warning["code"] == "missing_model_pricing" for warning in payload["warnings"])
    assert any(warning["code"] == "stale_pricing" for warning in payload["warnings"])


def test_graph_node_definition_rejects_invalid_field_type() -> None:
    definition = GraphNodeDefinition(
        type="debug.invalid",
        title="Invalid",
        category="Debug",
        ui={
            "default_size": {"width": 240, "height": 200},
            "min_size": {"width": 240, "height": 180},
            "max_size": {"width": 500, "height": 500},
            "color": "orange",
            "accent": "orange",
            "icon": "bug",
        },
        ports={"inputs": [], "outputs": [GraphNodePort(id="json", label="JSON", type="json")]},
        fields=[GraphNodeField(id="bad", label="Bad", type="unsupported_renderer")],
    )
    with pytest.raises(GraphNodeDefinitionError, match="unsupported field renderer"):
        validate_node_definition(definition)


def test_graph_node_definition_rejects_unknown_port_type() -> None:
    definition = GraphNodeDefinition(
        type="debug.invalid_port",
        title="Invalid Port",
        category="Debug",
        ui={
            "default_size": {"width": 240, "height": 200},
            "min_size": {"width": 240, "height": 180},
            "max_size": {"width": 500, "height": 500},
            "color": "orange",
            "accent": "orange",
            "icon": "bug",
        },
        ports={"inputs": [GraphNodePort(id="latent", label="Latent", type="latent")], "outputs": []},
        fields=[],
    )
    with pytest.raises(GraphNodeDefinitionError, match="unsupported port type"):
        validate_node_definition(definition)


def test_graph_compatible_node_filtering_by_port_type(client) -> None:
    definitions = [GraphNodeDefinition.model_validate(item) for item in client.get("/media/graph/node-definitions").json()["items"]]
    image_targets = {item.type for item in compatible_node_definitions(definitions, port_type="image", direction="from_output")}
    text_targets = {item.type for item in compatible_node_definitions(definitions, port_type="text", direction="from_output")}
    video_targets = {item.type for item in compatible_node_definitions(definitions, port_type="video", direction="from_output")}
    json_targets = {item.type for item in compatible_node_definitions(definitions, port_type="json", direction="from_output")}

    assert {"image.transform", "preview.image", "media.save_image", "model.kie.nano_banana_pro"}.issubset(image_targets)
    assert {"model.kie.nano_banana_pro", "prompt.concat"}.issubset(text_targets)
    assert {"video.transform", "video.combine", "video.extract", "preview.video", "media.save_video", "debug.inspect"}.issubset(video_targets)
    assert "debug.inspect" in json_targets


def test_graph_prompt_text_can_feed_model_prompt(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    workflow["nodes"].insert(
        1,
        {
            "id": "prompt",
            "type": "prompt.text",
            "position": {"x": 180, "y": -260},
            "fields": {"text": "Create a cinematic editorial image from the source."},
        },
    )
    model_node = next(node for node in workflow["nodes"] if node["id"] == "model")
    model_node["fields"].pop("prompt")
    workflow["edges"].append({"id": "edge-prompt-model", "source": "prompt", "source_port": "text", "target": "model", "target_port": "prompt"})

    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    workflow_id = create_response.json()["workflow_id"]

    validation = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True


def test_graph_model_blocks_prompt_over_model_budget(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Prompt budget block",
        "nodes": [
            {"id": "prompt", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "x" * 20001}},
            {"id": "model", "type": "model.kie.gpt_image_2_text_to_image", "position": {"x": 360, "y": 0}, "fields": {}},
            {"id": "preview", "type": "preview.image", "position": {"x": 720, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-prompt-model", "source": "prompt", "source_port": "text", "target": "model", "target_port": "prompt"},
            {"id": "edge-model-preview", "source": "model", "source_port": "image", "target": "preview", "target_port": "image"},
        ],
    }

    final_payload = _run_graph_workflow(client, workflow)

    assert final_payload["status"] == "failed"
    assert "Prompt is too long for gpt-image-2-text-to-image" in final_payload.get("error", "")
    model_node = next(node for node in final_payload["nodes"] if node["node_id"] == "model")
    assert model_node["status"] == "failed"
    assert model_node["input_snapshot_json"]["prompt"] == "x" * 20001


def test_graph_failure_marks_unvisited_nodes_skipped(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Failure skip finalization",
        "nodes": [
            {"id": "prompt", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "x" * 20001}},
            {"id": "model", "type": "model.kie.gpt_image_2_text_to_image", "position": {"x": 360, "y": 0}, "fields": {}},
            {"id": "preview", "type": "preview.image", "position": {"x": 540, "y": 0}, "fields": {}},
            {
                "id": "muted-video",
                "type": "model.kie.seedance_2_0",
                "position": {"x": 720, "y": 0},
                "fields": {"prompt": "muted branch should not run"},
                "metadata": {"execution": {"mode": "muted"}},
            },
        ],
        "edges": [
            {"id": "edge-prompt-model", "source": "prompt", "source_port": "text", "target": "model", "target_port": "prompt"},
            {"id": "edge-model-preview", "source": "model", "source_port": "image", "target": "preview", "target_port": "image"},
        ],
    }

    final_payload = _run_graph_workflow(client, workflow)

    assert final_payload["status"] == "failed"
    nodes = {node["node_id"]: node for node in final_payload["nodes"]}
    assert nodes["model"]["status"] == "failed"
    assert nodes["preview"]["status"] == "skipped"
    assert nodes["preview"]["metrics_json"]["skip_reason"] == "upstream_failed"
    assert nodes["muted-video"]["status"] == "skipped"
    assert nodes["muted-video"]["metrics_json"]["skip_reason"] == "muted"


def test_graph_runtime_surfaces_completed_model_output_before_next_ready_model(client, app_modules, monkeypatch) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    reference_id = _create_reference_image(app_modules)

    def fake_kie_execute(node, context):
        return {
            "image": [
                GraphOutputRef(
                    kind="asset",
                    media_type="image",
                    asset_id=reference_id,
                    metadata={"source_node_id": node.id},
                )
            ]
        }

    monkeypatch.setattr(runtime.executors["model.kie"], "execute", fake_kie_execute)
    workflow = {
        "schema_version": 1,
        "name": "Surface model output before next model",
        "nodes": [
            {"id": "prompt1", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "first"}},
            {"id": "prompt2", "type": "prompt.text", "position": {"x": 0, "y": 260}, "fields": {"text": "second"}},
            {"id": "model1", "type": "model.kie.gpt_image_2_text_to_image", "position": {"x": 320, "y": 0}, "fields": {}},
            {"id": "model2", "type": "model.kie.gpt_image_2_text_to_image", "position": {"x": 320, "y": 260}, "fields": {}},
            {"id": "save1", "type": "media.save_image", "position": {"x": 680, "y": 0}, "fields": {"label": "First"}},
            {"id": "save2", "type": "media.save_image", "position": {"x": 680, "y": 260}, "fields": {"label": "Second"}},
        ],
        "edges": [
            {"id": "edge-prompt1-model1", "source": "prompt1", "source_port": "text", "target": "model1", "target_port": "prompt"},
            {"id": "edge-prompt2-model2", "source": "prompt2", "source_port": "text", "target": "model2", "target_port": "prompt"},
            {"id": "edge-model1-save1", "source": "model1", "source_port": "image", "target": "save1", "target_port": "image"},
            {"id": "edge-model2-save2", "source": "model2", "source_port": "image", "target": "save2", "target_port": "image"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run = runtime.create_run(created.json()["workflow_id"], GraphWorkflow(**workflow), start=False)

    runtime.execute_run(run.run_id)

    final_payload = client.get(f"/media/graph/runs/{run.run_id}").json()
    assert final_payload["status"] == "completed"
    started_order = [
        event["node_id"]
        for event in client.get(f"/media/graph/runs/{run.run_id}/events").json()["items"]
        if event["event_type"] == "node.started"
    ]
    assert started_order.index("model1") < started_order.index("save1") < started_order.index("model2")
    nodes_by_id = {node["node_id"]: node for node in final_payload["nodes"]}
    assert nodes_by_id["save1"]["status"] == "completed"
    assert nodes_by_id["save1"]["output_snapshot_json"]["image"][0]["asset_id"] == reference_id


def test_graph_storyboard_continuity_execution_order_is_dependency_driven() -> None:
    from app.graph.runtime import _prioritized_execution_order

    node_specs = [
        ("character", "media.load_image"),
        ("environment-recipe", "prompt.recipe"),
        ("environment-model", "model.kie.gpt_image_2_text_to_image"),
        ("environment-save", "media.save_image"),
        ("board-1-recipe", "prompt.recipe"),
        ("board-1-model", "model.kie.gpt_image_2_image_to_image"),
        ("board-1-save", "media.save_image"),
        ("board-2-recipe", "prompt.recipe"),
        ("board-2-model", "model.kie.gpt_image_2_image_to_image"),
        ("board-2-save", "media.save_image"),
        ("board-3-recipe", "prompt.recipe"),
        ("board-3-model", "model.kie.gpt_image_2_image_to_image"),
        ("board-3-save", "media.save_image"),
    ]
    edge_specs = [
        ("environment-recipe", "environment-model"),
        ("environment-model", "environment-save"),
        ("character", "board-1-recipe"),
        ("character", "board-1-model"),
        ("environment-save", "board-1-recipe"),
        ("environment-save", "board-1-model"),
        ("board-1-recipe", "board-1-model"),
        ("board-1-model", "board-1-save"),
        ("character", "board-2-recipe"),
        ("character", "board-2-model"),
        ("environment-save", "board-2-recipe"),
        ("environment-save", "board-2-model"),
        ("board-1-recipe", "board-2-recipe"),
        ("board-1-model", "board-2-recipe"),
        ("board-1-model", "board-2-model"),
        ("board-2-recipe", "board-2-model"),
        ("board-2-model", "board-2-save"),
        ("character", "board-3-recipe"),
        ("character", "board-3-model"),
        ("environment-save", "board-3-recipe"),
        ("environment-save", "board-3-model"),
        ("board-2-recipe", "board-3-recipe"),
        ("board-2-model", "board-3-recipe"),
        ("board-2-model", "board-3-model"),
        ("board-3-recipe", "board-3-model"),
        ("board-3-model", "board-3-save"),
    ]
    workflow = GraphWorkflow(
        name="Canonical storyboard dependency fixture",
        nodes=[
            GraphWorkflowNode(id=node_id, type=node_type, position={"x": 0, "y": index * 100})
            for index, (node_id, node_type) in enumerate(node_specs)
        ],
        edges=[
            GraphWorkflowEdge(
                id=f"edge-{index}",
                source=source,
                source_port="text" if source.endswith("recipe") else "image",
                target=target,
                target_port="prompt" if target.endswith("model") and source.endswith("recipe") else "image_refs",
            )
            for index, (source, target) in enumerate(edge_specs)
        ],
    )
    execution_order = [node_id for node_id, _node_type in node_specs]
    depends_on_by_id = {node_id: set() for node_id in execution_order}
    for source, target in edge_specs:
        depends_on_by_id[target].add(source)
    ordered = _prioritized_execution_order(workflow, execution_order, depends_on_by_id)
    order_index = {node_id: index for index, node_id in enumerate(ordered)}

    assert depends_on_by_id["board-2-recipe"] >= {"character", "environment-save", "board-1-recipe", "board-1-model"}
    assert depends_on_by_id["board-3-recipe"] >= {"character", "environment-save", "board-2-recipe", "board-2-model"}
    assert order_index["environment-save"] < order_index["board-1-recipe"] < order_index["board-1-model"] < order_index["board-1-save"]
    assert order_index["board-1-model"] < order_index["board-2-recipe"] < order_index["board-2-model"] < order_index["board-2-save"]
    assert order_index["board-2-model"] < order_index["board-3-recipe"] < order_index["board-3-model"] < order_index["board-3-save"]


def test_graph_prompt_recipe_image_context_prefers_bounded_web_asset(monkeypatch, tmp_path) -> None:
    from app.graph import media_refs

    original = tmp_path / "original.png"
    web = tmp_path / "web.webp"
    original.write_bytes(b"full-resolution")
    web.write_bytes(b"bounded-web")
    monkeypatch.setattr(media_refs.settings, "data_root", tmp_path)
    monkeypatch.setattr(
        media_refs.store,
        "get_asset",
        lambda _asset_id: {
            "generation_kind": "image",
            "hero_original_path": original.name,
            "hero_web_path": web.name,
            "hero_poster_path": None,
            "hero_thumb_path": None,
        },
    )
    ref = GraphOutputRef(kind="asset", media_type="image", asset_id="asset-context")

    assert media_refs.graph_ref_path(ref, expected_media_type="image") == original
    assert media_refs.graph_ref_path(ref, expected_media_type="image", prefer_web_variant=True) == web


def test_gpt_image_2_graph_prompt_shaper_compacts_dense_storyboard_under_conservative_budget() -> None:
    panels = "\n".join(
        f"PANEL {index:02d}: SHOT: cinematic frame. CAMERA: 35mm. ACTION: character crosses the lobby while cards and safe glass fragments move through frame. DIALOGUE: none. SFX/AUDIO: hush. CONTINUITY: keep layout stable."
        for index in range(1, 13)
    )
    prompt = (
        "Production-ready time-freeze storyboard production sheet with dense metadata and readable frame notes.\n\n"
        "Reference locks: use connected @image1 only for lead character identity; use connected @image2 only for hotel lobby geography and lighting.\n\n"
        f"{panels}\n\n"
        + "Bottom continuity anchors: preserve the character, wardrobe, room geography, lighting, props, and timing order. " * 60
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert result.final_chars <= 4200
    assert "@image1" in result.prompt
    assert "Panel plan with metadata rows:" in result.prompt
    for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
        assert result.prompt.count(label) >= 12
    assert "identical borders, image sizes, row heights" in result.prompt
    assert "six separate full-width horizontal rows stacked vertically" in result.prompt
    assert "FRAMING:" not in result.prompt
    assert "Use one label and value per row" in result.prompt
    assert "SFX:" not in result.prompt


def test_gpt_image_2_storyboard_compactor_reserves_all_six_panels_and_uses_positive_visual_direction() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d} image and metadata:\n"
        f"SHOT: {index:02d} COMPLETE BEAT\n"
        "CAMERA: controlled cinematic camera with a clear lens choice\n"
        "FRAMING: readable subject, vehicle, and environment composition\n"
        f"ACTION: The subject completes causal story action {index} while the environment state advances visibly\n"
        "MOTION: purposeful camera and subject movement\n"
        + "DIALOG: {}\n".format('LEAD [warm voice] — "Ready for the next beat?"' if index == 5 else "")
        + "NOTES: preserve the exact current geography, lighting, wardrobe, props, and handoff state"
        for index in range(1, 7)
    )
    prompt = (
        "Create one complete 16:9 production storyboard titled ‘RELAY HANDOFF — BOARD 3 OF 3’.\n\n"
        "Use @image1 for identity. Use @image2 for environment continuity. Use @image3 for the prior final frame.\n\n"
        "HANDOFF ADVANCE: Continue from the prior final frame, but it must not duplicate the prior image.\n"
        "DIALOGUE CUES: LEAD [warm voice] — \"Ready for the next beat?\"\n"
        "WARDROBE CUES: sealed high-collar work coverall with continuous opaque fabric through the hips. No exposed midriff.\n"
        "SUBJECT DESIGN CUES: compact four-legged companion with articulated forelegs; never render a humanoid or biped.\n\n"
        f"{panels}\n\n"
        + "Keep the full sheet, all six finished cells, exact labels, and causal continuity. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.final_chars <= 4200
    assert "Every one of the 6 cells contains a finished photoreal" in result.prompt
    assert "feature-film production still photographed on a physical set" in result.prompt
    assert "real lens optics" in result.prompt
    assert "natural skin and material texture" in result.prompt
    assert "clean production typography outside the image" in result.prompt
    assert "Copy every label exactly and completely in every cell" in result.prompt
    assert "spell each label exactly and completely" in result.prompt
    for index in range(1, 7):
        assert f"{index:02d}: SHOT:" in result.prompt
        panel = result.prompt.split(f"{index:02d}: SHOT:", 1)[1].split("|", 1)[0]
        assert "COMPLETE BEAT" in panel.split(";", 1)[0]
    for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
        assert result.prompt.count(label) == 6
    assert "FRAMING:" not in result.prompt
    lowered = result.prompt.lower()
    for negative_direction in ("do not", "don't", "never", "without", "no exposed"):
        assert negative_direction not in lowered


def test_gpt_image_2_graph_prompt_shaper_does_not_storyboard_compact_environment_sheet() -> None:
    prompt = (
        "Create a production-ready environment continuity sheet for a ruined spaceport hangar repair bay.\n\n"
        "Environment brief: cinematic sci-fi spacecraft hangar interior, environment only, no people, no characters, "
        "no faces, no bodies. Use the connected character reference only as a visual style influence for worn red-white "
        "paint, scratched metal, dark industrial materials, yellow-orange graphics, practical lighting, and film grain.\n\n"
        "Key zones: fixed hero spacecraft parked center-left; open ramp camera-right; cracked concrete floor with oil stains; "
        "overhead gantries; service cranes; blue diagnostic wall; tool carts; cable bundles; welding bay; large hangar doors.\n\n"
        "Layout mode: production_sheet. Avoid staged characters, combat, exterior views, and no storyboard panels. "
        "Keep the same hangar geography locked for future panels. "
        * 24
    )

    result = shape_kie_graph_prompt("gpt-image-2-text-to-image", prompt, task_mode="text_to_image", max_chars=20000)

    assert result.changed is True
    assert result.strategy == "gpt_image_2_environment_compact"
    assert result.final_chars <= 4200
    assert "Environment only" in result.prompt
    assert "storyboard panels" in result.prompt
    assert "freeze trigger" not in result.prompt
    assert "frozen suspended objects" not in result.prompt
    assert "character identity" not in result.prompt
    assert "DIALOGUE" not in result.prompt
    assert "SFX rows" in result.prompt


def test_gpt_image_2_graph_prompt_shaper_keeps_non_freeze_storyboard_generic() -> None:
    panels = "\n".join(
        f"PANEL {index:02d}: SHOT: cinematic frame. CAMERA: 35mm. ACTION: pilot advances the red-white ship story through a ruined spaceport. DIALOGUE: none. SFX/AUDIO: engine hum. CONTINUITY: keep ship, pilot, and hangar geography stable."
        for index in range(1, 13)
    )
    prompt = (
        "Production-ready sci-fi storyboard sheet for a pilot upgrade check, launch, and orbital relay signal.\n\n"
        "Reference locks: use connected @image1 for lead character identity; use connected @image2 for hangar geography and ship style.\n\n"
        f"{panels}\n\n"
        + "Bottom continuity anchors: preserve the pilot, wardrobe, ship, location geography, lighting, props, and story order. " * 60
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert result.final_chars <= 4200
    assert "GPT Image 2" not in result.prompt
    assert "every other row value must be non-empty and may not use a placeholder" in result.prompt
    assert "freeze trigger" not in result.prompt
    assert "frozen suspended objects" not in result.prompt


def test_gpt_image_2_graph_prompt_shaper_ignores_conditional_freeze_template_for_non_freeze_story() -> None:
    panels = "\n".join(
        f"PANEL {index:02d}: SHOT: orbital relay. CAMERA: 35mm. ACTION: the pilot advances the launch sequence. DIALOGUE: none. SFX/AUDIO: engine hum. CONTINUITY: keep the ship and hangar stable."
        for index in range(1, 7)
    )
    prompt = (
        "USER STORY BRIEF: A pilot repairs a red-white ship, launches from the ruined spaceport, and activates an orbital relay.\n\n"
        "Generic recipe guidance: when a different USER STORY BRIEF includes time freeze or stopped time, preserve "
        "NORMAL -> FREEZE TRIGGER -> FROZEN INTERVENTION -> UNFREEZE TRIGGER -> RESUMED order.\n\n"
        f"{panels}\n\n"
        + "Preserve the pilot, ship, hangar geography, panel grid, and production-board metadata. " * 90
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.final_chars <= 4200
    assert "freeze trigger" not in result.prompt.lower()
    assert "frozen intervention" not in result.prompt.lower()
    assert "unfreeze trigger" not in result.prompt.lower()
    assert "frozen suspended objects" not in result.prompt.lower()
    assert "pilot advances the launch sequence" in result.prompt.lower()


def test_gpt_image_2_graph_prompt_shaper_preserves_time_freeze_state_order() -> None:
    panels = "\n".join(
        f"PANEL {index:02d}: SHOT: hotel lobby beat. CAMERA: 35mm. ACTION: state-machine beat {index}. DIALOGUE: none. SFX/AUDIO: lobby ambience. CONTINUITY: preserve state order."
        for index in range(1, 7)
    )
    prompt = (
        "USER STORY BRIEF: The lead enters in NORMAL time, performs the FREEZE TRIGGER, moves alone during "
        "FROZEN INTERVENTION, performs the UNFREEZE TRIGGER, then everyone is RESUMED in causal order.\n\n"
        f"{panels}\n\n"
        + "Preserve the character, lobby geography, 3x2 grid, readable metadata, and exact chronological state transitions. " * 90
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.final_chars <= 4200
    state_sequence = ("NORMAL", "FREEZE TRIGGER", "FROZEN INTERVENTION", "UNFREEZE TRIGGER", "RESUMED")
    shaped_upper = result.prompt.upper()
    for state in state_sequence:
        assert state in shaped_upper
    state_positions = [shaped_upper.index(state) for state in state_sequence]
    assert state_positions == sorted(state_positions)


def test_gpt_image_2_graph_prompt_shaper_preserves_live_shot_image_headings_and_final_handoff() -> None:
    actions = [
        "The pilot begins the upgrade inspection beside her ship.",
        "The pilot rotates her wrist and checks every mechanical finger.",
        "The pilot checks power flow through both modified arms.",
        "The pilot completes a controlled strength test beside the ramp.",
        "The pilot confirms every upgraded system is stable.",
        "The pilot finishes the inspection and turns toward the ship.",
    ]
    shots = "\n\n".join(
        f"SHOT {index:02d} image — cinematic beat.\n"
        f"SHOT: {index:02d} SYSTEMS CHECK\n"
        "CAMERA: cinematic 35mm framing\n"
        f"ACTION: {action}\n"
        f"DIALOG: {'Looks like I am ready for the next adventure.' if index == 6 else 'none'}\n"
        "SFX/AUDIO: hangar ambience\n"
        "CONTINUITY: preserve the pilot, ship, ramp, and repair-bay geography"
        for index, action in enumerate(actions, start=1)
    )
    prompt = (
        "Create one 16:9 cinematic storyboard production sheet with a locked 3x2 grid.\n\n"
        "Reference locks: use @image1 for character identity and @image2 for environment geography.\n\n"
        f"{shots}\n\n"
        + "Keep the same board design, metadata rows, character, ship, and location. " * 70
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.final_chars <= 4200
    assert "Panel plan with metadata rows" in result.prompt
    assert "upgrade inspection" in result.prompt.lower()
    assert "ready for the next adventure" in result.prompt.lower()
    assert "01:" in result.prompt
    assert "06:" in result.prompt


def test_gpt_image_2_graph_prompt_shaper_preserves_paid_cell_upgrade_beats_and_safe_framing() -> None:
    cells = [
        (
            "wide establishing image. The half-cyborg woman looks down at both upgraded arms beside the open ship ramp.",
            "ARRIVAL CHECK",
            "The woman raises both mechanical forearms and begins a careful visual inspection",
            "",
            "Establish the inspection beside the ship and preserve the approved outfit",
        ),
        (
            "medium over-shoulder image. She rotates the upgraded left wrist and spreads articulated fingers one by one.",
            "FINE CONTROL",
            "The woman rotates her wrist and tests each articulated finger through its full range",
            "Response is cleaner.",
            "Keep every upgraded part attached and visually consistent",
        ),
        (
            "detailed insert. She presses the integrated diagnostic pad and watches the indicator stabilize.",
            "DIAGNOSTIC",
            "The woman presses the built-in diagnostic control and studies the readout",
            "",
            "The visible control confirms stable operation",
        ),
        (
            "low side image. She flexes both knees and tests the upgraded leg and torso servos.",
            "LOAD TEST",
            "The woman tests shoulder travel and transfers weight between both legs",
            "",
            "Preserve exact body and covered outfit continuity",
        ),
        (
            "dynamic image. She completes the inspection and turns toward the open ramp.",
            "ALL GREEN",
            "The woman completes one final hand cycle and relaxes her upgraded arms",
            "",
            "Stable indicators confirm the inspection succeeded",
        ),
        (
            "intimate hero close-up. She smiles with the ship ramp behind her; end on optimism and readiness, not launch.",
            "READY",
            "The woman finishes the inspection, lifts her gaze, and smiles with quiet confidence",
            "Looks like I am ready for the next adventure.",
            "Final payoff preserves identity, covered wardrobe, and the spoken handoff",
        ),
    ]
    cell_text = "\n\n".join(
        f"CELL {index:02d} — {scene}\n\n"
        f"SHOT: {index:02d} {shot}\n"
        "CAMERA: cinematic 35mm production framing\n"
        "FRAMING: readable subject and environment composition\n"
        f"ACTION: {action}\n"
        "MOTION: controlled character and camera movement\n"
        f"DIALOG: {dialogue}\n"
        f"NOTES: {notes}"
        for index, (scene, shot, action, dialogue, notes) in enumerate(cells, start=1)
    )
    prompt = (
        "Create one 4K-quality 16:9 cinematic production storyboard sheet titled SYSTEMS CHECK, exactly six cells in a fixed 3x2 grid.\n\n"
        "Use @image1 for character identity and approved wardrobe; use @image2 for the ruined spaceport hangar geography.\n\n"
        "USER WARDROBE: fully enclosed crew workwear with continuous fabric from collar through hips.\n\n"
        "Newly modified parts are already installed. Show a calm post-upgrade inspection sequence that ends with the requested next-adventure line.\n\n"
        f"{cell_text}\n\n"
        + "Keep the same board design, character, ship, metadata geometry, and location continuity. " * 70
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert result.final_chars <= 4200
    shaped = result.prompt.lower()
    for required in (
        "upgraded arms",
        "visual inspection",
        "rotates her wrist",
        "diagnostic",
        "ready for the next adventure",
        "fully enclosed crew workwear",
        "task-focused professional framing",
    ):
        assert required in shaped
    assert "dialogue: notes" not in shaped
    assert [result.prompt.index(f"{index:02d}:") for index in range(1, 7)] == sorted(
        result.prompt.index(f"{index:02d}:") for index in range(1, 7)
    )


def test_gpt_image_2_graph_prompt_shaper_preserves_paid_cell_launch_beats_and_destination_handoff() -> None:
    cells = [
        ("The pilot reaches the open ramp and begins climbing into the ship.", "BOARDING", "The pilot ascends the reachable ramp", "Pick up from the prior final state"),
        ("The pilot enters the worn passage and lowers into the cockpit seat.", "COCKPIT ENTRY", "The pilot enters the cockpit and places her hands near visible controls", "Prove the ramp-to-cockpit route"),
        ("The pilot presses the visible start control and checks cockpit systems.", "STARTUP", "The pilot activates the startup control and verifies cockpit indicators", "Controls appear before activation"),
        ("The engines power up and the ship lifts toward the hangar exit.", "ENGINE LIFT", "The powered ship lifts from the repair bay", "Power precedes movement"),
        ("The ship launches into a storm-lit sky while the ruined spaceport recedes.", "STORM CLIMB", "The pilot advances the throttle through the storm", "The spaceport visibly recedes"),
        ("Above the clouds, a new destination signal appears on the cockpit display.", "NEW SIGNAL", "The pilot notices the destination signal", "Final handoff to Segment 3"),
    ]
    cell_text = "\n\n".join(
        f"CELL {index:02d} — {scene}\n\n"
        f"SHOT: {index + 6:02d} {shot}\n"
        "CAMERA: cinematic continuation framing\n"
        "FRAMING: readable character, ship, and location composition\n"
        f"ACTION: {action}\n"
        "MOTION: preserve causal movement and screen direction\n"
        "DIALOG: \n"
        f"NOTES: {notes}"
        for index, (scene, shot, action, notes) in enumerate(cells, start=1)
    )
    prompt = (
        "Create one 16:9 production storyboard sheet titled LAUNCH WINDOW, segment 2 of 3, exactly six cells in a fixed 3x2 grid.\n\n"
        "Use @image1 for character identity and approved wardrobe, @image2 for environment geography, and @image3 for prior-board layout and ending state.\n\n"
        "CONTINUATION BRIEF: board the ship, enter the cockpit, check systems, launch through a storm, and end on a new destination signal.\n\n"
        f"{cell_text}\n\n"
        + "Preserve the same layout, metadata rows, ship, cockpit, wardrobe, lighting, and final handoff. " * 75
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert result.final_chars <= 4200
    shaped = result.prompt.lower()
    for required in ("boarding", "cockpit", "startup", "storm", "destination signal", "segment 3"):
        assert required in shaped
    assert "dialogue: notes" not in shaped
    assert [result.prompt.index(f"{index:02d}:") for index in range(1, 7)] == sorted(
        result.prompt.index(f"{index:02d}:") for index in range(1, 7)
    )


def test_gpt_image_2_graph_prompt_shaper_preserves_recipe_metadata_and_phase7_inspection_beats() -> None:
    cells = [
        ("Service robots load supply crates through the fixed hangar lane.", "LOADING", "Service robots carry labeled supply crates toward the open ship ramp"),
        ("The pilot starts the exterior walkaround beside the same ship.", "GEAR CHECK", "The pilot checks the landing gear and follows the hull seams"),
        ("The inspection continues along the fixed service side.", "PORT CHECK", "The pilot checks the fuel and coolant connections"),
        ("The ship and loading lane remain in the same hangar geography.", "STATUS CHECK", "The pilot verifies the exterior status lights while robots keep loading supplies"),
        ("A diagnostic indicator identifies the next reachable inspection point.", "FAULT TRACE", "The pilot follows the diagnostic indicator toward the engine service panel"),
        ("Loading continues as the exterior check hands off to the deeper repair.", "SERVICE HANDOFF", "The pilot reaches the service panel and prepares to inspect it next"),
    ]
    cell_text = "\n\n".join(
        f"CELL {index:02d} — {scene}\n\n"
        f"SHOT: {index:02d} {shot}\n"
        "CAMERA: controlled cinematic 35mm camera\n"
        "FRAMING: readable pilot, ship, robots, and hangar geography\n"
        f"ACTION: {action}\n"
        "MOTION: preserve screen direction and continuous loading motion\n"
        f"DIALOG: {'Loading route is clear.' if index == 1 else ''}\n"
        "NOTES: preserve the exact ship, hangar, wardrobe, and inspection state"
        for index, (scene, shot, action) in enumerate(cells, start=1)
    )
    prompt = (
        "Create one 16:9 production storyboard sheet, exactly six cells in a fixed 3x2 grid.\n\n"
        "Use @image1 for character identity and @image2 for the connected hangar, ship, and cockpit environment lock.\n\n"
        f"{cell_text}\n\n"
        + "Use the identical metadata-strip geometry, typography, palette, and footer across all sequence boards. " * 70
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert result.final_chars <= 4200
    shaped = result.prompt.lower()
    for required in (
        "service robots",
        "supply crates",
        "landing gear",
        "hull seams",
        "fuel",
        "coolant",
        "status lights",
        "diagnostic indicator",
        "service panel",
    ):
        assert required in shaped
    for index in range(1, 7):
        start = result.prompt.index(f"{index:02d}:")
        end = result.prompt.index(f"{index + 1:02d}:") if index < 6 else len(result.prompt)
        panel = result.prompt[start:end]
        for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
            assert label in panel


def test_gpt_image_2_graph_prompt_shaper_preserves_live_panel_image_heading_variant() -> None:
    panels = "\n\n".join(
        f"Panel {index:02d} image — causal hangar story beat {index} with the pilot and ship.\n"
        f"SHOT: {index:02d} STORY BEAT\n"
        "CAMERA: cinematic 35mm production camera\n"
        "FRAMING: readable pilot, ship, and fixed hangar geography\n"
        f"ACTION: The pilot advances causal hangar action {index} toward the launch\n"
        "MOTION: preserve screen direction and continuous environment motion\n"
        f"DIALOG: {'Bolts, are you ready for this next adventure?' if index == 6 else ''}\n"
        "NOTES: preserve character, ship, environment, and prior ending state"
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard titled “BOARDING AND LAUNCH — BOARD 3 OF 3” with exactly six panels in a fixed 3x2 grid.\n\n"
        "Use @image1 for character identity, @image2 for environment geography, and @image3 for prior-board layout and ending state.\n\n"
        f"{panels}\n\n"
        + "Keep one identical board layout and exact metadata row system across the sequence. " * 80
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert result.final_chars <= 4200
    assert [result.prompt.index(f"{index:02d}:") for index in range(1, 7)] == sorted(
        result.prompt.index(f"{index:02d}:") for index in range(1, 7)
    )
    for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
        assert result.prompt.count(label) >= 6
    assert "FRAMING:" not in result.prompt
    assert "User board title: BOARDING AND LAUNCH — BOARD 3 OF 3" in result.prompt
    assert "Bolts, are you ready for this next adventure?" in result.prompt
    assert "Exact DIALOG text stays verbatim, complete, and assigned to one row." in result.prompt


def test_gpt_image_2_graph_prompt_shaper_preserves_split_reference_locks_and_exact_title() -> None:
    panels = "\n\n".join(
        f"Panel {index:02d} image — causal continuation beat {index} in the fixed hangar and ship.\n"
        f"SHOT: {index:02d} CONTINUATION BEAT\n"
        "CAMERA: controlled cinematic production camera\n"
        "FRAMING: readable pilot, ship, and environment geography\n"
        f"ACTION: The pilot advances the repair-to-launch story beat {index}\n"
        "MOTION: preserve causal screen direction and continuous action\n"
        f"DIALOG: {'Bolts, are you ready for this next adventure?' if index == 6 else ''}\n"
        "NOTES: preserve the prior ending state and fixed board design"
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard titled exactly “BOARDING AND LAUNCH — BOARD 3 OF 3,” "
        "with exactly six panels in a fixed 3x2 grid.\n\n"
        "PREVIOUS-BOARD READ: Continue from the actual ending state of @image3 without repeating prior beats.\n\n"
        "REFERENCE LOCKS:\n"
        "Use @image1 only for the recurring pilot's identity, cyborg design, and covered wardrobe.\n\n"
        "Use @image2 only for the definitive hangar, ship, cockpit, lighting, and route geography.\n\n"
        "Use @image3 only for the immediate previous board's ending state, layout, and metadata geometry.\n\n"
        f"{panels}\n\n"
        + "Keep the identical production-board layout, reference roles, and continuity system. " * 90
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.changed is True
    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert result.final_chars <= 4200
    assert "User board title: BOARDING AND LAUNCH — BOARD 3 OF 3" in result.prompt
    for token in ("@image1", "@image2", "@image3"):
        assert token in result.prompt
    assert result.prompt.index("@image1") < result.prompt.index("@image2") < result.prompt.index("@image3")


def test_gpt_image_2_graph_prompt_shaper_preserves_adjacent_live_reference_lines() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d}: causal hangar beat.\n"
        f"SHOT: {index:02d} CONTINUITY BEAT\n"
        "CAMERA: controlled cinematic production camera\n"
        "FRAMING: readable pilot, ship, and hangar geography\n"
        f"ACTION: The pilot advances the causal story beat {index}\n"
        "MOTION: preserve screen direction and continuous action\n"
        "DIALOG: \n"
        "NOTES: preserve the exact environment and prior ending state"
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard titled exactly \u201cBOARDING AND LAUNCH \u2014 BOARD 3 OF 3\u201d.\n\n"
        "REFERENCE CONTROL:\n"
        "Use @image1 only for the pilot identity, face, long brown hair, age impression, and facial proportions; do not copy casual clothing or text.\n"
        "Use @image2 exclusively as the immutable hangar geography, ship, cockpit, route, materials, and lighting lock.\n"
        "Use @image3 only as evidence for the immediate previous board ending state, layout, and metadata geometry.\n\n"
        f"{panels}\n\n"
        + "Keep the identical board system and causal story. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.final_chars <= 4200
    for token in ("@image1", "@image2", "@image3"):
        assert token in result.prompt
    assert result.prompt.index("@image1") < result.prompt.index("@image2") < result.prompt.index("@image3")


def test_gpt_image_2_graph_prompt_shaper_preserves_late_action_state_terms() -> None:
    actions = [
        "The pilot supervises service robots carrying supply crates toward the open ramp",
        "The pilot checks the loading manifest while the robots continue their route",
        "The pilot inspects the landing gear and follows the exterior hull seams",
        "The pilot checks the secured fuel and coolant connections beside the same ship",
        "The pilot checks the locked fuel and coolant collars, then confirms steady exterior status lights",
        "The pilot installs and locks the replacement, then resets the circuit as the system returns to steady green",
    ]
    panels = "\n\n".join(
        f"Panel {index:02d} image — causal inspection and repair state {index} beside the fixed ship.\n"
        f"SHOT: {index:02d} STATE CHECK\n"
        "CAMERA: controlled cinematic production camera\n"
        "FRAMING: readable pilot, ship, and hangar geography\n"
        f"ACTION: {action}\n"
        "MOTION: preserve causal screen direction and continuous loading action\n"
        "DIALOG: \n"
        "NOTES: preserve the exact ship, environment, and component state"
        for index, action in enumerate(actions, start=1)
    )
    prompt = (
        "Create one 16:9 production storyboard titled “EXTERIOR REPAIR — BOARD 2 OF 3” with six panels.\n\n"
        "Use @image1 for the pilot and @image2 for the fixed hangar and ship environment.\n\n"
        f"{panels}\n\n"
        + "Keep the identical board layout, production-note rows, references, and causal story. " * 90
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.final_chars <= 4200
    assert "status lights" in result.prompt
    assert "steady green" in result.prompt


def test_gpt_image_2_graph_prompt_shaper_preserves_fixed_grid_spatial_headings() -> None:
    headings = (
        "TOP-LEFT",
        "TOP-CENTER",
        "TOP-RIGHT",
        "BOTTOM-LEFT",
        "BOTTOM-CENTER",
        "BOTTOM-RIGHT",
    )
    actions = (
        "Service robots carry supply crates through the fixed hangar lane",
        "The pilot checks the loading manifest beside the same ship",
        "The pilot inspects landing gear, hull seams, fuel, coolant, and status lights",
        "The pilot opens the service panel and identifies one burnt-out capacitor",
        "The pilot installs the replacement and restores the system to steady green",
        "The pilot straps in beside the cyborg cat and launches through the same hangar doors",
    )
    panels = "\n\n".join(
        f"{heading} PANEL IMAGE: causal story beat {index} in the fixed environment.\n"
        f"SHOT: {index:02d} CONTINUITY BEAT\n"
        "CAMERA: controlled cinematic production camera\n"
        "FRAMING: readable pilot, ship, and hangar geography\n"
        f"ACTION: {action}\n"
        "MOTION: preserve screen direction and causal movement\n"
        f"DIALOG: {'Bolts, are you ready for this next adventure?' if index == 6 else ''}\n"
        "NOTES: preserve the exact environment, layout, and prior ending state"
        for index, (heading, action) in enumerate(zip(headings, actions), start=1)
    )
    prompt = (
        "Create one 16:9 production storyboard titled exactly “BOARDING AND LAUNCH — BOARD 3 OF 3” in a fixed 3x2 grid.\n\n"
        "Use @image1 for the pilot, @image2 for environment geography, and @image3 for the previous board.\n\n"
        f"{panels}\n\n"
        + "Keep the identical production-board layout, metadata rows, references, and causal story. " * 90
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.final_chars <= 4200
    assert [result.prompt.index(f"{index:02d}:") for index in range(1, 7)] == sorted(
        result.prompt.index(f"{index:02d}:") for index in range(1, 7)
    )
    for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
        assert result.prompt.count(label) == 6
    assert "FRAMING:" not in result.prompt
    for required in ("@image1", "@image2", "@image3", "burnt-out capacitor", "steady green", "cyborg cat", "hangar doors"):
        assert required in result.prompt
    assert "Bolts, are you ready for this next adventure?" in result.prompt


def test_gpt_image_2_graph_prompt_shaper_preserves_live_spatial_panel_headings_without_image_word() -> None:
    headings = (
        "Top-left panel",
        "Top-middle panel",
        "Top-right panel",
        "Bottom-left panel",
        "Bottom-middle panel",
        "Bottom-right panel",
    )
    actions = (
        "Service robots carry supply crates through the fixed hangar lane",
        "The pilot checks the loading manifest beside the same ship",
        "The pilot inspects the landing gear and exterior hull seams",
        "The pilot checks the fuel and coolant connections",
        "The pilot verifies the exterior status lights",
        "The pilot reaches the closed engine service panel",
    )
    panels = "\n\n".join(
        f"{heading}:\n"
        f"SHOT: {index:02d} CONTINUITY BEAT\n"
        "CAMERA: controlled cinematic production camera\n"
        "FRAMING: readable pilot, ship, and hangar geography\n"
        f"ACTION: {action}\n"
        "MOTION: preserve screen direction and continuous loading\n"
        "DIALOG: "
        for index, (heading, action) in enumerate(zip(headings, actions), start=1)
    )
    prompt = (
        "Create one 16:9 production storyboard titled “LOADING AND EXTERIOR INSPECTION — BOARD 1 OF 3”.\n\n"
        "Use @image1 for pilot identity.\n"
        "Use @image2 for fixed hangar, ship, route, material, and lighting continuity.\n\n"
        f"{panels}\n\n"
        + "Keep the identical production-board layout and metadata system. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.final_chars <= 4200
    for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
        assert result.prompt.count(label) == 6
    assert "FRAMING:" not in result.prompt
    for required in ("supply crates", "loading manifest", "landing gear", "fuel", "coolant", "status lights", "service panel"):
        assert required in result.prompt


def test_gpt_image_2_graph_prompt_shaper_uses_positive_only_coverage_framing() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d}: practical hangar inspection beat.\n"
        f"SHOT: {index:02d} INSPECTION\n"
        "CAMERA: controlled cinematic camera\n"
        "FRAMING: readable task-focused composition\n"
        "ACTION: The pilot performs the next preflight check\n"
        "MOTION: measured professional movement\n"
        "DIALOG: \n"
        "NOTES: keep one practical crew uniform"
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard for a professional preflight sequence.\n\n"
        "Use @image1 for pilot identity and @image2 for hangar continuity.\n\n"
        "USER WARDROBE: fully enclosed crew workwear with continuous fabric from collar through hips.\n\n"
        f"{panels}\n\n"
        + "Keep the same practical production design and crew uniform. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)
    shaped = result.prompt.lower()

    assert "fully enclosed crew workwear" in shaped
    assert "task-focused professional framing" in shaped
    for term in ("non-sexual", "pin-up", "underwear", "wardrobe removal", "skin exposure", "cleavage", "midriff", "gore", "injury"):
        assert term not in shaped


def test_gpt_image_2_graph_prompt_shaper_shortens_metadata_at_whole_word_boundaries() -> None:
    framings = (
        "Extreme wide; ship dominates center and the loading lane remains readable",
        "Medium; tablet foreground and the open ramp remains visible behind",
        "Medium-wide; landing gear foreground and the pilot remains in profile",
        "Medium-wide; pilot lower third and the long hull seam leads through frame",
        "Medium close; couplings foreground and status lights remain readable",
        "Medium-wide; pilot and closed panel dominate while loading continues behind",
    )
    motions = (
        "Steady robot traffic continues through the marked supply lane",
        "Short push-in while one service robot crosses toward the ramp",
        "Brief lateral track while the pilot traces the landing assembly",
        "Smooth parallel track while background gantries drift in parallax",
        "Rack focus from seated couplings to the first amber indicator",
        "Slow push-in while the amber indicator pulses beside the closed latch",
    )
    panels = "\n\n".join(
        f"Panel {index:02d} image — practical exterior inspection beat beside the same ship.\n"
        f"SHOT: {index:02d} CONTINUITY CHECK\n"
        "CAMERA: Tight three-quarter insert with controlled cinematic movement\n"
        f"FRAMING: {framing}\n"
        "ACTION: The pilot advances the exterior inspection in the fixed hangar\n"
        f"MOTION: {motion}\n"
        "DIALOG: \n"
        "NOTES: preserve the exact environment and story order"
        for index, (framing, motion) in enumerate(zip(framings, motions), start=1)
    )
    prompt = (
        "Create one 16:9 production storyboard titled “LOADING AND EXTERIOR INSPECTION — BOARD 1 OF 3”.\n\n"
        "Use @image1 for pilot identity and @image2 for the fixed hangar and ship.\n\n"
        f"{panels}\n\n"
        + "Keep the same six-panel production-board layout and causal story. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    assert result.final_chars <= 4200
    for fragment in ("three-quarter inse.", "ship dominat.", "pilot lower t.", "couplings fo.", "seated cou.", "amber indica."):
        assert fragment not in result.prompt
    for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
        assert result.prompt.count(label) == 6
    assert "FRAMING:" not in result.prompt


def test_gpt_image_2_graph_prompt_shaper_avoids_dangling_metadata_clauses() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d} image and metadata:\n"
        f"SHOT: {index:02d} INSPECTION\n"
        "CAMERA: Side-on dolly with a restrained tracking move beside the same ship\n"
        "FRAMING: Medium-close; pilot and the service panel remain readable together\n"
        "ACTION: The pilot checks a handheld loading manifest while service robots carry labeled supply crates toward the open ramp\n"
        "MOTION: Gentle push-in timed to the amber diagnostic indicator\n"
        "DIALOG: \n"
        "NOTES: preserve the fixed hangar geography"
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard titled ‘LOADING AND EXTERIOR INSPECTION — BOARD 1 OF 3’.\n\n"
        "Use @image1 for pilot identity and @image2 for fixed environment continuity.\n\n"
        f"{panels}\n\n"
        + "Preserve the same board system and causal story. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    for fragment in (
        "three-quarte.",
        "dolly with.",
        "pilot and.",
        "timed to.",
        "looks toward the.",
        "carry labeled.",
        "advance in.",
        "push-in as the.",
    ):
        assert fragment not in result.prompt.lower()
    assert result.prompt.count(
        "ACTION: The pilot checks a handheld loading manifest while service robots carry labeled supply crates toward the open ramp"
    ) == 6


def test_gpt_image_2_graph_prompt_shaper_excludes_negated_future_state_from_board_one_handoff() -> None:
    actions = (
        "The pilot supervises service robots carrying supply crates toward the open ramp",
        "The pilot checks the loading manifest beside the same ship",
        "The pilot inspects the landing gear and exterior hull seams",
        "The pilot checks the fuel and coolant connections",
        "The pilot verifies the exterior status lights as one amber cue appears",
        "The diagnostic indicator guides the pilot to the reachable engine service panel",
    )
    scenes = (
        "Loading continues in the fixed hangar.",
        "The open ramp remains visible behind the pilot.",
        "The same landing gear and hangar doors remain fixed.",
        "The loading robots remain in the established lane.",
        "The amber diagnostic cue points farther aft.",
        "The already-open ramp remains ahead of the repaired closed service panel while the pilot rests one red mechanical hand on the hull immediately beside the latch. Do not reveal internal components or a capacitor.",
    )
    panels = "\n\n".join(
        f"Panel {index:02d} image — {scene}\n"
        f"SHOT: {index:02d} INSPECTION\n"
        "CAMERA: controlled cinematic production camera\n"
        "FRAMING: readable pilot, ship, and hangar geography\n"
        f"ACTION: {action}\n"
        "MOTION: preserve continuous screen direction\n"
        "DIALOG: \n"
        "NOTES: preserve the exact environment and current state"
        for index, (scene, action) in enumerate(zip(scenes, actions), start=1)
    )
    prompt = (
        "Create one 16:9 production storyboard titled “LOADING AND EXTERIOR INSPECTION — BOARD 1 OF 3”.\n\n"
        "Use @image1 only for pilot identity and cyborg construction.\n"
        "Use @image2 exclusively for fixed hangar, ship, route, material, and lighting continuity.\n\n"
        "HANDOFF ADVANCE: End with the repaired closed service panel and the character beside its latch.\n\n"
        f"{panels}\n\n"
        + "Keep the identical production-board layout and metadata system. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)
    shaped = result.prompt.lower()

    assert result.final_chars <= 4200
    assert "closed service panel" in shaped
    assert "open service panel" not in shaped
    assert "amber cue" in shaped
    assert "character beside its latch" in shaped
    assert "State:" not in result.prompt
    assert "capacitor" not in shaped
    assert "internal components" not in shaped


def test_gpt_image_2_graph_prompt_shaper_assigns_wardrobe_to_prompt_not_retained_identity_sheet() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d}: practical hangar inspection beat.\n"
        f"SHOT: {index:02d} INSPECTION\n"
        "CAMERA: controlled cinematic camera\n"
        "FRAMING: readable task-focused composition\n"
        "ACTION: The pilot performs the next preflight check\n"
        "MOTION: measured professional movement\n"
        "DIALOG: \n"
        "NOTES: keep one practical crew uniform"
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard for a professional preflight sequence.\n\n"
        "Use @image1 as the pilot identity, body, and wardrobe reference and @image2 for hangar continuity.\n\n"
        "USER WARDROBE: sealed high-collar cream-and-red mechanic coverall; continuous fabric covers chest through hips; "
        "the face is the only visible human skin; broad opaque cream-and-red mechanic waist guard overlaps the upper coverall "
        "and trousers in front, side, back, and seated views.\n\n"
        f"{panels}\n\n"
        + "Keep the same practical production design and crew uniform. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)
    shaped = result.prompt.lower()

    assert "recognizable identity and subject construction" in shaped
    assert "user wardrobe directions define the clothing" in shaped
    assert "@image1 locks recognizable identity and subject construction" in shaped
    assert "@image1 as the pilot identity, body, and wardrobe reference" not in shaped
    assert "high-collar" in shaped
    assert "continuous fabric covers chest through hips" in shaped
    assert "the face is the only visible human skin" in shaped
    assert "broad opaque cream-and-red mechanic waist guard" in shaped
    assert "overlaps the upper coverall and trousers" in shaped
    assert "front, side, back, and seated views" in shaped
    for term in ("non-sexual", "pin-up", "underwear", "wardrobe removal", "skin exposure", "cleavage", "midriff", "gore", "injury"):
        assert term not in shaped


def test_gpt_image_2_graph_prompt_shaper_prefers_closed_panel_and_does_not_turn_departing_droids_around() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d}\n"
        f"SHOT: {index:02d} CONTINUATION\n"
        "CAMERA: cinematic production camera\n"
        "FRAMING: environment and subject remain readable\n"
        + (
            "ACTION: The pilot crosses from the repaired closed service panel toward the already-open ramp\n"
            "MOTION: The last departing service droids recede along a separate route\n"
            "DIALOG: \n"
            "NOTES: closed service panel, open ramp, droids clearing away"
            if index == 1
            else "ACTION: The pilot continues aboard\nMOTION: deliberate movement\nDIALOG: \nNOTES: preserve the repaired state"
        )
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard titled BOARDING AND LAUNCH — BOARD 3 OF 3.\n\n"
        "Use @image1 only for identity and cyborg construction. Use @image2 for the hangar and ship.\n\n"
        f"{panels}\n\n"
        + "Preserve the identical complete storyboard layout and repaired handoff. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)
    shaped = result.prompt.lower()

    assert "closed service panel" in shaped
    assert "open service panel" not in shaped
    assert "droids entering ramp" not in shaped
    assert "open ramp" in shaped


def test_gpt_image_2_graph_prompt_shaper_locks_complete_cinematic_sheet_and_environment_authority() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d}\n"
        f"SHOT: {index:02d} STORY BEAT\n"
        "CAMERA: cinematic production camera\n"
        "FRAMING: environment and subject remain readable\n"
        "ACTION: The pilot advances through the fixed hangar story\n"
        "MOTION: deliberate causal movement\n"
        "DIALOG: \n"
        "NOTES: preserve ship, ramp, doors, lanes, and lighting"
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard titled ‘HANGAR STORY — BOARD 1 OF 3’.\n\n"
        "Use @image1 only for pilot identity. Use @image2 for the fixed hangar, ship, ramp, doors, loading lane, and lighting.\n\n"
        f"{panels}\n\n"
        + "Keep one exact production-board design across the trilogy. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)
    shaped = result.prompt.lower()

    assert result.final_chars <= 4200
    assert "fixed sequence template" in shaped
    assert "top project, sequence, location, date, artist strip" in shaped
    for field in ("project", "sequence", "location", "date", "artist"):
        assert field in shaped
    assert "footer-free" in shaped
    assert "thin bordered footer band" not in shaped
    assert "photoreal live-action cinematic image" in shaped
    assert "physically plausible production lighting" in shaped
    assert "@image2 is the spatial, vehicle, material, geography, and lighting authority" in shaped
    for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
        assert result.prompt.count(label) == 6
    assert "FRAMING:" not in result.prompt


def test_gpt_image_2_graph_prompt_shaper_retains_environmental_approach_cat_and_lift_state() -> None:
    scenes = (
        "The pilot begins one full ship-length away while three service droids carry crates and climb into the open ramp.",
        "The pilot approaches the same ship while loading continues.",
        "A harnessed cyborg cat has two articulated worn-red mechanical forelegs with cyan status lights.",
        "Both occupants are secured in the fixed cockpit chairs.",
        "During lift-off the hangar floor visibly drops beneath the canopy and the ship clears the ground.",
        "The same ship clears the same hangar doors.",
    )
    panels = "\n\n".join(
        f"PANEL {index:02d} image and metadata:\n"
        f"{scene}\n"
        f"SHOT: {index:02d} CAUSAL BEAT\n"
        "CAMERA: cinematic production camera\n"
        "FRAMING: environment and subject remain readable\n"
        f"ACTION: {scene}\n"
        "MOTION: deliberate causal movement\n"
        "DIALOG: \n"
        "NOTES: preserve the exact current state"
        for index, scene in enumerate(scenes, start=1)
    )
    prompt = (
        "Create one 16:9 production storyboard titled ‘CONTINUITY PROOF — BOARD 3 OF 3’.\n\n"
        "Use @image1 for identity, @image2 for the fixed environment, and @image3 for prior-board continuity.\n\n"
        f"{panels}\n\n"
        + "Keep the same causal story and exact board design. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)
    shaped = result.prompt.lower()

    for term in (
        "one full ship-length away",
        "service droids carry crates and climb into the open ramp",
        "articulated worn-red mechanical forelegs",
        "hangar floor visibly drops beneath the canopy",
        "ship clears the ground",
    ):
        assert term in shaped


def test_gpt_image_2_graph_prompt_shaper_is_story_agnostic_and_requires_distinct_handoff_action() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d}\n"
        f"SHOT: {index:02d} CONTINUATION\n"
        "CAMERA: user supplied angle\n"
        "FRAMING: user supplied composition\n"
        f"ACTION: The courier advances beat {index}\n"
        "MOTION: deliberate movement\n"
        "DIALOG: COURIER [quiet voice] — \"Keep moving.\"\n"
        "NOTES: preserve the prior ending state"
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard titled ‘MOUNTAIN RELAY — BOARD 2 OF 3’.\n\n"
        "Use @image1 for identity. Use @image2 for the mountain relay. "
        "Use @image3 for the immediate previous board ending state.\n\n"
        "HANDOFF ADVANCE: Panel 01 starts a step later as the courier raises the receiver; use a low three-quarter angle.\n"
        "DIALOGUE CUES: COURIER [quiet voice] — \"Keep moving.\"\n\n"
        "WARDROBE CUES: weatherproof indigo courier coat with a closed high collar.\n"
        "SUBJECT DESIGN CUES: compact brass relay drone with four folding antennae.\n\n"
        f"{panels}\n\n" + "Preserve causal continuity and the same board design. " * 100
    )

    shaped = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    ).prompt
    lowered = shaped.lower()

    assert "handoff continuity" in lowered
    assert "then advances one visible action" in lowered
    assert "purposeful camera or movement delta" in lowered
    assert "speaker [voice hint]" in lowered and "identifies its speaker explicitly" in lowered
    assert "weatherproof indigo courier coat" in lowered
    assert "compact brass relay drone" in lowered
    assert "footer-free" in lowered
    for leaked in ("pilot", "ship", "hangar", "bolts", "cyborg cat", "cream-and-red"):
        assert leaked not in lowered


def test_gpt_image_2_graph_prompt_shaper_ignores_outline_panels_before_metadata_panels() -> None:
    outline = "\n".join(
        f"PANEL {index:02d}: story-outline summary without director metadata"
        for index in range(1, 7)
    )
    panels = "\n\n".join(
        f"PANEL {index:02d} image and metadata:\n"
        f"SHOT: {index:02d} CAUSAL BEAT\n"
        "CAMERA: cinematic production camera\n"
        "FRAMING: environment and subject remain readable\n"
        f"ACTION: The pilot advances causal beat {index}\n"
        "MOTION: deliberate causal movement\n"
        f"DIALOG: {'Bolts, are you ready for this next adventure?' if index == 5 else ''}\n"
        "NOTES: preserve the exact current state"
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard titled ‘BOARDING AND LAUNCH — BOARD 3 OF 3’.\n\n"
        "Use @image1 for identity, @image2 for environment, and @image3 for prior-board continuity.\n\n"
        f"STORY OUTLINE:\n{outline}\n\nFINAL PANELS:\n{panels}\n\n"
        + "Keep the same causal story and exact board design. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)

    for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
        assert result.prompt.count(label) == 6
    assert "FRAMING:" not in result.prompt
    assert "Bolts, are you ready for this next adventure?" in result.prompt
    assert "story-outline summary" not in result.prompt


def test_gpt_image_2_graph_prompt_shaper_keeps_cyborg_cat_out_of_pre_reveal_panels() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d}\n"
        f"SHOT: {index:02d} BOARDING BEAT\n"
        "CAMERA: cinematic production camera\n"
        "FRAMING: environment and subject remain readable\n"
        + (
            "ACTION: The pilot climbs the ramp. The cyborg cat is not visible yet.\n"
            "MOTION: deliberate ascent\n"
            "DIALOG: \n"
            "NOTES: no cat reveal before Panel 03"
            if index == 2
            else (
                "ACTION: The pilot reaches the cockpit and sees the harnessed cyborg cat\n"
                "MOTION: focus shifts to the co-pilot chair\n"
                "DIALOG: \n"
                "NOTES: first cat reveal"
                if index == 3
                else "ACTION: The pilot advances the boarding sequence\nMOTION: deliberate movement\nDIALOG: \nNOTES: preserve story order"
            )
        )
        for index in range(1, 7)
    )
    prompt = (
        "Create one 16:9 production storyboard titled ‘BOARDING AND LAUNCH — BOARD 3 OF 3’.\n\n"
        "Use @image1 for identity, @image2 for environment, and @image3 for prior-board continuity.\n\n"
        f"{panels}\n\n"
        + "Keep the same causal story and exact board design. " * 100
    )

    result = shape_kie_graph_prompt("gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000)
    shaped = result.prompt.lower()

    panel_two = shaped.split("02: shot:", 1)[1].split("| 03:", 1)[0]
    panel_three = shaped.split("03: shot:", 1)[1].split("| 04:", 1)[0]
    assert "cyborg cat" not in panel_two
    assert "cyborg cat" in panel_three


def test_storyboard_title_extraction_normalizes_neutral_subject_board_suffixes() -> None:
    assert _extract_title(
        "Create one storyboard sheet titled “LOADING AND EXTERIOR INSPECTION — the character 1 OF 3,” with six panels."
    ) == "LOADING AND EXTERIOR INSPECTION — BOARD 1 OF 3"
    assert _extract_title(
        "Create one storyboard sheet titled “THE BURNT-OUT CAPACITOR — THE PILOT — 2 OF 3,” with six panels."
    ) == "THE BURNT-OUT CAPACITOR — THE PILOT — BOARD 2 OF 3"
    assert _extract_title(
        "Create one storyboard sheet titled “LOADING AND EXTERIOR INSPECTION,” BOARD 1 OF 3, with six panels."
    ) == "LOADING AND EXTERIOR INSPECTION — BOARD 1 OF 3"


def test_graph_workflow_json_is_canonicalized_to_saved_workflow_id(client, app_modules) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    workflow["workflow_id"] = None

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    workflow_id = created.json()["workflow_id"]
    assert created.json()["workflow_json"]["workflow_id"] == workflow_id

    stale_workflow = {**workflow, "workflow_id": "stale-workflow-id"}
    run = runtime.create_run(workflow_id, GraphWorkflow(**stale_workflow), start=False)

    assert run.workflow_json["workflow_id"] == workflow_id


def test_graph_prompt_recipe_smoke_templates_are_seeded(client) -> None:
    response = client.get("/media/graph/templates")
    assert response.status_code == 200, response.text
    names = {item["name"] for item in response.json()["items"]}
    assert {
        "Prompt Recipe - Text Single Prompt",
        "Prompt Recipe - Single Image Director",
        "Prompt Recipe - Multi Image Director",
        "Prompt Recipe - Video Director Batch",
        "Prompt Recipe - Storyboard 3x3",
        "Prompt Recipe - Analysis Only",
    }.issubset(names)


def test_graph_validation_rejects_invalid_connections(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    workflow["edges"][0]["source_port"] = "missing"

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    workflow_id = created.json()["workflow_id"]

    response = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is False
    assert any(error["code"] == "missing_source_port" for error in payload["errors"])


def test_graph_validation_rejects_multiple_edges_to_single_input(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Single input cardinality",
        "nodes": [
            {"id": "text", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "display this"}},
            {"id": "llm", "type": "prompt.llm", "position": {"x": 0, "y": 200}, "fields": {"user_prompt": "describe"}},
            {"id": "display", "type": "display.any", "position": {"x": 360, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-text-display", "source": "text", "source_port": "text", "target": "display", "target_port": "value"},
            {"id": "edge-llm-display", "source": "llm", "source_port": "text", "target": "display", "target_port": "value"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is False
    assert any(error["code"] == "input_cardinality_exceeded" and error["port_id"] == "value" for error in payload["errors"])


def test_graph_kling_3_i2v_validates_start_and_end_frame_ports(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = {
        "schema_version": 1,
        "name": "Kling 3 frame ports",
        "nodes": [
            {"id": "start", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "model",
                "type": "model.kie.kling_3_0_i2v",
                "position": {"x": 360, "y": 0},
                "fields": {"prompt": "Animate the frame.", "mode": "std", "sound": True, "duration": 5, "aspect_ratio": "9:16"},
            },
            {
                "id": "save",
                "type": "media.save_video",
                "position": {"x": 720, "y": 0},
                "fields": {"filename_prefix": "kling-3-frame", "format": "source_original", "codec": "auto", "include_metadata": True},
            },
        ],
        "edges": [
            {"id": "edge-start-model", "source": "start", "source_port": "image", "target": "model", "target_port": "start_frame"},
            {"id": "edge-model-save", "source": "model", "source_port": "video", "target": "save", "target_port": "video"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert response.status_code == 200, response.text
    assert response.json()["valid"] is True

    workflow["edges"][0]["target_port"] = "end_frame"
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is False
    assert any(error["code"] == "missing_required_input" and error["port_id"] == "start_frame" for error in payload["errors"])


def test_graph_seedance_validation_rejects_mixed_frame_and_reference_modes(client, app_modules) -> None:
    start_reference_id = _create_named_reference_image(app_modules, name="seedance-start.png")
    reference_id = _create_named_reference_image(app_modules, name="seedance-reference.png")
    workflow = {
        "schema_version": 1,
        "name": "Seedance mixed modes",
        "nodes": [
            {"id": "start", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": start_reference_id}},
            {"id": "ref", "type": "media.load_image", "position": {"x": 0, "y": 220}, "fields": {"reference_id": reference_id}},
            {
                "id": "model",
                "type": "model.kie.seedance_2_0",
                "position": {"x": 360, "y": 0},
                "fields": {"prompt": "Animate the subject.", "duration": 5, "resolution": "720p", "aspect_ratio": "16:9"},
            },
            {"id": "save", "type": "media.save_video", "position": {"x": 760, "y": 0}, "fields": {"label": "Seedance"}},
        ],
        "edges": [
            {"id": "edge-start-model", "source": "start", "source_port": "image", "target": "model", "target_port": "start_frame"},
            {"id": "edge-ref-model", "source": "ref", "source_port": "image", "target": "model", "target_port": "reference_images"},
            {"id": "edge-model-save", "source": "model", "source_port": "video", "target": "save", "target_port": "video"},
        ],
    }

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is False
    assert any(error["code"] == "seedance_input_modes_are_mutually_exclusive" and error["node_id"] == "model" for error in payload["errors"])


def test_graph_seedance_validation_requires_start_frame_for_end_frame(client, app_modules) -> None:
    end_reference_id = _create_named_reference_image(app_modules, name="seedance-end.png")
    workflow = {
        "schema_version": 1,
        "name": "Seedance end frame only",
        "nodes": [
            {"id": "end", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": end_reference_id}},
            {
                "id": "model",
                "type": "model.kie.seedance_2_0",
                "position": {"x": 360, "y": 0},
                "fields": {"prompt": "Animate between frames.", "duration": 5, "resolution": "720p", "aspect_ratio": "16:9"},
            },
            {"id": "save", "type": "media.save_video", "position": {"x": 760, "y": 0}, "fields": {"label": "Seedance"}},
        ],
        "edges": [
            {"id": "edge-end-model", "source": "end", "source_port": "image", "target": "model", "target_port": "end_frame"},
            {"id": "edge-model-save", "source": "model", "source_port": "video", "target": "save", "target_port": "video"},
        ],
    }

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is False
    assert any(error["code"] == "seedance_last_frame_requires_start_frame" and error["port_id"] == "end_frame" for error in payload["errors"])


def test_graph_validation_rejects_unconnected_model_output(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Unconnected model output",
        "nodes": [
            {"id": "prompt", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "Generate one image."}},
            {"id": "model", "type": "model.kie.nano_banana_pro", "position": {"x": 360, "y": 0}, "fields": {}},
        ],
        "edges": [{"id": "edge-prompt-model", "source": "prompt", "source_port": "text", "target": "model", "target_port": "prompt"}],
    }

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is False
    assert any(error["code"] == "model_output_unconnected" and error["node_id"] == "model" and error["port_id"] == "image" for error in payload["errors"])


def test_graph_validation_allows_empty_load_image_for_optional_nano_reference(client) -> None:
    workflow = _workflow("")
    workflow["nodes"][0]["fields"] = {}

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    workflow_id = created.json()["workflow_id"]

    response = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=workflow)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is True
    assert any(warning["code"] == "empty_optional_media_input" for warning in payload["warnings"])


def test_graph_validation_rejects_empty_load_image_for_required_save_input(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Blank required image",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {}},
            {"id": "save", "type": "media.save_image", "position": {"x": 360, "y": 0}, "fields": {"label": "Final"}},
        ],
        "edges": [{"id": "edge-load-save", "source": "load", "source_port": "image", "target": "save", "target_port": "image"}],
    }

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["valid"] is False
    assert any(error["code"] == "missing_media_reference" for error in payload["errors"])


def test_graph_validation_detects_cycles(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    workflow["edges"].append({"id": "cycle", "source": "save", "source_port": "asset", "target": "model", "target_port": "image_refs"})

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)

    assert response.status_code == 200, response.text
    assert any(error["code"] == "cycle_detected" for error in response.json()["errors"])


def test_graph_startup_cleanup_marks_interrupted_runs_failed(client, app_modules) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    workflow_id = create_response.json()["workflow_id"]

    run = runtime.create_run(workflow_id, GraphWorkflow(**workflow), start=False)
    assert run.status == "queued"

    marked = app_modules["store"].mark_interrupted_graph_runs()

    assert marked == 1
    failed_run = app_modules["store"].get_graph_run(run.run_id)
    assert failed_run["status"] == "failed"
    assert "interrupted" in failed_run["error"].lower()
    failed_nodes = app_modules["store"].list_graph_run_nodes(run.run_id)
    assert all(node["status"] == "failed" for node in failed_nodes)
    events = client.get(f"/media/graph/runs/{run.run_id}/events").json()["items"]
    assert any(event["event_type"] == "run.failed" for event in events)


@pytest.mark.parametrize("poll_failure", [False, True])
def test_graph_recovery_completes_interrupted_kie_node_and_resumes_downstream(
    client,
    app_modules,
    poll_failure: bool,
) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    run_error = "Poll failed: KIE status request failed: response was not valid JSON" if poll_failure else "Graph run was interrupted before completion."
    downstream_status = "skipped" if poll_failure else "failed"
    downstream_metrics = {"skip_reason": "upstream_failed"} if poll_failure else {}

    workflow = {
        "schema_version": 1,
        "name": "Recover completed KIE job",
        "nodes": [
            {
                "id": "model",
                "type": "model.kie.nano_banana_pro",
                "position": {"x": 0, "y": 0},
                "fields": {"prompt": "Recovered prompt", "resolution": "1K"},
            },
            {"id": "save", "type": "media.save_image", "position": {"x": 360, "y": 0}, "fields": {"label": "Recovered"}},
        ],
        "edges": [{"id": "edge-model-save", "source": "model", "source_port": "image", "target": "save", "target_port": "image"}],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run = runtime.create_run(created.json()["workflow_id"], GraphWorkflow(**workflow), start=False)

    batch, jobs = app_modules["store"].create_batch_and_jobs(
        {"status": "completed", "model_key": "nano-banana-pro", "task_mode": "text_to_image", "completed_count": 1},
        [
            {
                "model_key": "nano-banana-pro",
                "task_mode": "text_to_image",
                "status": "completed",
                "provider_task_id": "provider-recovered-1",
                "artifact_json": {},
                "final_status_json": {},
            }
        ],
    )
    job = jobs[0]
    asset = app_modules["store"].create_or_update_asset(
        {
            "asset_id": "asset_recovered_graph_image",
            "job_id": job["job_id"],
            "provider_task_id": job["provider_task_id"],
            "model_key": "nano-banana-pro",
            "status": "completed",
            "generation_kind": "image",
            "hero_original_path": "outputs/recovered/original.png",
            "hero_web_path": "outputs/recovered/web.webp",
            "hero_thumb_path": "outputs/recovered/thumb.webp",
            "payload_json": {"outputs": [{"kind": "image", "role": "output", "original_path": "outputs/recovered/original.png"}]},
        }
    )
    app_modules["store"].append_graph_run_event(
        run.run_id,
        "kie.submitted",
        {"model_key": "nano-banana-pro", "job_id": job["job_id"], "batch_id": batch["batch_id"]},
        node_id="model",
    )
    app_modules["store"].update_graph_run(run.run_id, {"status": "failed", "error": run_error})
    app_modules["store"].update_graph_run_node(run.run_id, "model", {"status": "failed", "error": run_error})
    app_modules["store"].update_graph_run_node(
        run.run_id,
        "save",
        {"status": downstream_status, "error": run_error, "metrics_json": downstream_metrics},
    )

    result = runtime.recover_run(run.run_id, start=False)
    assert result["recovered"] is True
    recovered_model = app_modules["store"].get_graph_run_node(run.run_id, "model")
    assert recovered_model["status"] == "completed"
    assert recovered_model["output_snapshot_json"]["image"][0]["asset_id"] == asset["asset_id"]

    runtime.execute_run(run.run_id, resume=True)

    recovered_run = client.get(f"/media/graph/runs/{run.run_id}")
    assert recovered_run.status_code == 200, recovered_run.text
    payload = recovered_run.json()
    assert payload["status"] == "completed"
    assert payload["metrics_json"]["recovered_from_interruption"] is True
    assert payload["metrics_json"]["recovered_node_ids"] == ["model"]
    nodes_by_id = {item["node_id"]: item for item in payload["nodes"]}
    assert nodes_by_id["model"]["status"] == "completed"
    assert nodes_by_id["save"]["status"] == "completed"
    assert nodes_by_id["model"]["error"] is None
    assert nodes_by_id["save"]["error"] is None
    assert nodes_by_id["model"]["metrics_json"]["recovered"] is True
    assert nodes_by_id["save"]["output_snapshot_json"]["image"][0]["asset_id"] == asset["asset_id"]
    assert any(event["event_type"] == "run.recovered" for event in client.get(f"/media/graph/runs/{run.run_id}/events").json()["items"])


def test_graph_recovery_resumes_existing_running_kie_job_without_resubmit(client, app_modules, monkeypatch) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    workflow = {
        "schema_version": 1,
        "name": "Resume running KIE job",
        "nodes": [
            {
                "id": "model",
                "type": "model.kie.nano_banana_pro",
                "position": {"x": 0, "y": 0},
                "fields": {"prompt": "Resume prompt", "resolution": "1K"},
            },
            {"id": "save", "type": "media.save_image", "position": {"x": 360, "y": 0}, "fields": {"label": "Recovered"}},
        ],
        "edges": [{"id": "edge-model-save", "source": "model", "source_port": "image", "target": "save", "target_port": "image"}],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run = runtime.create_run(created.json()["workflow_id"], GraphWorkflow(**workflow), start=False)
    batch, jobs = app_modules["store"].create_batch_and_jobs(
        {"status": "processing", "model_key": "nano-banana-pro", "task_mode": "text_to_image"},
        [
            {
                "model_key": "nano-banana-pro",
                "task_mode": "text_to_image",
                "status": "running",
                "provider_task_id": "provider-running-recovery",
                "artifact_json": {},
                "final_status_json": {},
            }
        ],
    )
    job = jobs[0]
    app_modules["store"].append_graph_run_event(
        run.run_id,
        "kie.submitted",
        {"model_key": "nano-banana-pro", "job_id": job["job_id"], "batch_id": batch["batch_id"]},
        node_id="model",
    )
    app_modules["store"].update_graph_run(run.run_id, {"status": "failed", "error": "Graph run was interrupted before completion."})
    app_modules["store"].update_graph_run_node(run.run_id, "model", {"status": "failed", "error": "Graph run was interrupted before completion."})
    app_modules["store"].update_graph_run_node(run.run_id, "save", {"status": "failed", "error": "Graph run was interrupted before completion."})

    def fail_resubmit(request):
        raise AssertionError("resume should not submit a new KIE job")

    def complete_existing_job():
        app_modules["store"].create_or_update_asset(
            {
                "asset_id": "asset_resumed_graph_image",
                "job_id": job["job_id"],
                "provider_task_id": job["provider_task_id"],
                "model_key": "nano-banana-pro",
                "status": "completed",
                "generation_kind": "image",
                "hero_original_path": "outputs/resumed/original.png",
                "hero_web_path": "outputs/resumed/web.webp",
                "hero_thumb_path": "outputs/resumed/thumb.webp",
                "payload_json": {"outputs": [{"kind": "image", "role": "output", "original_path": "outputs/resumed/original.png"}]},
            }
        )
        app_modules["store"].update_job(job["job_id"], {"status": "completed"})

    monkeypatch.setattr(app_modules["service"], "submit_jobs", fail_resubmit)
    monkeypatch.setattr(app_modules["runner"].runner, "tick", complete_existing_job)

    result = runtime.recover_run(run.run_id, start=False)
    assert result["recovered"] is True
    assert app_modules["store"].get_graph_run_node(run.run_id, "model")["status"] == "running"

    runtime.execute_run(run.run_id, resume=True)

    payload = client.get(f"/media/graph/runs/{run.run_id}").json()
    assert payload["status"] == "completed"
    assert payload["metrics_json"]["recovered_from_interruption"] is True
    assert payload["metrics_json"]["resumed_node_ids"] == ["model"]
    nodes_by_id = {item["node_id"]: item for item in payload["nodes"]}
    assert nodes_by_id["model"]["metrics_json"]["recovered_existing_kie_job"] is True
    assert nodes_by_id["model"]["output_snapshot_json"]["image"][0]["asset_id"] == "asset_resumed_graph_image"
    assert nodes_by_id["save"]["status"] == "completed"


def test_graph_recovery_marks_terminal_provider_failure(client, app_modules) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    workflow = {
        "schema_version": 1,
        "name": "Recover failed KIE job",
        "nodes": [
            {
                "id": "model",
                "type": "model.kie.nano_banana_pro",
                "position": {"x": 0, "y": 0},
                "fields": {"prompt": "Failed prompt", "resolution": "1K"},
            },
            {"id": "save", "type": "media.save_image", "position": {"x": 360, "y": 0}, "fields": {"label": "Failed"}},
        ],
        "edges": [{"id": "edge-model-save", "source": "model", "source_port": "image", "target": "save", "target_port": "image"}],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run = runtime.create_run(created.json()["workflow_id"], GraphWorkflow(**workflow), start=False)
    batch, jobs = app_modules["store"].create_batch_and_jobs(
        {"status": "partial_failure", "model_key": "nano-banana-pro", "task_mode": "text_to_image"},
        [
            {
                "model_key": "nano-banana-pro",
                "task_mode": "text_to_image",
                "status": "failed",
                "provider_task_id": "provider-failed-recovery",
                "error": "Provider failed while Media Studio was offline.",
                "artifact_json": {},
                "final_status_json": {},
            }
        ],
    )
    job = jobs[0]
    app_modules["store"].append_graph_run_event(
        run.run_id,
        "kie.submitted",
        {"model_key": "nano-banana-pro", "job_id": job["job_id"], "batch_id": batch["batch_id"]},
        node_id="model",
    )
    app_modules["store"].update_graph_run(run.run_id, {"status": "failed", "error": "Graph run was interrupted before completion."})
    app_modules["store"].update_graph_run_node(run.run_id, "model", {"status": "failed", "error": "Graph run was interrupted before completion."})

    result = runtime.recover_run(run.run_id, start=False)

    assert result["recovered"] is False
    assert result["terminal_provider_failures"] == ["model"]
    recovered_model = app_modules["store"].get_graph_run_node(run.run_id, "model")
    assert recovered_model["status"] == "failed"
    assert recovered_model["error"] == "Provider failed while Media Studio was offline."
    recovered_run = app_modules["store"].get_graph_run(run.run_id)
    assert recovered_run["error"] == "Interrupted graph run could not recover because the submitted provider job failed."
    assert recovered_run["metrics_json"]["terminal_provider_failure_node_ids"] == ["model"]


def test_graph_recovery_leaves_unsubmitted_interrupted_run_for_cleanup(client, app_modules) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run = runtime.create_run(created.json()["workflow_id"], GraphWorkflow(**workflow), start=False)

    result = runtime.recover_run(run.run_id, start=False)
    assert result["recovered"] is False

    marked = app_modules["store"].mark_interrupted_graph_runs()
    assert marked == 1
    assert app_modules["store"].get_graph_run(run.run_id)["status"] == "failed"


def test_graph_startup_recovery_skips_incompatible_historical_run(client, app_modules, monkeypatch) -> None:
    from app.graph.runtime import runtime

    runs = [
        {"run_id": "grun_incompatible", "status": "failed", "error": "Graph run was interrupted before completion."},
        {"run_id": "grun_recoverable", "status": "failed", "error": "Graph run was interrupted before completion."},
    ]

    monkeypatch.setattr(app_modules["store"], "list_graph_runs", lambda limit=100: runs)

    def recover(run_id: str, *, start: bool = True):
        if run_id == "grun_incompatible":
            raise ValueError("Unknown target port: previous_storyboard_prompt")
        return {"recovered": True, "started": start, "run_id": run_id}

    monkeypatch.setattr(runtime, "recover_run", recover)

    assert runtime.recover_interrupted_runs(start=False) == 1


def test_graph_run_events_stream_endpoint_exists(client, app_modules) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run = runtime.create_run(create_response.json()["workflow_id"], GraphWorkflow(**workflow), start=False)
    app_modules["store"].update_graph_run(run.run_id, {"status": "completed"})
    response = client.get(f"/media/graph/runs/{run.run_id}/events/stream")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "run.created" in response.text


def test_graph_run_events_after_event_id_does_not_skip_same_timestamp_events(client, app_modules) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run = runtime.create_run(create_response.json()["workflow_id"], GraphWorkflow(**workflow), start=False)
    first = app_modules["store"].append_graph_run_event(run.run_id, "node.first", {})
    second = app_modules["store"].append_graph_run_event(run.run_id, "node.second", {})
    same_timestamp = "2026-05-12T00:00:00+00:00"
    with app_modules["store"].get_connection() as connection:
        connection.execute(
            "UPDATE graph_run_events SET created_at = ? WHERE event_id IN (?, ?)",
            (same_timestamp, first["event_id"], second["event_id"]),
        )

    response = client.get(f"/media/graph/runs/{run.run_id}/events?after_event_id={first['event_id']}")

    assert response.status_code == 200, response.text
    assert [event["event_type"] for event in response.json()["items"]] == ["node.second"]


def test_graph_run_status_endpoint_reports_latest_event_and_output_presence(client, app_modules) -> None:
    from app.graph.runtime import runtime
    from app.graph.schemas import GraphWorkflow

    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run = runtime.create_run(create_response.json()["workflow_id"], GraphWorkflow(**workflow), start=False)
    app_modules["store"].update_graph_run_node(
        run.run_id,
        "model",
        {
            "status": "completed",
            "progress": 1,
            "output_snapshot_json": {"images": [{"reference_id": reference_id}]},
        },
    )
    event = app_modules["store"].append_graph_run_event(run.run_id, "node.completed", {"node_id": "model"}, node_id="model")

    response = client.get(f"/media/graph/runs/{run.run_id}/status")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run_id"] == run.run_id
    assert payload["latest_event_id"] == event["event_id"]
    model_node = next(item for item in payload["nodes"] if item["node_id"] == "model")
    assert model_node["status"] == "completed"
    assert model_node["has_output_snapshot"] is True


def test_graph_load_image_nano_save_runs_offline_and_creates_asset(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    create_response = client.post("/media/graph/workflows", json=_workflow(reference_id))
    assert create_response.status_code == 200, create_response.text
    workflow_id = create_response.json()["workflow_id"]

    run_response = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    assert final_payload["metrics_json"]["duration_seconds"] >= 0
    assert final_payload["metrics_json"]["completed_node_count"] == 3
    assert "model" in final_payload["metrics_json"]["node_metrics"]
    events = client.get(f"/media/graph/runs/{run_id}/events").json()["items"]
    assert any(event["event_type"] == "run.completed" for event in events)
    assert any((event.get("payload_json") or {}).get("metrics") for event in events if event["event_type"] == "run.completed")
    assets = app_modules["store"].list_assets(limit=20)
    assert any(asset["model_key"] == "nano-banana-pro" for asset in assets)


def test_graph_suno_music_model_runs_offline_and_creates_audio_asset(client, app_modules) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Suno music smoke",
        "nodes": [
            {
                "id": "model",
                "type": "model.kie.suno_generate_music",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "song_description": "Instrumental synth pop with warm analog bass, crisp drums, and a bright city-night melody.",
                    "custom_mode": False,
                    "instrumental": True,
                    "suno_model": "V5",
                    "audio_weight": 0.7,
                },
            },
            {
                "id": "save",
                "type": "media.save_music_track",
                "position": {"x": 440, "y": 0},
                "fields": {"label": "Saved Song", "filename_prefix": "graph-song"},
            },
        ],
        "edges": [
            {"id": "edge-model-save", "source": "model", "source_port": "track_1", "target": "save", "target_port": "track"},
        ],
    }

    final_payload = _run_graph_workflow(client, workflow)

    assert final_payload["status"] == "completed", final_payload
    model_node = next(node for node in final_payload["nodes"] if node["node_id"] == "model")
    assert model_node["output_snapshot_json"]["track_1"][0]["media_type"] == "music_track"
    assert model_node["output_snapshot_json"]["track_1"][0]["metadata"]["audio_asset_id"]
    assert model_node["metrics_json"]["kie_poll_count"] >= 1
    save_node = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    output_ref = save_node["output_snapshot_json"]["audio"][0]
    asset = app_modules["store"].get_asset(output_ref["asset_id"])
    assert asset["generation_kind"] == "audio"
    upstream_asset = app_modules["store"].get_asset(model_node["output_snapshot_json"]["track_1"][0]["metadata"]["audio_asset_id"])
    assert upstream_asset["generation_kind"] == "audio"
    assert upstream_asset["model_key"] == "suno-generate-music"
    assert asset["asset_id"] == upstream_asset["asset_id"]
    assert asset["model_key"] == "suno-generate-music"


def test_graph_workflow_runs_endpoint_lists_only_selected_workflow_runs(client, app_modules) -> None:
    first_reference_id = _create_reference_image(app_modules)
    second_reference_id = _create_grid_reference_image(app_modules)
    first = client.post("/media/graph/workflows", json=_workflow(first_reference_id)).json()
    second = client.post("/media/graph/workflows", json=_workflow(second_reference_id)).json()

    first_run = client.post(f"/media/graph/workflows/{first['workflow_id']}/runs", json={}).json()
    second_run = client.post(f"/media/graph/workflows/{second['workflow_id']}/runs", json={}).json()
    for run_id in [first_run["run_id"], second_run["run_id"]]:
        for _ in range(60):
            current = client.get(f"/media/graph/runs/{run_id}").json()
            if current["status"] in {"completed", "failed"}:
                break
            time.sleep(0.1)

    response = client.get(f"/media/graph/workflows/{first['workflow_id']}/runs")
    assert response.status_code == 200, response.text
    run_ids = [item["run_id"] for item in response.json()["items"]]
    assert first_run["run_id"] in run_ids
    assert second_run["run_id"] not in run_ids


def test_graph_save_image_can_assign_output_asset_to_project(client, app_modules) -> None:
    store = app_modules["store"]
    reference_id = _create_reference_image(app_modules)
    project = store.create_or_update_project(
        {
            "project_id": "graph-project-test",
            "name": "Graph Project Test",
            "description": "Graph output group",
            "status": "active",
        }
    )
    workflow = _workflow(reference_id)
    save_node = next(node for node in workflow["nodes"] if node["id"] == "save")
    save_node["fields"]["project_id"] = project["project_id"]

    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    workflow_id = create_response.json()["workflow_id"]

    run_response = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    assets = store.list_assets(limit=20, project_id=project["project_id"])
    assert any(asset["model_key"] == "nano-banana-pro" and asset["project_id"] == project["project_id"] for asset in assets)


def test_graph_kling_i2v_save_video_runs_offline_and_creates_video_asset(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _video_workflow(reference_id)
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    workflow_id = create_response.json()["workflow_id"]

    validation = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True

    run_response = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    model_node = next(node for node in final_payload["nodes"] if node["node_id"] == "model")
    assert "video" in model_node["output_snapshot_json"]
    save_node = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    assert "video" in save_node["output_snapshot_json"]
    assets = app_modules["store"].list_assets(limit=20)
    assert any(asset["model_key"] == "kling-2.6-i2v" and asset["generation_kind"] == "video" for asset in assets)


def test_graph_kling_i2v_materializes_required_option_defaults_before_validation(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _video_workflow(reference_id)
    model_node = next(node for node in workflow["nodes"] if node["id"] == "model")
    model_node["fields"] = {}

    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    workflow_id = create_response.json()["workflow_id"]

    validation = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True


def test_graph_save_video_transcodes_generated_asset_to_gallery_asset(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _video_workflow(reference_id)
    save_node = next(node for node in workflow["nodes"] if node["id"] == "save")
    save_node["fields"]["format"] = "mp4_h264_browser"
    save_node["fields"]["codec"] = "auto"
    save_node["fields"]["crf"] = 28
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    save_node_run = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    assert save_node_run["metrics_json"]["video_transcode_count"] == 1
    save_video_ref = save_node_run["output_snapshot_json"]["video"][0]
    assert save_video_ref["asset_id"]
    assets = app_modules["store"].list_assets(limit=20)
    derived = next(asset for asset in assets if asset["asset_id"] == save_video_ref["asset_id"])
    assert derived["model_key"] == "graph-derived"
    assert derived["generation_kind"] == "video"
    assert derived["payload_json"]["graph"]["transform"]["transform_type"] == "media.save_video.transcode"


def test_graph_save_video_transcodes_reference_video(client, app_modules) -> None:
    reference_id = _create_reference_video(app_modules)
    workflow = _save_reference_video_workflow(reference_id, format_preset="mp4_h264_browser")
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    save_node_run = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    assert save_node_run["metrics_json"]["video_transcode_count"] == 1
    output_ref = save_node_run["output_snapshot_json"]["video"][0]
    asset = app_modules["store"].get_asset(output_ref["asset_id"])
    assert asset["model_key"] == "graph-derived"
    assert asset["generation_kind"] == "video"
    assert asset["hero_web_path"]
    assert asset["hero_thumb_path"]
    assert asset["hero_poster_path"]
    assert (app_modules["main"].settings.data_root / asset["hero_thumb_path"]).exists()
    assert (app_modules["main"].settings.data_root / asset["hero_poster_path"]).exists()


def test_graph_save_video_transcode_requires_ffmpeg(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_video(app_modules)
    workflow = _save_reference_video_workflow(reference_id, format_preset="mp4_h264_browser")
    real_which = shutil.which

    def fake_which(binary: str):
        if binary == "ffmpeg":
            return None
        return real_which(binary)

    monkeypatch.setattr("app.graph.executors.media_save.shutil.which", fake_which)
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "failed"
    save_node_run = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    assert "ffmpeg is required" in save_node_run["error"]


def test_graph_save_video_rejects_unknown_format(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _video_workflow(reference_id)
    save_node = next(node for node in workflow["nodes"] if node["id"] == "save")
    save_node["fields"]["format"] = "avi_unsupported"
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "failed"
    save_node_run = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    assert "format must be one of" in save_node_run["error"]


def test_graph_save_audio_creates_gallery_asset_and_filters_as_audio(client, app_modules) -> None:
    reference_id = _create_reference_audio(app_modules)
    reference = app_modules["store"].get_reference_media(reference_id)
    assert reference["duration_seconds"] > 0
    assert reference["metadata_json"]["codec"]
    assert reference["metadata_json"]["sample_rate"] == 44100
    workflow = {
        "schema_version": 1,
        "name": "Save audio smoke",
        "nodes": [
            {
                "id": "load",
                "type": "media.load_audio",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": reference_id},
            },
            {
                "id": "save",
                "type": "media.save_audio",
                "position": {"x": 360, "y": 0},
                "fields": {"label": "Saved Audio"},
            },
        ],
        "edges": [{"id": "edge-load-save", "source": "load", "source_port": "audio", "target": "save", "target_port": "audio"}],
    }
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    save_node_run = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    output_ref = save_node_run["output_snapshot_json"]["audio"][0]
    asset = app_modules["store"].get_asset(output_ref["asset_id"])
    assert asset["generation_kind"] == "audio"
    assert asset["hero_web_path"].endswith(".wav")
    assert asset["payload_json"]["outputs"][0]["duration_seconds"] > 0
    assert any(item["asset_id"] == asset["asset_id"] for item in app_modules["store"].list_assets(limit=20, media_type="audio"))


def test_graph_save_audio_transcodes_to_mp3(client, app_modules) -> None:
    reference_id = _create_reference_audio(app_modules, name="graph-audio-transcode.wav")
    workflow = {
        "schema_version": 1,
        "name": "Save audio transcode",
        "nodes": [
            {"id": "load", "type": "media.load_audio", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "save",
                "type": "media.save_audio",
                "position": {"x": 360, "y": 0},
                "fields": {"label": "Saved MP3", "format": "mp3", "filename_prefix": "graph-audio"},
            },
        ],
        "edges": [{"id": "edge-load-save", "source": "load", "source_port": "audio", "target": "save", "target_port": "audio"}],
    }
    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed", final_payload
    save_node_run = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    assert save_node_run["metrics_json"]["audio_transcode_count"] == 1
    output_ref = save_node_run["output_snapshot_json"]["audio"][0]
    asset = app_modules["store"].get_asset(output_ref["asset_id"])
    assert asset["generation_kind"] == "audio"
    assert asset["hero_web_path"].endswith(".mp3")
    assert asset["payload_json"]["graph"]["transform"]["transform_type"] == "media.save_audio.transcode"


def test_graph_audio_import_rejects_unsupported_extension(app_modules) -> None:
    with pytest.raises(Exception, match="wav, mp3, m4a, or aac"):
        app_modules["service"].import_reference_media_bytes(
            source_bytes=b"not-real-audio",
            source_name="graph-audio.ogg",
            source_mime_type="audio/ogg",
        )


def test_graph_audio_transform_normalizes_and_outputs_reference_audio(client, app_modules) -> None:
    reference_id = _create_reference_audio(app_modules, name="graph-audio-transform.wav")
    workflow = {
        "schema_version": 1,
        "name": "Audio transform smoke",
        "nodes": [
            {"id": "load", "type": "media.load_audio", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "transform",
                "type": "audio.transform",
                "position": {"x": 320, "y": 0},
                "fields": {"operation": "normalize", "format": "m4a_aac", "target_lufs": -16},
            },
            {"id": "save", "type": "media.save_audio", "position": {"x": 680, "y": 0}, "fields": {"label": "Normalized Audio"}},
        ],
        "edges": [
            {"id": "edge-load-transform", "source": "load", "source_port": "audio", "target": "transform", "target_port": "audio"},
            {"id": "edge-transform-save", "source": "transform", "source_port": "audio", "target": "save", "target_port": "audio"},
        ],
    }
    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed", final_payload
    transform_node = next(node for node in final_payload["nodes"] if node["node_id"] == "transform")
    output_ref = transform_node["output_snapshot_json"]["audio"][0]
    reference = app_modules["store"].get_reference_media(output_ref["reference_id"])
    assert reference["kind"] == "audio"
    assert reference["stored_path"].endswith(".m4a")
    assert output_ref["metadata"]["lineage"]["transform_type"] == "audio.transform.normalize"


def test_graph_save_video_replaces_audio_input_and_preserves_lineage(client, app_modules) -> None:
    video_reference_id = _create_reference_video(app_modules, name="graph-video-muted-source.mp4")
    audio_reference_id = _create_reference_audio(app_modules, name="graph-video-replacement-audio.wav")
    workflow = {
        "schema_version": 1,
        "name": "Save video audio mux",
        "nodes": [
            {"id": "load-video", "type": "media.load_video", "position": {"x": 0, "y": 0}, "fields": {"reference_id": video_reference_id}},
            {"id": "load-audio", "type": "media.load_audio", "position": {"x": 0, "y": 260}, "fields": {"reference_id": audio_reference_id}},
            {
                "id": "save",
                "type": "media.save_video",
                "position": {"x": 380, "y": 0},
                "fields": {"label": "Muxed Video", "format": "source_original", "audio_policy": "replace", "audio_fit": "trim_to_video"},
            },
        ],
        "edges": [
            {"id": "edge-video-save", "source": "load-video", "source_port": "video", "target": "save", "target_port": "video"},
            {"id": "edge-audio-save", "source": "load-audio", "source_port": "audio", "target": "save", "target_port": "audio"},
        ],
    }
    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed", final_payload
    save_node_run = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    assert save_node_run["metrics_json"]["video_audio_mux_count"] == 1
    output_ref = save_node_run["output_snapshot_json"]["video"][0]
    asset = app_modules["store"].get_asset(output_ref["asset_id"])
    assert asset["generation_kind"] == "video"
    assert asset["hero_thumb_path"]
    assert asset["hero_poster_path"]
    assert asset["payload_json"]["graph"]["transform"]["transform_type"] == "media.save_video.audio_mux"
    assert asset["payload_json"]["graph"]["transform"]["transform_params"]["audio_policy"] == "replace"


def test_graph_save_video_mixes_and_mutes_audio(client, app_modules) -> None:
    video_reference_id = _create_reference_video_with_audio(app_modules)
    audio_reference_id = _create_reference_audio(app_modules, name="graph-video-mix-audio.wav")
    for policy in ("mix", "mute"):
        workflow = {
            "schema_version": 1,
            "name": f"Save video {policy}",
            "nodes": [
                {"id": "load-video", "type": "media.load_video", "position": {"x": 0, "y": 0}, "fields": {"reference_id": video_reference_id}},
                {"id": "load-audio", "type": "media.load_audio", "position": {"x": 0, "y": 260}, "fields": {"reference_id": audio_reference_id}},
                {
                    "id": "save",
                    "type": "media.save_video",
                    "position": {"x": 380, "y": 0},
                    "fields": {"label": f"{policy} video", "format": "source_original", "audio_policy": policy},
                },
            ],
            "edges": [{"id": "edge-video-save", "source": "load-video", "source_port": "video", "target": "save", "target_port": "video"}],
        }
        if policy == "mix":
            workflow["edges"].append({"id": "edge-audio-save", "source": "load-audio", "source_port": "audio", "target": "save", "target_port": "audio"})
        final_payload = _run_graph_workflow(client, workflow)
        assert final_payload["status"] == "completed", final_payload
        save_node_run = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
        output_ref = save_node_run["output_snapshot_json"]["video"][0]
        asset = app_modules["store"].get_asset(output_ref["asset_id"])
        assert asset["payload_json"]["graph"]["transform"]["transform_params"]["audio_policy"] == policy


def test_graph_seedance_audio_reference_workflow_runs_offline(client, app_modules, monkeypatch) -> None:
    image_reference_id = _create_reference_image(app_modules)
    video_reference_id = _create_reference_video(app_modules, name="graph-seedance-ref-video.mp4")
    audio_reference_id = _create_reference_audio(app_modules, name="graph-seedance-ref-audio.wav")
    output_reference_id = _create_reference_video(app_modules, name="graph-seedance-output.mp4")
    output_reference = app_modules["store"].get_reference_media(output_reference_id)

    captured_request = {}

    def fake_submit_jobs(request):
        captured_request["request"] = request
        batch, jobs = app_modules["store"].create_batch_and_jobs(
            {"model_key": request.model_key, "task_mode": request.task_mode, "requested_outputs": 1, "request_summary_json": {}},
            [
                {
                    "model_key": request.model_key,
                    "task_mode": request.task_mode,
                    "raw_prompt": request.prompt,
                    "final_prompt_used": request.prompt,
                    "status": "queued",
                    "validation_json": {"normalized_request": {"provider_model": "seedance-2.0"}},
                    "submit_response_json": {},
                    "final_status_json": {},
                    "resolved_options_json": request.options,
                    "prompt_context_json": {},
                }
            ],
        )
        job = jobs[0]
        completed_job = app_modules["store"].update_job(job["job_id"], {"status": "completed", "progress": 1})
        app_modules["store"].create_or_update_asset(
            {
                "job_id": completed_job["job_id"],
                "generation_kind": "video",
                "model_key": request.model_key,
                "status": "completed",
                "task_mode": request.task_mode,
                "prompt_summary": request.prompt,
                "hero_original_path": output_reference["stored_path"],
                "hero_web_path": output_reference["stored_path"],
                "hero_thumb_path": output_reference.get("thumb_path"),
                "hero_poster_path": output_reference.get("poster_path"),
                "payload_json": {"outputs": [{"kind": "video", "role": "output", "original_path": output_reference["stored_path"]}]},
            }
        )
        return batch, [completed_job]

    monkeypatch.setattr("app.graph.executors.kie_model.service.submit_jobs", fake_submit_jobs)
    workflow = {
        "schema_version": 1,
        "name": "Seedance audio reference smoke",
        "nodes": [
            {"id": "load-image", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": image_reference_id}},
            {"id": "load-video", "type": "media.load_video", "position": {"x": 0, "y": 240}, "fields": {"reference_id": video_reference_id}},
            {"id": "load-audio", "type": "media.load_audio", "position": {"x": 0, "y": 480}, "fields": {"reference_id": audio_reference_id}},
            {
                "id": "prompt",
                "type": "prompt.text",
                "position": {"x": 300, "y": -160},
                "fields": {"text": "Use @image1, @video1, and @audio1 to create a rhythmic editorial motion clip."},
            },
            {
                "id": "model",
                "type": "model.kie.seedance_2_0",
                "position": {"x": 360, "y": 120},
                "fields": {"duration": 5, "resolution": "720p", "aspect_ratio": "16:9", "generate_audio": False},
            },
            {
                "id": "save",
                "type": "media.save_video",
                "position": {"x": 780, "y": 120},
                "fields": {"label": "Seedance Audio Ref", "format": "source_original"},
            },
        ],
        "edges": [
            {"id": "edge-image-model", "source": "load-image", "source_port": "image", "target": "model", "target_port": "reference_images"},
            {"id": "edge-video-model", "source": "load-video", "source_port": "video", "target": "model", "target_port": "reference_videos"},
            {"id": "edge-audio-model", "source": "load-audio", "source_port": "audio", "target": "model", "target_port": "reference_audios"},
            {"id": "edge-prompt-model", "source": "prompt", "source_port": "text", "target": "model", "target_port": "prompt"},
            {"id": "edge-model-save", "source": "model", "source_port": "video", "target": "save", "target_port": "video"},
        ],
    }
    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed", final_payload
    model_node = next(node for node in final_payload["nodes"] if node["node_id"] == "model")
    assert "video" in model_node["output_snapshot_json"]
    save_node = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    output_ref = save_node["output_snapshot_json"]["video"][0]
    asset = app_modules["store"].get_asset(output_ref["asset_id"])
    assert asset["generation_kind"] == "video"
    assert asset["model_key"] in {"seedance-2.0", "graph-derived"}
    request = captured_request["request"]
    assert request.task_mode == "reference_to_video"
    assert [item.role for item in request.images] == ["reference"]
    assert [item.role for item in request.videos] == ["reference"]
    assert [item.role for item in request.audios] == ["reference"]


def test_graph_video_combine_hard_cut_outputs_reference_video(client, app_modules) -> None:
    refs = [
        _create_reference_video(app_modules, color="0xff0000", name="graph-video-red.mp4"),
        _create_reference_video(app_modules, color="0x0000ff", name="graph-video-blue.mp4"),
    ]
    workflow = _combine_video_workflow(refs, transition="hard_cut")
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    combine_node = next(node for node in final_payload["nodes"] if node["node_id"] == "combine")
    output_ref = combine_node["output_snapshot_json"]["video"][0]
    assert output_ref["kind"] == "reference_media"
    assert output_ref["reference_id"]
    assert combine_node["metrics_json"]["combined_clip_count"] == 2
    artifacts = client.get(f"/media/graph/runs/{run_id}/artifacts").json()["items"]
    combine_artifact = next(item for item in artifacts if item["node_id"] == "combine" and item["output_port"] == "video")
    assert combine_artifact["transform_type"] == "video.combine"
    assert combine_artifact["transform_params_json"]["transition"] == "hard_cut"


def test_graph_video_combine_crossfade_then_save_video_creates_gallery_asset(client, app_modules) -> None:
    refs = [
        _create_reference_video(app_modules, color="0xff0000", name="graph-video-red-a.mp4"),
        _create_reference_video(app_modules, color="0x00ff00", name="graph-video-green-a.mp4"),
        _create_reference_video(app_modules, color="0x0000ff", name="graph-video-blue-a.mp4"),
        _create_reference_video(app_modules, color="0xffff00", name="graph-video-yellow-a.mp4"),
    ]
    workflow = _combine_video_workflow(refs, transition="crossfade", save=True)
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    combine_node = next(node for node in final_payload["nodes"] if node["node_id"] == "combine")
    assert combine_node["output_snapshot_json"]["metadata"][0]["value"]["transition"] == "crossfade"
    save_node = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    output_ref = save_node["output_snapshot_json"]["video"][0]
    asset = app_modules["store"].get_asset(output_ref["asset_id"])
    assert asset["generation_kind"] == "video"
    assert asset["model_key"] == "graph-derived"
    assert asset["payload_json"]["graph"]["transform"]["transform_type"] == "video.combine"
    assert asset["payload_json"]["graph"]["transform"]["transform_params"]["clip_count"] == 4
    assert any(item["asset_id"] == asset["asset_id"] for item in app_modules["store"].list_assets(limit=20, media_type="video"))

    rerun_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert rerun_response.status_code == 200, rerun_response.text
    rerun_id = rerun_response.json()["run_id"]
    rerun_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{rerun_id}")
        assert current.status_code == 200
        rerun_payload = current.json()
        if rerun_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert rerun_payload is not None
    assert rerun_payload["status"] == "completed", rerun_payload
    rerun_save_node = next(node for node in rerun_payload["nodes"] if node["node_id"] == "save")
    rerun_output_ref = rerun_save_node["output_snapshot_json"]["video"][0]
    assert rerun_output_ref["asset_id"] == output_ref["asset_id"]
    assert rerun_save_node["metrics_json"]["reused_asset_count"] == 1


def test_graph_video_combine_fade_to_black_and_validation_errors(client, app_modules, monkeypatch) -> None:
    refs = [
        _create_reference_video(app_modules, color="0xff00ff", name="graph-video-magenta.mp4"),
        _create_reference_video(app_modules, color="0x00ffff", name="graph-video-cyan.mp4"),
    ]
    workflow = _combine_video_workflow(refs, transition="fade_to_black")
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]
    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload

    missing = _combine_video_workflow(refs, transition="hard_cut")
    missing["nodes"][-1]["fields"]["clip_count"] = 3
    create_response = client.post("/media/graph/workflows", json=missing)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    run_id = run_response.json()["run_id"]
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert final_payload["status"] == "failed"
    assert "missing required clip slots" in next(node for node in final_payload["nodes"] if node["node_id"] == "combine")["error"]

    bad_transition = _combine_video_workflow(refs, transition="wipe")
    create_response = client.post("/media/graph/workflows", json=bad_transition)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    run_id = run_response.json()["run_id"]
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert final_payload["status"] == "failed"
    assert "transition must be" in next(node for node in final_payload["nodes"] if node["node_id"] == "combine")["error"]

    real_which = shutil.which

    def fake_which(binary: str):
        if binary == "ffmpeg":
            return None
        return real_which(binary)

    monkeypatch.setattr("app.graph.executors.video_ops.shutil.which", fake_which)
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    run_response = client.post(f"/media/graph/workflows/{create_response.json()['workflow_id']}/runs", json={})
    run_id = run_response.json()["run_id"]
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert final_payload["status"] == "failed"
    assert "ffmpeg is required" in next(node for node in final_payload["nodes"] if node["node_id"] == "combine")["error"]


def test_graph_nano_prompt_only_runs_when_optional_load_image_is_empty(client, app_modules) -> None:
    workflow = _workflow("")
    workflow["nodes"][0]["fields"] = {}
    create_response = client.post("/media/graph/workflows", json=workflow)
    assert create_response.status_code == 200, create_response.text
    workflow_id = create_response.json()["workflow_id"]

    run_response = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    assets = app_modules["store"].list_assets(limit=20)
    assert any(asset["model_key"] == "nano-banana-pro" for asset in assets)


def test_graph_grid_slice_save_many_creates_derived_assets_with_lineage(client, app_modules) -> None:
    store = app_modules["store"]
    reference_id = _create_grid_reference_image(app_modules)
    project = store.create_or_update_project(
        {
            "project_id": "graph-slices-project",
            "name": "Graph Slices Project",
            "description": "Graph slice outputs",
            "status": "active",
        }
    )
    workflow = {
        "schema_version": 1,
        "name": "Grid slice save many",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "slice",
                "type": "image.grid_slice",
                "position": {"x": 320, "y": 0},
                "fields": {"rows": 2, "columns": 2, "gutter_mode": "none", "format": "png"},
            },
            {
                "id": "save_many",
                "type": "media.save_images",
                "position": {"x": 680, "y": 0},
                "fields": {"project_id": project["project_id"], "naming_pattern": "Grid {row}-{column}"},
            },
        ],
        "edges": [
            {"id": "edge-load-slice", "source": "load", "source_port": "image", "target": "slice", "target_port": "image"},
            {"id": "edge-slice-save", "source": "slice", "source_port": "images", "target": "save_many", "target_port": "images"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    slice_node = next(node for node in final_payload["nodes"] if node["node_id"] == "slice")
    save_node = next(node for node in final_payload["nodes"] if node["node_id"] == "save_many")
    assert len(slice_node["output_snapshot_json"]["images"]) == 4
    assert slice_node["output_snapshot_json"]["metadata"][0]["value"]["slice_count"] == 4
    assert save_node["metrics_json"]["saved_asset_count"] == 4

    artifacts = client.get(f"/media/graph/runs/{run_id}/artifacts").json()["items"]
    slice_artifacts = [item for item in artifacts if item["node_id"] == "slice" and item["output_port"] == "images"]
    save_artifacts = [item for item in artifacts if item["node_id"] == "save_many" and item["output_port"] == "assets"]
    assert len(slice_artifacts) == 4
    assert len(save_artifacts) == 4
    assert all(item["parent_reference_id"] for item in slice_artifacts)
    assert all(item["transform_type"] == "image.grid_slice" for item in slice_artifacts)

    assets = store.list_assets(limit=20, project_id=project["project_id"])
    graph_assets = [asset for asset in assets if asset["model_key"] == "graph-derived"]
    assert len(graph_assets) == 4
    assert all(asset["payload_json"]["graph"]["source_reference_id"] for asset in graph_assets)
    assert all(asset["payload_json"]["graph"]["source_artifact_id"] for asset in graph_assets)


def test_graph_save_image_accepts_image_arrays(client, app_modules) -> None:
    store = app_modules["store"]
    reference_id = _create_grid_reference_image(app_modules)
    project = store.create_or_update_project(
        {
            "project_id": "graph-save-image-array-project",
            "name": "Graph Save Image Array Project",
            "description": "Graph save image array outputs",
            "status": "active",
        }
    )
    workflow = {
        "schema_version": 1,
        "name": "Grid slice save image array",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "slice",
                "type": "image.grid_slice",
                "position": {"x": 320, "y": 0},
                "fields": {"rows": 2, "columns": 2, "gutter_mode": "none", "format": "png"},
            },
            {
                "id": "save",
                "type": "media.save_image",
                "position": {"x": 680, "y": 0},
                "fields": {"project_id": project["project_id"], "label": "Saved slice"},
            },
        ],
        "edges": [
            {"id": "edge-load-slice", "source": "load", "source_port": "image", "target": "slice", "target_port": "image"},
            {"id": "edge-slice-save", "source": "slice", "source_port": "images", "target": "save", "target_port": "image"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    save_node = next(node for node in final_payload["nodes"] if node["node_id"] == "save")
    assert save_node["metrics_json"]["saved_asset_count"] == 4
    assert len(save_node["output_snapshot_json"]["asset"]) == 4

    assets = store.list_assets(limit=20, project_id=project["project_id"])
    graph_assets = [asset for asset in assets if asset["model_key"] == "graph-derived"]
    assert len(graph_assets) == 4


def test_graph_image_split_fans_out_ordered_array_outputs(client, app_modules) -> None:
    reference_id = _create_grid_reference_image(app_modules)
    workflow = {
        "schema_version": 1,
        "name": "Grid slice split fanout",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "slice",
                "type": "image.grid_slice",
                "position": {"x": 320, "y": 0},
                "fields": {"rows": 2, "columns": 2, "gutter_mode": "none", "format": "png"},
            },
            {"id": "split", "type": "image.split", "position": {"x": 680, "y": 0}, "fields": {"outputs": 4}},
            {"id": "save_first", "type": "media.save_image", "position": {"x": 1040, "y": 0}, "fields": {"label": "First split"}},
            {"id": "save_fourth", "type": "media.save_image", "position": {"x": 1040, "y": 360}, "fields": {"label": "Fourth split"}},
        ],
        "edges": [
            {"id": "edge-load-slice", "source": "load", "source_port": "image", "target": "slice", "target_port": "image"},
            {"id": "edge-slice-split", "source": "slice", "source_port": "images", "target": "split", "target_port": "images"},
            {"id": "edge-split-save-first", "source": "split", "source_port": "image_1", "target": "save_first", "target_port": "image"},
            {"id": "edge-split-save-fourth", "source": "split", "source_port": "image_4", "target": "save_fourth", "target_port": "image"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]

    final_payload = None
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{run_id}")
        assert current.status_code == 200
        final_payload = current.json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)

    assert final_payload is not None
    assert final_payload["status"] == "completed", final_payload
    slice_node = next(node for node in final_payload["nodes"] if node["node_id"] == "slice")
    split_node = next(node for node in final_payload["nodes"] if node["node_id"] == "split")
    assert split_node["metrics_json"]["split_output_count"] == 4
    for index in range(1, 5):
        assert split_node["output_snapshot_json"][f"image_{index}"][0]["reference_id"] == slice_node["output_snapshot_json"]["images"][index - 1]["reference_id"]
        assert split_node["output_snapshot_json"][f"image_{index}"][0]["metadata"]["split_index"] == index

    save_first = next(node for node in final_payload["nodes"] if node["node_id"] == "save_first")
    save_fourth = next(node for node in final_payload["nodes"] if node["node_id"] == "save_fourth")
    assert save_first["metrics_json"]["saved_asset_count"] == 1
    assert save_fourth["metrics_json"]["saved_asset_count"] == 1
    artifacts = client.get(f"/media/graph/runs/{run_id}/artifacts").json()["items"]
    split_artifacts = [item for item in artifacts if item["node_id"] == "split"]
    assert len(split_artifacts) == 4
    assert all(item["transform_type"] == "image.split" for item in split_artifacts)


def test_graph_frozen_model_reuses_previous_output_without_resubmitting(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    workflow_id = created.json()["workflow_id"]
    first_run = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
    assert first_run.status_code == 200, first_run.text
    first_run_id = first_run.json()["run_id"]
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{first_run_id}").json()
        if current["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert current["status"] == "completed", current

    def fail_submit(*args, **kwargs):
        raise AssertionError("frozen model should not submit a KIE job")

    monkeypatch.setattr("app.graph.executors.kie_model.service.submit_jobs", fail_submit)
    frozen_workflow = _workflow(reference_id)
    frozen_workflow["workflow_id"] = workflow_id
    model_node = next(node for node in frozen_workflow["nodes"] if node["id"] == "model")
    model_node["metadata"] = {"execution": {"mode": "frozen"}}
    validation = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=frozen_workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True

    second_run = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={"workflow": frozen_workflow})
    assert second_run.status_code == 200, second_run.text
    second_run_id = second_run.json()["run_id"]
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{second_run_id}").json()
        if current["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert current["status"] == "completed", current
    model_run_node = next(node for node in current["nodes"] if node["node_id"] == "model")
    assert model_run_node["status"] == "cached"
    assert model_run_node["metrics_json"]["cached"] is True
    events = client.get(f"/media/graph/runs/{second_run_id}/events").json()["items"]
    assert any(event["event_type"] == "node.cached" and event["node_id"] == "model" for event in events)


def test_graph_muted_model_carries_previous_output_without_resubmitting(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    workflow_id = created.json()["workflow_id"]
    first_run = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
    assert first_run.status_code == 200, first_run.text
    first_run_id = first_run.json()["run_id"]
    for _ in range(60):
        first_payload = client.get(f"/media/graph/runs/{first_run_id}").json()
        if first_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert first_payload["status"] == "completed", first_payload
    first_model_node = next(node for node in first_payload["nodes"] if node["node_id"] == "model")

    def fail_submit(*args, **kwargs):
        raise AssertionError("muted model should not submit a KIE job")

    monkeypatch.setattr("app.graph.executors.kie_model.service.submit_jobs", fail_submit)
    muted_workflow = _workflow(reference_id)
    muted_workflow["workflow_id"] = workflow_id
    model_node = next(node for node in muted_workflow["nodes"] if node["id"] == "model")
    model_node["metadata"] = {"execution": {"mode": "muted"}}
    validation = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=muted_workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True

    second_run = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={"workflow": muted_workflow})
    assert second_run.status_code == 200, second_run.text
    second_run_id = second_run.json()["run_id"]
    for _ in range(40):
        second_payload = client.get(f"/media/graph/runs/{second_run_id}").json()
        if second_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert second_payload["status"] == "completed", second_payload
    second_nodes = {node["node_id"]: node for node in second_payload["nodes"]}
    assert second_nodes["model"]["status"] == "skipped"
    assert second_nodes["model"]["metrics_json"]["carried_forward"] is True
    assert second_nodes["model"]["output_snapshot_json"] == first_model_node["output_snapshot_json"]
    assert second_nodes["save"]["status"] == "completed"
    events = client.get(f"/media/graph/runs/{second_run_id}/events").json()["items"]
    assert any(event["event_type"] == "node.skipped" and event["node_id"] == "model" for event in events)


def test_graph_frozen_side_branch_without_cache_does_not_block_enabled_branch(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Frozen side branch",
        "nodes": [
            {"id": "enabled-source", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": "run this branch"}},
            {"id": "enabled-inspect", "type": "debug.inspect", "position": {"x": 320, "y": 0}, "fields": {}},
            {
                "id": "frozen-source",
                "type": "prompt.text",
                "position": {"x": 0, "y": 240},
                "fields": {"text": "skip this branch"},
                "metadata": {"execution": {"mode": "frozen"}},
            },
            {
                "id": "frozen-inspect",
                "type": "debug.inspect",
                "position": {"x": 320, "y": 240},
                "fields": {},
                "metadata": {"execution": {"mode": "frozen"}},
            },
        ],
        "edges": [
            {"id": "edge-enabled", "source": "enabled-source", "source_port": "text", "target": "enabled-inspect", "target_port": "value"},
            {"id": "edge-frozen", "source": "frozen-source", "source_port": "text", "target": "frozen-inspect", "target_port": "value"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    workflow_id = created.json()["workflow_id"]
    validation = client.post(f"/media/graph/workflows/{workflow_id}/validate", json={**workflow, "workflow_id": workflow_id})
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True

    final_payload = _run_graph_workflow(client, {**workflow, "workflow_id": workflow_id})
    assert final_payload["status"] == "completed", final_payload.get("error")
    enabled_inspect = next(node for node in final_payload["nodes"] if node["node_id"] == "enabled-inspect")
    frozen_source = next(node for node in final_payload["nodes"] if node["node_id"] == "frozen-source")
    frozen_inspect = next(node for node in final_payload["nodes"] if node["node_id"] == "frozen-inspect")
    assert enabled_inspect["output_snapshot_json"]["json"][0]["value"][0]["value"] == "run this branch"
    assert frozen_source["status"] == "skipped"
    assert frozen_source["metrics_json"]["skip_reason"] == "missing_cached_output"
    assert frozen_inspect["status"] == "skipped"


def test_graph_frozen_required_dependency_without_cache_fails_validation(client) -> None:
    workflow = {
        "schema_version": 1,
        "name": "Frozen required dependency",
        "nodes": [
            {
                "id": "load",
                "type": "media.load_image",
                "position": {"x": 0, "y": 0},
                "fields": {"reference_id": "ref_missing"},
                "metadata": {"execution": {"mode": "frozen"}},
            },
            {"id": "save", "type": "media.save_image", "position": {"x": 320, "y": 0}, "fields": {}},
        ],
        "edges": [{"id": "edge-load-save", "source": "load", "source_port": "image", "target": "save", "target_port": "image"}],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json={**workflow, "workflow_id": created.json()["workflow_id"]})
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is False
    assert any(error["code"] == "frozen_dependency_missing" for error in validation.json()["errors"])


def test_graph_frozen_model_can_pin_prior_run_artifacts(client, app_modules, monkeypatch) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = _workflow(reference_id)
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    workflow_id = created.json()["workflow_id"]
    first_run = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
    assert first_run.status_code == 200, first_run.text
    first_run_id = first_run.json()["run_id"]
    for _ in range(60):
        current = client.get(f"/media/graph/runs/{first_run_id}").json()
        if current["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert current["status"] == "completed", current
    artifacts = client.get(f"/media/graph/runs/{first_run_id}/artifacts").json()["items"]
    model_artifacts = [artifact["artifact_id"] for artifact in artifacts if artifact["node_id"] == "model" and artifact["output_port"] == "image"]
    assert model_artifacts

    def fail_submit(*args, **kwargs):
        raise AssertionError("pinned frozen model should not submit a KIE job")

    monkeypatch.setattr("app.graph.executors.kie_model.service.submit_jobs", fail_submit)
    pinned_workflow = _workflow(reference_id)
    pinned_workflow["workflow_id"] = workflow_id
    model_node = next(node for node in pinned_workflow["nodes"] if node["id"] == "model")
    model_node["metadata"] = {"execution": {"mode": "frozen", "cached_run_id": first_run_id, "cached_artifact_ids": {"image": model_artifacts}}}
    validation = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=pinned_workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True

    second_run = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={"workflow": pinned_workflow})
    assert second_run.status_code == 200, second_run.text
    second_run_id = second_run.json()["run_id"]
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{second_run_id}").json()
        if current["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert current["status"] == "completed", current
    model_run_node = next(node for node in current["nodes"] if node["node_id"] == "model")
    assert model_run_node["status"] == "cached"
    assert model_run_node["metrics_json"]["cached_run_id"] == first_run_id

    model_node["metadata"] = {"execution": {"mode": "frozen", "cached_run_id": first_run_id, "cached_artifact_ids": {"image": ["missing-artifact"]}}}
    validation = client.post(f"/media/graph/workflows/{workflow_id}/validate", json=pinned_workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is False
    assert any(error["code"] == "frozen_artifact_missing" for error in validation.json()["errors"])


def test_graph_save_node_reuses_unchanged_frozen_input_without_duplicate_asset(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = {
        "schema_version": 1,
        "name": "Idempotent save",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {"id": "save", "type": "media.save_image", "position": {"x": 320, "y": 0}, "fields": {"label": "Saved reference"}},
        ],
        "edges": [{"id": "edge-load-save", "source": "load", "source_port": "image", "target": "save", "target_port": "image"}],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    workflow_id = created.json()["workflow_id"]

    first_run = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={})
    assert first_run.status_code == 200, first_run.text
    first_run_id = first_run.json()["run_id"]
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{first_run_id}").json()
        if current["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert current["status"] == "completed", current
    first_save = next(node for node in current["nodes"] if node["node_id"] == "save")
    assert first_save["metrics_json"]["saved_asset_count"] == 1
    first_asset_id = first_save["output_snapshot_json"]["asset"][0]["asset_id"]

    frozen_workflow = {
        **workflow,
        "workflow_id": workflow_id,
        "nodes": [
            {**workflow["nodes"][0], "metadata": {"execution": {"mode": "frozen"}}},
            workflow["nodes"][1],
        ],
    }
    second_run = client.post(f"/media/graph/workflows/{workflow_id}/runs", json={"workflow": frozen_workflow})
    assert second_run.status_code == 200, second_run.text
    second_run_id = second_run.json()["run_id"]
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{second_run_id}").json()
        if current["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert current["status"] == "completed", current
    second_save = next(node for node in current["nodes"] if node["node_id"] == "save")
    assert second_save["metrics_json"]["saved_asset_count"] == 0
    assert second_save["metrics_json"]["reused_asset_count"] == 1
    assert second_save["output_snapshot_json"]["asset"][0]["asset_id"] == first_asset_id
    graph_assets = [asset for asset in app_modules["store"].list_assets(limit=20) if asset["model_key"] == "graph-derived"]
    assert len(graph_assets) == 1
    events = client.get(f"/media/graph/runs/{second_run_id}/events").json()["items"]
    assert any(event["event_type"] == "asset.reused" and event["node_id"] == "save" for event in events)


def test_graph_selective_execution_validation_for_muted_and_unsupported_bypass(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    muted_workflow = {
        "schema_version": 1,
        "name": "Muted dependency",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}, "metadata": {"execution": {"mode": "muted"}}},
            {"id": "save", "type": "media.save_image", "position": {"x": 320, "y": 0}, "fields": {}},
        ],
        "edges": [{"id": "edge-load-save", "source": "load", "source_port": "image", "target": "save", "target_port": "image"}],
    }
    created = client.post("/media/graph/workflows", json=muted_workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=muted_workflow)
    assert response.status_code == 200, response.text
    assert response.json()["valid"] is False
    assert any(error["code"] == "muted_required_dependency" for error in response.json()["errors"])

    bypass_workflow = _workflow(reference_id)
    model_node = next(node for node in bypass_workflow["nodes"] if node["id"] == "model")
    model_node["metadata"] = {"execution": {"mode": "bypassed"}}
    created = client.post("/media/graph/workflows", json=bypass_workflow)
    assert created.status_code == 200, created.text
    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=bypass_workflow)
    assert response.status_code == 200, response.text
    assert response.json()["valid"] is False
    assert any(error["code"] == "unsupported_bypass" for error in response.json()["errors"])


def test_graph_bypassed_image_utility_passes_through_without_artifact(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = {
        "schema_version": 1,
        "name": "Bypass resize",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "resize",
                "type": "image.transform",
                "position": {"x": 320, "y": 0},
                "fields": {"operation": "resize", "width": 4, "height": 4, "fit": "stretch", "format": "png"},
                "metadata": {"execution": {"mode": "bypassed"}},
            },
            {"id": "save", "type": "media.save_image", "position": {"x": 680, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-load-resize", "source": "load", "source_port": "image", "target": "resize", "target_port": "image"},
            {"id": "edge-resize-save", "source": "resize", "source_port": "image", "target": "save", "target_port": "image"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["run_id"]
    for _ in range(40):
        current = client.get(f"/media/graph/runs/{run_id}").json()
        if current["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert current["status"] == "completed", current
    resize_node = next(node for node in current["nodes"] if node["node_id"] == "resize")
    assert resize_node["status"] == "bypassed"
    assert resize_node["output_snapshot_json"]["image"][0]["reference_id"] == reference_id
    artifacts = client.get(f"/media/graph/runs/{run_id}/artifacts").json()["items"]
    assert not [item for item in artifacts if item["node_id"] == "resize"]
    events = client.get(f"/media/graph/runs/{run_id}/events").json()["items"]
    assert any(event["event_type"] == "node.bypassed" and event["node_id"] == "resize" for event in events)
