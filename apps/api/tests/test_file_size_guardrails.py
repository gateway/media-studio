from __future__ import annotations

from pathlib import Path
import runpy
import shutil
import subprocess
import sys


REPO_ROOT = Path(__file__).resolve().parents[3]
GUARDRAIL_SCRIPT = REPO_ROOT / "scripts" / "check_file_size_guardrails.py"
ASSISTANT_PACKAGE_CAP = 11_299


def _guardrail_fixture(tmp_path: Path) -> Path:
    script_path = tmp_path / "scripts" / GUARDRAIL_SCRIPT.name
    script_path.parent.mkdir(parents=True)
    shutil.copy2(GUARDRAIL_SCRIPT, script_path)
    guardrail_module = runpy.run_path(str(script_path))
    for guardrail in guardrail_module["GUARDRAILS"]:
        target = tmp_path / guardrail.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.touch()
    return script_path


def _run_guardrail(script_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script_path)],
        check=False,
        capture_output=True,
        text=True,
    )


def test_assistant_package_growth_fails_with_review_guidance(tmp_path: Path) -> None:
    script_path = _guardrail_fixture(tmp_path)
    growth_file = tmp_path / "apps" / "api" / "app" / "assistant" / "package_growth.py"
    growth_file.write_text("source_line = True\n" * (ASSISTANT_PACKAGE_CAP + 1), encoding="utf-8")

    result = _run_guardrail(script_path)

    assert result.returncode == 1
    assert "apps/api/app/assistant: 11300 lines exceeds max 11299" in result.stderr
    assert "intentionally raise the guardrail with a review note" in result.stderr


def test_assistant_package_ignores_generated_and_non_python_artifacts(tmp_path: Path) -> None:
    script_path = _guardrail_fixture(tmp_path)
    assistant_root = tmp_path / "apps" / "api" / "app" / "assistant"
    (assistant_root / "source.py").write_text("source_line = True\n", encoding="utf-8")
    generated = assistant_root / "__pycache__" / "generated.py"
    generated.parent.mkdir()
    generated.write_text("generated_line = True\n" * (ASSISTANT_PACKAGE_CAP + 1), encoding="utf-8")
    (assistant_root / "notes.md").write_text("not Python source\n" * (ASSISTANT_PACKAGE_CAP + 1), encoding="utf-8")

    result = _run_guardrail(script_path)

    assert result.returncode == 0, result.stderr
    assert "     1  11299  apps/api/app/assistant  [OK]" in result.stdout
