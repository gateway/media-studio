"""Studio output contracts and queue integration with mocked KIE calls."""

from pathlib import Path
from shutil import copyfile
from unittest.mock import MagicMock

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


def test_svg_result_host_uses_anonymous_download(monkeypatch):
    kie_api = kie_adapter.get_kie_module()
    client = MagicMock()
    client.return_value.__enter__.return_value.download_to_path.return_value = {"downloaded": True}
    monkeypatch.setattr(kie_api.clients, "DownloadClient", client)
    ordinary_download = MagicMock(return_value={"ordinary": True})
    monkeypatch.setattr(kie_adapter, "download_output_file", ordinary_download)

    assert kie_adapter.download_job_output("https://getapib.org/result", "result.bin", "svg") == {"downloaded": True}
    settings = client.call_args.args[0]
    assert settings.api_key is None
    assert settings.trusted_download_hosts == ["getapib.org"]
    client.return_value.__enter__.return_value.download_to_path.assert_called_once_with(
        "https://getapib.org/result", "result.bin", anonymous=True,
    )
    assert kie_adapter.download_job_output("https://getapib.org/result", "result.bin", "gif") == {"ordinary": True}
    assert kie_adapter.download_job_output("https://other.getapib.org/result", "result.bin", "svg") == {"ordinary": True}


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


@pytest.mark.parametrize("output_format, options, provider_options", [
    ("png", {"aspect_ratio": "1:1"}, {"aspect_ratio": "1:1"}),
    ("gif", {"frame_count": 2, "frame_duration_ms": 250}, {"frame_count": 2, "frame_duration_ms": 250}),
    ("svg", {"svg_model": "gpt-5.6-luna"}, {"svg": {"model": "gpt-5.6-luna"}}),
])
def test_composer_output_passes_through_queue(
    client, app_modules, tmp_path, monkeypatch, output_format, options, provider_options,
):
    worker = app_modules["runner"].runner
    adapter = app_modules["runner"].kie_adapter
    settings = app_modules["runner"].settings
    kie = adapter.get_kie_module()
    source = tmp_path / f"fixture.{output_format}"
    _write_output_fixture(source, output_format)
    url = "https://tempfile.redpandaai.co/fixture.bin"
    payloads = []

    def submit(prepared):
        payload = kie.build_submission_payload(kie.PreparedRequest(**prepared), adapter.get_registry())
        payloads.append(payload)
        return {"task_id": "fixture-task", "provider_payload": payload}

    status = MagicMock(side_effect=[{"state": "running"}, {"state": "succeeded", "output_urls": [url]}])
    download = MagicMock(side_effect=lambda _, destination, __: copyfile(source, destination))
    monkeypatch.setattr(adapter, "submit_request", submit)
    monkeypatch.setattr(adapter, "poll_task", status)
    monkeypatch.setattr(adapter, "download_job_output", download)
    monkeypatch.setattr(settings, "media_enable_live_submit", True)
    monkeypatch.setattr(settings, "kie_api_key", "mock-provider-key")

    response = client.post("/media/jobs", json={
        "model_key": "gpt-image-2-6-sunburst-text-to-image",
        "task_mode": "text_to_image",
        "prompt": "A blue circle on white.",
        "options": {"output_format": output_format, **options},
    })
    assert response.status_code == 200, response.text
    job = response.json()["jobs"][0]
    assert job["status"] == "queued"

    worker.tick()
    running = client.get(f"/media/jobs/{job['job_id']}").json()
    _assert_running_output(running, payloads, output_format, provider_options)

    worker.tick()
    completed = client.get(f"/media/jobs/{job['job_id']}").json()
    assert completed["status"] == "completed", completed["error"]
    assert (completed["scheduler_attempts"], len(payloads), status.call_count) == (1, 1, 2)
    download.assert_called_once()
    _assert_published_output(client, app_modules["store"], job["job_id"], source)


def _assert_running_output(job, payloads, output_format, provider_options):
    assert (job["status"], job["provider_task_id"]) == ("running", "fixture-task")
    [payload] = payloads
    sent = payload["input"]
    assert sent["output_format"] == output_format
    assert {key: sent[key] for key in provider_options} == provider_options
    format_fields = {"frame_count", "frame_duration_ms", "svg"}
    assert format_fields.intersection(sent) == format_fields.intersection(provider_options)


def _assert_published_output(client, store, job_id, source):
    [asset] = store.get_assets_by_job_id(job_id)
    original_path = asset["hero_original_path"]
    assert original_path.endswith(source.suffix)
    original = client.get(f"/media/files/{original_path}")
    assert original.status_code == 200
    assert original.content == source.read_bytes()


def _write_output_fixture(path, output_format):
    if output_format == "svg":
        path.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"/>', encoding="utf-8")
    elif output_format == "gif":
        frames = [Image.new("RGB", (8, 8), color) for color in ("red", "blue")]
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=250, loop=0)
    else:
        Image.new("RGB", (8, 8), "blue").save(path)
