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

This repo is intended to work alongside a sibling local `kie-api` checkout, usually:

`../kie-api`

The API uses the shared `kie-api` virtualenv. No second Python venv is required.

Upstream KIE repository:

- [gateway/kie-api](https://github.com/gateway/kie-api)

## One-command local bootstrap

```bash
cd /absolute/path/to/media-studio
./scripts/bootstrap_local.sh
```

That script will:

- clone `https://github.com/gateway/kie-api.git` into `../kie-api` if it is missing
- create the shared KIE virtualenv if it does not exist
- install both `kie-api` and the Media Studio API into that venv
- install web dependencies
- create local data folders
- create `.env` if it is missing
- bootstrap an empty SQLite schema

The database starts empty. The schema is created automatically, but no user jobs/assets are preloaded.

## Existing local setup

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

## Fresh database

For a clean local reset:

```bash
rm -f data/media-studio.db data/media-studio.sqlite
./scripts/bootstrap_local.sh
```

That recreates an empty schema without carrying over old local jobs/assets.
