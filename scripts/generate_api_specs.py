#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

from _shared_runtime import ensure_shared_python, repo_root_for


def main() -> int:
    repo_root = repo_root_for(__file__)
    ensure_shared_python(repo_root, __file__, sys.argv[1:])
    sys.path.insert(0, str(repo_root / "apps" / "api"))

    from app.main import app  # noqa: E402

    specs_dir = repo_root / "specs"
    specs_dir.mkdir(parents=True, exist_ok=True)
    output_path = specs_dir / "media-studio-openapi.json"
    output_path.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
    print(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
