# Media Studio Setup for Windows

Use this path if you want a native Windows setup without WSL2.

## 1. Install prerequisites

Make sure these are available in PowerShell:

- `git`
- `python`
- `npm`

Video thumbnails, posters, and browser-friendly playback derivatives are handled by the shared `kie-api` Python environment. If you already have a system FFmpeg install, KIE API can use it, but Windows setup does not require a separate FFmpeg install.

## 2. Clone Media Studio

```powershell
git clone https://github.com/gateway/media-studio.git
cd media-studio
```

## 3. Run the Windows onboarding helper

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\onboard_windows.ps1
```

The script will:

- reuse an existing sibling `../kie-api` or `../kie-ai/kie_codex_bootstrap` checkout when present
- clone `gateway/kie-api` beside this repo if no supported sibling checkout exists
- create or reuse the shared Python virtualenv
- install Python and web dependencies
- create `.env` if it does not exist
- create a clean local SQLite database with schema and default presets
- prompt for your KIE API key and optional prompt-enhancement providers

Before a public release, validate this flow on a real Windows machine with a clean clone, a fresh `.env`, and a new local database.

## 4. Add the required KIE API key

Live generation requires `KIE_API_KEY`.

Get a key here:

- [kie.ai referral](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

If you skip this during onboarding, Media Studio stays in offline-safe mode until you add the key later.

## 5. Optional LLM providers

You can also configure:

- local `codex` login for Codex Local
- `OPENROUTER_API_KEY` for hosted prompt enhancement and Prompt Recipe drafting
- `MEDIA_LOCAL_OPENAI_BASE_URL` for a local OpenAI-compatible endpoint
- `MEDIA_LOCAL_OPENAI_API_KEY` if your local endpoint requires one

These are optional. Users can still generate media without them.

After onboarding, the shared provider defaults live in:

- `http://127.0.0.1:3000/settings/llms`

## 6. Start the app

Manual start commands:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_studio.ps1
```

Then open:

- `http://127.0.0.1:3000/setup`
- `http://127.0.0.1:3000/studio`

The Windows start script starts the API and web app together in one PowerShell window, checks the sibling `kie-api` checkout for new releases, offers a fast-forward update when safe, checks migration safety, creates a database backup before pending migrations, refreshes shared Python dependencies and the production web build if needed, writes runtime logs under `data\runtime\`, waits for readiness, and opens Studio. Stop it with:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop_studio.ps1
```

If `8000` or `3000` is already in use by another app, startup automatically chooses the next open local ports, wires the web app to the selected API port, and prints the actual Studio URL for that launch. To force a specific pair, run with explicit ports:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_studio.ps1 --api-port 8010 --web-port 3010
```

Passing explicit ports keeps startup strict: if one of those ports is busy, startup stops and asks you to choose another pair.

## 7. Back up or rebuild local state

Back up the current local database:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup_db.ps1
```

Generate a clean schema-only database:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\create_clean_db.ps1 --output .\data\backups\media-studio-clean.sqlite --overwrite
```

The repo should not commit local runtime databases, uploads, downloads, or outputs. Those stay local and ignored.
