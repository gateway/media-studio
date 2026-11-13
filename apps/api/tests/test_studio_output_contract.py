"""Studio catalog and generated-file checks with no application lifespan or store."""

from pathlib import Path

import pytest
from PIL import Image

from app import kie_adapter, runner, service


def _studio_options(model_key):
    return {row["key"]: row for row in kie_adapter.get_model(model_key)["studio_dynamic_options"]}


@pytest.mark.parametrize("tier", ["sunburst", "flare"])
@pytest.mark.parametrize("mode", ["text", "image"])
def test_catalog_controls_use_sdk_contracts(tier, mode):
    model_key = f"gpt-image-2-6-{tier}-{mode}-to-image"
    spec = kie_adapter.get_registry().get_model(model_key)
    controls = _studio_options(model_key)
    assert controls["output_format"]["allowed"] == spec.options["output_format"].allowed
    assert controls["output_compression"]["ui_visible_when"] == {"output_format": ["jpeg", "webp"]}
    assert controls["frame_count"]["default"] == 9
    assert controls["frame_duration_ms"]["default"] == 200
    assert controls["frame_duration_ms"]["ui_step"] == 10
    assert controls["svg_model"]["default"] == "gpt-5.6-luna"
    assert ("size" in controls) == (mode == "text")


@pytest.mark.parametrize("output_format, options", [
    ("png", {"aspect_ratio": "auto", "resolution": "1K", "background": "transparent"}),
    ("jpeg", {"aspect_ratio": "auto", "resolution": "1K", "background": "auto", "output_compression": 65}),
    ("webp", {"aspect_ratio": "auto", "resolution": "4K", "output_compression": 0}),
    ("gif", {"frame_count": 10, "frame_duration_ms": 250, "size": "384x512", "background": "auto"}),
    ("svg", {"svg_model": "gpt-5.6-luna"}),
])
def test_active_options_validate_against_sdk(output_format, options):
    result = kie_adapter.validate_request({
        "model_key": "gpt-image-2-6-sunburst-text-to-image",
        "prompt": "A ceramic mug",
        "options": {"output_format": output_format, **options},
    })
    assert result["state"] == "ready_with_defaults", result
    assert result["normalized_request"]["options"]["output_format"] == output_format


def test_kling_catalog_declares_aspect_visibility():
    controls = _studio_options("kling-3.0-i2v")
    assert controls["aspect_ratio"]["ui_visible_when"] == {"$input_pattern": ["prompt_only", "single_image"]}
    assert "ui_visible_when" not in _studio_options("kling-3.0-t2v")["aspect_ratio"]


def test_svg_and_gif_keep_original_format_even_with_a_generic_provider_url(tmp_path, monkeypatch):
    monkeypatch.setattr(kie_adapter.settings, "data_root", tmp_path)
    svg = tmp_path / "output.svg"
    xml = b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" />'
    source = tmp_path / "output.jpg"
    source.write_bytes(xml)
    gif = tmp_path / "animation.bin"
    frames = [Image.new("RGB", (8, 8), color) for color in ("red", "blue")]
    frames[0].save(gif, format="GIF", save_all=True, append_images=frames[1:], duration=200, loop=0)
    job = {"model_key": "gpt-image-2-6-sunburst-text-to-image", "task_mode": "text_to_image"}
    normalize = service._normalized_output_source_path
    assert runner._download_suffix_from_url("https://example.invalid/out.svg?signature=abc") == ".svg"
    assert normalize(job, source, "https://example.invalid/result") == svg
    assert svg.read_bytes() == xml
    gif_path = normalize(job, gif, "https://example.invalid/result")
    assert gif_path.suffix == ".gif"
    artifact = kie_adapter.create_run_artifact({
        "status": "succeeded", "model_key": job["model_key"],
        "outputs": [
            {"kind": "image", "role": "output", "source_path": str(gif_path)},
            {"kind": "image", "role": "output", "source_path": str(svg)},
        ],
    })
    _check_gif_thumbnail(artifact)
    _check_svg_original(artifact)


def _check_svg_original(artifact):
    svg_output = artifact["outputs"][1]
    assert svg_output["mime_type"] == "image/svg+xml"
    assert svg_output["web_path"] is None
    assert svg_output["thumb_path"] is None


def _check_gif_thumbnail(artifact):
    gif_output = artifact["outputs"][0]
    assert gif_output["mime_type"] == "image/gif"
    assert gif_output["metadata"]["frame_count"] == 2
    with Image.open(Path(artifact["run_dir"]) / gif_output["thumb_path"]) as thumb:
        assert not thumb.is_animated
