from __future__ import annotations

import os
import sys
from pathlib import Path


def repo_root_for(script_file: str | Path) -> Path:
    return Path(script_file).resolve().parent.parent


def resolve_kie_root(repo_root: Path) -> Path:
    default_kie_root = repo_root.parent / "kie-api"
    legacy_kie_root = repo_root.parent / "kie-ai" / "kie_codex_bootstrap"
    configured_kie_root = os.getenv("KIE_ROOT") or os.getenv("MEDIA_STUDIO_KIE_API_REPO_PATH")
    if configured_kie_root:
        return Path(configured_kie_root)
    if default_kie_root.exists():
        return default_kie_root
    if legacy_kie_root.exists():
        return legacy_kie_root
    return default_kie_root


def resolve_shared_python(repo_root: Path) -> Path:
    kie_root = resolve_kie_root(repo_root)
    if os.name == "nt":
        return kie_root / ".venv" / "Scripts" / "python.exe"
    return kie_root / ".venv" / "bin" / "python"


def ensure_shared_python(repo_root: Path, script_file: str, argv: list[str]) -> None:
    try:
        import pydantic  # noqa: F401
    except ModuleNotFoundError:
        shared_python = resolve_shared_python(repo_root)
        if not shared_python.exists():
            raise RuntimeError(
                f"shared Media Studio Python runtime not found at {shared_python}. Run ./scripts/bootstrap_local.sh first."
            )
        if Path(sys.executable).resolve() == shared_python.resolve():
            raise
        os.execv(str(shared_python), [str(shared_python), script_file, *argv])
