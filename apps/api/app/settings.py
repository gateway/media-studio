from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field
from dotenv import load_dotenv


REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(REPO_ROOT / ".env", override=False)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


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
    media_studio_supervisor: Optional[str] = None
    kie_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    local_openai_base_url: str = "http://127.0.0.1:8080/v1"
    local_openai_api_key: Optional[str] = None

    @property
    def uploads_dir(self) -> Path:
        return self.data_root / "uploads"

    @property
    def downloads_dir(self) -> Path:
        return self.data_root / "downloads"

    @property
    def outputs_dir(self) -> Path:
        return self.data_root / "outputs"


settings = AppSettings(
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
    media_studio_supervisor=os.getenv("MEDIA_STUDIO_SUPERVISOR"),
    kie_api_key=os.getenv("KIE_API_KEY"),
    openrouter_api_key=os.getenv("OPENROUTER_API_KEY"),
    openrouter_base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    local_openai_base_url=os.getenv("MEDIA_LOCAL_OPENAI_BASE_URL", "http://127.0.0.1:8080/v1"),
    local_openai_api_key=os.getenv("MEDIA_LOCAL_OPENAI_API_KEY"),
)
