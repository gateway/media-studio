#!/usr/bin/env python3
"""Refresh the compact Graph Studio node catalog used by the graph-builder skill."""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_URL = "http://127.0.0.1:3000/api/control/media/graph/node-definitions"


def compact_option(option: Any) -> Any:
    if isinstance(option, dict):
        return {key: option.get(key) for key in ("label", "value") if key in option}
    return option


def compact_field(field: dict[str, Any]) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": field.get("id"),
        "label": field.get("label"),
        "type": field.get("type"),
    }
    for key in ("required", "default", "connectable", "port_type", "advanced", "hidden", "visible_if"):
        value = field.get(key)
        if value not in (None, False, "", [], {}):
            item[key] = value
    options = field.get("options") or []
    if options:
        item["options"] = [compact_option(option) for option in options[:32]]
        if len(options) > 32:
            item["options_truncated"] = len(options)
    return item


def compact_port(port: dict[str, Any]) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": port.get("id"),
        "label": port.get("label"),
        "type": port.get("type"),
    }
    for key in ("array", "required", "min", "max", "visible_if", "advanced"):
        value = port.get(key)
        if value not in (None, False, "", [], {}):
            item[key] = value
    return item


def compact_definition(definition: dict[str, Any]) -> dict[str, Any]:
    source = definition.get("source") or {}
    ports = definition.get("ports") or {}
    item: dict[str, Any] = {
        "type": definition.get("type"),
        "title": definition.get("title"),
        "category": definition.get("category"),
        "inputs": [compact_port(port) for port in ports.get("inputs") or []],
        "outputs": [compact_port(port) for port in ports.get("outputs") or []],
        "fields": [compact_field(field) for field in definition.get("fields") or []],
    }
    if source:
        item["source"] = {key: source.get(key) for key in ("kind", "providers", "supports_images", "recipe_backed") if key in source}
    return item


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    out_path = Path(__file__).resolve().parents[1] / "references" / "node-catalog.json"
    with urllib.request.urlopen(url, timeout=20) as response:
        payload = json.load(response)
    definitions = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(definitions, list):
        raise SystemExit("Node definition response did not contain a list.")
    compact = {
        "source_url": url,
        "count": len(definitions),
        "nodes": [compact_definition(definition) for definition in definitions],
    }
    out_path.write_text(json.dumps(compact, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {len(definitions)} node definitions to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
