from __future__ import annotations

from app.assistant.kernel import KERNEL_CAPABILITY_PROMPTS
from app.assistant.prompt_assets import assistant_system_prompt_assembly, prompt_asset


def test_each_kernel_capability_loads_its_prompt_asset() -> None:
    for capability, asset_path in KERNEL_CAPABILITY_PROMPTS.items():
        assembly = assistant_system_prompt_assembly(
            capability_prompt_asset=asset_path,
        )

        assert prompt_asset(asset_path)
        assert asset_path in assembly.loaded_assets
        assert prompt_asset(asset_path) in assembly.prompt
        assert assembly.char_count == len(assembly.prompt)


def test_kernel_capability_assemblies_include_shared_policy_and_only_the_selected_skill() -> None:
    skill_assets = set(KERNEL_CAPABILITY_PROMPTS.values())

    for selected_asset in skill_assets:
        assembly = assistant_system_prompt_assembly(
            capability_prompt_asset=selected_asset,
        )

        assert prompt_asset("persona.md") in assembly.prompt
        assert prompt_asset("response_policy.md") in assembly.prompt
        assert set(assembly.loaded_assets) == {selected_asset}
        for other_asset in skill_assets - {selected_asset}:
            assert prompt_asset(other_asset) not in assembly.prompt
