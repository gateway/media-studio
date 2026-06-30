from app.model_support import derive_studio_model_support


def _model_with_patterns(patterns):
    return {
        "key": "example-model",
        "input_patterns": patterns,
        "raw": {
            "inputs": {"image": {"required_min": 0, "required_max": 0}},
            "options": {
                "quality": {"type": "enum", "allowed": ["fast", "best"], "default": "fast"},
                "freeform": {"type": "string"},
            },
        },
    }


def test_dynamic_options_include_known_control_types() -> None:
    support = derive_studio_model_support(_model_with_patterns(["prompt_only"]))

    assert support["studio_exposed"] is True
    assert support["studio_support_status"] == "generic_supported"
    assert support["studio_dynamic_options"] == [
        {
            "key": "quality",
            "type": "enum",
            "label": "Quality",
            "help_text": None,
            "ui_group": None,
            "ui_order": None,
            "advanced": False,
            "required": False,
            "default": "fast",
            "hidden_from_studio": False,
            "allowed": ["fast", "best"],
        }
    ]
    assert support["studio_unsupported_option_keys"] == ["freeform"]


def test_unknown_input_pattern_is_hidden_from_studio() -> None:
    support = derive_studio_model_support(_model_with_patterns(["new_media_slot"]))

    assert support["studio_exposed"] is False
    assert support["studio_support_status"] == "unsupported"
    assert support["studio_unsupported_input_patterns"] == ["new_media_slot"]


def test_seedance_fast_multimodal_contract_is_exposed() -> None:
    support = derive_studio_model_support(
        {
            "key": "seedance-2.0-fast",
            "input_patterns": ["prompt_only", "single_image", "first_last_frames", "multimodal_reference"],
            "raw": {
                "inputs": {
                    "image": {"required_min": 0, "required_max": 9},
                    "video": {"required_min": 0, "required_max": 3},
                    "audio": {"required_min": 0, "required_max": 3},
                },
                "options": {
                    "resolution": {"type": "enum", "allowed": ["480p", "720p"], "default": "720p"},
                    "duration": {"type": "int_range", "min": 4, "max": 15, "required": True},
                },
            },
        }
    )

    assert support["studio_exposed"] is True
    assert support["studio_support_status"] == "fully_supported"
    assert support["studio_supported_input_patterns"] == [
        "prompt_only",
        "single_image",
        "first_last_frames",
        "multimodal_reference",
    ]


def test_seedance_mini_multimodal_contract_is_exposed() -> None:
    support = derive_studio_model_support(
        {
            "key": "seedance-2.0-mini",
            "input_patterns": ["prompt_only", "single_image", "first_last_frames", "multimodal_reference"],
            "raw": {
                "inputs": {
                    "image": {"required_min": 0, "required_max": 9},
                    "video": {"required_min": 0, "required_max": 3},
                    "audio": {"required_min": 0, "required_max": 3},
                },
                "options": {
                    "resolution": {"type": "enum", "allowed": ["480p", "720p"], "default": "720p"},
                    "duration": {"type": "int_range", "min": 4, "max": 15, "required": True},
                },
            },
        }
    )

    assert support["studio_exposed"] is True
    assert support["studio_support_status"] == "fully_supported"
    assert support["studio_support_summary"] == "Studio can use the dedicated Seedance frame and reference composer for this contract."


def test_kling_turbo_i2v_contract_with_unknown_image_max_is_exposed() -> None:
    support = derive_studio_model_support(
        {
            "key": "kling-3.0-turbo-i2v",
            "input_patterns": ["single_image", "first_last_frames"],
            "raw": {
                "inputs": {
                    "image": {"required_min": 1},
                    "video": {"required_min": 0, "required_max": 0},
                    "audio": {"required_min": 0, "required_max": 0},
                },
                "options": {
                    "duration": {"type": "int_range", "min": 3, "max": 15, "default": 5, "required": True},
                    "resolution": {"type": "enum", "allowed": ["720p", "1080p"], "default": "720p", "required": True},
                },
            },
        }
    )

    assert support["studio_exposed"] is True
    assert support["studio_support_status"] == "fully_supported"
    assert support["studio_support_summary"] == "Studio can render the standard single-image slot for this model."
