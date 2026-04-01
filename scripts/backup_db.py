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

    from app.db_admin import backup_database  # noqa: E402
    from app.settings import settings  # noqa: E402

    parser = argparse.ArgumentParser(description="Back up the local Media Studio SQLite database.")
    parser.add_argument(
        "--source",
        type=Path,
        default=settings.db_path,
        help="Path to the source SQLite database. Defaults to MEDIA_STUDIO_DB_PATH.",
    )
    parser.add_argument(
        "--backup-dir",
        type=Path,
        default=repo_root / "data" / "backups",
        help="Directory where ignored backup copies should be written.",
    )
    args = parser.parse_args()

    backup_path = backup_database(args.source, args.backup_dir)
    print(f"Backed up database to: {backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
