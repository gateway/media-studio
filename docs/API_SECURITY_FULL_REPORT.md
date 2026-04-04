# API Security Full Report

## Summary

- Total endpoints reviewed: `51`
- Public endpoints: `6`
- Read-protected endpoints: `25`
- Admin-protected endpoints: `20`

## Notes

- This report is generated from the FastAPI route table plus the control access policy.
- It is intended as a release-review input, not a replacement for runtime smoke checks.

## Endpoint Inventory

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/openapi.json` | `public` | - |
| GET | `/docs` | `public` | - |
| GET | `/docs/oauth2-redirect` | `public` | - |
| GET | `/redoc` | `public` | - |
| GET | `/health` | `public` | control exception |
| GET | `/media/models` | `read` | - |
| GET | `/media/models/{model_key}` | `read` | - |
| GET | `/media/pricing` | `read` | - |
| POST | `/media/pricing/refresh` | `admin` | - |
| POST | `/media/pricing/estimate` | `read` | read exception |
| GET | `/media/credits` | `read` | - |
| GET | `/media/queue/settings` | `read` | - |
| PATCH | `/media/queue/settings` | `admin` | - |
| GET | `/media/queue/policies` | `read` | - |
| PATCH | `/media/queue/policies/{model_key}` | `admin` | - |
| GET | `/media/presets` | `read` | - |
| GET | `/media/presets/{preset_id}` | `read` | - |
| POST | `/media/presets` | `admin` | - |
| PATCH | `/media/presets/{preset_id}` | `admin` | - |
| DELETE | `/media/presets/{preset_id}` | `admin` | - |
| GET | `/media/system-prompts` | `read` | - |
| GET | `/media/system-prompts/lookup` | `read` | - |
| GET | `/media/system-prompts/{prompt_id}` | `read` | - |
| POST | `/media/system-prompts` | `admin` | - |
| PATCH | `/media/system-prompts/{prompt_id}` | `admin` | - |
| DELETE | `/media/system-prompts/{prompt_id}` | `admin` | - |
| GET | `/media/enhancement-configs` | `read` | - |
| GET | `/media/enhancement-configs/{model_key}` | `read` | - |
| POST | `/media/enhancement-configs` | `admin` | - |
| PATCH | `/media/enhancement-configs/{model_key}` | `admin` | - |
| DELETE | `/media/enhancement-configs/{model_key}` | `admin` | - |
| POST | `/media/enhancement/providers/probe` | `admin` | - |
| POST | `/media/prompt-context` | `read` | read exception |
| POST | `/media/validate` | `read` | read exception |
| POST | `/media/enhance/preview` | `read` | read exception |
| POST | `/media/jobs` | `admin` | - |
| GET | `/media/jobs` | `read` | - |
| GET | `/media/jobs/{job_id}` | `read` | - |
| GET | `/media/jobs/{job_id}/events` | `read` | - |
| POST | `/media/jobs/{job_id}/poll` | `admin` | - |
| POST | `/media/jobs/{job_id}/retry` | `admin` | - |
| POST | `/media/jobs/{job_id}/dismiss` | `admin` | - |
| GET | `/media/batches` | `read` | - |
| GET | `/media/batches/{batch_id}` | `read` | - |
| POST | `/media/batches/{batch_id}/cancel` | `admin` | - |
| GET | `/media/assets` | `read` | - |
| GET | `/media/assets/latest` | `read` | - |
| GET | `/media/assets/{asset_id}` | `read` | - |
| POST | `/media/assets/{asset_id}/dismiss` | `admin` | - |
| POST | `/media/assets/{asset_id}/favorite` | `admin` | - |
| POST | `/media/providers/kie/callback` | `public` | control exception, verified callback |
