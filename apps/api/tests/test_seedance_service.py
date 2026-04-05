from app import schemas, service


def test_seedance_roles_flow_into_raw_request(app_modules) -> None:
    request = schemas.ValidateRequest(
        model_key="seedance-2.0",
        task_mode="reference_to_video",
        prompt="Use @image1 for the hero and @video1 for the motion rhythm.",
        images=[
            schemas.MediaRefInput(path="/tmp/first.png", role="first_frame"),
            schemas.MediaRefInput(path="/tmp/ref-image.png", role="reference"),
        ],
        videos=[schemas.MediaRefInput(path="/tmp/ref-video.mp4", role="reference", duration_seconds=4.5)],
        audios=[schemas.MediaRefInput(path="/tmp/ref-audio.wav", role="reference")],
        options={"duration": 4, "resolution": "480p", "aspect_ratio": "16:9"},
    )

    bundle = service.build_validation_bundle(request)
    raw_request = bundle["raw_request"]

    assert raw_request["task_mode"] == "reference_to_video"
    assert raw_request["images"][0]["role"] == "first_frame"
    assert raw_request["images"][1]["role"] == "reference"
    assert raw_request["videos"][0]["role"] == "reference"
    assert raw_request["videos"][0]["duration_seconds"] == 4.5
    assert raw_request["audios"][0]["role"] == "reference"


def test_seedance_prompt_context_surfaces_reference_asset_guide(app_modules) -> None:
    request = schemas.ValidateRequest(
        model_key="seedance-2.0",
        task_mode="reference_to_video",
        prompt="Use @image1 and @audio1.",
        images=[schemas.MediaRefInput(path="/tmp/ref-image.png", role="reference")],
        audios=[schemas.MediaRefInput(path="/tmp/ref-audio.wav", role="reference")],
        options={"duration": 4, "resolution": "480p", "aspect_ratio": "16:9"},
    )

    bundle = service.build_validation_bundle(request)

    prompt_context = bundle["prompt_context"]
    assert prompt_context["input_pattern"] == "multimodal_reference"
    assert prompt_context["resolved_profile_key"] == "seedance_2_0_multimodal_reference_v1"
    assert "@image1 -> reference image 1" in prompt_context["rendered_system_prompt"]
    assert "@audio1 -> reference audio 1" in prompt_context["rendered_system_prompt"]


def test_seedance_invalid_shapes_are_rejected_early(app_modules) -> None:
    invalid_last_only = schemas.ValidateRequest(
        model_key="seedance-2.0",
        task_mode="reference_to_video",
        prompt="Use a final hero shot.",
        images=[schemas.MediaRefInput(path="/tmp/last.png", role="last_frame")],
        options={"duration": 4, "resolution": "480p", "aspect_ratio": "16:9"},
    )
    invalid_mixed = schemas.ValidateRequest(
        model_key="seedance-2.0",
        task_mode="reference_to_video",
        prompt="Use a first frame and a reference image.",
        images=[
            schemas.MediaRefInput(path="/tmp/first.png", role="first_frame"),
            schemas.MediaRefInput(path="/tmp/ref.png", role="reference"),
        ],
        options={"duration": 4, "resolution": "480p", "aspect_ratio": "16:9"},
    )

    last_only_bundle = service.build_validation_bundle(invalid_last_only)
    mixed_bundle = service.build_validation_bundle(invalid_mixed)

    assert last_only_bundle["validation"]["state"] == "invalid"
    assert "first-frame image" in last_only_bundle["validation"]["errors"][0]
    assert mixed_bundle["validation"]["state"] == "invalid"
    assert "multimodal reference assets" in mixed_bundle["validation"]["errors"][0]
