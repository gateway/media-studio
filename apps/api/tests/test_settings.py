import importlib
import os
import sys

import pytest


def _reload_settings_module():
    for name in sorted([key for key in sys.modules if key == "app" or key.startswith("app.")], reverse=True):
        sys.modules.pop(name, None)
    return importlib.import_module("app.settings")


def test_development_allows_default_control_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_STUDIO_APP_ENV", "development")
    monkeypatch.delenv("MEDIA_STUDIO_CONTROL_API_TOKEN", raising=False)

    settings_module = _reload_settings_module()

    assert settings_module.settings.control_api_token == settings_module.DEFAULT_LOCAL_CONTROL_API_TOKEN


def test_production_requires_explicit_control_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_STUDIO_APP_ENV", "production")
    monkeypatch.delenv("MEDIA_STUDIO_CONTROL_API_TOKEN", raising=False)

    with pytest.raises(RuntimeError, match="MEDIA_STUDIO_CONTROL_API_TOKEN is required"):
        _reload_settings_module()


def test_production_rejects_default_control_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_STUDIO_APP_ENV", "production")
    monkeypatch.setenv("MEDIA_STUDIO_CONTROL_API_TOKEN", "media-studio-local-control-token")

    with pytest.raises(RuntimeError, match="must be set to a unique value"):
        _reload_settings_module()


def test_production_rejects_placeholder_control_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEDIA_STUDIO_APP_ENV", "production")
    monkeypatch.setenv("MEDIA_STUDIO_CONTROL_API_TOKEN", "replace_with_a_unique_control_token")

    with pytest.raises(RuntimeError, match="must be set to a unique value"):
        _reload_settings_module()
