#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path


SOURCE_PATTERN = re.compile(
    r"(?:text|bg|border)-(?:white|black)(?:/|\b)|rgba\(|#[0-9a-fA-F]{3,8}\b"
)
STYLE_PATTERN = re.compile(r"rgba\(|#[0-9a-fA-F]{3,8}\b")

SOURCE_EXTENSIONS = {".ts", ".tsx"}
STYLE_EXTENSIONS = {".css"}
SOURCE_MAX_DEFAULT = 230
STYLE_MAX_DEFAULT = 220

IGNORED_SUFFIXES = (
    ".test.ts",
    ".test.tsx",
    ".d.ts",
)
IGNORED_EXACT = {
    "apps/web/app/globals.css",
    "apps/web/app/icon.svg",
}


def tracked_files(repo_root: Path) -> list[str]:
    output = subprocess.check_output(["git", "-C", str(repo_root), "ls-files"], text=True)
    return output.splitlines()


def should_skip(path: str) -> bool:
    if path in IGNORED_EXACT:
        return True
    if not path.startswith("apps/web/"):
        return True
    return any(path.endswith(suffix) for suffix in IGNORED_SUFFIXES)


def count_matches(repo_root: Path, paths: list[str], extensions: set[str], pattern: re.Pattern[str]) -> tuple[int, Counter[str]]:
    total = 0
    by_file: Counter[str] = Counter()
    for rel_path in paths:
        if should_skip(rel_path):
            continue
        if Path(rel_path).suffix not in extensions:
            continue
        text = (repo_root / rel_path).read_text(errors="ignore")
        count = len(pattern.findall(text))
        if count:
            total += count
            by_file[rel_path] = count
    return total, by_file


def print_top(label: str, by_file: Counter[str]) -> None:
    print(f"{label}:")
    if not by_file:
        print("  none")
        return
    for path, count in by_file.most_common(12):
        print(f"  {count:>4}  {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Report direct theme-color/style drift outside token files.")
    parser.add_argument("--max-source", type=int, default=SOURCE_MAX_DEFAULT)
    parser.add_argument("--max-style", type=int, default=STYLE_MAX_DEFAULT)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    files = tracked_files(repo_root)
    source_total, source_by_file = count_matches(repo_root, files, SOURCE_EXTENSIONS, SOURCE_PATTERN)
    style_total, style_by_file = count_matches(repo_root, files, STYLE_EXTENSIONS, STYLE_PATTERN)

    print("Style drift report")
    print(f"Source direct color/style hits: {source_total} / {args.max_source}")
    print(f"Graph/style CSS raw color hits: {style_total} / {args.max_style}")
    print_top("Top source files", source_by_file)
    print_top("Top CSS files", style_by_file)

    failures: list[str] = []
    if source_total > args.max_source:
        failures.append(f"source hits {source_total} exceed max {args.max_source}")
    if style_total > args.max_style:
        failures.append(f"CSS hits {style_total} exceed max {args.max_style}")
    if failures:
        print("Style drift guardrail failed:", file=sys.stderr)
        for failure in failures:
            print(f" - {failure}", file=sys.stderr)
        print("Move repeated colors/classes onto semantic tokens or intentionally raise the guardrail.", file=sys.stderr)
        return 1
    print("Style drift guardrail passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
