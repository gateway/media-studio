#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys


@dataclass(frozen=True)
class FileGuardrail:
    path: str
    max_lines: int
    owner: str


@dataclass(frozen=True)
class PackageGuardrail:
    path: str
    max_lines: int
    owner: str
    source_suffix: str = ".py"
    excluded_directories: tuple[str, ...] = ("__pycache__",)


GUARDRAILS = (
    # Release rollup note: these caps intentionally cover the Media Assistant release diff.
    # Split focused modules/tests in a follow-up cleanup PR before lowering the caps again.
    FileGuardrail("apps/web/components/media-studio.tsx", 2600, "Studio screen coordinator; release cap"),
    # Phase 16/17 review: dynamic-definition hydration and manual-size persistence are
    # still coordinator-owned. Keep a narrow release cap and track extraction in the
    # 20260712 Uber review instead of hiding the current 2,324-line baseline.
    FileGuardrail("apps/web/components/graph-studio/graph-studio.tsx", 2350, "Graph Studio screen coordinator; reviewed release cap"),
    FileGuardrail("apps/web/hooks/studio/use-studio-composer-core.ts", 1200, "Studio composer coordinator"),
    FileGuardrail("apps/web/hooks/studio/use-studio-gallery-feed.ts", 600, "Studio gallery feed hook"),
    FileGuardrail("apps/web/hooks/studio/use-studio-polling.ts", 500, "Studio polling hook"),
    FileGuardrail("apps/api/app/service.py", 1500, "API service facade"),
    FileGuardrail("apps/api/app/store.py", 900, "API store facade"),
    FileGuardrail("apps/api/app/store_schema.py", 2600, "API schema/migration owner"),
    FileGuardrail("apps/api/app/store_support.py", 400, "API store helper facade"),
    FileGuardrail("apps/web/lib/media-studio-helpers.test.ts", 1500, "Studio helper compatibility tests"),
    FileGuardrail("apps/web/lib/graph-node-search.test.ts", 1200, "Graph utility compatibility tests"),
    # The integration owner intentionally accumulated scheduler, media, and prompt-
    # shaping regression coverage during the storyboard campaign. Splitting tests is
    # tracked cleanup; the cap remains close to the reviewed 6,866-line baseline.
    FileGuardrail("apps/api/tests/test_graph_studio.py", 7000, "Graph backend integration tests; reviewed release cap"),
    FileGuardrail("apps/api/app/assistant/routes.py", 600, "Media Assistant thin HTTP adapter"),
    FileGuardrail(
        "apps/web/components/graph-studio/creative-assistant-kernel.test.tsx",
        550,
        "Media Assistant typed-action panel tests",
    ),
    FileGuardrail("apps/api/tests/test_api_smoke.py", 3250, "API smoke tests; release cap"),
)

# Exact Python-source total on the reviewed Ticket-9 responsiveness candidate.
# Deliberate net growth requires updating this value with a review note.
ASSISTANT_PACKAGE_GUARDRAIL = PackageGuardrail(
    "apps/api/app/assistant",
    11_395,
    "Media Assistant Python source package; reviewed candidate cap",
)


def count_lines(path: Path) -> int:
    with path.open("r", encoding="utf-8", errors="ignore") as handle:
        return sum(1 for _ in handle)


def package_source_files(package_root: Path, guardrail: PackageGuardrail) -> tuple[Path, ...]:
    return tuple(
        path
        for path in sorted(package_root.rglob(f"*{guardrail.source_suffix}"))
        if not any(part in guardrail.excluded_directories for part in path.relative_to(package_root).parts)
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    failures: list[str] = []

    print("File-size guardrail report")
    print(f"{'Lines':>6} {'Max':>6}  File")
    for guardrail in GUARDRAILS:
        absolute_path = repo_root / guardrail.path
        if not absolute_path.exists():
            failures.append(f"{guardrail.path} is missing")
            continue
        line_count = count_lines(absolute_path)
        status = "OK" if line_count <= guardrail.max_lines else "FAIL"
        print(f"{line_count:>6} {guardrail.max_lines:>6}  {guardrail.path}  [{status}] {guardrail.owner}")
        if line_count > guardrail.max_lines:
            failures.append(f"{guardrail.path}: {line_count} lines exceeds max {guardrail.max_lines}")

    package_guardrail = ASSISTANT_PACKAGE_GUARDRAIL
    package_root = repo_root / package_guardrail.path
    if not package_root.is_dir():
        failures.append(f"{package_guardrail.path} is missing")
    else:
        package_lines = sum(count_lines(path) for path in package_source_files(package_root, package_guardrail))
        status = "OK" if package_lines <= package_guardrail.max_lines else "FAIL"
        print(
            f"{package_lines:>6} {package_guardrail.max_lines:>6}  {package_guardrail.path}  "
            f"[{status}] {package_guardrail.owner}"
        )
        if package_lines > package_guardrail.max_lines:
            failures.append(
                f"{package_guardrail.path}: {package_lines} lines exceeds max {package_guardrail.max_lines}"
            )

    if failures:
        print("File-size guardrail failed:", file=sys.stderr)
        for failure in failures:
            print(f" - {failure}", file=sys.stderr)
        print("Extract focused modules or intentionally raise the guardrail with a review note.", file=sys.stderr)
        return 1
    print("File-size guardrail passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
