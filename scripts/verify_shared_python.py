"""Fail onboarding if the shared backend/provider imports or registry are broken."""

import sys

import fastapi
import kie_api
import uvicorn
from app import kie_adapter

if sys.version_info[:2] != (3, 11):
    raise SystemExit("Media Studio onboarding requires Python 3.11")

registry = kie_api.load_registry()
models = kie_adapter.list_models()
if not registry.model_specs or not models:
    raise SystemExit("KIE registry or Studio model list is empty")
print(f"Shared runtime verified: Python {sys.version.split()[0]}, {len(models)} Studio models")
