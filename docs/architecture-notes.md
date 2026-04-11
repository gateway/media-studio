# Media Studio Architecture Notes

## Repo boundary

This repository is standalone and intended for its own GitHub remote.

## Local KIE dependency

During local development, the API app depends on a sibling `kie-api` checkout, typically:

`../kie-api`

The older `../kie-ai/kie_codex_bootstrap` layout can still exist in local workspaces, but new setup flows should target the standalone `kie-api` repo.

The API should load that repo through configuration instead of hardcoding imports everywhere. All application code should depend on the internal adapter seam first.

## Product rules preserved from the spec packet

- Browser never sees provider API credentials.
- FastAPI owns SQLite, queue durability, presets, prompts, assets, and artifact publication.
- Next.js owns the Studio UI and browser proxy routes.
- KIE integration stays behind an adapter boundary.

## Deployment boundary

- Media Studio is intended to run locally on the operator's machine.
- It should not be treated as a general public-network web app.
- Web auth and control-route protections still need to stay internally consistent, but review and remediation work should treat localhost-only operation as the baseline deployment model.

## Pricing architecture

- The source of truth for pricing math stays in the shared Python `kie-api` layer.
- The dashboard consumes a normalized pricing catalog from `GET /media/pricing`.
- The Studio requests server-side estimates from `POST /media/pricing/estimate` so model options like duration, resolution, audio, or output count can change the displayed total immediately.
- Validation and submit flows should persist the same pricing summary used by the UI so job history remains explainable even if upstream rates change later.
