from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import CONTROL_HEADERS


@pytest.mark.parametrize("flag_value", [None, "true", "yes", "on"])
def test_media_assistant_requires_exact_environment_opt_in(
    tmp_path: Path,
    monkeypatch,
    flag_value: str | None,
) -> None:
    if flag_value is None:
        monkeypatch.delenv("NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG", raising=False)
    else:
        monkeypatch.setenv("NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG", flag_value)
    dotenv_module = importlib.import_module("dotenv")
    monkeypatch.setattr(dotenv_module, "load_dotenv", lambda *args, **kwargs: False)
    monkeypatch.setenv("MEDIA_STUDIO_DB_PATH", str(tmp_path / "disabled.db"))
    monkeypatch.setenv("MEDIA_STUDIO_DATA_ROOT", str(tmp_path / "data"))
    monkeypatch.setenv(
        "MEDIA_STUDIO_CONTROL_API_TOKEN",
        CONTROL_HEADERS["x-media-studio-control-token"],
    )
    monkeypatch.setenv("MEDIA_ENABLE_LIVE_SUBMIT", "0")
    monkeypatch.setenv("MEDIA_BACKGROUND_POLL_ENABLED", "0")
    monkeypatch.setenv("MEDIA_PRICING_REFRESH_ON_STARTUP", "0")

    for name in sorted(
        [key for key in sys.modules if key == "app" or key.startswith("app.")],
        reverse=True,
    ):
        sys.modules.pop(name, None)

    main = importlib.import_module("app.main")
    store = importlib.import_module("app.store")
    store.bootstrap_schema()

    with TestClient(main.app, headers=CONTROL_HEADERS) as client:
        assistant = client.post(
            "/media/assistant/sessions",
            json={"owner_kind": "standalone"},
        )
        health = client.get("/health")

    assert assistant.status_code == 404
    assert health.status_code == 200
    assert health.json()["media_assistant_enabled"] is False


def test_enabled_media_assistant_route_and_health_are_available(client) -> None:
    session = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone"},
    )

    assert session.status_code == 200
    assert client.get("/health").json()["media_assistant_enabled"] is True
