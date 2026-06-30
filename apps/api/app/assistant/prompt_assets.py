from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal


PROMPT_ASSET_ROOT = Path(__file__).with_name("prompts")
MediaPresetPromptRoute = Literal[
    "preset_intake",
    "reference_image_analysis",
    "replacement_field_planning",
    "image_slot_planning",
    "prompt_compilation",
    "show_current_prompt",
    "output_comparison",
    "story_project",
    "general",
]


@dataclass(frozen=True)
class PromptAssembly:
    prompt: str
    prompt_route: str
    loaded_assets: tuple[str, ...]
    char_count: int


def _read_prompt_asset(relative_path: str) -> str:
    path = (PROMPT_ASSET_ROOT / relative_path).resolve()
    if PROMPT_ASSET_ROOT.resolve() not in path.parents and path != PROMPT_ASSET_ROOT.resolve():
        return ""
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


@lru_cache(maxsize=32)
def prompt_asset(relative_path: str) -> str:
    return _read_prompt_asset(relative_path)


def _media_preset_route_assets(prompt_route: str | None) -> tuple[str, ...]:
    route = prompt_route or "general"
    base = ("skills/media_preset_orchestrator.md",)
    route_assets: dict[str, tuple[str, ...]] = {
        "preset_intake": (
            "skills/media_preset/reference_image_analyzer.md",
            "skills/media_preset/replacement_field_planner.md",
            "skills/media_preset/image_slot_planner.md",
            "skills/media_preset/prompt_compiler.md",
            "skills/media_preset/backend_contract.md",
        ),
        "reference_image_analysis": (
            "skills/media_preset/reference_image_analyzer.md",
            "skills/media_preset/backend_contract.md",
        ),
        "replacement_field_planning": (
            "skills/media_preset/replacement_field_planner.md",
            "skills/media_preset/backend_contract.md",
        ),
        "image_slot_planning": (
            "skills/media_preset/image_slot_planner.md",
            "skills/media_preset/backend_contract.md",
        ),
        "prompt_compilation": (
            "skills/media_preset/prompt_compiler.md",
            "skills/media_preset/backend_contract.md",
        ),
        "show_current_prompt": (
            "skills/media_preset/prompt_lookup.md",
        ),
        "output_comparison": (
            "skills/media_preset/output_comparison_judge.md",
        ),
        "story_project": (
            "skills/story_project.md",
        ),
        "general": (),
    }
    return (*base, *route_assets.get(route, route_assets["general"]))


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


def assistant_system_prompt_assembly(prompt_route: str | None = None) -> PromptAssembly:
    asset_paths = _media_preset_route_assets(prompt_route)
    sections = _prompt_sections(asset_paths)
    prompt = "\n\n".join(section for section in sections if section)
    return PromptAssembly(
        prompt=prompt,
        prompt_route=prompt_route or "general",
        loaded_assets=asset_paths,
        char_count=len(prompt),
    )


def assistant_system_prompt(prompt_route: str | None = None) -> str:
    assembly = assistant_system_prompt_assembly(prompt_route)
    return assembly.prompt
