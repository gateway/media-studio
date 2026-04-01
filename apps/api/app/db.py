from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .settings import settings


def _connect(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = _connect(settings.db_path)
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()
