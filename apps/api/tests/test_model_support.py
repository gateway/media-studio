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
