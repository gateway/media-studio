from __future__ import annotations

import time

import pytest

from app.graph.storyboard_metadata_preflight import (
    storyboard_camera_contract_missing,
    validate_storyboard_metadata_preflight,
)


def _submitted_prompt(*, panel_count: int = 6, overrides: dict[tuple[int, str], str | None] | None = None) -> str:
    overrides = overrides or {}
    panels: list[str] = []
    for panel_number in range(1, panel_count + 1):
        values: dict[str, str | None] = {
            "SHOT": f"{panel_number:02d} CONTINUITY BEAT",
            "CAMERA": "Eye-level 50mm track; medium-wide subject placement",
            "ACTION": f"The subject completes user-authored beat {panel_number}",
            "MOTION": "Measured subject and camera movement",
            "DIALOG": "",
            "NOTES": "Preserve the established location and prop state",
        }
        for (target_panel, label), value in overrides.items():
            if target_panel == panel_number:
                values[label] = value
        rows = [
            f"{label}: {value}".rstrip()
            for label, value in values.items()
            if value is not None
        ]
        panels.append(f"{panel_number:02d}: " + "; ".join(rows))
    return (
        "Create one complete storyboard production sheet. "
        "Panel plan with metadata rows: "
        + " | ".join(panels)
        + "\n\nContinuity: preserve user-authored story order."
    )


def test_preflight_accepts_complete_rows_and_blank_dialogue() -> None:
    result = validate_storyboard_metadata_preflight(
        model_key="gpt-image-2-image-to-image",
        original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
        submitted_prompt=_submitted_prompt(),
    )

    assert result is not None
    assert result.panel_count == 6


@pytest.mark.parametrize("movement", ["pullback", "pushin", "pull-back", "push-in"])
def test_camera_contract_recognizes_compound_movement_terms(movement: str) -> None:
    assert storyboard_camera_contract_missing(
        f"Rear three-quarter angle, gentle {movement}, natural 35mm lens"
    ) == ()


@pytest.mark.parametrize("label", ["SHOT", "CAMERA", "ACTION", "MOTION", "NOTES"])
def test_preflight_rejects_empty_required_metadata_values(label: str) -> None:
    with pytest.raises(ValueError, match=rf"Panel 05 {label} is empty"):
        validate_storyboard_metadata_preflight(
            model_key="gpt-image-2-image-to-image",
            original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
            submitted_prompt=_submitted_prompt(overrides={(5, label): ""}),
        )


def test_preflight_rejects_missing_rows_and_placeholder_values() -> None:
    with pytest.raises(ValueError, match=r"Panel 03 MOTION row count is 0; expected 1"):
        validate_storyboard_metadata_preflight(
            model_key="gpt-image-2-image-to-image",
            original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
            submitted_prompt=_submitted_prompt(overrides={(3, "MOTION"): None}),
        )


def test_preflight_rejects_placeholder_values() -> None:
    with pytest.raises(ValueError, match=r"Panel 04 NOTES uses placeholder value 'N/A'"):
        validate_storyboard_metadata_preflight(
            model_key="gpt-image-2-image-to-image",
            original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
            submitted_prompt=_submitted_prompt(overrides={(4, "NOTES"): "N/A"}),
        )


@pytest.mark.parametrize(
    ("left", "right", "left_value", "right_value"),
    [
        (
            "ACTION",
            "MOTION",
            "The operator crosses the marked threshold toward the relay chamber",
            "The operator crosses the marked threshold toward the relay chamber",
        ),
        (
            "MOTION",
            "NOTES",
            "Indicator lights settle while the camera advances through the chamber",
            "Indicator lights settle while the camera advances through the chamber slowly",
        ),
    ],
)
def test_preflight_rejects_duplicate_or_substantially_overlapping_narrative_rows(
    left: str,
    right: str,
    left_value: str,
    right_value: str,
) -> None:
    with pytest.raises(
        ValueError,
        match=rf"Panel 03 {left} and {right} duplicate the same production meaning",
    ):
        validate_storyboard_metadata_preflight(
            model_key="gpt-image-2-image-to-image",
            original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
            submitted_prompt=_submitted_prompt(
                overrides={(3, left): left_value, (3, right): right_value}
            ),
        )


@pytest.mark.parametrize(
    "value",
    [
        "02 —.",
        "02",
        "SHOT 02",
        "—",
    ],
)
def test_preflight_rejects_shot_rows_without_a_meaningful_title(value: str) -> None:
    with pytest.raises(ValueError, match=r"Panel 02 SHOT must include a meaningful description"):
        validate_storyboard_metadata_preflight(
            model_key="gpt-image-2-image-to-image",
            original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
            submitted_prompt=_submitted_prompt(overrides={(2, "SHOT"): value}),
        )


@pytest.mark.parametrize(
    ("label", "value"),
    [
        ("ACTION", "The relay opening is."),
        ("ACTION", "The operator places the calibrated relay within the engineer's."),
        ("MOTION", "The operator begins."),
        ("MOTION", "Her mechanical fingertips."),
        ("NOTES", "Only the clean."),
        ("NOTES", "The same panel now."),
        ("NOTES", "The replacement becomes."),
        ("NOTES", "The same panel now visibly."),
        ("NOTES", "Both fixed chairs."),
        ("NOTES", "Final handoff —."),
        ("ACTION", "The service panel fully open."),
        ("ACTION", "The pilot closes."),
        ("ACTION", "Seated in the pilot chair."),
        ("MOTION", "The ship climbs forward along."),
        ("NOTES", "The service panel fully."),
        ("NOTES", "Lift visibility lock: show."),
        ("NOTES", "Final payoff: preserve."),
        ("ACTION", "BURNT-OUT CAPACITOR."),
        ("ACTION", "Holding the manifest tablet at her side."),
        ("ACTION", "The pilot closes; The final operators clear the marked route."),
        ("NOTES", "The pilot follows the status-light sequence until."),
        ("ACTION", "The pilot's mechanical hand grips;"),
        ("ACTION", "The pilot locks the retaining clips around;"),
        ("MOTION", "Boots contact successive."),
        ("MOTION", "Boots contact successive ramp."),
        ("MOTION", "The cracked floor, painted markings."),
        ("MOTION", "A diagnostic light."),
        ("ACTION", "The pilot physically climbs the already-open starboard."),
        ("ACTION", "The pilot locks the retaining clips around the clean."),
        ("NOTES", "Preserve Board 2’s exact repaired."),
        ("ACTION", "Clearly show the companion’s."),
        ("MOTION", "Clearly show the companion’."),
        ("NOTES", "The cracked landing floor."),
        ("NOTES", "Final-board payoff: preserve the exact."),
    ],
)
def test_preflight_rejects_semantic_metadata_fragments(label: str, value: str) -> None:
    with pytest.raises(ValueError, match=rf"Panel 04 {label} is not a complete semantic value"):
        validate_storyboard_metadata_preflight(
            model_key="gpt-image-2-image-to-image",
            original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
            submitted_prompt=_submitted_prompt(overrides={(4, label): value}),
        )


@pytest.mark.parametrize(
    ("label", "value"),
    [
        ("ACTION", "Door closes."),
        ("MOTION", "Indicators stabilize."),
        ("NOTES", "AMBER CUE."),
    ],
)
def test_preflight_accepts_concise_complete_metadata(label: str, value: str) -> None:
    result = validate_storyboard_metadata_preflight(
        model_key="gpt-image-2-image-to-image",
        original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
        submitted_prompt=_submitted_prompt(overrides={(4, label): value}),
    )

    assert result is not None


@pytest.mark.parametrize(
    "value",
    [
        "Live-action cinema camera.",
        "Close-up production view.",
        "Low side angle with subject placement.",
    ],
)
def test_preflight_rejects_camera_rows_without_angle_movement_and_lens(value: str) -> None:
    with pytest.raises(ValueError, match=r"Panel 04 CAMERA must include angle, movement, and lens direction"):
        validate_storyboard_metadata_preflight(
            model_key="gpt-image-2-image-to-image",
            original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
            submitted_prompt=_submitted_prompt(overrides={(4, "CAMERA"): value}),
        )


def test_preflight_uses_requested_panel_count_without_hardcoding_six() -> None:
    result = validate_storyboard_metadata_preflight(
        model_key="gpt-image-2-image-to-image",
        original_prompt="PANEL COUNT: 4\nCreate a storyboard production sheet.",
        submitted_prompt=_submitted_prompt(panel_count=4),
    )

    assert result is not None
    assert result.panel_count == 4


def test_preflight_derives_panel_count_from_numbered_panels_when_count_is_omitted() -> None:
    original_prompt = "Create a storyboard production sheet.\n" + "\n".join(
        f"PANEL {panel:02d}: user-authored beat" for panel in range(1, 13)
    )

    result = validate_storyboard_metadata_preflight(
        model_key="gpt-image-2-image-to-image",
        original_prompt=original_prompt,
        submitted_prompt=_submitted_prompt(panel_count=12),
    )

    assert result is not None
    assert result.panel_count == 12


def test_preflight_ignores_non_storyboard_and_non_gpt_image_2_prompts() -> None:
    assert validate_storyboard_metadata_preflight(
        model_key="gpt-image-2-text-to-image",
        original_prompt="Create one cinematic portrait in a quiet room.",
        submitted_prompt="Create one cinematic portrait in a quiet room.",
    ) is None
    assert validate_storyboard_metadata_preflight(
        model_key="nano-banana-pro",
        original_prompt="PANEL COUNT: 6\nCreate a storyboard production sheet.",
        submitted_prompt=_submitted_prompt(),
    ) is None


def test_preflight_skips_typed_text_free_storyboard_art_sources() -> None:
    prompt = (
        "Storyboard art source contract: storyboard_art_grid_v1. "
        "Create one text-free 4:3 source plate with exactly six equal cinematic frames in a "
        "2-column by 3-row source grid. Show art only: no titles, words, letters, numbers, "
        "captions, metadata, borders, dashboards, or production-sheet chrome.\n\n"
        + "\n".join(
            f"Cell {panel:02d}: The subject completes distinct visual beat {panel}."
            for panel in range(1, 7)
        )
    )

    assert validate_storyboard_metadata_preflight(
        model_key="gpt-image-2-image-to-image",
        original_prompt=prompt,
        submitted_prompt=prompt,
    ) is None


def test_preflight_does_not_require_the_literal_storyboard_word_when_structure_is_explicit() -> None:
    result = validate_storyboard_metadata_preflight(
        model_key="gpt-image-2-image-to-image",
        original_prompt=_submitted_prompt().replace("storyboard ", ""),
        submitted_prompt=_submitted_prompt(),
    )

    assert result is not None
    assert result.panel_count == 6


def test_graph_preflight_fails_before_provider_submission(client, monkeypatch) -> None:
    submitted = False

    def fail_submit(*_args, **_kwargs):
        nonlocal submitted
        submitted = True
        raise AssertionError("metadata preflight must stop before provider submission")

    monkeypatch.setattr("app.graph.executors.kie_model.service.submit_jobs", fail_submit)
    workflow = {
        "schema_version": 1,
        "name": "Storyboard metadata preflight",
        "nodes": [
            {"id": "prompt", "type": "prompt.text", "position": {"x": 0, "y": 0}, "fields": {"text": _submitted_prompt(overrides={(5, "ACTION"): ""})}},
            {"id": "model", "type": "model.kie.gpt_image_2_text_to_image", "position": {"x": 360, "y": 0}, "fields": {}},
            {"id": "preview", "type": "preview.image", "position": {"x": 720, "y": 0}, "fields": {}},
        ],
        "edges": [
            {"id": "edge-prompt-model", "source": "prompt", "source_port": "text", "target": "model", "target_port": "prompt"},
            {"id": "edge-model-preview", "source": "model", "source_port": "image", "target": "preview", "target_port": "image"},
        ],
    }
    created = client.post("/media/graph/workflows", json=workflow)
    assert created.status_code == 200, created.text
    started = client.post(f"/media/graph/workflows/{created.json()['workflow_id']}/runs", json={})
    assert started.status_code == 200, started.text
    for _ in range(100):
        final_payload = client.get(f"/media/graph/runs/{started.json()['run_id']}").json()
        if final_payload["status"] in {"completed", "failed"}:
            break
        time.sleep(0.05)

    assert final_payload["status"] == "failed"
    assert "Panel 05 ACTION is empty" in final_payload.get("error", "")
    assert submitted is False
