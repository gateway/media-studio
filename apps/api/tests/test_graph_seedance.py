from __future__ import annotations

from test_graph_studio import (
    _create_named_reference_image,
    _create_reference_video,
    _run_graph_workflow,
)


def test_graph_seedance_25_definition_uses_existing_seedance_contract(client) -> None:
    response = client.get("/media/graph/node-definitions")
    assert response.status_code == 200, response.text
    definition = next(item for item in response.json()["items"] if item["type"] == "model.kie.seedance_2_5")

    inputs = {port["id"]: port for port in definition["ports"]["inputs"]}
    fields = {field["id"]: field for field in definition["fields"]}
    assert definition["source"]["model_key"] == "seedance-2.5"
    assert inputs["start_frame"]["max"] == 1
    assert inputs["end_frame"]["max"] == 1
    assert inputs["reference_images"]["max"] == 30
    assert inputs["reference_videos"]["max"] == 10
    assert inputs["reference_audios"]["max"] == 10
    assert fields["resolution"]["options"] == ["480p", "720p", "1080p"]
    assert fields["duration"]["default"] == 5
    assert fields["duration"]["options"] == [-1]
    assert fields["duration"]["max"] == 30
    assert fields["output_format"]["options"] == ["mp4", "mov"]
    assert fields["nsfw_checker"]["default"] is False


def test_graph_seedance_25_reuses_mutually_exclusive_input_validation(client, app_modules) -> None:
    start_reference_id = _create_named_reference_image(app_modules, name="seedance-25-start.png")
    style_reference_id = _create_named_reference_image(app_modules, name="seedance-25-style.png")
    workflow = {
        "schema_version": 1,
        "name": "Seedance 2.5 mixed modes",
        "nodes": [
            {"id": "start", "type": "media.load_image", "position": {"x": 0, "y": 0}, "fields": {"reference_id": start_reference_id}},
            {"id": "style", "type": "media.load_image", "position": {"x": 0, "y": 220}, "fields": {"reference_id": style_reference_id}},
            {
                "id": "model",
                "type": "model.kie.seedance_2_5",
                "position": {"x": 360, "y": 0},
                "fields": {"prompt": "Animate the subject.", "duration": 5, "resolution": "720p", "aspect_ratio": "16:9"},
            },
        ],
        "edges": [
            {"id": "start-model", "source": "start", "source_port": "image", "target": "model", "target_port": "start_frame"},
            {"id": "style-model", "source": "style", "source_port": "image", "target": "model", "target_port": "reference_images"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text

    response = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/validate", json=workflow)
    assert response.status_code == 200, response.text
    assert any(error["code"] == "seedance_input_modes_are_mutually_exclusive" for error in response.json()["errors"])


def test_graph_seedance_output_last_frame_wires_image_output_offline(client, app_modules, monkeypatch) -> None:
    output_video_id = _create_reference_video(app_modules, name="graph-seedance-output-last-frame-video.mp4")
    output_image_id = _create_named_reference_image(app_modules, name="graph-seedance-output-last-frame.png")
    output_video = app_modules["store"].get_reference_media(output_video_id)
    output_image = app_modules["store"].get_reference_media(output_image_id)

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
                "hero_original_path": output_video["stored_path"],
                "hero_web_path": output_video["stored_path"],
                "hero_thumb_path": output_video.get("thumb_path"),
                "hero_poster_path": output_video.get("poster_path"),
                "payload_json": {"outputs": [{"kind": "video", "role": "output", "original_path": output_video["stored_path"]}]},
            }
        )
        app_modules["store"].create_or_update_asset(
            {
                "job_id": completed_job["job_id"],
                "generation_kind": "image",
                "model_key": request.model_key,
                "status": "completed",
                "task_mode": request.task_mode,
                "prompt_summary": request.prompt,
                "hero_original_path": output_image["stored_path"],
                "hero_web_path": output_image["stored_path"],
                "hero_thumb_path": output_image.get("thumb_path"),
                "hero_poster_path": output_image.get("poster_path"),
                "payload_json": {"outputs": [{"kind": "image", "role": "last_frame", "original_path": output_image["stored_path"]}]},
            }
        )
        return batch, [completed_job]

    monkeypatch.setattr("app.graph.executors.kie_model.service.submit_jobs", fake_submit_jobs)
    workflow = {
        "schema_version": 1,
        "name": "Seedance output last frame smoke",
        "nodes": [
            {
                "id": "model",
                "type": "model.kie.seedance_2_0",
                "position": {"x": 0, "y": 0},
                "fields": {
                    "prompt": "Create a short cinematic establishing shot.",
                    "duration": 5,
                    "resolution": "720p",
                    "aspect_ratio": "16:9",
                    "return_last_frame": True,
                    "generate_audio": False,
                },
            },
            {
                "id": "save-video",
                "type": "media.save_video",
                "position": {"x": 440, "y": -120},
                "fields": {"label": "Seedance Video", "format": "source_original"},
            },
            {
                "id": "save-image",
                "type": "media.save_image",
                "position": {"x": 440, "y": 180},
                "fields": {"label": "Seedance Last Frame"},
            },
        ],
        "edges": [
            {"id": "edge-video", "source": "model", "source_port": "video", "target": "save-video", "target_port": "video"},
            {"id": "edge-image", "source": "model", "source_port": "image", "target": "save-image", "target_port": "image"},
        ],
    }
    final_payload = _run_graph_workflow(client, workflow)
    assert final_payload["status"] == "completed", final_payload
    model_node = next(node for node in final_payload["nodes"] if node["node_id"] == "model")
    assert "video" in model_node["output_snapshot_json"]
    assert "image" in model_node["output_snapshot_json"]
    save_video_node = next(node for node in final_payload["nodes"] if node["node_id"] == "save-video")
    save_image_node = next(node for node in final_payload["nodes"] if node["node_id"] == "save-image")
    video_asset = app_modules["store"].get_asset(save_video_node["output_snapshot_json"]["video"][0]["asset_id"])
    image_asset = app_modules["store"].get_asset(save_image_node["output_snapshot_json"]["image"][0]["asset_id"])
    assert video_asset["generation_kind"] == "video"
    assert image_asset["generation_kind"] == "image"
    assert captured_request["request"].options["return_last_frame"] is True
