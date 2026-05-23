#!/usr/bin/env python3
"""Validate a Media Studio graph template for portable sharing."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


FORBIDDEN_PATTERNS = {
    "local_path": re.compile(r"/Users/|/home/|C:\\\\", re.IGNORECASE),
    "file_url": re.compile(r"file://", re.IGNORECASE),
    "data_url": re.compile(r"data:", re.IGNORECASE),
    "api_key": re.compile(r"(?i)(api[_-]?key|secret|token|bearer)\\s*[:=]"),
    "asset_id": re.compile(r"asset_[a-f0-9]{8,}", re.IGNORECASE),
    "job_id": re.compile(r"job_[a-f0-9]{8,}", re.IGNORECASE),
    "run_id": re.compile(r"run_[a-f0-9]{8,}", re.IGNORECASE),
}


def load(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: invalid JSON: {exc}") from exc


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: validate_graph_template.py path/to/template.media-studio-graph.json")
    path = Path(sys.argv[1])
    payload = load(path)
    text = path.read_text()
    errors: list[str] = []
    if payload.get("kind") != "media-studio.graph.workflow":
        errors.append("kind must be media-studio.graph.workflow")
    workflow = payload.get("workflow")
    if not isinstance(workflow, dict):
        errors.append("workflow must be an object")
    else:
        if workflow.get("workflow_id") is not None:
            errors.append("workflow.workflow_id must be null for a portable template")
        nodes = workflow.get("nodes") or []
        edges = workflow.get("edges") or []
        groups = ((workflow.get("metadata") or {}).get("groups") or [])
        if not nodes:
            errors.append("workflow must contain nodes")
        node_ids = {node.get("id") for node in nodes if isinstance(node, dict)}
        for edge in edges:
            if edge.get("source") not in node_ids:
                errors.append(f"edge {edge.get('id')} source does not match a node")
            if edge.get("target") not in node_ids:
                errors.append(f"edge {edge.get('id')} target does not match a node")
        for group in groups:
            for node_id in group.get("node_ids") or []:
                if node_id not in node_ids:
                    errors.append(f"group {group.get('id')} references missing node {node_id}")
    for name, pattern in FORBIDDEN_PATTERNS.items():
        if pattern.search(text):
            errors.append(f"forbidden {name} pattern found")
    if errors:
        print(json.dumps({"ok": False, "errors": errors}, indent=2))
        return 1
    print(json.dumps({"ok": True, "file": str(path), "nodes": len(workflow.get("nodes") or []), "edges": len(workflow.get("edges") or []), "groups": len((workflow.get("metadata") or {}).get("groups") or [])}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
