#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    media_root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    sys.path.insert(0, str(media_root / "apps" / "api"))

    from app import store  # noqa: WPS433
    from app.codex_local_provider import CODEX_LOCAL_DEFAULT_MODEL  # noqa: WPS433

    db_path = os.environ.get("MEDIA_STUDIO_DB_PATH")
    if db_path:
        store.bootstrap_schema(Path(db_path))
    else:
        store.bootstrap_schema()

    store.create_or_update_enhancement_config(
        {
            "config_id": "cfg-__studio_enhancement__",
            "model_key": "__studio_enhancement__",
            "label": "Studio enhancement",
            "helper_profile": "midctx-64k-no-thinking-q3-prefill",
            "provider_kind": "codex_local",
            "provider_label": "Codex Local",
            "provider_model_id": CODEX_LOCAL_DEFAULT_MODEL,
            "provider_api_key": None,
            "provider_base_url": None,
            "provider_supports_images": True,
            "provider_status": "active",
            "provider_capabilities_json": {
                "provider": "codex_local",
                "credential_source": "codex_local_login",
                "default_model": CODEX_LOCAL_DEFAULT_MODEL,
            },
            "supports_text_enhancement": True,
            "supports_image_analysis": True,
        }
    )
    store.create_or_update_prompt_recipe_drafting_config(
        {
            "config_key": "prompt_recipe_drafting",
            "enabled": True,
            "provider_kind": "codex_local",
            "provider_label": "Codex Local",
            "provider_model_id": CODEX_LOCAL_DEFAULT_MODEL,
            "provider_base_url": None,
            "provider_supports_images": True,
            "provider_status": "active",
            "provider_capabilities_json": {
                "provider": "codex_local",
                "credential_source": "codex_local_login",
                "default_model": CODEX_LOCAL_DEFAULT_MODEL,
            },
            "temperature": 0.2,
            "max_tokens": 1800,
        }
    )
    print(f"Codex Local defaults saved with {CODEX_LOCAL_DEFAULT_MODEL}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
