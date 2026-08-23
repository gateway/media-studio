from __future__ import annotations

import importlib

import pytest


DRAFT_CASES = [
    (
        "recipe-drafts",
        "recipe",
        "kernel_recipe_draft",
        {
            "key": "contract-recipe",
            "label": "Contract recipe",
            "category": "image",
            "system_prompt_template": "Write an image prompt.",
            "validation_warnings_json": ["Review the output before saving."],
        },
        "draft_prompt_recipe",
        "/presets/prompt-recipes/new",
    ),
    (
        "preset-drafts",
        "preset",
        "kernel_preset_draft",
        {"key": "contract-preset", "label": "Contract preset"},
        "draft_media_preset",
        "/presets/new",
    ),
]


def _session(client) -> dict:
    response = client.post(
        "/media/assistant/sessions",
        json={"owner_kind": "standalone", "provider_kind": "codex_local"},
    )
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize(
    "route,mode,summary_key,draft,capability,review_path",
    DRAFT_CASES,
)
def test_assistant_draft_routes_preserve_success_contract(
    client,
    monkeypatch,
    route: str,
    mode: str,
    summary_key: str,
    draft: dict,
    capability: str,
    review_path: str,
) -> None:
    session = _session(client)
    confirmation_routes = importlib.import_module("app.assistant.confirmation_routes")
    captured = {}

    def fake_create_kernel_message(*, session, payload, attachments):
        captured.update(
            {
                "session_id": session["assistant_session_id"],
                "message": payload.content_text,
                "assistant_mode": payload.assistant_mode,
                "metadata": payload.metadata,
                "attachments": attachments,
            }
        )
        return {**session, "summary_json": {summary_key: draft}}

    monkeypatch.setattr(
        confirmation_routes,
        "create_kernel_message",
        fake_create_kernel_message,
    )

    response = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/{route}",
        json={"message": "Draft this artifact."},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["capability"] == capability
    assert payload["draft"]["key"] == draft["key"]
    assert payload["review_url"] == (
        f"{review_path}?assistantSession={session['assistant_session_id']}"
    )
    assert captured == {
        "session_id": session["assistant_session_id"],
        "message": "Draft this artifact.",
        "assistant_mode": mode,
        "metadata": {"source": f"{mode}_draft_endpoint"},
        "attachments": [],
    }
    if mode == "recipe":
        assert payload["validation_warnings"] == ["Review the output before saving."]


@pytest.mark.parametrize("route", ["recipe-drafts", "preset-drafts"])
def test_assistant_draft_routes_preserve_not_found_and_request_errors(
    client,
    monkeypatch,
    route: str,
) -> None:
    session = _session(client)
    confirmation_routes = importlib.import_module("app.assistant.confirmation_routes")

    missing_session = client.post(
        f"/media/assistant/sessions/missing/{route}",
        json={"message": "Draft this artifact."},
    )
    blank_message = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/{route}",
        json={"message": "   "},
    )
    missing_message = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/{route}",
        json={},
    )

    assert missing_session.status_code == 404
    assert missing_session.json() == {"detail": "assistant session not found"}
    assert blank_message.status_code == 400
    expected_label = "Prompt Recipe" if route == "recipe-drafts" else "Media Preset"
    assert blank_message.json() == {"detail": f"Describe the {expected_label} first."}
    assert missing_message.status_code == 422

    monkeypatch.setattr(
        confirmation_routes,
        "create_kernel_message",
        lambda **kwargs: {**kwargs["session"], "summary_json": {}},
    )
    missing_draft = client.post(
        f"/media/assistant/sessions/{session['assistant_session_id']}/{route}",
        json={"message": "Draft this artifact."},
    )

    assert missing_draft.status_code == 400
    assert missing_draft.json() == {
        "detail": f"The assistant did not produce a validated {expected_label} draft."
    }
