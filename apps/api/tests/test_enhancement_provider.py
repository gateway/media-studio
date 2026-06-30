from __future__ import annotations

import json
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


def test_run_openai_compatible_chat_omits_runtime_overrides_when_not_set(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict = {}
    response = _FakeResponse(
        {
            "id": "chat-1",
            "choices": [{"message": {"content": "prompt result"}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
        }
    )

    monkeypatch.setattr(
        enhancement_provider,
        "_http_client",
        lambda: _FakeClient(response, captured),
    )

    result = enhancement_provider.run_openai_compatible_chat(
        provider_kind="local_openai",
        base_url="http://127.0.0.1:11434/v1",
        api_key=None,
        model_id="local-text-model",
        messages=[{"role": "user", "content": [{"type": "text", "text": "Hello"}]}],
        temperature=None,
        max_tokens=None,
        error_context="prompt node",
    )

    assert result["generated_text"] == "prompt result"
    assert "temperature" not in captured["json"]
    assert "max_tokens" not in captured["json"]


def test_run_codex_local_chat_uses_app_server_turn_result(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class _FakeSession:
        def __init__(self, *, temp_root: Path, timeout_seconds: int) -> None:
            captured["temp_root"] = temp_root
            captured["timeout_seconds"] = timeout_seconds

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def start_thread(self, *, cwd: str, model: str) -> dict[str, object]:
            captured["cwd"] = cwd
            captured["model"] = model
            return {"thread": {"id": "thread-codex-1"}}

        def run_turn(self, *, thread_id: str, input_items: list[dict[str, object]], output_schema=None, cancel_event=None) -> dict[str, object]:
            captured["thread_id"] = thread_id
            captured["input_items"] = input_items
            captured["output_schema"] = output_schema
            return {
                "generated_text": '{"answer":"ok"}',
                "provider_thread_id": thread_id,
                "provider_session_id": thread_id,
                "provider_turn_id": "turn-codex-1",
                "provider_response_id": f"{thread_id}:turn-codex-1",
                "usage": {
                    "prompt_tokens": 120,
                    "completion_tokens": 30,
                    "total_tokens": 150,
                },
            }

    monkeypatch.setattr(enhancement_provider.codex_local_provider, "_CodexAppServerSession", _FakeSession)

    result = enhancement_provider.run_codex_local_chat(
        model_id="gpt-5.4",
        messages=[
            {"role": "system", "content": "Return JSON."},
            {"role": "user", "content": [{"type": "text", "text": "Say ok."}]},
        ],
        response_format={"type": "json_object"},
    )

    assert result["provider_kind"] == "codex_local"
    assert result["provider_model_id"] == "gpt-5.4"
    assert result["provider_thread_id"] == "thread-codex-1"
    assert result["provider_session_id"] == "thread-codex-1"
    assert result["provider_turn_id"] == "turn-codex-1"
    assert result["provider_response_id"] == "thread-codex-1:turn-codex-1"
    assert result["provider_thread_reused"] is False
    assert result["generated_text"] == '{"answer":"ok"}'
    assert result["usage"]["prompt_tokens"] == 120
    assert result["usage"]["completion_tokens"] == 30
    assert result["usage"]["total_tokens"] == 150
    assert captured["thread_id"] == "thread-codex-1"
    assert captured["output_schema"] is None
    input_items = captured["input_items"]
    assert isinstance(input_items, list)
    assert input_items[0]["type"] == "text"
    assert "SYSTEM:" in str(input_items[0]["text"])
    assert "Return exactly one valid JSON object" in str(input_items[0]["text"])
    assert "USER:" in str(input_items[0]["text"])


def test_run_codex_local_chat_converts_data_url_images_to_local_inputs(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class _FakeSession:
        def __init__(self, *, temp_root: Path, timeout_seconds: int) -> None:
            captured["temp_root"] = temp_root

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def start_thread(self, *, cwd: str, model: str) -> dict[str, object]:
            return {"thread": {"id": "thread-codex-image"}}

        def run_turn(self, *, thread_id: str, input_items: list[dict[str, object]], output_schema=None, cancel_event=None) -> dict[str, object]:
            captured["input_items"] = input_items
            return {
                "generated_text": "A tiny white square.",
                "provider_thread_id": thread_id,
                "provider_session_id": thread_id,
                "provider_turn_id": "turn-codex-image",
                "provider_response_id": f"{thread_id}:turn-codex-image",
                "usage": {},
            }

    monkeypatch.setattr(enhancement_provider.codex_local_provider, "_CodexAppServerSession", _FakeSession)

    result = enhancement_provider.run_codex_local_chat(
        model_id="gpt-5.4",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Describe the image."},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/png;base64,"
                            + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Z7d8AAAAASUVORK5CYII="
                        },
                    },
                ],
            }
        ],
    )

    assert result["generated_text"] == "A tiny white square."
    input_items = captured["input_items"]
    assert isinstance(input_items, list)
    assert any(item["type"] == "localImage" for item in input_items)


def test_run_codex_local_chat_reuses_managed_skill_thread(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {"session_count": 0, "start_count": 0, "turn_count": 0, "exit_count": 0}

    class _FakeSession:
        def __init__(self, *, temp_root: Path, timeout_seconds: int) -> None:
            captured["session_count"] = int(captured["session_count"]) + 1
            self.temp_root = temp_root

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            captured["exit_count"] = int(captured["exit_count"]) + 1

        def start_thread(self, *, cwd: str, model: str) -> dict[str, object]:
            captured["start_count"] = int(captured["start_count"]) + 1
            return {"thread": {"id": "thread-managed-1"}}

        def run_turn(self, *, thread_id: str, input_items: list[dict[str, object]], output_schema=None, cancel_event=None) -> dict[str, object]:
            captured["turn_count"] = int(captured["turn_count"]) + 1
            turn_id = f"turn-managed-{captured['turn_count']}"
            return {
                "generated_text": f"reply {captured['turn_count']}",
                "provider_thread_id": thread_id,
                "provider_session_id": thread_id,
                "provider_turn_id": turn_id,
                "provider_response_id": f"{thread_id}:{turn_id}",
                "usage": {},
            }

    monkeypatch.setattr(enhancement_provider.codex_local_provider, "_CodexAppServerSession", _FakeSession)
    enhancement_provider.codex_local_provider.close_codex_local_skill_sessions()

    first = enhancement_provider.run_codex_local_chat(
        model_id="gpt-5.4",
        messages=[{"role": "user", "content": "First turn."}],
        codex_session_key="assistant|asst_1|workflow|wf_1|attachments|hash_1",
    )
    second = enhancement_provider.run_codex_local_chat(
        model_id="gpt-5.4",
        messages=[{"role": "user", "content": "Second turn."}],
        codex_session_key="assistant|asst_1|workflow|wf_1|attachments|hash_1",
        provider_thread_id="thread-managed-1",
    )

    assert first["provider_thread_id"] == "thread-managed-1"
    assert first["provider_turn_id"] == "turn-managed-1"
    assert first["provider_thread_reused"] is False
    assert second["provider_thread_id"] == "thread-managed-1"
    assert second["provider_turn_id"] == "turn-managed-2"
    assert second["provider_thread_reused"] is True
    assert second["provider_response_id"] == "thread-managed-1:turn-managed-2"
    assert captured["session_count"] == 1
    assert captured["start_count"] == 1
    assert captured["turn_count"] == 2

    enhancement_provider.codex_local_provider.close_codex_local_skill_sessions()
    assert captured["exit_count"] == 1


def test_run_codex_local_chat_records_fallback_when_requested_thread_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {"start_count": 0}

    class _FakeSession:
        def __init__(self, *, temp_root: Path, timeout_seconds: int) -> None:
            return None

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def start_thread(self, *, cwd: str, model: str) -> dict[str, object]:
            captured["start_count"] = int(captured["start_count"]) + 1
            return {"thread": {"id": f"thread-managed-{captured['start_count']}"}}

        def run_turn(self, *, thread_id: str, input_items: list[dict[str, object]], output_schema=None, cancel_event=None) -> dict[str, object]:
            return {
                "generated_text": "ok",
                "provider_thread_id": thread_id,
                "provider_session_id": thread_id,
                "provider_turn_id": f"turn-{captured['start_count']}",
                "provider_response_id": f"{thread_id}:turn-{captured['start_count']}",
                "usage": {},
            }

    monkeypatch.setattr(enhancement_provider.codex_local_provider, "_CodexAppServerSession", _FakeSession)
    enhancement_provider.codex_local_provider.close_codex_local_skill_sessions()

    first = enhancement_provider.run_codex_local_chat(
        model_id="gpt-5.4",
        messages=[{"role": "user", "content": "First turn."}],
        codex_session_key="assistant|asst_1|workflow|wf_1|attachments|hash_1",
    )
    second = enhancement_provider.run_codex_local_chat(
        model_id="gpt-5.4",
        messages=[{"role": "user", "content": "Recover turn."}],
        codex_session_key="assistant|asst_1|workflow|wf_1|attachments|hash_1",
        provider_thread_id="missing-thread",
    )

    assert first["provider_thread_id"] == "thread-managed-1"
    assert second["provider_thread_id"] == "thread-managed-2"
    assert second["provider_thread_reused"] is False
    assert second["fallback_mode"] == "provider_thread_unavailable"

    enhancement_provider.codex_local_provider.close_codex_local_skill_sessions()


def test_run_codex_local_chat_cleans_managed_session_after_cancelled_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {"start_count": 0, "exit_count": 0, "cancel_next": True}

    class _FakeSession:
        def __init__(self, *, temp_root: Path, timeout_seconds: int) -> None:
            return None

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            captured["exit_count"] = int(captured["exit_count"]) + 1

        def start_thread(self, *, cwd: str, model: str) -> dict[str, object]:
            captured["start_count"] = int(captured["start_count"]) + 1
            return {"thread": {"id": f"thread-cancel-{captured['start_count']}"}}

        def run_turn(self, *, thread_id: str, input_items: list[dict[str, object]], output_schema=None, cancel_event=None) -> dict[str, object]:
            if captured["cancel_next"]:
                captured["cancel_next"] = False
                raise enhancement_provider.codex_local_provider.CodexLocalProviderCancelled("cancelled")
            return {
                "generated_text": "ok",
                "provider_thread_id": thread_id,
                "provider_session_id": thread_id,
                "provider_turn_id": "turn-after-cancel",
                "provider_response_id": f"{thread_id}:turn-after-cancel",
                "usage": {},
            }

    monkeypatch.setattr(enhancement_provider.codex_local_provider, "_CodexAppServerSession", _FakeSession)
    enhancement_provider.codex_local_provider.close_codex_local_skill_sessions()

    with pytest.raises(enhancement_provider.EnhancementProviderError, match="cancelled"):
        enhancement_provider.run_codex_local_chat(
            model_id="gpt-5.4",
            messages=[{"role": "user", "content": "Cancelled turn."}],
            codex_session_key="assistant|asst_1|workflow|wf_1|attachments|hash_cancel",
        )

    recovered = enhancement_provider.run_codex_local_chat(
        model_id="gpt-5.4",
        messages=[{"role": "user", "content": "Recovered turn."}],
        codex_session_key="assistant|asst_1|workflow|wf_1|attachments|hash_cancel",
    )

    assert captured["start_count"] == 2
    assert captured["exit_count"] == 1
    assert recovered["provider_thread_id"] == "thread-cancel-2"
    assert recovered["provider_thread_reused"] is False

    enhancement_provider.codex_local_provider.close_codex_local_skill_sessions()


def test_run_codex_local_chat_cleans_managed_session_after_failed_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {"start_count": 0, "exit_count": 0, "fail_next": True}

    class _FakeSession:
        def __init__(self, *, temp_root: Path, timeout_seconds: int) -> None:
            return None

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            captured["exit_count"] = int(captured["exit_count"]) + 1

        def start_thread(self, *, cwd: str, model: str) -> dict[str, object]:
            captured["start_count"] = int(captured["start_count"]) + 1
            return {"thread": {"id": f"thread-timeout-{captured['start_count']}"}}

        def run_turn(self, *, thread_id: str, input_items: list[dict[str, object]], output_schema=None, cancel_event=None) -> dict[str, object]:
            if captured["fail_next"]:
                captured["fail_next"] = False
                raise enhancement_provider.codex_local_provider.CodexLocalProviderError("Codex Local timed out while waiting for a response.")
            return {
                "generated_text": "ok",
                "provider_thread_id": thread_id,
                "provider_session_id": thread_id,
                "provider_turn_id": "turn-after-timeout",
                "provider_response_id": f"{thread_id}:turn-after-timeout",
                "usage": {},
            }

    monkeypatch.setattr(enhancement_provider.codex_local_provider, "_CodexAppServerSession", _FakeSession)
    enhancement_provider.codex_local_provider.close_codex_local_skill_sessions()

    with pytest.raises(enhancement_provider.EnhancementProviderError, match="timed out"):
        enhancement_provider.run_codex_local_chat(
            model_id="gpt-5.4",
            messages=[{"role": "user", "content": "Timeout turn."}],
            codex_session_key="assistant|asst_1|workflow|wf_1|attachments|hash_timeout",
        )

    recovered = enhancement_provider.run_codex_local_chat(
        model_id="gpt-5.4",
        messages=[{"role": "user", "content": "Recovered turn."}],
        codex_session_key="assistant|asst_1|workflow|wf_1|attachments|hash_timeout",
    )

    assert captured["start_count"] == 2
    assert captured["exit_count"] == 1
    assert recovered["provider_thread_id"] == "thread-timeout-2"
    assert recovered["provider_thread_reused"] is False

    enhancement_provider.codex_local_provider.close_codex_local_skill_sessions()


def test_run_codex_local_chat_rejects_unsupported_response_format() -> None:
    with pytest.raises(
        enhancement_provider.EnhancementProviderError,
        match="does not support response_format",
    ):
        enhancement_provider.run_codex_local_chat(
            model_id="gpt-5.4",
            messages=[{"role": "user", "content": "Say ok."}],
            response_format={"type": "text"},
        )


def test_run_codex_local_chat_normalizes_json_schema_for_app_server(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class _FakeSession:
        def __init__(self, *, temp_root: Path, timeout_seconds: int) -> None:
            return None

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def start_thread(self, *, cwd: str, model: str) -> dict[str, object]:
            return {"thread": {"id": "thread-codex-schema"}}

        def run_turn(self, *, thread_id: str, input_items: list[dict[str, object]], output_schema=None, cancel_event=None) -> dict[str, object]:
            captured["output_schema"] = output_schema
            return {
                "generated_text": '{"answer":"ok","details":{"summary":"done"}}',
                "provider_thread_id": thread_id,
                "provider_session_id": thread_id,
                "provider_turn_id": "turn-codex-schema",
                "provider_response_id": f"{thread_id}:turn-codex-schema",
                "usage": {},
            }

    monkeypatch.setattr(enhancement_provider.codex_local_provider, "_CodexAppServerSession", _FakeSession)

    result = enhancement_provider.run_codex_local_chat(
        model_id="gpt-5.4",
        messages=[{"role": "user", "content": "Return JSON."}],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "schema": {
                    "type": "object",
                    "properties": {
                        "answer": {"type": "string"},
                        "details": {
                            "type": "object",
                            "properties": {
                                "summary": {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
    )

    assert result["generated_text"] == '{"answer":"ok","details":{"summary":"done"}}'
    assert captured["output_schema"] == {
        "type": "object",
        "properties": {
            "answer": {"type": "string"},
            "details": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                },
                "additionalProperties": False,
                "required": ["summary"],
            },
        },
        "additionalProperties": False,
        "required": ["answer", "details"],
    }


def test_test_codex_local_connection_uses_probe_bundle_result(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(enhancement_provider.codex_local_provider, "codex_command_path", lambda: "/opt/homebrew/bin/codex")
    monkeypatch.setattr(
        enhancement_provider.codex_local_provider,
        "_probe_bundle",
        lambda **_: (
            {"type": "chatgpt", "planType": "pro", "email": "test@example.com"},
            {
                "id": enhancement_provider.codex_local_provider.CODEX_LOCAL_DEFAULT_MODEL,
                "label": "GPT-5.4",
                "provider": "codex_local",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {"billing_kind": "subscription"},
            },
            [
                {
                    "id": enhancement_provider.codex_local_provider.CODEX_LOCAL_DEFAULT_MODEL,
                    "label": "GPT-5.4",
                    "provider": "codex_local",
                    "supports_images": True,
                    "input_modalities": ["text", "image"],
                    "raw": {"billing_kind": "subscription"},
                }
            ],
            {"provider_response_id": "thread-codex-default"},
        ),
    )

    result = enhancement_provider.test_codex_local_connection(model_id=None, require_images=False)

    assert result["ok"] is True
    assert result["provider"] == "codex_local"
    assert result["credential_source"] == enhancement_provider.codex_local_provider.CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE
    assert result["selected_model"]["id"] == enhancement_provider.codex_local_provider.CODEX_LOCAL_DEFAULT_MODEL
    assert result["selected_model"]["raw"]["provider_base_url"] == enhancement_provider.codex_local_provider.CODEX_LOCAL_PROVIDER_BASE_URL
    assert result["selected_model"]["raw"]["plan_type"] == "pro"


def test_load_codex_local_catalog_wraps_provider_result(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        enhancement_provider.codex_local_provider,
        "load_codex_local_catalog",
        lambda **_: {
            "ok": True,
            "provider": "codex_local",
            "credential_source": enhancement_provider.codex_local_provider.CODEX_LOCAL_PROVIDER_CREDENTIAL_SOURCE,
            "selected_model": {
                "id": "gpt-5.4",
                "label": "GPT-5.4",
                "provider": "codex_local",
                "supports_images": True,
                "input_modalities": ["text", "image"],
                "raw": {"catalog_cache_hit": True},
            },
            "available_models": [],
        },
    )

    result = enhancement_provider.load_codex_local_catalog(model_id="gpt-5.4", require_images=False)

    assert result["provider"] == "codex_local"
    assert result["selected_model"]["raw"]["catalog_cache_hit"] is True


def test_probe_bundle_requires_chatgpt_login(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(enhancement_provider.codex_local_provider, "codex_command_path", lambda: "/opt/homebrew/bin/codex")

    class _FakeSession:
        def __init__(self, *, temp_root: Path, timeout_seconds: int) -> None:
            return None

        def __enter__(self) -> "_FakeSession":
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def read_account(self) -> dict[str, object]:
            return {"account": {"type": "apiKey"}, "requiresOpenaiAuth": False}

        def list_models(self) -> list[dict[str, object]]:
            return []

    monkeypatch.setattr(enhancement_provider.codex_local_provider, "_CodexAppServerSession", _FakeSession)

    with pytest.raises(
        enhancement_provider.EnhancementProviderError,
        match="ChatGPT-backed Codex login",
    ):
        enhancement_provider.test_codex_local_connection(model_id="gpt-5.4", require_images=False)
