from __future__ import annotations

from typing import Any
from .db import get_connection
from .store_support import utcnow_iso


def get_provider_connection(provider_kind: str) -> dict[str, Any]:
    with get_connection() as connection:
        row = connection.execute("SELECT * FROM media_provider_connections WHERE provider_kind = ?", (provider_kind,)).fetchone()
    return dict(row) if row else {}


def save_provider_connection(provider_kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    current = get_provider_connection(provider_kind)
    # Omitted fields preserve saved values. Empty values explicitly use environment defaults.
    values = {key: payload.get(key, current.get(key)) for key in ("api_key", "base_url")}
    with get_connection() as connection:
        connection.execute(
            "INSERT INTO media_provider_connections (provider_kind, api_key, base_url, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(provider_kind) DO UPDATE SET api_key=excluded.api_key, base_url=excluded.base_url, updated_at=excluded.updated_at",
            (provider_kind, values["api_key"], values["base_url"], utcnow_iso()),
        )
    return get_provider_connection(provider_kind)
