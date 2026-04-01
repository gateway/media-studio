# Media Studio Architecture Notes

## Repo boundary

This repository is standalone and intended for its own GitHub remote.

## Local KIE dependency

During local development, the API app depends on the sibling `kie-ai` checkout, typically:

`../kie-ai/kie_codex_bootstrap`

The API should load that repo through configuration instead of hardcoding imports everywhere. All application code should depend on the internal adapter seam first.

## Product rules preserved from the spec packet

- Browser never sees provider API credentials.
- FastAPI owns SQLite, queue durability, presets, prompts, assets, and artifact publication.
- Next.js owns the Studio UI and browser proxy routes.
- KIE integration stays behind an adapter boundary.
