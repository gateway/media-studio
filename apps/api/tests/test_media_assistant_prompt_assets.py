from __future__ import annotations

import json

from app.assistant.kernel import KERNEL_CAPABILITY_PROMPTS
from app.assistant.guides import TurnGuideContext
from app.assistant.prompt_assets import (
    assistant_thread_prompt_assembly,
    capability_prompt,
    prompt_asset,
)


def test_thread_prompt_places_stable_assets_once_in_protocol_instructions() -> None:
    skill_assets = tuple(KERNEL_CAPABILITY_PROMPTS.values())
    assembly = assistant_thread_prompt_assembly(
        developer_addendum="typed tool catalog",
    )

    assert assembly.base_instructions == prompt_asset("persona.md")
    assert prompt_asset("response_policy.md") in assembly.developer_instructions
    assert "typed tool catalog" in assembly.developer_instructions
    assert assembly.loaded_assets == (
        "apps/api/app/assistant/prompts/persona.md",
        "apps/api/app/assistant/prompts/response_policy.md",
    )
    for asset_path in skill_assets:
        assert prompt_asset(asset_path) not in assembly.base_instructions
        assert prompt_asset(asset_path) not in assembly.developer_instructions


def test_each_kernel_capability_loads_its_prompt_asset() -> None:
    for capability, asset_path in KERNEL_CAPABILITY_PROMPTS.items():
        assert prompt_asset(asset_path)
        assert capability_prompt(capability) == prompt_asset(asset_path)


def test_kernel_guides_include_only_the_selected_skill_without_shared_policy() -> None:
    for capability, selected_asset in KERNEL_CAPABILITY_PROMPTS.items():
        context = TurnGuideContext()
        assert "error" not in context.load(capability)
        fragments = context.application_context()
        manifest = json.loads(fragments["media_studio_guides"]["value"])
        payload = json.loads("".join(fragments[key]["value"] for key in manifest["parts"]))
        assert context.assets() == [selected_asset]
        assert [guide["instructions"] for guide in payload["guides"]] == [prompt_asset(selected_asset)]
        assert prompt_asset("response_policy.md") not in payload["guides"][0]["instructions"]
