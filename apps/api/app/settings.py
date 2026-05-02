from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from dotenv import load_dotenv


REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env", override=False)
DEFAULT_LOCAL_CONTROL_API_TOKEN = "media-studio-local-control-token"
DEFAULT_CONTROL_API_TOKEN_PLACEHOLDER = "replace_with_a_unique_control_token"


def _env_str(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip() or default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def _resolve_control_api_token(app_env: str) -> str:
    configured = os.getenv("MEDIA_STUDIO_CONTROL_API_TOKEN", "").strip()
    normalized_env = app_env.strip().lower()
    if configured:
        if normalized_env not in {"development", "dev", "test"} and configured in {
            DEFAULT_LOCAL_CONTROL_API_TOKEN,
            DEFAULT_CONTROL_API_TOKEN_PLACEHOLDER,
        }:
            raise RuntimeError(
                "MEDIA_STUDIO_CONTROL_API_TOKEN must be set to a unique value outside development/test."
            )
        return configured
    if normalized_env in {"development", "dev", "test"}:
        return DEFAULT_LOCAL_CONTROL_API_TOKEN
    raise RuntimeError("MEDIA_STUDIO_CONTROL_API_TOKEN is required outside development/test.")


class AppSettings(BaseModel):
    model_config = ConfigDict(extra="ignore")

    app_name: str = "Media Studio API"
    app_env: str = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    db_path: Path = Field(default=Path("/tmp/media-studio.db"))
    data_root: Path = Field(default=Path("/tmp/media-studio-data"))
    kie_api_repo_path: Optional[Path] = None
    media_enable_live_submit: bool = False
    media_background_poll_enabled: bool = True
    media_poll_seconds: int = 6
    media_pricing_cache_hours: int = 6
    media_pricing_refresh_on_startup: bool = True
    media_studio_supervisor: Optional[str] = None
    control_api_token: str = "media-studio-local-control-token"
    kie_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    local_openai_base_url: str = "http://127.0.0.1:8080/v1"
    local_openai_api_key: Optional[str] = None
    media_auto_backup_before_migration: bool = True
    media_reference_import_max_bytes: int = 104_857_600

    @property
    def uploads_dir(self) -> Path:
        return self.data_root / "uploads"

    @property
    def downloads_dir(self) -> Path:
        return self.data_root / "downloads"

    @property
    def outputs_dir(self) -> Path:
        return self.data_root / "outputs"

    @property
    def backups_dir(self) -> Path:
        return self.data_root / "backups"


settings = AppSettings(
    app_env=_env_str("MEDIA_STUDIO_APP_ENV", "development"),
    api_host=os.getenv("MEDIA_STUDIO_API_HOST", "127.0.0.1"),
    api_port=int(os.getenv("MEDIA_STUDIO_API_PORT", "8000")),
    db_path=Path(os.getenv("MEDIA_STUDIO_DB_PATH", "/tmp/media-studio.db")),
    data_root=Path(os.getenv("MEDIA_STUDIO_DATA_ROOT", "/tmp/media-studio-data")),
    kie_api_repo_path=(
        Path(os.getenv("MEDIA_STUDIO_KIE_API_REPO_PATH"))
        if os.getenv("MEDIA_STUDIO_KIE_API_REPO_PATH")
        else None
    ),
    media_enable_live_submit=_env_bool("MEDIA_ENABLE_LIVE_SUBMIT", False),
    media_background_poll_enabled=_env_bool("MEDIA_BACKGROUND_POLL_ENABLED", True),
    media_poll_seconds=int(os.getenv("MEDIA_POLL_SECONDS", "6")),
    media_pricing_cache_hours=int(os.getenv("MEDIA_PRICING_CACHE_HOURS", "6")),
    media_pricing_refresh_on_startup=_env_bool("MEDIA_PRICING_REFRESH_ON_STARTUP", True),
    media_studio_supervisor=os.getenv("MEDIA_STUDIO_SUPERVISOR"),
    control_api_token=_resolve_control_api_token(_env_str("MEDIA_STUDIO_APP_ENV", "development")),
    kie_api_key=os.getenv("KIE_API_KEY"),
    openrouter_api_key=os.getenv("OPENROUTER_API_KEY"),
    openrouter_base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    local_openai_base_url=os.getenv("MEDIA_LOCAL_OPENAI_BASE_URL", "http://127.0.0.1:8080/v1"),
    local_openai_api_key=os.getenv("MEDIA_LOCAL_OPENAI_API_KEY"),
    media_auto_backup_before_migration=_env_bool("MEDIA_AUTO_BACKUP_BEFORE_MIGRATION", True),
    media_reference_import_max_bytes=_env_int("MEDIA_REFERENCE_IMPORT_MAX_BYTES", 104_857_600),
)
