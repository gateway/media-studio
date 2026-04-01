# Media Studio

Media Studio is an open-source build-your-own AI image and video studio.

It pairs a local Next.js + FastAPI app with the shared Python `kie-api` layer so you can run your own generation workspace instead of relying on another closed monthly creative tool.

## Why this exists

- build your own branded image and video workflow instead of renting a generic hosted UI
- keep the product layer local and flexible while the Python backend handles queueing, jobs, artifacts, and provider integration
- use KIE for pay-as-you-go generation instead of forcing users into another monthly subscription just to get started
- support both image and video creation from one admin and studio surface

In practice, Media Studio is best thought of as your own image/video product shell on top of a real Python generation layer.

## Pricing model

Media Studio itself is the local product layer. For live generation, it connects to KIE through the shared Python/backend integration.

Why that matters:

- KIE documents a credit-based model with no required subscription
- KIE's getting-started docs say pricing is typically lower than official APIs, while the exact numbers can change over time
- many creator-facing tools still lead with monthly plans, so Media Studio gives you a cleaner pay-as-you-go path if you want your own stack

Always use the current KIE pricing page before making cost promises:

- [KIE API key and pricing via our referral link](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

The dashboard pricing flow is built around three layers:

- pricing catalog: `GET /media/pricing` returns the normalized KIE pricing snapshot used by the dashboard
- request estimate: `POST /media/pricing/estimate` returns the resolved prompt, options, and total estimated credits/USD for the exact request
- submit gate: `POST /media/validate` and job submission both carry the same pricing summary so the number shown in the Studio stays aligned with the server-side calculation

In the Studio UI, the `Generate` button now displays the current estimated total. If a model option changes pricing, the button label updates with it.
The admin UI also exposes a dedicated `/pricing` page and shows the saved estimate snapshot for each batch on `/jobs`.

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

KIE API key sign-up link:

- [kie.ai referral](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

## Quickstart for macOS

```bash
cd /absolute/path/to/media-studio
./scripts/onboard_mac.sh
```

That onboarding path:

- bootstraps the local repo and shared `kie-api` dependency
- creates `.env` and a clean local database
- prompts for `KIE_API_KEY`
- prompts for optional `OPENROUTER_API_KEY`
- offers to open the API and web processes in Terminal

Required for live generation:

- `KIE_API_KEY`

Optional:

- `OPENROUTER_API_KEY`
- `MEDIA_LOCAL_OPENAI_BASE_URL`
- `MEDIA_LOCAL_OPENAI_API_KEY`

Detailed guide:

- [docs/getting-started-mac.md](docs/getting-started-mac.md)

## Quickstart for Windows

```powershell
cd C:\absolute\path\to\media-studio
powershell -ExecutionPolicy Bypass -File .\scripts\onboard_windows.ps1
```

That onboarding path:

- bootstraps the local repo and shared `kie-api` dependency
- creates `.env` and a clean local database
- prompts for `KIE_API_KEY`
- prompts for optional `OPENROUTER_API_KEY`
- offers to open the API and web processes in PowerShell

Detailed guide:

- [docs/getting-started-windows.md](docs/getting-started-windows.md)

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

Get a KIE API key here:

- [kie.ai referral](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

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

This now includes a repo hygiene check that fails if tracked files include local `.env`
files, runtime databases, logs, certificates, or local artifact folders that should stay
developer-only.

## Repository hygiene

Keep the repo public-safe:

- commit code, docs, schema, migrations, and example config like `.env.example`
- do not commit live API keys, local `.env` files, runtime SQLite files, uploaded media,
  downloads, outputs, or local logs
- keep local runtime state under `data/`, `output/`, `tmp/`, or other ignored paths
- if a new tool writes local artifacts, add that path to `.gitignore` before pushing

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

## Backups and clean databases

The repo should not carry a committed SQLite database. The source of truth for schema and
default seed data is the API bootstrap code in `apps/api/app/store.py`, and tests use temporary databases.

Before resetting local state, make an ignored backup copy:

```bash
./scripts/backup_db.sh
```

That writes a timestamped backup under `data/backups/`.

If you need a clean database file with schema and default rows only, generate one explicitly:

```bash
./scripts/create_clean_db.sh --output ./data/backups/media-studio-clean.sqlite --overwrite
```

That clean DB contains schema, queue defaults, and seeded shared presets, but no local jobs,
assets, downloads, or test/runtime history.
