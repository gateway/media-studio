from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Iterable, Mapping, Sequence
import json
import re

from .storyboard_metadata_preflight import validate_storyboard_metadata_rows
from .storyboard_sheet_spec import (
    STORYBOARD_METADATA_DISPLAY_LIMITS,
    StoryboardSheetSpec,
    storyboard_art_source_prompt_is_compatible,
    storyboard_sheet_spec_from_mapping,
)


METADATA_LABELS = ("SHOT", "CAMERA", "ACTION", "MOTION", "DIALOG", "NOTES")
VISUAL_GATE_IDS = (
    "V001_complete_sheet_layout",
    "V002_board_numbering",
    "V003_cinematic_movie_stills",
    "V004_environment_authority",
    "V005_character_wardrobe",
    "V006_causal_panel_flow",
    "V007_board_handoffs",
    "V008_subject_design_and_reveal",
    "V009_user_dialogue_accuracy",
    "V010_final_motion_payoff",
)


def stacked_metadata_layout_instruction(labels: Sequence[str] = METADATA_LABELS) -> str:
    normalized = tuple(str(label).strip().upper() for label in labels if str(label).strip())
    count_word = {5: "five", 6: "six", 7: "seven"}.get(len(normalized), str(len(normalized)))
    return (
        "METADATA ROW LAYOUT LOCK: Under every panel image, use exactly "
        f"{count_word} separate horizontal rows stacked vertically: {', '.join(normalized)}. "
        "Each full-width row has one exact label at left and its value to the right; values wrap only within their own row. "
        "Never render metadata as side-by-side columns, tables, vertical lanes/dividers, or two labels on one line."
    )


def storyboard_v2_sheet_contract_instruction() -> str:
    """Return the immutable visible-sheet contract shared by first and continuation boards."""

    return (
        "IMMUTABLE STORYBOARD V2 SHEET CONTRACT:\n"
        "Render one footer-free 16:9 production sheet with the board title at upper left, one compact top strip in exact "
        "PROJECT, SEQUENCE, LOCATION, DATE, ARTIST order. SHOT COUNT is authoritative: render an exact 2x2 grid for "
        "four panels, 3x2 for six panels, or 3x3 for nine panels. "
        "The first board and every continuation use identical canvas geometry, panel order, image-area proportions, "
        "metadata-strip proportions, row heights, borders, spacing, typography hierarchy, dark near-black chrome, "
        "thin yellow-orange rules, palette, and rendering treatment. Only the user-owned board title, production-strip "
        "values, story images, and per-row values may change. Do not add a page footer, alternate sheet template, "
        "secondary dashboard, or board-specific chrome.\n"
        "The typed field order remains SHOT, CAMERA, ACTION, MOTION, DIALOG, NOTES for validation and art planning. "
        "Every image cell is a photoreal live-action feature-film production still photographed on a physical set with "
        "real lens optics, natural skin and material texture, physically plausible production lighting, atmospheric "
        "depth, restrained film color, and premium production design.\n"
        "SHOT appears exactly once as the panel heading above the image; it is a required typed field, not a second "
        "metadata row below the image. "
        f"{stacked_metadata_layout_instruction(METADATA_LABELS[1:])}\n"
        "READABLE VALUE BUDGET: Write complete clauses within these hard character limits, including spaces and "
        "punctuation: "
        + ", ".join(
            f"{label} {limit}"
            for label, limit in STORYBOARD_METADATA_DISPLAY_LIMITS.items()
        )
        + ". Shorten generated wording before returning; never clip a word or clause. Preserve exact user-owned "
        "DIALOG and PANEL NOTES CUES, and report that the supplied value is too long instead of paraphrasing it.\n"
        "METADATA SEMANTIC ROLE LOCK: ACTION states what the subject or scene element does in the current beat. "
        "MOTION states camera, subject, environmental, rhythm, VFX, or transformation movement over time. "
        "NOTES states a concise continuity, state, emotion, VFX, or handoff requirement derived from the user-owned "
        "brief and current panel state. Keep all three values semantically distinct. Never omit a required value, copy "
        "one row into another, paraphrase the same sentence across rows, or use SHOT text as a narrative-row fallback. "
        "DIALOG alone may be empty when the panel has no spoken line.\n"
        "FINAL METADATA AUDIT: Before returning the final image-generation prompt, inspect every PANEL NN block and "
        "count exactly one SHOT heading and one CAMERA, ACTION, MOTION, DIALOG, and NOTES row in that order. If ACTION or "
        "MOTION is absent, author a concise panel-specific value from the user-owned brief and current panel state. If "
        "NOTES is absent, author a concise panel-specific NOTES value from the user-owned brief and current panel state. "
        "Never copy or paraphrase another row to fill a missing value. Do not return the prompt until every panel passes "
        "this heading-plus-five-row audit."
    )


@dataclass(frozen=True)
class BoardEvidence:
    board_number: int
    job_id: str
    asset_id: str
    prompt: str
    reference_paths: tuple[str, ...]
    output_path: str
    sheet_spec: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class StoryRequirement:
    requirement_id: str
    title: str
    board_number: int
    panel_number: int | None = None
    required_terms: tuple[str, ...] = ()
    forbidden_terms: tuple[str, ...] = ()
    forbidden_before_panel: int | None = None
    exact_text: str = ""
    exact_count: int | None = None


@dataclass(frozen=True)
class TrilogyQualityContract:
    story_requirements: tuple[StoryRequirement, ...] = ()


def story_quality_contract_from_mapping(value: Mapping[str, Any] | None) -> TrilogyQualityContract:
    requirements: list[StoryRequirement] = []
    raw_requirements = value.get("story_requirements") if isinstance(value, Mapping) else []
    for index, raw in enumerate(raw_requirements if isinstance(raw_requirements, list) else []):
        if not isinstance(raw, Mapping):
            continue
        requirements.append(
            StoryRequirement(
                requirement_id=str(raw.get("requirement_id") or f"R{index + 1:03d}"),
                title=str(raw.get("title") or "User story requirement"),
                board_number=int(raw.get("board_number") or 0),
                panel_number=int(raw["panel_number"]) if raw.get("panel_number") is not None else None,
                required_terms=tuple(str(term) for term in raw.get("required_terms") or [] if str(term)),
                forbidden_terms=tuple(str(term) for term in raw.get("forbidden_terms") or [] if str(term)),
                forbidden_before_panel=(
                    int(raw["forbidden_before_panel"])
                    if raw.get("forbidden_before_panel") is not None
                    else None
                ),
                exact_text=str(raw.get("exact_text") or ""),
                exact_count=int(raw["exact_count"]) if raw.get("exact_count") is not None else None,
            )
        )
    return TrilogyQualityContract(story_requirements=tuple(requirements))


def _check(check_id: str, title: str, passed: bool, evidence: str) -> dict[str, Any]:
    return {"id": check_id, "title": title, "status": "pass" if passed else "fail", "evidence": evidence}


def _panel_capsule(prompt: str, board_panel: int) -> str:
    pattern = re.compile(
        rf"\b0?{board_panel}:\s*(.*?)(?=\s*\|\s*0?{board_panel + 1}:|\s*Continuity:|$)",
        flags=re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(prompt)
    return match.group(1).strip() if match else ""


def _all_present(value: str, terms: Iterable[str]) -> bool:
    lowered = value.lower()
    return all(term.lower() in lowered for term in terms)


def evaluate_trilogy(
    boards: Sequence[BoardEvidence],
    contract: TrilogyQualityContract | None = None,
) -> list[dict[str, Any]]:
    ordered = sorted(boards, key=lambda board: board.board_number)
    if [board.board_number for board in ordered] != [1, 2, 3]:
        return [_check("D000", "Exactly Boards 1-3 are present", False, "board numbers must be 1, 2, 3")]

    checks: list[dict[str, Any]] = []
    metadata_results: dict[int, str] = {}
    parsed_specs: dict[int, StoryboardSheetSpec] = {}
    uses_typed_specs = all(isinstance(board.sheet_spec, Mapping) for board in ordered)
    has_partial_typed_specs = any(isinstance(board.sheet_spec, Mapping) for board in ordered) and not uses_typed_specs
    for board in ordered:
        try:
            if uses_typed_specs:
                spec = storyboard_sheet_spec_from_mapping(board.sheet_spec or {})
                parsed_specs[board.board_number] = spec
                metadata_results[board.board_number] = f"pass: {len(spec.panels)} typed complete panels"
            elif has_partial_typed_specs:
                metadata_results[board.board_number] = "fail: typed sheet evidence must be present for all three boards"
            else:
                result = validate_storyboard_metadata_rows(board.prompt, expected_count=6)
                metadata_results[board.board_number] = f"pass: {result.panel_count} complete panels"
        except ValueError as exc:
            metadata_results[board.board_number] = f"fail: {exc}"
    checks.append(
        _check(
            "D001",
            "Six complete metadata sets per board",
            all(result.startswith("pass:") for result in metadata_results.values()),
            str(metadata_results),
        )
    )

    sheet_terms = (
        "fixed sequence template",
        "top project, sequence, location, date, artist strip",
        "project, sequence, location, date, artist",
        "exact 3x2 grid",
        "footer-free",
        "photoreal live-action cinematic image",
        "feature-film production still photographed on a physical set",
        "real lens optics",
        "clean production typography outside the image",
    )
    if uses_typed_specs and len(parsed_specs) == 3:
        layout_signatures = {
            (
                spec.contract_id,
                spec.contract_version,
                spec.layout_id,
                spec.layout_version,
            )
            for spec in parsed_specs.values()
        }
        shared_contract_pass = len(layout_signatures) == 1 and all(
            storyboard_art_source_prompt_is_compatible(board.prompt)
            and "photoreal live-action feature-film" in board.prompt.lower()
            for board in ordered
        )
        shared_contract_evidence = (
            f"typed_layout_signatures={sorted(layout_signatures)}; "
            "all provider prompts use the text-free storyboard art-source contract"
        )
    else:
        shared_contract_pass = all(_all_present(board.prompt, sheet_terms) for board in ordered)
        shared_contract_evidence = "all three prompts must retain the same sheet and movie-still tokens"
    checks.append(
        _check(
            "D002",
            "Shared complete-sheet and cinematic contract",
            shared_contract_pass,
            shared_contract_evidence,
        )
    )

    environment_paths = [board.reference_paths[1] if len(board.reference_paths) > 1 else "" for board in ordered]
    checks.append(
        _check(
            "D003",
            "Environment is reference 2 on every board",
            bool(environment_paths[0]) and len(set(environment_paths)) == 1,
            str(environment_paths),
        )
    )

    continuation_pass = (
        len(ordered[1].reference_paths) >= 3
        and len(ordered[2].reference_paths) >= 3
        and ordered[1].reference_paths[2] == ordered[0].output_path
        and ordered[2].reference_paths[2] == ordered[1].output_path
    )
    checks.append(
        _check(
            "D004",
            "Immediate prior board is reference 3",
            continuation_pass,
            f"board2_ref3={ordered[1].reference_paths[2] if len(ordered[1].reference_paths) >= 3 else ''}; "
            f"board3_ref3={ordered[2].reference_paths[2] if len(ordered[2].reference_paths) >= 3 else ''}",
        )
    )

    board_by_number = {board.board_number: board for board in ordered}
    for requirement in (contract or TrilogyQualityContract()).story_requirements:
        board = board_by_number.get(requirement.board_number)
        target = _panel_capsule(board.prompt, requirement.panel_number) if board and requirement.panel_number else board.prompt if board else ""
        before_target = ""
        if board and requirement.forbidden_before_panel:
            before_target = " ".join(
                _panel_capsule(board.prompt, panel_number)
                for panel_number in range(1, requirement.forbidden_before_panel)
            )
        passed = bool(board)
        passed = passed and _all_present(target, requirement.required_terms)
        passed = passed and not any(term.lower() in target.lower() for term in requirement.forbidden_terms)
        passed = passed and not any(term.lower() in before_target.lower() for term in requirement.required_terms)
        if requirement.exact_text and requirement.exact_count is not None:
            passed = passed and target.count(requirement.exact_text) == requirement.exact_count
        checks.append(
            _check(
                requirement.requirement_id,
                requirement.title,
                passed,
                f"board={requirement.board_number}; panel={requirement.panel_number or 'all'}; "
                f"required={list(requirement.required_terms)}; forbidden={list(requirement.forbidden_terms)}; "
                f"exact_count={requirement.exact_count}",
            )
        )

    placeholder_pattern = re.compile(r"\{\{[^}]+}}|\[\[[^]]+]]|\[(?:placeholder|character brief)]", re.IGNORECASE)
    checks.append(
        _check(
            "D010",
            "Provider prompts are bounded and placeholder-free",
            all(len(board.prompt) <= 4200 and not placeholder_pattern.search(board.prompt) for board in ordered),
            str({board.board_number: len(board.prompt) for board in ordered}),
        )
    )
    handoff_terms = (
        "Handoff continuity",
        "@image3 locks prior Panel 06",
        "Panel 01 preserves",
        "then advances one visible action",
        "purposeful camera or movement delta",
    )
    if uses_typed_specs and len(parsed_specs) == 3:
        typed_handoff_results: dict[str, bool] = {}
        for previous_number, current_number in ((1, 2), (2, 3)):
            previous = parsed_specs[previous_number].panels[-1]
            current = parsed_specs[current_number].panels[0]
            current_board = ordered[current_number - 1]
            reference_chain_ok = (
                len(current_board.reference_paths) >= 3
                and current_board.reference_paths[2] == ordered[previous_number - 1].output_path
            )
            advances = (
                current.action.casefold() != previous.action.casefold()
                and current.motion.casefold() != previous.motion.casefold()
                and current.camera.casefold() != previous.camera.casefold()
                and current.shot.casefold() != previous.shot.casefold()
            )
            typed_handoff_results[f"{previous_number}->{current_number}"] = reference_chain_ok and advances
        handoff_pass = all(typed_handoff_results.values())
        handoff_evidence = str(typed_handoff_results)
    else:
        handoff_pass = all(_all_present(board.prompt, handoff_terms) for board in ordered[1:])
        handoff_evidence = "Boards 2-3 preserve prior state while advancing action/dialogue and shot purpose"
    checks.append(
        _check(
            "D011",
            "Adjacent-but-distinct storyboard handoff lock",
            handoff_pass,
            handoff_evidence,
        )
    )
    return checks


def default_visual_scorecard() -> dict[str, dict[str, str]]:
    return {gate_id: {"status": "needs_review", "evidence": ""} for gate_id in VISUAL_GATE_IDS}


def build_manifest(
    *,
    workflow_id: str,
    workflow_name: str,
    run_id: str,
    run_status: str,
    boards: Sequence[BoardEvidence],
    deterministic_checks: Sequence[Mapping[str, Any]],
    visual_scorecard: Mapping[str, Mapping[str, str]] | None = None,
    credits_before: float | None = None,
    credits_after: float | None = None,
) -> dict[str, Any]:
    ordered = sorted(boards, key=lambda board: board.board_number)
    visual = default_visual_scorecard()
    for gate_id, result in (visual_scorecard or {}).items():
        if gate_id in visual:
            visual[gate_id] = {
                "status": str(result.get("status") or "needs_review"),
                "evidence": str(result.get("evidence") or ""),
            }
    deterministic_pass = bool(deterministic_checks) and all(check.get("status") == "pass" for check in deterministic_checks)
    visual_pass = all(result["status"] == "pass" for result in visual.values())
    credit_cost = None
    if credits_before is not None and credits_after is not None:
        credit_cost = round(credits_before - credits_after, 4)
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "workflow": {"workflow_id": workflow_id, "name": workflow_name},
        "run": {"run_id": run_id, "status": run_status},
        "accounting": {
            "credits_before": credits_before,
            "credits_after": credits_after,
            "credits_used": credit_cost,
        },
        "boards": [
            {
                "board_number": board.board_number,
                "job_id": board.job_id,
                "asset_id": board.asset_id,
                "output_path": board.output_path,
                "prompt_chars": len(board.prompt),
                "prompt_sha256": sha256(board.prompt.encode("utf-8")).hexdigest(),
                "sheet_spec_sha256": (
                    sha256(json.dumps(board.sheet_spec, sort_keys=True).encode("utf-8")).hexdigest()
                    if board.sheet_spec is not None
                    else None
                ),
                "reference_paths": list(board.reference_paths),
            }
            for board in ordered
        ],
        "deterministic_checks": list(deterministic_checks),
        "visual_scorecard": visual,
        "gate": {
            "deterministic": "pass" if deterministic_pass else "fail",
            "visual": "pass" if visual_pass else "needs_review",
            "overall": "pass" if deterministic_pass and visual_pass and run_status == "completed" else "not_accepted",
        },
    }
