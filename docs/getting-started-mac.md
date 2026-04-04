# Media Studio Setup for macOS

Use this path if you want a clean first-run setup with the required KIE API dependency and local database created for you.

## Prerequisites

Before you start, make sure this Mac has:

- Git
- Node.js **LTS**

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
- install Python and web dependencies
- create `.env` if it does not exist
- create a clean local SQLite database with schema and default presets
- prompt for your KIE API key and optional prompt-enhancement providers

## 3. Add the required KIE API key

Live generation requires `KIE_API_KEY`.

Get a key here:

- [kie.ai referral](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

If you skip this during onboarding, Media Studio stays in offline-safe mode until you add the key later.

## 4. Optional prompt enhancement providers

You can also configure:

- `OPENROUTER_API_KEY` for hosted prompt enhancement
- `MEDIA_LOCAL_OPENAI_BASE_URL` for a local OpenAI-compatible endpoint
- `MEDIA_LOCAL_OPENAI_API_KEY` if your local endpoint requires one

These are optional. Users can still generate media without them.

## 5. Start the app

Manual start commands:

```bash
npm run dev:api
./scripts/dev_web.sh
```

Or use the Finder-friendly launchers from the repo root:

- `Start Media Studio.command`
- `Stop Media Studio.command`

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
