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


GUARDRAILS = (
    FileGuardrail("apps/web/components/media-studio.tsx", 2400, "Studio screen coordinator"),
    FileGuardrail("apps/web/components/graph-studio/graph-studio.tsx", 1600, "Graph Studio screen coordinator"),
    FileGuardrail("apps/web/hooks/studio/use-studio-composer-core.ts", 1200, "Studio composer coordinator"),
    FileGuardrail("apps/web/hooks/studio/use-studio-gallery-feed.ts", 600, "Studio gallery feed hook"),
    FileGuardrail("apps/web/hooks/studio/use-studio-polling.ts", 500, "Studio polling hook"),
    FileGuardrail("apps/api/app/service.py", 1500, "API service facade"),
    FileGuardrail("apps/api/app/store.py", 900, "API store facade"),
    FileGuardrail("apps/api/app/store_schema.py", 2600, "API schema/migration owner"),
    FileGuardrail("apps/api/app/store_support.py", 400, "API store helper facade"),
    FileGuardrail("apps/web/lib/media-studio-helpers.test.ts", 1500, "Studio helper compatibility tests"),
    FileGuardrail("apps/web/lib/graph-node-search.test.ts", 1200, "Graph utility compatibility tests"),
    FileGuardrail("apps/api/tests/test_graph_studio.py", 4200, "Graph backend integration tests"),
    FileGuardrail("apps/api/tests/test_api_smoke.py", 3200, "API smoke tests"),
)


def count_lines(path: Path) -> int:
    with path.open("r", encoding="utf-8", errors="ignore") as handle:
        return sum(1 for _ in handle)


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
