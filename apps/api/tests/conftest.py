import os
import sys
import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


CONTROL_HEADERS = {
    "x-media-studio-control-token": "test-control-token",
    "x-media-studio-access-mode": "admin",
}


@pytest.fixture()
def app_modules(tmp_path: Path):
    repo_root = Path(__file__).resolve().parents[3]
    default_kie_root = (repo_root.parent / "kie-ai" / "kie_codex_bootstrap").resolve()
    os.environ["MEDIA_STUDIO_DB_PATH"] = str(tmp_path / "test.db")
    os.environ["MEDIA_STUDIO_DATA_ROOT"] = str(tmp_path / "data")
    os.environ["MEDIA_STUDIO_KIE_API_REPO_PATH"] = os.environ.get(
        "MEDIA_STUDIO_KIE_API_REPO_PATH",
        str(default_kie_root),
    )
    os.environ["KIE_API_KEY"] = ""
    os.environ["OPENROUTER_API_KEY"] = ""
    os.environ["MEDIA_ENABLE_LIVE_SUBMIT"] = "0"
    os.environ["MEDIA_BACKGROUND_POLL_ENABLED"] = "0"
    os.environ["MEDIA_STUDIO_CONTROL_API_TOKEN"] = CONTROL_HEADERS["x-media-studio-control-token"]

    for name in sorted([key for key in sys.modules.keys() if key == "app" or key.startswith("app.")], reverse=True):
        sys.modules.pop(name, None)

    main = importlib.import_module("app.main")
    store = importlib.import_module("app.store")
    runner = importlib.import_module("app.runner")
    service = importlib.import_module("app.service")
    db_admin = importlib.import_module("app.db_admin")
    yield {
        "main": main,
        "store": store,
        "runner": runner,
        "service": service,
        "db_admin": db_admin,
    }


@pytest.fixture()
def client(app_modules):
    app = app_modules["main"].app

    with TestClient(app, headers=CONTROL_HEADERS) as test_client:
        yield test_client


@pytest.fixture()
def unauthenticated_client(app_modules):
    app = app_modules["main"].app

    with TestClient(app) as test_client:
        yield test_client
