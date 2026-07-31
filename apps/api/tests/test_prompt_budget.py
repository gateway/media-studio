from __future__ import annotations

import pytest


def test_build_validation_bundle_rejects_prompt_over_model_limit(app_modules, monkeypatch) -> None:
    service = app_modules["service"]
    schemas = app_modules["schemas"]
    calls = {"resolve": 0, "validate": 0, "preflight": 0}

    def fail_resolve(_raw_request):
        calls["resolve"] += 1
        raise AssertionError("prompt budget should fail before prompt context resolution")

    def fail_validate(_raw_request):
        calls["validate"] += 1
        raise AssertionError("prompt budget should fail before KIE validation")

    def fail_preflight(_validation):
        calls["preflight"] += 1
        raise AssertionError("prompt budget should fail before preflight")

    monkeypatch.setattr(service.kie_adapter, "resolve_prompt_context", fail_resolve)
    monkeypatch.setattr(service.kie_adapter, "validate_request", fail_validate)
    monkeypatch.setattr(service.kie_adapter, "run_preflight", fail_preflight)

    with pytest.raises(service.ServiceError, match="Prompt is too long"):
        service.build_validation_bundle(
            schemas.ValidateRequest(
                model_key="gpt-image-2-text-to-image",
                task_mode="text_to_image",
                prompt="x" * 20001,
                options={},
            )
        )

    assert calls == {"resolve": 0, "validate": 0, "preflight": 0}


def test_prompt_budget_unknown_model_limit_is_non_blocking(app_modules, monkeypatch) -> None:
    prompt_budget = __import__("app.service_prompt_budget", fromlist=["enforce_prompt_budget"])

    monkeypatch.setattr(
        prompt_budget.kie_adapter,
        "get_model",
        lambda _model_key: {"raw": {"prompt": {"max_chars": None}}},
    )

    summary = prompt_budget.enforce_prompt_budget("seedance-2.0", "x" * 30000)

    assert summary == {
        "model_key": "seedance-2.0",
        "current_chars": 30000,
        "max_chars": None,
        "over_limit": False,
    }

