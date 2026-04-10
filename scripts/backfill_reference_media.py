from __future__ import annotations

import json
import sys
from pathlib import Path

from _shared_runtime import ensure_shared_python, repo_root_for


def main() -> int:
    repo_root = repo_root_for(__file__)
    ensure_shared_python(repo_root, str(Path(__file__).resolve()), sys.argv[1:])

    api_root = repo_root / "apps" / "api"
    if str(api_root) not in sys.path:
        sys.path.insert(0, str(api_root))

    from app import service, store  # noqa: WPS433

    store.bootstrap_schema()
    result = service.backfill_reference_media()
    print(json.dumps(result, indent=2))
    return 0 if not result.get("errors") else 1


if __name__ == "__main__":
    raise SystemExit(main())
