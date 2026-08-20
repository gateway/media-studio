#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import re
import sys


REPO_ROOT = Path(__file__).resolve().parent.parent

# These modules are reusable recipe/compiler/quality owners. Campaign content is
# allowed in tests, saved workflows, and user fields, but never in these owners.
CHECKS: dict[str, tuple[tuple[str, str], ...]] = {
    "apps/api/app/store_seed_prompt_recipes.py": (
        ("private campaign character name", r"\b(?:sadi|sadie|bolts)\b"),
        ("campaign subject design", r"\bcyborg[ -]cat\b"),
        ("campaign repair beat", r"\b(?:burnt|burned)[ -]out capacitor\b"),
        ("campaign wardrobe palette", r"\b(?:cream-and-red|red-and-cream)\b"),
    ),
    "apps/api/app/graph/prompt_shaping.py": (
        ("private campaign character name", r"\b(?:sadi|sadie|bolts)\b"),
        ("campaign subject design", r"\bcyborg[ -]cat\b|\bmechanical forelegs?\b"),
        ("campaign repair/launch state", r"\b(?:capacitor|hangar doors?|service panel|landing gear|coolant|hull seams?|supply crates?)\b"),
        ("campaign staging phrase", r"\b(?:one (?:full )?ship-length|droids entering ramp)\b"),
        ("campaign wardrobe palette", r"\b(?:cream-and-red|red-and-cream)\b"),
    ),
    "apps/api/app/graph/storyboard_trilogy_quality.py": (
        ("private campaign character name", r"\b(?:sadi|sadie|bolts)\b"),
        ("campaign subject design", r"\bcyborg[ -]cat\b|\bmechanical forelegs?\b"),
        ("campaign environment/action", r"\b(?:pilot|droids?|hangar|ship-length|service panel|capacitor|cockpit|supply crates?|open ramp)\b"),
    ),
    "apps/api/app/graph/storyboard_sheet_spec.py": (
        ("private campaign character name", r"\b(?:sadi|sadie|bolts)\b"),
        ("campaign subject design", r"\bcyborg[ -]cat\b|\bmechanical forelegs?\b"),
        ("campaign environment/action", r"\b(?:pilot|droids?|hangar|ship-length|service panel|capacitor|cockpit|supply crates?|open ramp)\b"),
        ("campaign wardrobe palette", r"\b(?:cream-and-red|red-and-cream)\b"),
    ),
    "apps/api/app/graph/storyboard_sheet_renderer.py": (
        ("private campaign character name", r"\b(?:sadi|sadie|bolts)\b"),
        ("campaign subject design", r"\bcyborg[ -]cat\b|\bmechanical forelegs?\b"),
        ("campaign environment/action", r"\b(?:pilot|droids?|hangar|service panel|capacitor|cockpit|supply crates?|open ramp)\b"),
    ),
    "apps/api/app/graph/executors/storyboard_ops.py": (
        ("private campaign character name", r"\b(?:sadi|sadie|bolts)\b"),
        ("campaign subject design", r"\bcyborg[ -]cat\b|\bmechanical forelegs?\b"),
        ("campaign environment/action", r"\b(?:pilot|droids?|hangar|service panel|capacitor|cockpit|supply crates?|open ramp)\b"),
    ),
}


def main() -> int:
    failures: list[str] = []
    for relative_path, patterns in CHECKS.items():
        source = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
        for label, pattern in patterns:
            matches = list(re.finditer(pattern, source, flags=re.IGNORECASE))
            if not matches:
                continue
            line_numbers = sorted({source.count("\n", 0, match.start()) + 1 for match in matches})
            failures.append(f"{relative_path}: {label} at lines {line_numbers}")
    if failures:
        print("Storyboard genericity guard failed:", file=sys.stderr)
        for failure in failures:
            print(f" - {failure}", file=sys.stderr)
        print("Move story nouns and exact creative requirements into declared recipe/workflow user inputs.", file=sys.stderr)
        return 1
    print("Storyboard recipe/compiler genericity guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
