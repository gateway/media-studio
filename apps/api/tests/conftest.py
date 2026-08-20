import os
import sys
import importlib
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


CONTROL_HEADERS = {
    "x-media-studio-control-token": "test-control-token",
    "x-media-studio-access-mode": "admin",
}
API_ROOT = Path(__file__).resolve().parents[1]

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

# Some compatibility tests intentionally import app modules during collection.
# Give those module instances their own fully bootstrapped database so later
# fixture-driven app reloads cannot leave stale imports pointing at no schema.
_COLLECTION_TEST_ROOT = tempfile.TemporaryDirectory(prefix="media-studio-pytest-collection-")
_collection_root = Path(_COLLECTION_TEST_ROOT.name)
os.environ["MEDIA_STUDIO_DB_PATH"] = str(_collection_root / "collection.db")
os.environ["MEDIA_STUDIO_DATA_ROOT"] = str(_collection_root / "data")
_collection_store = importlib.import_module("app.store")
_collection_store.bootstrap_schema()


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
    os.environ["MEDIA_PRICING_REFRESH_ON_STARTUP"] = "0"
    os.environ["MEDIA_STUDIO_CONTROL_API_TOKEN"] = CONTROL_HEADERS["x-media-studio-control-token"]
    os.environ["NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG"] = "1"

    for name in sorted([key for key in sys.modules.keys() if key == "app" or key.startswith("app.")], reverse=True):
        sys.modules.pop(name, None)

    main = importlib.import_module("app.main")
    store = importlib.import_module("app.store")
    store_assistant = importlib.import_module("app.store_assistant")
    runner = importlib.import_module("app.runner")
    service = importlib.import_module("app.service")
    db_admin = importlib.import_module("app.db_admin")
    schemas = importlib.import_module("app.schemas")
    store.bootstrap_schema()
    yield {
        "main": main,
        "store": store,
        "store_assistant": store_assistant,
        "runner": runner,
        "service": service,
        "db_admin": db_admin,
        "schemas": schemas,
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
