from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

from .settings import settings

CONTROL_TOKEN_HEADER = "x-media-studio-control-token"
CONTROL_ACCESS_MODE_HEADER = "x-media-studio-access-mode"
READ_ACCESS_PATHS = {
    "/media/validate",
    "/media/pricing/estimate",
    "/media/prompt-context",
    "/media/enhance/preview",
}
CONTROL_ROUTE_EXCEPTIONS = {
    "/health",
    "/media/providers/kie/callback",
}


def required_access_mode(path: str, method: str) -> str | None:
    if path in CONTROL_ROUTE_EXCEPTIONS:
        return None
    if not path.startswith("/media"):
        return None
    if path.startswith("/media/files/"):
        return "read"
    normalized_method = method.upper()
    if normalized_method in {"GET", "HEAD", "OPTIONS"}:
        return "read"
    # Validation and pricing estimation mutate nothing, so they stay available
    # to the lower read tier even though they are POST endpoints.
    if path in READ_ACCESS_PATHS:
        return "read"
    return "admin"


def validate_control_request(request: Request) -> JSONResponse | None:
    required_mode = required_access_mode(request.url.path, request.method)
    if required_mode is None:
        return None

    expected_token = settings.control_api_token
    provided_token = request.headers.get(CONTROL_TOKEN_HEADER)
    if provided_token != expected_token:
        return JSONResponse(
            {"ok": False, "error": "Missing or invalid control API token."},
            status_code=403,
        )

    provided_mode = (request.headers.get(CONTROL_ACCESS_MODE_HEADER) or "read").strip().lower()
    if required_mode == "admin" and provided_mode != "admin":
        return JSONResponse(
            {"ok": False, "error": "Admin access is required for this control operation."},
            status_code=403,
        )
    if required_mode == "read" and provided_mode not in {"read", "admin"}:
        return JSONResponse(
            {"ok": False, "error": "Unsupported control access mode."},
            status_code=403,
        )
    return None
