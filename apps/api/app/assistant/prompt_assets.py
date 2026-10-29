from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .schemas import AssistantKernelCapability


PROMPT_ASSET_ROOT = Path(__file__).with_name("prompts")
PROMPT_ASSET_REPO_PREFIX = "apps/api/app/assistant/prompts/"
SHARED_PROMPT_ASSETS = (
    f"{PROMPT_ASSET_REPO_PREFIX}persona.md",
    f"{PROMPT_ASSET_REPO_PREFIX}response_policy.md",
)
KERNEL_CAPABILITY_PROMPTS: dict[AssistantKernelCapability, str] = {
    "general": f"{PROMPT_ASSET_REPO_PREFIX}skills/general_helper.md",
    "graph_builder": f"{PROMPT_ASSET_REPO_PREFIX}skills/graph_workflow_builder.md",
    "preset_builder": f"{PROMPT_ASSET_REPO_PREFIX}skills/media_preset_builder.md",
    "recipe_builder": f"{PROMPT_ASSET_REPO_PREFIX}skills/prompt_recipe_builder.md",
    "story_builder": f"{PROMPT_ASSET_REPO_PREFIX}skills/story_project.md",
    "run_debugger": f"{PROMPT_ASSET_REPO_PREFIX}skills/run_debugger.md",
}


@dataclass(frozen=True)
class ThreadPromptAssembly:
    base_instructions: str
    developer_instructions: str
    loaded_assets: tuple[str, ...]


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
    except (OSError, UnicodeError):
        return ""


@lru_cache(maxsize=32)
def prompt_asset(relative_path: str) -> str:
    return _read_prompt_asset(relative_path)


def capability_prompt(guide_id: AssistantKernelCapability) -> str:
    """Read once per active turn, rather than pinning a guide to the process cache."""
    return _read_prompt_asset(KERNEL_CAPABILITY_PROMPTS[guide_id])


def assistant_thread_prompt_assembly(
    capability_prompt_assets: tuple[str, ...],
    *,
    developer_addendum: str = "",
) -> ThreadPromptAssembly:
    developer_sections = [
        prompt_asset("response_policy.md"),
        *(prompt_asset(path) for path in capability_prompt_assets),
        (
            "Stay inside Media Studio. Infer whether the user wants a workflow, Prompt Recipe, "
            "Media Preset, repair, or explanation. Do not claim that you changed the graph, saved data, "
            "ran jobs, or edited files unless the backend context says so. When workflow changes are needed, "
            "describe the plan in plain language and tell the user to review it before applying."
        ),
        developer_addendum,
    ]
    return ThreadPromptAssembly(
        base_instructions=prompt_asset("persona.md"),
        developer_instructions="\n\n".join(section for section in developer_sections if section),
        loaded_assets=(*SHARED_PROMPT_ASSETS, *capability_prompt_assets),
    )
