"""Recipe authorization through real routing; service/store calls are dummy spies."""
import pytest

from conftest import CONTROL_HEADERS


RECIPE_INPUT = {
    "key": "authorization-regression",
    "label": "Authorization regression",
    "category": "test",
    "system_prompt_template": "Return {{user_prompt}}.",
}
RECIPE_ROUTES = [
    ("GET", "/prompt-recipes", None, "list"),
    ("GET", "/prompt-recipes/dummy-recipe", None, "get"),
    ("POST", "/prompt-recipes", RECIPE_INPUT, "upsert"),
    ("PATCH", "/prompt-recipes/dummy-recipe", RECIPE_INPUT, "upsert"),
    ("DELETE", "/prompt-recipes/dummy-recipe", None, "archive"),
    ("POST", "/prompt-recipes/draft", {"idea": "Dummy authorization check"}, "draft"),
]


def _recipe_spies(app_modules, monkeypatch):
    record = {"recipe_id": "dummy-recipe", **RECIPE_INPUT}
    calls = []

    def spy(name, result):
        def handler(*args, **kwargs):
            calls.append(name)
            return result
        return handler

    store, service = app_modules["store"], app_modules["service"]
    monkeypatch.setattr(store, "list_prompt_recipes", spy("list", [record]))
    monkeypatch.setattr(store, "get_prompt_recipe", spy("get", record))
    monkeypatch.setattr(service, "upsert_prompt_recipe", spy("upsert", record))
    monkeypatch.setattr(store, "delete_prompt_recipe", spy("archive", record))
    monkeypatch.setattr(service, "generate_prompt_recipe_draft", spy("draft", {"draft": RECIPE_INPUT}))
    return calls


@pytest.mark.parametrize("method,path,payload,boundary", RECIPE_ROUTES)
def test_recipe_route_authorization_matrix(unauthenticated_client, app_modules, monkeypatch, method, path, payload, boundary):
    calls = _recipe_spies(app_modules, monkeypatch)
    token_header = "x-media-studio-control-token"
    mode_header = "x-media-studio-access-mode"
    token = CONTROL_HEADERS[token_header]
    scenarios = [
        ("missing token", {}, 403, 403),
        ("wrong token", {token_header: "dummy-wrong-token", mode_header: "admin"}, 403, 403),
        ("read tier", {token_header: token, mode_header: "read"}, 200, 403),
        ("admin tier", {token_header: token, mode_header: "admin"}, 200, 200),
        ("default read", {token_header: token}, 200, 403),
        ("invalid tier", {token_header: token, mode_header: "unsupported"}, 403, 403),
    ]
    for label, headers, read_status, write_status in scenarios:
        calls.clear()
        response = unauthenticated_client.request(method, path, headers=headers, json=payload)
        expected = read_status if method == "GET" else write_status
        assert response.status_code == expected, (method, path, label, response.text)
        assert calls == ([boundary] if expected == 200 else []), (method, path, label, calls)
        if expected == 403:
            assert response.json()["ok"] is False and response.json()["error"]


def test_every_registered_recipe_route_has_authorization_matrix_coverage(app_modules):
    expected = {(method, path.replace("/dummy-recipe", "/{recipe_id}")) for method, path, _, _ in RECIPE_ROUTES}
    actual = {
        (method, route.path)
        for route in app_modules["main"].app.routes
        if hasattr(route, "path")
        if route.path == "/prompt-recipes" or route.path.startswith("/prompt-recipes/")
        for method in route.methods
    }
    assert actual == expected


def test_recipe_policy_boundaries_preserve_existing_control_contract(app_modules):
    from app.control_auth import required_access_mode

    cases = [
        ("/prompt-recipes", "GET", "read"),
        ("/prompt-recipes", "HEAD", "read"),
        ("/prompt-recipes/draft", "OPTIONS", "read"),
        ("/prompt-recipes/", "GET", "read"),
        ("/prompt-recipes/child/descendant", "POST", "admin"),
        ("/prompt-recipes-other", "POST", None),
        ("/prompt-recipes2", "GET", None),
        ("/prompt-recipe", "POST", None),
        ("/other/prompt-recipes", "POST", None),
        ("/media/settings", "GET", "read"),
        ("/media/settings", "PATCH", "admin"),
        ("/media/files/dummy", "POST", "read"),
        ("/media/validate", "POST", "read"),
        ("/media/pricing/estimate", "POST", "read"),
        ("/media/prompt-context", "POST", "read"),
        ("/media/enhance/preview", "POST", "read"),
        ("/health", "GET", None),
        ("/media/providers/kie/callback", "POST", None),
        ("/media/providers/kie/callback-neighbor", "POST", "admin"),
    ]
    for path, method, expected in cases:
        assert required_access_mode(path, method) == expected, (path, method)


def test_unauthorized_draft_is_denied_before_body_validation(unauthenticated_client, app_modules, monkeypatch):
    calls = _recipe_spies(app_modules, monkeypatch)
    response = unauthenticated_client.post("/prompt-recipes/draft", json={})
    assert response.status_code == 403 and calls == []
