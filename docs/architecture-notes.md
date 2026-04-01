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
