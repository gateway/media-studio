from __future__ import annotations

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
from app.graph.schemas import GraphNodeDefinition, GraphNodeField, GraphNodePort

PNG_1X1_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\x0b~\x90"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _create_reference_image(app_modules) -> str:
    data_root = app_modules["main"].settings.data_root
    target = data_root / "reference-media" / "images" / "graph-source.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(PNG_1X1_BYTES)
    record = app_modules["store"].create_or_reuse_reference_media(
        {
            "kind": "image",
            "original_filename": "graph-source.png",
            "stored_path": "reference-media/images/graph-source.png",
            "mime_type": "image/png",
            "file_size_bytes": len(PNG_1X1_BYTES),
            "sha256": "graph-source-hash",
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


def _create_reference_video(app_modules, *, color: str = "0x101414", name: str = "graph-video-source.mp4") -> str:
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
            f"color=c={color}:s=320x180:d=1",
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
        "preset.render",
        "prompt.concat",
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
    display_any = next(item for item in items if item["type"] == "display.any")
    assert display_any["category"] == "Preview"
    display_any_input = display_any["ports"]["inputs"][0]
    assert display_any_input["type"] == "any"
    assert display_any_input["array"] is False
    assert display_any_input["max"] == 1
    assert {"value", "json"} == {port["id"] for port in display_any["ports"]["outputs"]}
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
    assert next(field for field in kling["fields"] if field["id"] == "sound")["type"] == "boolean"
    assert next(field for field in kling["fields"] if field["id"] == "duration")["options"] == [5, 10]
    kling_3 = next(item for item in items if item["type"] == "model.kie.kling_3_0_i2v")
    kling_3_inputs = kling_3["ports"]["inputs"]
    assert any(port["id"] == "start_frame" and port["label"] == "Start Frame" and port["required"] is True and port["max"] == 1 for port in kling_3_inputs)
    assert any(port["id"] == "end_frame" and port["label"] == "End Frame" and port["required"] is False and port["max"] == 1 for port in kling_3_inputs)
    assert not any(port["id"] == "image_refs" for port in kling_3_inputs)
    seedance = next(item for item in items if item["type"] == "model.kie.seedance_2_0")
    assert any(port["id"] == "image_refs" and port["array"] is True and port["max"] == 9 for port in seedance["ports"]["inputs"])
    assert any(port["id"] == "video_refs" and port["array"] is True and port["max"] == 3 for port in seedance["ports"]["inputs"])
    assert any(port["id"] == "audio_refs" and port["array"] is True and port["max"] == 3 for port in seedance["ports"]["inputs"])
    save_video = next(item for item in items if item["type"] == "media.save_video")
    assert any(field["id"] == "format" and field["default"] == "source_original" for field in save_video["fields"])
    assert any(port["id"] == "video" and port["type"] == "video" for port in save_video["ports"]["outputs"])
    assert any(port["id"] == "audio" and port["type"] == "audio" and port["required"] is False for port in save_video["ports"]["inputs"])
    assert any(field["id"] == "audio_policy" and field["default"] == "keep_video_audio" for field in save_video["fields"])
    save_audio = next(item for item in items if item["type"] == "media.save_audio")
    assert any(field["id"] == "format" and field["default"] == "source_original" for field in save_audio["fields"])
    audio_transform = next(item for item in items if item["type"] == "audio.transform")
    assert any(field["id"] == "operation" and field["default"] == "extract_metadata" for field in audio_transform["fields"])


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
    assert fields["model_supports_images"]["type"] == "boolean"
    assert "[user_prompt]" in fields["system_prompt"]["help_text"]


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
                        "temperature": 0.2,
                        "max_tokens": 256,
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
                        "model_supports_images": True,
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
    assert len(calls[1]["image_paths"]) == 1
    assert calls[1]["mode"] == "describe_image"
    assert calls[2]["user_prompt"] == "turn this into sci-fi fantasy"


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


def test_graph_estimate_warns_for_prompt_llm_unknown_external_pricing(client) -> None:
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
    assert payload["pricing_summary"]["has_unknown_pricing"] is True
    assert payload["nodes"]["llm"]["pricing_summary"]["pricing_status"] == "unknown_external"
    assert any(warning["code"] == "unknown_external_llm_pricing" for warning in payload["warnings"])


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


def test_graph_template_can_be_archived_from_workflow_panel(client) -> None:
    response = client.post(
        "/media/graph/templates",
        json={
            "name": "Temporary Template",
            "description": None,
            "tags": ["graph-studio"],
            "thumbnail_path": None,
            "workflow_json": {"schema_version": 1, "name": "Temporary", "nodes": [], "edges": []},
        },
    )
    assert response.status_code == 200, response.text
    template_id = response.json()["template_id"]
    delete_response = client.delete(f"/media/graph/templates/{template_id}")
    assert delete_response.status_code == 200, delete_response.text
    assert delete_response.json()["status"] == "archived"
    list_response = client.get("/media/graph/templates")
    assert list_response.status_code == 200, list_response.text
    assert template_id not in {item["template_id"] for item in list_response.json()["items"]}


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

    def fake_submit_jobs(request):
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
            {"id": "edge-image-model", "source": "load-image", "source_port": "image", "target": "model", "target_port": "image_refs"},
            {"id": "edge-video-model", "source": "load-video", "source_port": "video", "target": "model", "target_port": "video_refs"},
            {"id": "edge-audio-model", "source": "load-audio", "source_port": "audio", "target": "model", "target_port": "audio_refs"},
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


def test_graph_image_resize_and_metadata_run_sync(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = {
        "schema_version": 1,
        "name": "Resize utility",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {
                "id": "resize",
                "type": "image.transform",
                "position": {"x": 320, "y": 0},
                "fields": {"operation": "resize", "width": 4, "height": 3, "fit": "stretch", "format": "png"},
            },
            {"id": "metadata", "type": "debug.metadata", "position": {"x": 680, "y": 0}, "fields": {}},
            {"id": "preview", "type": "preview.image", "position": {"x": 680, "y": 260}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-load-resize", "source": "load", "source_port": "image", "target": "resize", "target_port": "image"},
            {"id": "edge-resize-metadata", "source": "resize", "source_port": "image", "target": "metadata", "target_port": "image"},
            {"id": "edge-resize-preview", "source": "resize", "source_port": "image", "target": "preview", "target_port": "image"},
        ],
    }

    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True

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
    resize_output = final_payload["nodes"][1]["output_snapshot_json"]["image"][0]
    resized_reference = app_modules["store"].get_reference_media(resize_output["reference_id"])
    assert resized_reference["width"] == 4
    assert resized_reference["height"] == 3
    assert final_payload["nodes"][1]["metrics_json"]["utility_processing_duration_seconds"] >= 0


def test_graph_image_crop_pad_convert_and_extract_metadata_run_sync(client, app_modules) -> None:
    reference_id = _create_reference_image(app_modules)
    workflow = {
        "schema_version": 1,
        "name": "Image utility chain",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {"id": "pad", "type": "image.transform", "position": {"x": 280, "y": 0}, "fields": {"operation": "pad", "width": 4, "height": 4, "color": "#000000", "format": "png"}},
            {"id": "crop", "type": "image.transform", "position": {"x": 560, "y": 0}, "fields": {"operation": "crop", "x": 0, "y": 0, "width": 2, "height": 2, "format": "png"}},
            {"id": "convert", "type": "image.transform", "position": {"x": 840, "y": 0}, "fields": {"operation": "convert_format", "format": "webp"}},
            {"id": "metadata", "type": "image.transform", "position": {"x": 1120, "y": 0}, "fields": {"operation": "extract_metadata"}},
        ],
        "edges": [
            {"id": "edge-load-pad", "source": "load", "source_port": "image", "target": "pad", "target_port": "image"},
            {"id": "edge-pad-crop", "source": "pad", "source_port": "image", "target": "crop", "target_port": "image"},
            {"id": "edge-crop-convert", "source": "crop", "source_port": "image", "target": "convert", "target_port": "image"},
            {"id": "edge-convert-metadata", "source": "convert", "source_port": "image", "target": "metadata", "target_port": "image"},
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
    metadata_node = next(node for node in final_payload["nodes"] if node["node_id"] == "metadata")
    assert metadata_node["output_snapshot_json"]["metadata"][0]["value"]["width"] == 2
    assert metadata_node["output_snapshot_json"]["metadata"][0]["value"]["height"] == 2


def test_graph_preset_render_validates_required_slots_and_runs(client, app_modules) -> None:
    store = app_modules["store"]
    reference_id = _create_reference_image(app_modules)
    preset = store.create_or_update_preset(
        {
            "preset_id": "graph-preset-test",
            "key": "graph-preset-test",
            "label": "Graph Preset Test",
            "description": "Graph preset test",
            "status": "active",
            "model_key": "nano-banana-pro",
            "source_kind": "custom",
            "applies_to_models_json": ["nano-banana-pro"],
            "prompt_template": "Create a {{style}} editorial image from [[subject]].",
            "input_schema_json": [{"key": "style", "label": "Style", "required": True}],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True, "max_files": 1}],
            "choice_groups_json": [],
            "default_options_json": {},
            "rules_json": {},
        }
    )
    missing_slot_workflow = {
        "schema_version": 1,
        "name": "Preset missing slot",
        "nodes": [
            {
                "id": "preset",
                "type": "preset.render",
                "position": {"x": 0, "y": 0},
                "fields": {"preset_id": preset["preset_id"], "text_values_json": '{"style":"cinematic"}'},
            }
        ],
        "edges": [],
    }
    created = client.post("/media/graph/workflows", json=missing_slot_workflow)
    assert created.status_code == 200, created.text
    invalid = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=missing_slot_workflow)
    assert invalid.status_code == 200, invalid.text
    assert invalid.json()["valid"] is False
    assert any(error["code"] == "missing_preset_image_slot" for error in invalid.json()["errors"])

    workflow = _workflow(reference_id)
    workflow["nodes"].insert(
        1,
        {
            "id": "preset",
            "type": "preset.render",
            "position": {"x": 220, "y": -180},
            "fields": {"preset_id": preset["preset_id"], "text_values_json": '{"style":"cinematic"}'},
        },
    )
    model_node = next(node for node in workflow["nodes"] if node["id"] == "model")
    model_node["fields"].pop("prompt")
    workflow["edges"] = [
        {"id": "edge-load-preset", "source": "load", "source_port": "image", "target": "preset", "target_port": "image_refs"},
        {"id": "edge-preset-model-prompt", "source": "preset", "source_port": "prompt", "target": "model", "target_port": "prompt"},
        {"id": "edge-preset-model-image", "source": "preset", "source_port": "image_refs", "target": "model", "target_port": "image_refs"},
        {"id": "edge-model-save", "source": "model", "source_port": "image", "target": "save", "target_port": "image"},
    ]
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True

    run_response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
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
    preset_node = next(node for node in final_payload["nodes"] if node["node_id"] == "preset")
    assert preset_node["metrics_json"]["preset_image_ref_count"] == 1
    assert "cinematic editorial image" in preset_node["output_snapshot_json"]["prompt"][0]["value"]


def test_graph_dynamic_preset_node_renders_fields_and_slots(client, app_modules) -> None:
    store = app_modules["store"]
    reference_id = _create_reference_image(app_modules)
    preset = store.create_or_update_preset(
        {
            "preset_id": "graph-dynamic-preset-test",
            "key": "graph-dynamic-preset-test",
            "label": "Graph Dynamic Preset Test",
            "description": "Graph dynamic preset test",
            "status": "active",
            "model_key": "nano-banana-pro",
            "source_kind": "custom",
            "applies_to_models_json": ["nano-banana-pro"],
            "prompt_template": "Create a {{style}} portrait from [[subject]].",
            "input_schema_json": [{"key": "style", "label": "Style", "required": True}],
            "input_slots_json": [{"key": "subject", "label": "Subject", "required": True, "max_files": 1}],
            "choice_groups_json": [],
            "default_options_json": {},
            "rules_json": {},
        }
    )
    definitions = client.post("/media/graph/node-definitions/refresh").json()["items"]
    node_type = "preset.render.graph_dynamic_preset_test"
    dynamic_definition = next(item for item in definitions if item["type"] == node_type)
    assert any(field["id"] == "text__style" for field in dynamic_definition["fields"])
    assert any(port["id"] == "slot__subject" for port in dynamic_definition["ports"]["inputs"])

    workflow = {
        "schema_version": 1,
        "name": "Dynamic preset",
        "nodes": [
            {"id": "load", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": reference_id}},
            {"id": "preset", "type": node_type, "position": {"x": 320, "y": 0}, "fields": {"text__style": "cinematic"}},
        ],
        "edges": [{"id": "edge-load-preset", "source": "load", "source_port": "image", "target": "preset", "target_port": "slot__subject"}],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    validation = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert validation.status_code == 200, validation.text
    assert validation.json()["valid"] is True
