# Media Studio

Standalone internal Media Studio product built from the Media Studio standalone spec packet.

## Structure

```text
apps/
  api/   FastAPI backend, SQLite queue, filesystem artifacts, KIE adapter
  web/   Next.js frontend and browser proxy routes
packages/
  provider-adapter/  shared notes and future adapter extraction seam
  shared-types/      shared contract space for web/api types
data/
  uploads/
  downloads/
  outputs/
scripts/
docs/
```

## Local development

This repo is intended to work alongside a sibling local `kie-ai` checkout, usually:

`../kie-ai/kie_codex_bootstrap`

The API uses the shared `kie-api` virtualenv. No second Python venv is required.

## Setup

```bash
cd /absolute/path/to/media-studio
./scripts/setup_shared_env.sh
npm install
```

## Run

API:

```bash
npm run dev:api
```

Web:

```bash
npm run dev:web
```

Web defaults to `http://127.0.0.1:3000`.
API defaults to `http://127.0.0.1:8000`.

If you want live provider submit/poll behavior, export:

```bash
export KIE_API_KEY=...
export MEDIA_ENABLE_LIVE_SUBMIT=true
```

Then restart the API process.

If you want prompt enhancement through hosted or local external models, set:

```bash
export OPENROUTER_API_KEY=...
export OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
export MEDIA_LOCAL_OPENAI_BASE_URL=http://127.0.0.1:8080/v1
export MEDIA_LOCAL_OPENAI_API_KEY=
```

`OpenRouter.ai` and `Local OpenAI-Compatible` are configured from the Settings page under Prompt Enhancement.

## Supervised Runtime

For restartable runtime outside active coding sessions, use a supervisor instead of leaving terminal commands running forever.

Supported examples are documented in:

- [`docs/runtime-and-supervision.md`](docs/runtime-and-supervision.md)

Included example configs:

- `pm2`
- `systemd`
- `launchd`
- `supervisord`

Production-style API startup without `--reload`:

```bash
npm run start:api
```

## Quality gates

```bash
./scripts/run-quality-gates
```

## Current status

Standalone Media Studio is bootstrapped with:

- FastAPI backend
- SQLite queue/job/asset store
- in-process runner with recovery and offline completion mode
- KIE adapter boundary
- Next.js Studio, Models, and Jobs routes
- same-origin `/api/control/*` proxy routes
