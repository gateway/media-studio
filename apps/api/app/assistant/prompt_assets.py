from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
PROMPT_ASSET_ROOT = Path(__file__).with_name("prompts")
PROMPT_ASSET_REPO_PREFIX = "apps/api/app/assistant/prompts/"


@dataclass(frozen=True)
class PromptAssembly:
    prompt: str
    prompt_route: str
    loaded_assets: tuple[str, ...]
    char_count: int


def _read_prompt_asset(relative_path: str) -> str:
    prompt_relative_path = (
        relative_path.removeprefix(PROMPT_ASSET_REPO_PREFIX)
        if relative_path.startswith(PROMPT_ASSET_REPO_PREFIX)
        else relative_path
    )
    path = (PROMPT_ASSET_ROOT / prompt_relative_path).resolve()
    if PROMPT_ASSET_ROOT.resolve() not in path.parents and path != PROMPT_ASSET_ROOT.resolve():
        return ""
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


@lru_cache(maxsize=32)
def prompt_asset(relative_path: str) -> str:
    return _read_prompt_asset(relative_path)


def _prompt_sections(asset_paths: tuple[str, ...]) -> list[str]:
    return [
        prompt_asset("persona.md"),
        prompt_asset("response_policy.md"),
        *(prompt_asset(path) for path in asset_paths),
        (
            "Stay inside Media Studio. Infer whether the user wants a workflow, Prompt Recipe, "
            "Media Preset, repair, or explanation. Do not claim that you changed the graph, saved data, "
            "ran jobs, or edited files unless the backend context says so. When workflow changes are needed, "
            "describe the plan in plain language and tell the user to review it before applying."
        ),
    ]


def assistant_system_prompt_assembly(
    prompt_route: str | None = None,
    *,
    capability_prompt_asset: str | None = None,
) -> PromptAssembly:
    asset_paths = (capability_prompt_asset,) if capability_prompt_asset else ()
    sections = _prompt_sections(asset_paths)
    prompt = "\n\n".join(section for section in sections if section)
    return PromptAssembly(
        prompt=prompt,
        prompt_route=prompt_route or "general",
        loaded_assets=asset_paths,
        char_count=len(prompt),
    )


def assistant_system_prompt(
    prompt_route: str | None = None,
    *,
    capability_prompt_asset: str | None = None,
) -> str:
    assembly = assistant_system_prompt_assembly(
        prompt_route,
        capability_prompt_asset=capability_prompt_asset,
    )
    return assembly.prompt
