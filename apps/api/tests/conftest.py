import os
import sys
import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


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
    os.environ["MEDIA_ENABLE_LIVE_SUBMIT"] = "0"
    os.environ["MEDIA_BACKGROUND_POLL_ENABLED"] = "0"

    for name in sorted([key for key in sys.modules.keys() if key == "app" or key.startswith("app.")], reverse=True):
        sys.modules.pop(name, None)

    main = importlib.import_module("app.main")
    store = importlib.import_module("app.store")
    runner = importlib.import_module("app.runner")
    service = importlib.import_module("app.service")
    yield {
        "main": main,
        "store": store,
        "runner": runner,
        "service": service,
    }


@pytest.fixture()
def client(app_modules):
    app = app_modules["main"].app

    with TestClient(app) as test_client:
        yield test_client
