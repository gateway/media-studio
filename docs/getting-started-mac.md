# Media Studio Setup for macOS

Use this path if you want a clean first-run setup with the required KIE API dependency and local database created for you.

## Prerequisites

Before you start, make sure this Mac has:

- Git
- Python 3
- Node.js **LTS**

If you want a short prerequisites page first:

- [docs/prerequisites.md](prerequisites.md)

If Git is missing, run:

```bash
xcode-select --install
```

If Node.js is missing, install the **LTS** release from:

- [nodejs.org](https://nodejs.org)

## 1. Clone Media Studio

```bash
git clone https://github.com/gateway/media-studio.git
cd media-studio
```

## 2. Run the onboarding helper

```bash
./scripts/onboard_mac.sh
```

The script will:

- reuse an existing sibling `../kie-api` or `../kie-ai/kie_codex_bootstrap` checkout when present
- clone `gateway/kie-api` beside this repo if no supported sibling checkout exists
- create or reuse the shared Python virtualenv
- install Python dependencies plus the web app workspace dependencies
- create `.env` if it does not exist
- create a clean local SQLite database with schema and default presets
- prompt for your Kie AI API key
- ask whether you want to enable optional prompt enhancement now
- let you skip prompt enhancement and add it later in Settings

The shared Python virtualenv includes editable installs of:

- `kie-api`
- `media-studio-api`

Test-only packages are installed later only when you run the quality or release verification scripts.

Test tooling such as Vitest and browser smoke tooling are also kept out of the normal user path. They only get installed when you run the quality or release verification workflow.

## 3. Add the required KIE API key

Live generation requires `KIE_API_KEY`.

Get a key here:

- [kie.ai referral](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

If you skip this during onboarding, Media Studio stays in offline-safe mode until you add the key later.

## 4. Optional prompt enhancement providers

During onboarding, the macOS script now asks whether you want to enable prompt enhancement.

This feature is optional. It rewrites or improves your text prompt before generation. If you skip it, you can turn it on later in `Settings`.

If you enable it during onboarding, the recommended hosted model is:

- `qwen/qwen3.5-35b-a3b`

You can also configure:

- `OPENROUTER_API_KEY` for hosted prompt enhancement
- `MEDIA_LOCAL_OPENAI_BASE_URL` for a local OpenAI-compatible endpoint
- `MEDIA_LOCAL_OPENAI_API_KEY` if your local endpoint requires one

The onboarding helper verifies the OpenRouter key before saving it. These providers are optional. Users can still generate media without them.

## Terminal windows and port conflicts

If you choose the launch option at the end of onboarding, the script opens two Terminal windows:

- one for the FastAPI control API
- one for the Next.js web app

That is expected for local development.

Before opening them, the script checks whether the configured API and web ports are already in use. If either port is busy, onboarding stops and tells you to free the port or change it in `.env`.

## 5. Start the app

Manual start commands:

```bash
npm run dev:api
./scripts/dev_web.sh
```

Or use the Finder-friendly launchers from the repo root:

- `Start Media Studio.command`
- `Stop Media Studio.command`

`Start Media Studio.command` uses one launcher Terminal window on macOS and starts both the API and web processes behind it.

Then open:

- `http://127.0.0.1:3000/`

Media Studio will route you automatically:

- to `/setup` if this machine still needs configuration
- to `/studio` once the API, models, and live key are ready

## 6. Back up or rebuild local state

Back up the current local database:

```bash
./scripts/backup_db.sh
```

Generate a clean schema-only database:

```bash
./scripts/create_clean_db.sh --output ./data/backups/media-studio-clean.sqlite --overwrite
```

The repo should not commit local runtime databases, uploads, downloads, or outputs. Those stay local and ignored.
