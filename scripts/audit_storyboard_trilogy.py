#!/usr/bin/env python3
from __future__ import annotations

import argparse
from dataclasses import replace
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
API_ROOT = REPO_ROOT / "apps" / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.graph.storyboard_trilogy_quality import (  # noqa: E402
    BoardEvidence,
    build_manifest,
    evaluate_trilogy,
    story_quality_contract_from_mapping,
)
from app.graph.prompt_shaping import shape_kie_graph_prompt  # noqa: E402


BOARD_TITLES = {1: "Storyboard 1 GPT", 2: "Storyboard 2 GPT", 3: "Storyboard 3 GPT"}
PROMPT_TITLES = {1: "Storyboard 1 Recipe", 2: "Storyboard 2 Continuation", 3: "Storyboard 3 Continuation"}
COMPILER_TITLES = {1: "Storyboard 1 Compiler", 2: "Storyboard 2 Compiler", 3: "Storyboard 3 Compiler"}


def _json(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else {}


def _path_from_image(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    return str(value.get("path") or value.get("url") or "")


def _load_visual_review(path: Path | None) -> dict[str, dict[str, str]]:
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("visual review must be a JSON object keyed by visual gate id")
    return payload


def _board_evidence(connection: sqlite3.Connection, workflow: dict[str, Any], run_id: str) -> list[BoardEvidence]:
    node_ids = {
        int(title.split()[1]): str(node.get("id"))
        for node in workflow.get("nodes", [])
        if isinstance(node, dict)
        and (title := str(((node.get("metadata") or {}).get("ui") or {}).get("customTitle") or ""))
        in BOARD_TITLES.values()
    }
    compiler_node_ids = {
        int(title.split()[1]): str(node.get("id"))
        for node in workflow.get("nodes", [])
        if isinstance(node, dict)
        and (title := str(((node.get("metadata") or {}).get("ui") or {}).get("customTitle") or ""))
        in COMPILER_TITLES.values()
    }
    boards: list[BoardEvidence] = []
    for board_number in (1, 2, 3):
        node_id = node_ids.get(board_number)
        if not node_id:
            raise ValueError(f"missing {BOARD_TITLES[board_number]} node")
        artifact = connection.execute(
            """
            SELECT job_id, asset_id
            FROM graph_artifacts
            WHERE run_id = ? AND node_id = ? AND output_port = 'image'
            ORDER BY created_at DESC LIMIT 1
            """,
            (run_id, node_id),
        ).fetchone()
        if artifact is None or not artifact["job_id"]:
            raise ValueError(f"run {run_id} has no completed Board {board_number} image artifact")
        job = connection.execute(
            "SELECT * FROM media_jobs WHERE job_id = ?",
            (artifact["job_id"],),
        ).fetchone()
        if job is None:
            raise ValueError(f"missing media job {artifact['job_id']}")
        normalized = _json(job["normalized_request_json"])
        artifact_json = _json(job["artifact_json"])
        reference_paths = tuple(_path_from_image(image) for image in normalized.get("images", []))
        run_dir = str(artifact_json.get("run_dir") or "")
        output_path = str(Path(run_dir) / "original" / "output_01.png") if run_dir else ""
        compiler_node_id = compiler_node_ids.get(board_number)
        spec_artifact = (
            connection.execute(
                """
                SELECT value_json
                FROM graph_artifacts
                WHERE run_id = ? AND node_id = ? AND output_port = 'spec'
                ORDER BY created_at DESC LIMIT 1
                """,
                (run_id, compiler_node_id),
            ).fetchone()
            if compiler_node_id
            else None
        )
        boards.append(
            BoardEvidence(
                board_number=board_number,
                job_id=str(job["job_id"]),
                asset_id=str(artifact["asset_id"] or ""),
                prompt=str(job["final_prompt_used"] or ""),
                reference_paths=reference_paths,
                output_path=output_path,
                sheet_spec=_json(spec_artifact["value_json"]) if spec_artifact else None,
            )
        )
    return boards


def _replay_prompt_run(
    connection: sqlite3.Connection,
    workflow: dict[str, Any],
    prompt_run_id: str,
    boards: list[BoardEvidence],
) -> list[BoardEvidence]:
    node_ids = {
        int(title.split()[1]): str(node.get("id"))
        for node in workflow.get("nodes", [])
        if isinstance(node, dict)
        and (title := str(((node.get("metadata") or {}).get("ui") or {}).get("customTitle") or ""))
        in PROMPT_TITLES.values()
    }
    replayed: list[BoardEvidence] = []
    for board in boards:
        node_id = node_ids.get(board.board_number)
        if not node_id:
            raise ValueError(f"missing {PROMPT_TITLES[board.board_number]} node")
        artifact = connection.execute(
            """
            SELECT value_json
            FROM graph_artifacts
            WHERE run_id = ? AND node_id = ? AND output_port = 'text'
            ORDER BY created_at DESC LIMIT 1
            """,
            (prompt_run_id, node_id),
        ).fetchone()
        if artifact is None:
            raise ValueError(f"prompt run {prompt_run_id} has no Board {board.board_number} text artifact")
        raw_prompt = str(_json(artifact["value_json"]).get("value") or "")
        shaped = shape_kie_graph_prompt(
            "gpt-image-2-image-to-image",
            raw_prompt,
            task_mode="image_edit",
            max_chars=20000,
        ).prompt
        replayed.append(replace(board, prompt=shaped))
    return replayed


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit one completed three-board Graph Studio storyboard run.")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--workflow-id", default="graphwf_4fd06f50c493")
    parser.add_argument("--prompt-run-id", help="Replay recipe text artifacts from a zero-cost run through the current shaper.")
    parser.add_argument("--db", type=Path, default=REPO_ROOT / "data" / "media-studio.db")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--visual-review", type=Path)
    parser.add_argument(
        "--story-contract",
        type=Path,
        help="User-authored JSON story requirements; shared audit code contains no campaign story nouns.",
    )
    parser.add_argument("--credits-before", type=float)
    parser.add_argument("--credits-after", type=float)
    parser.add_argument("--require-visual-pass", action="store_true")
    args = parser.parse_args()

    connection = sqlite3.connect(args.db)
    connection.row_factory = sqlite3.Row
    try:
        workflow_row = connection.execute(
            "SELECT name, workflow_json FROM graph_workflows WHERE workflow_id = ?",
            (args.workflow_id,),
        ).fetchone()
        run_row = connection.execute(
            "SELECT status FROM graph_runs WHERE run_id = ? AND workflow_id = ?",
            (args.run_id, args.workflow_id),
        ).fetchone()
        if workflow_row is None or run_row is None:
            raise ValueError("workflow or run was not found")
        workflow = _json(workflow_row["workflow_json"])
        boards = _board_evidence(connection, workflow, args.run_id)
        if args.prompt_run_id:
            boards = _replay_prompt_run(connection, workflow, args.prompt_run_id, boards)
        story_contract = (
            story_quality_contract_from_mapping(json.loads(args.story_contract.read_text(encoding="utf-8")))
            if args.story_contract
            else None
        )
        checks = evaluate_trilogy(boards, contract=story_contract)
        manifest = build_manifest(
            workflow_id=args.workflow_id,
            workflow_name=str(workflow_row["name"]),
            run_id=args.run_id,
            run_status=str(run_row["status"]),
            boards=boards,
            deterministic_checks=checks,
            visual_scorecard=_load_visual_review(args.visual_review),
            credits_before=args.credits_before,
            credits_after=args.credits_after,
        )
        if args.prompt_run_id:
            manifest["prompt_source_run_id"] = args.prompt_run_id
            manifest["evidence_run_id"] = args.run_id
    finally:
        connection.close()

    output_name = args.prompt_run_id or args.run_id
    output = args.output or REPO_ROOT / "data" / "quality-manifests" / f"{output_name}.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(output), "gate": manifest["gate"]}, indent=2))
    if manifest["gate"]["deterministic"] != "pass":
        return 1
    if args.require_visual_pass and manifest["gate"]["overall"] != "pass":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
