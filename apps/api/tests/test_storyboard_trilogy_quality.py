from __future__ import annotations

from app.graph.storyboard_trilogy_quality import (
    BoardEvidence,
    StoryRequirement,
    TrilogyQualityContract,
    VISUAL_GATE_IDS,
    build_manifest,
    evaluate_trilogy,
)
from app.graph.storyboard_sheet_spec import (
    STORYBOARD_ART_SOURCE_CONTRACT,
    STORYBOARD_LAYOUT_ID,
    STORYBOARD_LAYOUT_VERSION,
    STORYBOARD_SHEET_CONTRACT_ID,
    STORYBOARD_SHEET_CONTRACT_VERSION,
)
from app.graph.prompt_shaping import shape_kie_graph_prompt


EXACT_DIALOGUE = "Bolts, are you ready for this next adventure?"


def _contract() -> TrilogyQualityContract:
    return TrilogyQualityContract(
        story_requirements=(
            StoryRequirement(
                "R001",
                "User-authored opening state",
                board_number=1,
                panel_number=1,
                required_terms=("pilot one ship-length away", "droids entering ramp", "supply crates", "open ramp", "hangar doors"),
            ),
            StoryRequirement("R002", "Board 1 handoff state", board_number=1, panel_number=6, required_terms=("closed service panel",)),
            StoryRequirement("R003", "Board 2 handoff state", board_number=2, panel_number=6, required_terms=("closed service panel",)),
            StoryRequirement("R004", "Board 3 opening state", board_number=3, panel_number=1, required_terms=("closed service panel",)),
            StoryRequirement(
                "R005",
                "User-authored subject reveal",
                board_number=3,
                panel_number=3,
                required_terms=("cyborg cat",),
                forbidden_before_panel=3,
            ),
            StoryRequirement(
                "R006",
                "User-authored exact dialogue",
                board_number=3,
                exact_text=EXACT_DIALOGUE,
                exact_count=1,
            ),
            StoryRequirement(
                "R007",
                "User-authored final motion state",
                board_number=3,
                panel_number=5,
                required_terms=("cockpit", "floor drops during lift", "ship airborne"),
            ),
        )
    )


def _prompt(board_number: int) -> str:
    intro = (
        "Create one clean 16:9 production storyboard with a fixed sequence template: upper-left title; "
        "top PROJECT, SEQUENCE, LOCATION, DATE, ARTIST strip; exact 3x2 grid; footer-free. "
        "Each cell is a photoreal live-action cinematic image that reads as a feature-film production still photographed on a physical set "
        "with real lens optics and clean production typography outside the image. "
    )
    if board_number == 1:
        notes = {
            1: "pilot one ship-length away, droids entering ramp, supply crates, open ramp, hangar doors",
            6: "closed service panel, hand near latch",
        }
    elif board_number == 2:
        intro += (
            "Handoff continuity: @image3 locks prior Panel 06; Panel 01 preserves its state, then advances one visible action with a purposeful "
            "camera or movement delta in the same moment. "
        )
        notes = {6: "closed service panel, steady green"}
    else:
        intro += (
            "Handoff continuity: @image3 locks prior Panel 06; Panel 01 preserves its state, then advances one visible action with a purposeful "
            "camera or movement delta in the same moment. "
            "Cyborg-cat reveal lock: Panels 01-02 contain no cat or cat-like figure; the cat first appears only in Panel 03 inside the cockpit. "
            "Lift-shot lock: Panel 05 stays inside the lifting ship's cockpit; through its canopy show only the hangar floor and gantry bases "
            "dropping below. The ship itself never appears outside its own canopy. "
        )
        notes = {
            1: "closed service panel, open ramp",
            3: "cyborg cat, mechanical forelegs",
            5: "cockpit, floor drops during lift, ship airborne",
        }
    panels = []
    for panel in range(1, 7):
        dialogue = EXACT_DIALOGUE if board_number == 3 and panel == 5 else ""
        panels.append(
            f"{panel:02d}: SHOT: {panel:02d} CAUSAL BEAT; CAMERA: eye-level tracking 35mm lens; FRAMING: readable; "
            "ACTION: The subject advances the causal beat; MOTION: The subject moves deliberately; "
            f"DIALOG: {dialogue}; NOTES: {notes.get(panel, 'Established continuity remains stable')}"
        )
    return intro + "Panel plan with metadata rows: " + " | ".join(panels) + " Continuity: preserve story order."


def _boards() -> list[BoardEvidence]:
    environment = "/outputs/environment.png"
    outputs = [f"/outputs/board-{number}.png" for number in (1, 2, 3)]
    return [
        BoardEvidence(1, "job-1", "asset-1", _prompt(1), ("/refs/character.png", environment), outputs[0]),
        BoardEvidence(2, "job-2", "asset-2", _prompt(2), ("/refs/character.png", environment, outputs[0]), outputs[1]),
        BoardEvidence(3, "job-3", "asset-3", _prompt(3), ("/refs/character.png", environment, outputs[1]), outputs[2]),
    ]


def test_trilogy_quality_gate_passes_complete_ordered_evidence() -> None:
    checks = evaluate_trilogy(_boards(), contract=_contract())

    assert len(checks) == 13
    assert all(check["status"] == "pass" for check in checks)


def test_trilogy_quality_gate_audits_typed_sheet_specs_for_text_free_art_sources() -> None:
    boards = _boards()
    typed_boards: list[BoardEvidence] = []
    for board in boards:
        panels = []
        for panel in range(1, 7):
            panels.append(
                {
                    "number": panel,
                    "shot": f"{panel:02d} — Causal beat {panel}",
                    "camera": f"35mm eye-level tracking shot; subject placement advances for beat {panel}",
                    "action": f"The subject completes distinct causal action {panel} for Board {board.board_number}.",
                    "motion": f"The subject and camera advance through movement beat {panel}.",
                    "dialog": "",
                    "notes": f"Preserve the established state while advancing beat {panel}.",
                }
            )
        sheet_spec = {
            "contract_id": STORYBOARD_SHEET_CONTRACT_ID,
            "contract_version": STORYBOARD_SHEET_CONTRACT_VERSION,
            "layout_id": STORYBOARD_LAYOUT_ID,
            "layout_version": STORYBOARD_LAYOUT_VERSION,
            "source_recipe_key": "neutral-storyboard-recipe",
            "board_title": f"BOARD {board.board_number} OF 3 — NEUTRAL SEQUENCE",
            "production_metadata": {
                "PROJECT": "NEUTRAL PROJECT",
                "SEQUENCE": f"BOARD {board.board_number} OF 3",
                "LOCATION": "NEUTRAL LOCATION",
                "DATE": "—",
                "ARTIST": "—",
            },
            "panels": panels,
            "visual_context": {},
        }
        art_prompt = (
            f"Storyboard art source contract: {STORYBOARD_ART_SOURCE_CONTRACT}. "
            "Create one text-free 4:3 source plate with exactly six cinematic frames. "
            "Every cell is a photoreal live-action feature-film still. Show art only: no metadata or production-sheet chrome."
        )
        typed_boards.append(
            BoardEvidence(
                board.board_number,
                board.job_id,
                board.asset_id,
                art_prompt,
                board.reference_paths,
                board.output_path,
                sheet_spec=sheet_spec,
            )
        )

    checks = {check["id"]: check for check in evaluate_trilogy(typed_boards)}

    assert checks["D001"]["status"] == "pass"
    assert checks["D002"]["status"] == "pass"
    assert checks["D011"]["status"] == "pass"


def test_trilogy_quality_gate_rejects_early_cat_and_broken_reference_chain() -> None:
    boards = _boards()
    board_three = boards[2]
    boards[2] = BoardEvidence(
        3,
        board_three.job_id,
        board_three.asset_id,
        board_three.prompt.replace("01: SHOT: 01 CAUSAL BEAT", "01: SHOT: 01 CAUSAL BEAT cyborg cat"),
        ("/refs/character.png", "/outputs/environment.png", "/outputs/wrong-board.png"),
        board_three.output_path,
    )

    checks = {check["id"]: check for check in evaluate_trilogy(boards, contract=_contract())}

    assert checks["D004"]["status"] == "fail"
    assert checks["R005"]["status"] == "fail"


def test_trilogy_quality_gate_rejects_an_empty_required_metadata_value() -> None:
    boards = _boards()
    board_two = boards[1]
    boards[1] = BoardEvidence(
        board_two.board_number,
        board_two.job_id,
        board_two.asset_id,
        board_two.prompt.replace("ACTION: The subject advances the causal beat", "ACTION:", 1),
        board_two.reference_paths,
        board_two.output_path,
    )

    checks = {check["id"]: check for check in evaluate_trilogy(boards, contract=_contract())}

    assert checks["D001"]["status"] == "fail"
    assert "Panel 01 ACTION is empty" in checks["D001"]["evidence"]


def test_manifest_records_hashes_checks_visual_gates_and_accounting() -> None:
    boards = _boards()
    checks = evaluate_trilogy(boards, contract=_contract())
    visual = {gate_id: {"status": "pass", "evidence": f"proved {gate_id}"} for gate_id in VISUAL_GATE_IDS}

    manifest = build_manifest(
        workflow_id="graphwf-test",
        workflow_name="Test trilogy",
        run_id="grun-test",
        run_status="completed",
        boards=boards,
        deterministic_checks=checks,
        visual_scorecard=visual,
        credits_before=100.0,
        credits_after=70.0,
    )

    assert manifest["gate"] == {"deterministic": "pass", "visual": "pass", "overall": "pass"}
    assert manifest["accounting"]["credits_used"] == 30.0
    assert len(manifest["boards"][0]["prompt_sha256"]) == 64
    assert set(manifest["visual_scorecard"]) == set(VISUAL_GATE_IDS)


def test_prompt_shaper_preserves_user_supplied_board_one_distance_and_removes_short_negated_cat_note() -> None:
    def panels(board: int) -> str:
        return "\n\n".join(
            f"PANEL {panel:02d}\n"
            f"SHOT: {panel:02d} CAUSAL BEAT\n"
            "CAMERA: cinematic camera\n"
            "FRAMING: environment remains readable\n"
            f"ACTION: {'The pilot begins one full ship-length away while the complete ship, droids carrying supply crates, open ramp, and hangar doors remain visible' if board == 1 else 'The pilot advances through the boarding route'}\n"
            "MOTION: deliberate movement\n"
            "DIALOG: \n"
            f"NOTES: {'Bolts not visible' if board == 3 and panel == 2 else 'preserve story order'}"
            for panel in range(1, 7)
        )

    board_one_raw = (
        "Create one 16:9 production storyboard titled “LOADING AND EXTERIOR INSPECTION — BOARD 1 OF 3”.\n\n"
        "Use @image1 for identity and @image2 for the fixed hangar Environment.\n\n"
        f"{panels(1)}\n\n" + "Preserve the same board system and continuity. " * 100
    )
    board_three_raw = (
        "Create one 16:9 production storyboard titled “BOARDING AND LAUNCH — BOARD 3 OF 3”.\n\n"
        "Use @image1 for identity, @image2 for Environment, and @image3 for the prior board. Bolts is not visible until Panel 03.\n\n"
        f"{panels(3)}\n\n" + "Preserve the same board system and continuity. " * 100
    )

    board_one = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", board_one_raw, task_mode="image_edit", max_chars=20000
    ).prompt
    board_three = shape_kie_graph_prompt(
        "gpt-image-2-image-to-image", board_three_raw, task_mode="image_edit", max_chars=20000
    ).prompt

    for term in ("one full ship-length away", "droids carrying supply crates", "open ramp", "hangar doors"):
        assert term in board_one
    panel_two = board_three.split("02: SHOT:", 1)[1].split("| 03:", 1)[0]
    assert "Bolts" not in panel_two


def test_prompt_shaper_locks_continuation_panel_one_to_prior_panel_six() -> None:
    def raw(board: int) -> str:
        panels = "\n\n".join(
            f"PANEL {panel:02d}\n"
            f"SHOT: {panel:02d} CONTINUATION\n"
            "CAMERA: cinematic camera\n"
            "FRAMING: pilot, ship, and hangar remain readable\n"
            f"ACTION: The pilot advances continuation beat {panel}\n"
            "MOTION: one deliberate movement\n"
            "DIALOG: \n"
            "NOTES: preserve the prior ending state"
            for panel in range(1, 7)
        )
        title = f"BOARD 2 — CONTINUATION" if board == 2 else f"CONTINUATION — BOARD {board} OF 3"
        return (
            f"Create one 16:9 production storyboard titled “{title}”.\n\n"
            "Use @image1 for identity. Use @image2 for Environment geography. "
            "Use @image3 only for the immediate previous board ending state, layout, and metadata geometry.\n\n"
            f"{panels}\n\n" + "Preserve the same board design and causal continuity. " * 100
        )

    for board in (2, 3):
        shaped = shape_kie_graph_prompt(
            "gpt-image-2-image-to-image", raw(board), task_mode="image_edit", max_chars=20000
        ).prompt
        assert len(shaped) <= 4200
        assert "Handoff continuity: @image3 locks prior Panel 06" in shaped
        assert "Panel 01 preserves that state, then advances one visible action" in shaped
        assert "purposeful camera or movement delta" in shaped
