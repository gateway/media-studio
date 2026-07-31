from __future__ import annotations

from typing import Any, Dict

from .. import enhancement_provider, store


GLOBAL_ENHANCEMENT_CONFIG_KEY = "__studio_enhancement__"


def studio_default_prompt_provider_config() -> Dict[str, Any]:
    config = store.get_enhancement_config(GLOBAL_ENHANCEMENT_CONFIG_KEY) or {}
    if config:
        return config
    default_model = enhancement_provider.codex_local_provider.CODEX_LOCAL_DEFAULT_MODEL
    return {
        "provider_kind": "codex_local",
        "provider_label": "Codex Local",
        "provider_model_id": default_model,
        "provider_supports_images": True,
        "provider_status": "active",
        "provider_capabilities_json": {
            "provider": "codex_local",
            "credential_source": enhancement_provider.codex_local_provider.CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE,
            "default_model": default_model,
        },
    }
