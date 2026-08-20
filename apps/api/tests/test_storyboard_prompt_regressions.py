from __future__ import annotations

import pytest

from app.graph.executors.prompt_ops import (
    _storyboard_apply_missing_requested_dialogue,
    _compact_storyboard_generated_display_rows,
    _sanitize_storyboard_v2_prompt_text,
)
from app.graph.prompt_shaping import (
    _fit_panel_capsule,
    compact_storyboard_display_value,
    shape_kie_graph_prompt,
)
from app.graph.storyboard_metadata_preflight import (
    parse_storyboard_metadata_panels,
    storyboard_camera_contract_missing,
    storyboard_metadata_value_is_semantic_fragment,
    validate_storyboard_metadata_rows,
)


def test_storyboard_v2_prompt_sanitizer_does_not_treat_sheet_as_a_private_name() -> None:
    raw_text = (
        "Create one complete 16:9 Storyboard v2 production sheet.\n"
        "REQUIREMENTS FOR SHEET\n"
        "PANEL 01 IMAGE:\n"
        "SHOT: 01 ARRIVAL\nCAMERA: wide\nFRAMING: full figure\n"
        "ACTION: The courier arrives\nMOTION: measured walk\nDIALOG:\nNOTES: preserve location"
    )
    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "Create a reusable relay storyboard without visible private names.",
            "previous_output": "",
            "style_direction": "photoreal live-action feature-film stills",
        },
    )
    assert "production sheet" in sanitized
    assert "REQUIREMENTS FOR SHEET" in sanitized
    assert "production the character" not in sanitized


def test_storyboard_v2_prompt_sanitizer_applies_only_user_owned_panel_notes_cues() -> None:
    panels = "\n\n".join(
        f"PANEL {number:02d} IMAGE:\n"
        f"SHOT: {number:02d} — RELAY BEAT\n"
        "CAMERA: Eye-level dolly push, 35mm lens; medium shot, subject centered\n"
        f"ACTION: The subject checks relay marker {number}.\n"
        f"MOTION: The camera advances as dust crosses marker {number}.\n"
        "DIALOG: \n"
        "NOTES: "
        for number in range(1, 7)
    )
    notes = "\n".join(
        f"PANEL {number:02d} — Preserve user-owned continuity state {number}."
        for number in range(1, 7)
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        f"BOARD TITLE: BOARD 1 OF 1 — RELAY\n{panels}",
        {
            "user_prompt": "Create six sequential relay beats.",
            "panel_notes_cues": notes,
        },
    )

    for number in range(1, 7):
        assert f"NOTES: Preserve user-owned continuity state {number}." in sanitized
    assert sanitized.count("NOTES:") == 6


def test_storyboard_v2_prompt_sanitizer_applies_inline_panel_notes_cues() -> None:
    panels = "\n\n".join(
        f"PANEL {number:02d} IMAGE:\n"
        f"SHOT: {number:02d} — RELAY BEAT\n"
        "CAMERA: Eye-level three-quarter angle, static frame, natural 50mm lens\n"
        f"ACTION: The subject completes relay beat {number}.\n"
        "MOTION: Indicator lights settle.\n"
        "DIALOG: \n"
        "NOTES: Generated note that must be replaced."
        for number in range(1, 7)
    )
    inline_notes = " ".join(
        f"PANEL {number:02d} — Preserve exact inline continuity state {number}."
        for number in range(1, 7)
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        f"BOARD TITLE: BOARD 1 OF 1 — RELAY\n{panels}",
        {
            "user_prompt": "Create six sequential relay beats.",
            "panel_notes_cues": inline_notes,
        },
    )

    for number in range(1, 7):
        assert f"NOTES: Preserve exact inline continuity state {number}." in sanitized
    assert "Generated note that must be replaced." not in sanitized


def test_storyboard_v2_prompt_sanitizer_fills_empty_generated_notes_row() -> None:
    panels = "\n\n".join(
        f"PANEL {number:02d} IMAGE:\n"
        f"SHOT: {number:02d} — RELAY BEAT\n"
        "CAMERA: Eye-level dolly push, 35mm lens; medium shot, subject centered\n"
        f"ACTION: The subject advances relay beat {number}.\n"
        f"MOTION: Camera drift follows the subject through beat {number}.\n"
        "DIALOG: \n"
        + ("NOTES: " if number == 2 else f"NOTES: Preserve relay continuity state {number}.")
        for number in range(1, 7)
    )
    raw_text = (
        "BOARD TITLE: BOARD 1 OF 1 — RELAY\n"
        "PRODUCTION METADATA: PROJECT: RELAY; SEQUENCE: TEST; LOCATION: Gate; DATE: Day; ARTIST: Media Studio\n\n"
        f"{panels}\n\n"
        'DIALOGUE CUES: Use exact lines: "First exact line." and "Second exact line."'
    )

    sanitized = _sanitize_storyboard_v2_prompt_text(
        raw_text,
        {
            "user_prompt": "Create six sequential relay beats.",
            "panel_notes_cues": "",
        },
    )

    parsed = parse_storyboard_metadata_panels(sanitized)
    panel_two = dict(parsed)[2]
    assert panel_two["NOTES"] == "Preserve reference continuity and readable production details for beat 2."
    validate_storyboard_metadata_rows(sanitized, expected_count=6)


def test_storyboard_requested_dialogue_fallback_inserts_exact_missing_quote() -> None:
    panels = "\n\n".join(
        f"PANEL {number:02d} IMAGE:\n"
        f"SHOT: {number:02d} — RELAY BEAT\n"
        "CAMERA: Eye-level dolly push, 35mm lens; medium shot, subject centered\n"
        f"ACTION: The subject advances relay beat {number}.\n"
        f"MOTION: Camera drift follows the subject through beat {number}.\n"
        + ("DIALOG: \"First exact line.\"\n" if number == 1 else "DIALOG: \n")
        + f"NOTES: Preserve relay continuity state {number}."
        for number in range(1, 7)
    )
    raw_text = (
        "BOARD TITLE: BOARD 1 OF 1 — RELAY\n"
        "PRODUCTION METADATA: PROJECT: RELAY; SEQUENCE: TEST; LOCATION: Gate; DATE: Day; ARTIST: Media Studio\n\n"
        f"{panels}"
    )

    updated = _storyboard_apply_missing_requested_dialogue(
        raw_text,
        {"dialogue_cues": 'Use exact lines: "First exact line." and "Second exact line."'},
    )

    assert '"Second exact line."' in updated
    parsed = parse_storyboard_metadata_panels(updated)
    assert any("Second exact line." in fields["DIALOG"] for _, fields in parsed)
    validate_storyboard_metadata_rows(updated, expected_count=6)


def test_gpt_image_2_graph_prompt_shaper_recognizes_uppercase_panel_image_headings() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d} IMAGE:\n"
        f"SHOT: {index:02d} RELAY BEAT\n"
        "CAMERA: shoulder-height three-quarter production angle\n"
        "FRAMING: courier and relay platform remain readable\n"
        f"ACTION: The courier advances relay beat {index}\n"
        "MOTION: measured movement through the fixed location\n"
        + ("DIALOG: COURIER [quiet voice] — \"Signal received.\"\n" if index == 5 else "DIALOG: \n")
        + "NOTES: preserve the current causal state"
        for index in range(1, 7)
    )
    prompt = (
        "Create one complete 16:9 Storyboard v2 production sheet.\n\n"
        "PANEL COUNT: 6\nGRID: 3 columns x 2 rows\n\n"
        "Use @image1 for identity, @image2 for location continuity, and @image3 for the prior ending.\n\n"
        "WARDROBE CUES: weatherproof indigo courier coat with a closed high collar.\n"
        "SUBJECT DESIGN CUES: compact four-legged brass relay animal with folding antennae.\n\n"
        f"{panels}\n\n"
        + "Keep the same fixed production-board design. " * 120
    )
    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    )
    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert result.final_chars <= 4200
    assert "Signal received." in result.prompt
    assert "four-legged brass relay animal" in result.prompt
    for label in ("SHOT:", "CAMERA:", "ACTION:", "MOTION:", "DIALOG:", "NOTES:"):
        assert result.prompt.count(label) == 6
    assert "FRAMING:" not in result.prompt
    camera_values = [
        panel.split("CAMERA:", 1)[1].split("; ACTION:", 1)[0]
        for panel in result.prompt.split("Panel plan with metadata rows: ", 1)[1].split("\n\nContinuity:", 1)[0].split(" | ")
    ]
    assert all("shoulder-height three-quarter production angle" in value.lower() for value in camera_values)
    assert all("courier and relay platform remain readable" in value.lower() for value in camera_values)
    assert all(";" in value for value in camera_values)


@pytest.mark.parametrize(
    ("panel_count", "grid_layout"),
    ((4, "2x2"), (6, "3x2"), (9, "3x3")),
)
def test_gpt_image_2_storyboard_compactor_uses_requested_panel_layout(
    panel_count: int,
    grid_layout: str,
) -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d} IMAGE:\n"
        f"SHOT: {index:02d} BEACH BEAT\n"
        "CAMERA: eye-level static 35mm lens\n"
        f"ACTION: The cleanup robot completes beach beat {index}.\n"
        f"MOTION: Loose debris moves into the collector during beat {index}.\n"
        "DIALOG: \n"
        f"NOTES: Preserve robot and shoreline continuity for beat {index}."
        for index in range(1, panel_count + 1)
    )
    prompt = (
        "Create one complete 16:9 Storyboard v2 production sheet.\n\n"
        f"SHOT COUNT: {panel_count}\n\n"
        f"{panels}\n\n"
        + "Preserve the fixed production-board design and chronological sequence. " * 120
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image",
        prompt,
        task_mode="image_edit",
        max_chars=20000,
    )

    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert f"Every one of the {panel_count} cells" in result.prompt
    assert f"exact {grid_layout} grid" in result.prompt
    assert result.prompt.count("SHOT:") == panel_count
    assert result.prompt.count("CAMERA:") == panel_count
    validate_storyboard_metadata_rows(result.prompt, expected_count=panel_count)


def test_gpt_image_2_storyboard_compactor_infers_layout_from_generated_panel_blocks() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d}\n\n"
        f"SHOT {index:02d} — BEACH BEAT\n\n"
        "Image: The exact cleanup robot clears polluted wet sand.\n\n"
        "CAMERA: eye-level static 35mm lens.\n"
        f"ACTION: The cleanup robot completes beach beat {index}.\n"
        f"MOTION: Loose debris moves into the collector during beat {index}.\n"
        "DIALOG:\n"
        f"NOTES: Preserve robot and shoreline continuity for beat {index}."
        for index in range(1, 5)
    )
    prompt = (
        "Create one 4K, footer-free, 16:9 cinematic production storyboard sheet titled exactly:\n\n"
        "EARTH GAMES — BEACH RESTORATION — 4 SHOTS\n\n"
        "Use one chronological 2x2 grid with exactly four equal panels.\n\n"
        f"{panels}\n\n"
        "BOARD TITLE: EARTH GAMES — BEACH RESTORATION — 4 SHOTS\n"
        "PRODUCTION METADATA: PROJECT: EARTH GAMES; SHOTS: 4; LOCATION: TROPICAL BEACH\n"
        + "Preserve the fixed production-board design and chronological sequence. " * 120
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image",
        prompt,
        task_mode="image_edit",
        max_chars=20000,
    )

    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert "Every one of the 4 cells" in result.prompt
    assert "exact 2x2 grid" in result.prompt
    assert result.prompt.count("SHOT:") == 4
    assert result.prompt.count("CAMERA:") == 4
    validate_storyboard_metadata_rows(result.prompt, expected_count=4)


def test_gpt_image_2_storyboard_compactor_preserves_missing_notes_for_fail_closed_preflight() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d} IMAGE:\n"
        f"SHOT: {index:02d} RELAY INSPECTION\n"
        "CAMERA: over-shoulder 50mm slow push-in\n"
        "FRAMING: medium-wide two-subject composition with the courier foreground-left and relay animal readable\n"
        "ACTION: The courier inspects the sealed relay housing and verifies the stable green indicator before moving to the next station.\n"
        "MOTION: The camera advances slowly while the relay animal's folding antennae track the indicator.\n"
        + (
            'DIALOG: COURIER [calm voice] — "The relay is ready for the crossing."\n'
            if index == 5
            else "DIALOG: \n"
        )
        + "NOTES: \n"
        for index in range(1, 7)
    )
    prompt = (
        "Create one complete 16:9 Storyboard v2 production sheet.\n\n"
        "PANEL COUNT: 6\nGRID: 3 columns x 2 rows\n\n"
        "Use @image1 for identity and @image2 for location continuity.\n\n"
        f"{panels}\n\n"
        + "Preserve the same fixed production-board design and causal order. " * 120
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    )

    assert result.strategy == "gpt_image_2_storyboard_compact"
    assert result.final_chars <= 4200
    assert result.prompt.count("CAMERA:") == 6
    assert "FRAMING:" not in result.prompt
    assert result.prompt.count('COURIER [calm voice] — "The relay is ready for the crossing."') == 1
    assert '"The relay is ready for the crossing.".' not in result.prompt
    with pytest.raises(ValueError, match=r"Panel 01 NOTES is empty"):
        validate_storyboard_metadata_rows(result.prompt, expected_count=6)


def test_gpt_image_2_storyboard_compactor_does_not_copy_adjacent_required_rows() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d} IMAGE:\n"
        f"SHOT: {index:02d} RELAY BEAT\n"
        "CAMERA: eye-level 50mm tracking view\n"
        "ACTION: \n"
        f"MOTION: The courier turns toward relay indicator {index} as its green light settles.\n"
        "DIALOG: \n"
        "NOTES: \n"
        for index in range(1, 7)
    )
    prompt = (
        "Create one complete 16:9 Storyboard v2 production sheet.\n"
        "SUBJECT DESIGN CUES: Compact four-legged brass relay animal. They.\n\n"
        f"{panels}\n\n"
        + "Preserve the fixed production-board design. " * 120
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    )

    panel_plan = result.prompt.split("Panel plan with metadata rows: ", 1)[1].split("\n\nContinuity:", 1)[0]
    for panel in panel_plan.split(" | "):
        action = panel.split("ACTION:", 1)[1].split("; MOTION:", 1)[0].strip()
        notes = panel.split("NOTES:", 1)[1].strip()
        assert action == ""
        assert notes == ""
    assert "They." not in result.prompt
    with pytest.raises(ValueError, match=r"Panel 01 ACTION is empty"):
        validate_storyboard_metadata_rows(result.prompt, expected_count=6)


def test_gpt_image_2_storyboard_compactor_reserves_notes_for_dialogue_heavy_panel() -> None:
    panels = "\n\n".join(
        f"PANEL {index:02d} IMAGE:\n"
        f"SHOT: {index:02d} RELAY SERVICE\n"
        "CAMERA: Cinema camera, low over-panel three-quarter angle, controlled locked-off frame, tactile 55mm lens feel; close framing on the operator, retaining clips, component, and open service cradle\n"
        "ACTION: The operator releases both retaining clips in sequence, grips the worn component, and removes the failed unit cleanly from its cradle while the clean replacement remains presented nearby\n"
        "MOTION: First clip snaps free, second clip releases, then the failed component slides straight outward into the operator's mechanical hand with a small fall of harmless residue\n"
        + (
            'DIALOG: OPERATOR [wry amused voice] — "That explains the diagnostic warning."\n'
            if index == 4
            else "DIALOG: \n"
        )
        + "NOTES: Show the complete removal action and newly empty cradle; preserve the same location, component state, and speaker assignment\n"
        for index in range(1, 7)
    )
    prompt = (
        "Create one complete 16:9 Storyboard v2 production sheet.\n"
        "PANEL COUNT: 6\n"
        "BOARD TITLE: BOARD 2 OF 3 — RELAY REPAIR\n"
        "PRODUCTION METADATA: PROJECT: GENERIC RELAY; SEQUENCE: BOARD 2 OF 3; LOCATION: SERVICE BAY\n"
        "WARDROBE CUES: Sealed high-collar utility coverall with consistent materials and silhouette.\n"
        "SUBJECT DESIGN CUES: Compact utility robot remains visually distinct from the operator.\n\n"
        f"{panels}\n\n"
        + "Preserve the fixed production-board design, causal order, and exact environment geography. " * 120
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    )

    assert result.strategy == "gpt_image_2_storyboard_compact"
    validate_storyboard_metadata_rows(result.prompt, expected_count=6)
    assert "ACTION: BURNT-OUT CAPACITOR." not in result.prompt
    assert "ACTION: BOTH SECURED." not in result.prompt
    panel_four = result.prompt.split(" | ")[3]
    assert 'OPERATOR [wry amused voice] — "That explains the diagnostic warning."' in panel_four
    assert panel_four.split("NOTES:", 1)[1].strip()


def test_storyboard_panel_budget_never_starves_required_notes_after_exact_dialogue() -> None:
    capsule = (
        "04: SHOT: 04 — FAILED UNIT OUT; "
        "CAMERA: Cinema camera, low over-panel close angle, controlled locked-off frame, tactile 55mm lens feel; close framing on the operator, retaining clips, worn component, and open service cradle; "
        "ACTION: The operator releases both retaining clips in sequence, grips the worn component, and removes the failed unit cleanly from its cradle while the replacement remains presented nearby; "
        "MOTION: First clip snaps free, second clip releases, then the failed component slides straight outward into the operator's mechanical hand with a small fall of harmless residue; "
        'DIALOG: OPERATOR [wry amused voice] — "That explains the diagnostic warning."; '
        "NOTES: Show the complete removal action and newly empty cradle; preserve the same location, component state, and speaker assignment"
    )

    fitted = _fit_panel_capsule(capsule, max_chars=360)

    assert 'DIALOG: OPERATOR [wry amused voice] — "That explains the diagnostic warning."' in fitted
    assert fitted.split("NOTES:", 1)[1].strip()


def test_short_storyboard_prompt_keeps_fragments_visible_for_fail_closed_preflight() -> None:
    fragments = {
        1: ("The relay opening is.", "The operator begins.", "Preserve the repaired."),
        2: ("From the service doorway.", "The indicator settles steadily.", "Only the clean."),
        3: ("Preflight displays.", "The camera eases forward.", "Make the relay."),
        4: ("The operator secures both retaining clips.", "The component locks firmly.", "Show the complete."),
        5: ("The operator verifies the stable indicator.", "The camera holds steady.", "End with the repaired."),
        6: ("The vehicle clears the threshold.", "The vehicle glides forward.", "Final handoff —."),
    }
    panels = []
    for index in range(1, 7):
        action, motion, notes = fragments[index]
        dialogue = 'OPERATOR [calm voice] — "Relay secure."' if index == 4 else ""
        panels.append(
            f"{index:02d}: SHOT: {index:02d} — RELAY BEAT; "
            "CAMERA: Eye-level 50mm track; medium-wide operator placement; "
            f"ACTION: {action}; MOTION: {motion}; DIALOG: {dialogue}; NOTES: {notes}"
        )
    prompt = (
        "Create one complete storyboard production sheet. PANEL COUNT: 6. "
        "Panel plan with metadata rows: "
        + " | ".join(panels)
        + "\n\nContinuity: preserve user-authored story order."
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    )

    assert result.strategy == "gpt_image_2_storyboard_metadata_normalized"
    with pytest.raises(ValueError, match=r"Panel 01 (?:ACTION|MOTION|NOTES) is not a complete semantic value"):
        validate_storyboard_metadata_rows(result.prompt, expected_count=6)
    assert result.prompt.count('OPERATOR [calm voice] — "Relay secure."') == 1


def test_storyboard_compactor_leaves_provider_bound_grammar_tails_for_preflight_rejection() -> None:
    fragments = {
        1: ("The service panel fully open.", "The latch rotates.", "The service panel fully."),
        2: ("The pilot closes.", "The panel settles flush.", "The latch locks."),
        3: ("Seated in the pilot chair.", "The buckle clicks.", "Both occupants are secured."),
        4: ("The vehicle rises.", "The ship climbs forward along.", "Lift visibility lock: show."),
        5: ("The vehicle clears the threshold.", "The vehicle glides forward.", "Final payoff: preserve."),
        6: ("The operator checks the stable indicator.", "The camera holds steady.", "The handoff is stable."),
    }
    panels = [
        (
            f"{index:02d}: SHOT: {index:02d} — CONTINUITY BEAT; "
            "CAMERA: Eye-level 50mm track; "
            f"ACTION: {action}; MOTION: {motion}; DIALOG:; NOTES: {notes}"
        )
        for index, (action, motion, notes) in fragments.items()
    ]
    prompt = (
        "Create one complete storyboard production sheet. PANEL COUNT: 6. "
        "Panel plan with metadata rows: "
        + " | ".join(panels)
        + "\n\nContinuity: preserve user-authored story order."
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    )

    with pytest.raises(ValueError, match=r"Panel 01 ACTION (?:is empty|is not a complete semantic value)"):
        validate_storyboard_metadata_rows(result.prompt, expected_count=6)


def test_action_compaction_preserves_object_after_spatial_before() -> None:
    capsule = (
        "01: SHOT: 01 — BEFORE THE LATCH; "
        "CAMERA: Cinema camera, starboard-aft three-quarter angle, nearly locked-off micro push; "
        "ACTION: The operator stands before the amber-lit service panel with one mechanical hand poised beside the latch while service units continue along a distant loading route; "
        "MOTION: Near-still suspense with minimal camera creep; DIALOG:; "
        "NOTES: The amber-lit service panel remains closed and flush"
    )

    fitted = _fit_panel_capsule(capsule, max_chars=285)

    validate_storyboard_metadata_rows(
        "Panel plan with metadata rows: " + fitted,
        expected_count=1,
    )
    assert "stands before the amber-lit service panel" in fitted


def test_raw_storyboard_compaction_keeps_complete_clause_ending_in_it() -> None:
    panels = []
    for index in range(1, 7):
        action = (
            "The operator stops directly before the closed amber relay panel and raises one mechanical hand beside the latch, poised to inspect it without touching or opening it; "
            "one service unit crosses the separate loading route while another follows"
            if index == 6
            else f"The operator completes calibration beat {index}"
        )
        panels.append(
            f"PANEL {index:02d}\n"
            f"SHOT: {index:02d} — CALIBRATION BEAT\n"
            "CAMERA: Cinema camera, shoulder-height three-quarter angle, controlled 50mm push\n"
            f"ACTION: {action}\n"
            "MOTION: The camera settles while the indicator remains steady\n"
            "DIALOG:\n"
            "NOTES: Preserve the current relay state\n"
        )
    prompt = (
        "Create one complete footer-free 16:9 Storyboard v2 production sheet.\n"
        "PANEL COUNT: 6\n"
        + "\n".join(panels)
        + ("\nPreserve the fixed production-board design and user-owned story order." * 120)
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    )

    validate_storyboard_metadata_rows(result.prompt, expected_count=6)
    panel_six = result.prompt.split(" | 06:", 1)[1]
    assert "before the closed amber relay panel" in panel_six
    assert "poised to inspect it" in panel_six


def test_storyboard_compactor_repairs_possessive_and_unresolved_predicate_tails() -> None:
    panels = []
    for index in range(1, 7):
        dialogue = (
            'SERVICE UNIT [dry synthetic voice] — "Calibration ready. Judgment withheld."'
            if index == 3
            else ""
        )
        panels.append(
            f"PANEL {index:02d} IMAGE:\n"
            f"SHOT: {index:02d} — CALIBRATION BEAT\n"
            "CAMERA: Cinema camera, low service-bay side angle, gentle lateral slide, natural 40mm lens feel; medium two-subject composition with the service unit foreground-right and engineer beside the open relay housing left-center\n"
            "ACTION: A nearby compact utility service unit extends one clean matching calibration module on a small presentation tray within the engineer's reach while the engineer compares it with the still-installed worn unit\n"
            "MOTION: The service unit's tray rises and steadies as the engineer turns toward the clean replacement and the status lights settle\n"
            f"DIALOG: {dialogue}\n"
            "NOTES: The replacement becomes visible and reachable here but is not yet installed; preserve the established housing and access route\n"
        )
    prompt = (
        "Create one complete 16:9 Storyboard v2 production sheet.\n"
        "PANEL COUNT: 6\n"
        "BOARD TITLE: BOARD 2 OF 3 — CALIBRATION\n"
        "PRODUCTION METADATA: PROJECT: GENERIC RELAY; SEQUENCE: BOARD 2 OF 3; LOCATION: SERVICE BAY\n\n"
        + "\n".join(panels)
        + "\nPreserve the fixed production-board design, causal order, and exact environment geography. " * 120
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    )

    assert result.strategy == "gpt_image_2_storyboard_compact"
    validate_storyboard_metadata_rows(result.prompt, expected_count=6)
    assert "within the engineer's." not in result.prompt
    assert "The replacement becomes." not in result.prompt
    assert result.prompt.count(
        'SERVICE UNIT [dry synthetic voice] — "Calibration ready. Judgment withheld."'
    ) == 1


def test_storyboard_capsule_preserves_camera_contract_but_does_not_cross_fill_tail_shapes() -> None:
    capsule = (
        "01: SHOT: 01 — RELAY CHECK; "
        "CAMERA: Live-action cinema camera, low service-bay side angle, controlled dolly push, tactile 55mm lens feel; "
        "ACTION: The operator's mechanical hand grips; "
        "MOTION: Boots contact successive.; DIALOG:; "
        "NOTES: The operator follows the status-light sequence until."
    )

    fitted = _fit_panel_capsule(capsule, max_chars=300)

    with pytest.raises(ValueError, match=r"Panel 01 ACTION is not a complete semantic value"):
        validate_storyboard_metadata_rows(
            "Panel plan with metadata rows: " + fitted,
            expected_count=1,
        )
    camera = fitted.split("CAMERA:", 1)[1].split("; ACTION:", 1)[0]
    assert "angle" in camera.lower()
    assert "push" in camera.lower()
    assert "55mm" in camera.lower()
    assert "mechanical hand grips" in fitted


def test_storyboard_camera_display_compaction_never_exceeds_row_budget() -> None:
    camera = (
        "Live-action cinema camera at a low three-quarter service-bay angle with a controlled dolly push "
        "and tactile 50mm lens feel; medium-wide environmental framing keeps the full subject, ship side, "
        "loading route, floor markings, gantries, and deep hangar geography simultaneously readable."
    )

    compacted = compact_storyboard_display_value("CAMERA", camera, 136)

    assert compacted
    assert len(compacted) <= 136
    assert not storyboard_camera_contract_missing(compacted)


@pytest.mark.parametrize(
    ("heading", "expected"),
    [
        ("01 — The pilot approaches from one ship-length away as", "01 — The pilot approaches from one ship-length away"),
        ("02 — At the staging lane, the pilot checks a", "02 — At the staging lane"),
        ("03 — The pilot crouches beside the landing strut and", "03 — The pilot crouches beside the landing strut"),
        ("05 — The pilot follows normal status lights until one", "05 — The pilot follows normal status lights"),
        ("06 — The pilot faces the closed amber panel with", "06 — The pilot faces the closed amber panel"),
    ],
)
def test_storyboard_shot_display_compaction_closes_dangling_headings(
    heading: str,
    expected: str,
) -> None:
    assert compact_storyboard_display_value("SHOT", heading, 64) == expected


def test_storyboard_action_display_compaction_keeps_a_complete_visible_clause() -> None:
    action = (
        "The pilot seats the clean replacement fully, locks its clips, and watches the indicators turn green "
        "while the service droid retracts its tray and the diagnostic display confirms stable output."
    )

    compacted = compact_storyboard_display_value("ACTION", action, 136)

    assert compacted
    assert len(compacted) <= 136
    assert not storyboard_metadata_value_is_semantic_fragment("ACTION", compacted)
    assert not compacted.rstrip(" .").endswith(("fully", "its", "the"))


def test_storyboard_motion_display_compaction_keeps_a_complete_visible_clause() -> None:
    motion = (
        "The latch rotates and starts to release as a service droid rolls through the deeper loading lane, "
        "the camera eases closer, and amber reflections travel across the closed metal surface toward the pilot."
    )

    compacted = compact_storyboard_display_value("MOTION", motion, 136)

    assert compacted
    assert len(compacted) <= 136
    assert not storyboard_metadata_value_is_semantic_fragment("MOTION", compacted)


def test_storyboard_motion_display_compaction_removes_only_a_dangling_tail() -> None:
    compacted = compact_storyboard_display_value(
        "MOTION",
        "The ship climbs forward along.",
        136,
    )

    assert compacted == "The ship climbs."
    assert not storyboard_metadata_value_is_semantic_fragment("MOTION", compacted)


def test_storyboard_semantic_guard_accepts_complete_long_clause_with_internal_comma() -> None:
    action = (
        "The operator reaches the cockpit doorway and sees the companion secured beside the empty, "
        "reachable pilot chair."
    )

    assert not storyboard_metadata_value_is_semantic_fragment("ACTION", action)


def test_storyboard_semantic_guard_accepts_complete_semicolon_motion_ending_nearby() -> None:
    motion = (
        "Both clips spring open; the failed unit slides free as the service unit holds the clean "
        "replacement steady nearby."
    )

    assert not storyboard_metadata_value_is_semantic_fragment("MOTION", motion)


def test_storyboard_semantic_guard_accepts_complete_motion_ending_object_pronoun() -> None:
    motion = (
        "Her steps carry her up the ramp and into the corridor while hangar light recedes behind her."
    )

    assert not storyboard_metadata_value_is_semantic_fragment("MOTION", motion)


def test_storyboard_semantic_guard_accepts_directional_motion_with_predicate() -> None:
    assert not storyboard_metadata_value_is_semantic_fragment(
        "MOTION",
        "The ship rises forward.",
    )


def test_storyboard_display_compaction_bounds_compact_panel_plan_camera_rows() -> None:
    camera = (
        "Live-action cinema camera at a low three-quarter service-bay angle with a controlled dolly push "
        "and tactile 50mm lens feel; medium-wide environmental framing keeps the full subject, ship side, "
        "loading route, floor markings, gantries, and deep hangar geography simultaneously readable."
    )
    capsules = " | ".join(
        f"{number:02d}: SHOT: {number:02d} — RELAY BEAT; CAMERA: {camera}; "
        f"ACTION: The subject checks relay marker {number}.; "
        "MOTION: Indicator lights settle.; DIALOG:; NOTES: Preserve continuity."
        for number in range(1, 7)
    )
    prompt = f"Panel plan with metadata rows: {capsules}\n\nContinuity: Preserve the fixed location."

    compacted = _compact_storyboard_generated_display_rows(prompt)
    panels = parse_storyboard_metadata_panels(compacted)

    assert len(panels) == 6
    assert all(len(fields["CAMERA"]) <= 136 for _, fields in panels)
    assert all(not storyboard_camera_contract_missing(fields["CAMERA"]) for _, fields in panels)


def test_storyboard_compactor_preserves_distinctive_user_traits_and_one_title_region() -> None:
    panels = []
    for number in range(1, 7):
        shot = "02 —." if number == 2 else f"{number:02d} — SURVEY BEAT"
        panels.append(
            f"PANEL {number:02d}:\n"
            f"SHOT: {shot}\n"
            "CAMERA: Eye-level three-quarter angle, controlled dolly track, natural 50mm lens feel\n"
            f"ACTION: The operator advances through survey beat {number}\n"
            "MOTION: Indicator lights settle as the camera advances\n"
            "DIALOG:\n"
            "NOTES: Preserve the established route and equipment state\n"
        )
    subject = (
        "A compact quadruped survey companion has a narrow feline silhouette, triangular ears, and a long tail. "
        "Its two articulated brass forelimbs show exposed metal joints and small violet status lights. "
        "Keep it four-legged and non-humanoid in every affected panel."
    )
    prompt = (
        "Create one complete footer-free 16:9 Storyboard v2 production sheet.\n"
        "PANEL COUNT: 6\n"
        "BOARD TITLE: BOARD 3 OF 3 — SURVEY EXIT\n"
        "PRODUCTION METADATA: PROJECT: ORBITAL RELAY; SEQUENCE: BOARD 3 OF 3; LOCATION: UPLINK CHAMBER\n\n"
        f"SUBJECT DESIGN CUES:\n{subject}\n\n"
        + "\n".join(panels)
        + "\nPreserve the fixed production-board layout and user-owned story order. " * 120
    )

    result = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", prompt, task_mode="image_edit", max_chars=20000
    )

    validate_storyboard_metadata_rows(result.prompt, expected_count=6)
    assert (
        "User production metadata: PROJECT: ORBITAL RELAY; "
        "SEQUENCE: BOARD 3 OF 3; LOCATION: UPLINK CHAMBER"
    ) in result.prompt
    assert "articulated brass forelimbs" in result.prompt
    assert "violet status lights" in result.prompt
    assert "only per-panel title region" in result.prompt
    assert "SHOT: 02 —." not in result.prompt
