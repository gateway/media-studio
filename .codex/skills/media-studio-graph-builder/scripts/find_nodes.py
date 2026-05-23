#!/usr/bin/env python3
"""Search the compact node catalog without loading the full catalog into context."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


CATALOG = Path(__file__).resolve().parents[1] / "references" / "node-catalog.json"


def slim_node(node: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": node.get("type"),
        "title": node.get("title"),
        "category": node.get("category"),
        "inputs": node.get("inputs", []),
        "outputs": node.get("outputs", []),
        "fields": node.get("fields", []),
    }


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: find_nodes.py search terms...")
    query = " ".join(sys.argv[1:]).lower()
    data = json.loads(CATALOG.read_text())
    matches = []
    for node in data.get("nodes", []):
        haystack = " ".join(str(node.get(key) or "") for key in ("type", "title", "category")).lower()
        if all(term in haystack for term in query.split()):
            matches.append(slim_node(node))
    print(json.dumps({"count": len(matches), "matches": matches[:12]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
