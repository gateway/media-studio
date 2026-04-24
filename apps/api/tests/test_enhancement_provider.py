from __future__ import annotations

from pathlib import Path

import pytest

from app import enhancement_provider


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    def __init__(self, response: _FakeResponse, captured: dict) -> None:
        self.response = response
        self.captured = captured

    def __enter__(self) -> "_FakeClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def post(self, url: str, *, headers: dict, json: dict) -> _FakeResponse:
        self.captured["url"] = url
        self.captured["headers"] = headers
        self.captured["json"] = json
        return self.response


def test_image_path_to_data_url_resolves_paths_relative_to_data_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    relative_path = Path("reference-media/images/enhance-ref.png")
    absolute_path = tmp_path / relative_path
    absolute_path.parent.mkdir(parents=True, exist_ok=True)
    absolute_path.write_bytes(b"\x89PNG\r\n\x1a\npng-bytes")

    monkeypatch.setattr(enhancement_provider.settings, "data_root", tmp_path)

    data_url = enhancement_provider._image_path_to_data_url(str(relative_path))

    assert data_url.startswith("data:image/png;base64,")


def test_run_openai_compatible_enhancement_disables_reasoning_for_openrouter(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}
    response = _FakeResponse(
        {
            "choices": [
                {
                    "message": {
                        "content": '{"enhanced_prompt":"better prompt","image_analysis":null,"warnings":[]}',
                    }
                }
            ]
        }
    )

    monkeypatch.setattr(
        enhancement_provider,
        "_http_client",
        lambda: _FakeClient(response, captured),
    )

    result = enhancement_provider.run_openai_compatible_enhancement(
        provider_kind="openrouter",
        base_url="https://openrouter.ai/api/v1",
        api_key="test-key",
        model_id="qwen/qwen3.5-35b-a3b",
        prompt="make it better",
        media_model_key="nano-banana-2",
        task_mode="text_to_image",
        system_prompt="Return JSON",
        image_analysis_prompt=None,
        image_paths=[],
    )

    assert captured["json"]["reasoning"] == {"effort": "none", "exclude": True}
    assert result["enhanced_prompt"] == "better prompt"


def test_run_openai_compatible_enhancement_rejects_reasoning_only_responses(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}
    response = _FakeResponse(
        {
            "choices": [
                {
                    "message": {
                        "content": None,
                        "reasoning": "Thinking through the prompt rewrite.",
                    }
                }
            ]
        }
    )

    monkeypatch.setattr(
        enhancement_provider,
        "_http_client",
        lambda: _FakeClient(response, captured),
    )

    with pytest.raises(
        enhancement_provider.EnhancementProviderError,
        match="reasoning tokens without a final answer",
    ):
        enhancement_provider.run_openai_compatible_enhancement(
            provider_kind="openrouter",
            base_url="https://openrouter.ai/api/v1",
            api_key="test-key",
            model_id="qwen/qwen3.5-35b-a3b",
            prompt="make it better",
            media_model_key="nano-banana-2",
            task_mode="text_to_image",
            system_prompt="Return JSON",
            image_analysis_prompt=None,
            image_paths=[],
        )
