#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

from _shared_runtime import ensure_shared_python, repo_root_for


def main() -> int:
    repo_root = repo_root_for(__file__)
    ensure_shared_python(repo_root, __file__, sys.argv[1:])
    sys.path.insert(0, str(repo_root / "apps" / "api"))

    from app.control_auth import CONTROL_ROUTE_EXCEPTIONS, READ_ACCESS_PATHS, required_access_mode  # noqa: E402
    from app.main import app  # noqa: E402

    inventory = []
    for route in app.routes:
        path = getattr(route, "path", None)
        methods = sorted(method for method in (getattr(route, "methods", set()) or set()) if method != "HEAD")
        if not path or not methods:
            continue
        for method in methods:
            auth_mode = required_access_mode(path, method)
            notes = []
            if path in CONTROL_ROUTE_EXCEPTIONS:
                notes.append("control exception")
            if path in READ_ACCESS_PATHS:
                notes.append("read exception")
            if path == "/media/providers/kie/callback":
                notes.append("verified callback")
            inventory.append(
                {
                    "path": path,
                    "method": method,
                    "control_access_mode": auth_mode,
                    "is_control_route_exception": path in CONTROL_ROUTE_EXCEPTIONS,
                    "is_read_access_exception": path in READ_ACCESS_PATHS,
                    "notes": notes,
                }
            )

    counts = Counter(item["control_access_mode"] or "public" for item in inventory)
    outputs_dir = repo_root / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    security_profile_path = outputs_dir / "security_profile.json"
    security_profile = {
        "endpoint_count": len(inventory),
        "counts": dict(sorted(counts.items())),
        "endpoints": inventory,
    }
    security_profile_path.write_text(json.dumps(security_profile, indent=2, sort_keys=True) + "\n")

    docs_dir = repo_root / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    report_path = docs_dir / "API_SECURITY_FULL_REPORT.md"
    lines = [
        "# API Security Full Report",
        "",
        "## Summary",
        "",
        f"- Total endpoints reviewed: `{len(inventory)}`",
        f"- Public endpoints: `{counts.get('public', 0)}`",
        f"- Read-protected endpoints: `{counts.get('read', 0)}`",
        f"- Admin-protected endpoints: `{counts.get('admin', 0)}`",
        "",
        "## Notes",
        "",
        "- This report is generated from the FastAPI route table plus the control access policy.",
        "- It is intended as a release-review input, not a replacement for runtime smoke checks.",
        "",
        "## Endpoint Inventory",
        "",
        "| Method | Path | Access | Notes |",
        "| --- | --- | --- | --- |",
    ]
    for endpoint in inventory:
        lines.append(
            f"| {endpoint['method']} | `{endpoint['path']}` | `{endpoint['control_access_mode'] or 'public'}` | {', '.join(endpoint.get('notes') or []) or '-'} |"
        )
    report_path.write_text("\n".join(lines) + "\n")

    print(json.dumps({"security_profile": str(security_profile_path), "report": str(report_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
