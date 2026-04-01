#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def _resolve_shared_python(repo_root: Path) -> Path:
    default_kie_root = repo_root.parent / "kie-api"
    legacy_kie_root = repo_root.parent / "kie-ai" / "kie_codex_bootstrap"
    configured_kie_root = os.getenv("KIE_ROOT") or os.getenv("MEDIA_STUDIO_KIE_API_REPO_PATH")
    kie_root = Path(configured_kie_root) if configured_kie_root else (default_kie_root if default_kie_root.exists() else legacy_kie_root)
    return kie_root / ".venv" / "bin" / "python"


def _ensure_shared_python(repo_root: Path) -> None:
    try:
        import pydantic  # noqa: F401
    except ModuleNotFoundError:
        shared_python = _resolve_shared_python(repo_root)
        if not shared_python.exists():
            raise RuntimeError(
                f"shared Media Studio Python runtime not found at {shared_python}. Run ./scripts/bootstrap_local.sh first."
            )
        if Path(sys.executable).resolve() == shared_python.resolve():
            raise
        os.execv(str(shared_python), [str(shared_python), __file__, *sys.argv[1:]])


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    _ensure_shared_python(repo_root)
    sys.path.insert(0, str(repo_root / "apps" / "api"))

    from app.db_admin import create_clean_database  # noqa: E402

    parser = argparse.ArgumentParser(description="Create a clean Media Studio SQLite database with schema and defaults only.")
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Target SQLite file path for the clean database.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace the target file if it already exists.",
    )
    args = parser.parse_args()

    db_path = create_clean_database(args.output, overwrite=args.overwrite)
    print(f"Created clean database at: {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
