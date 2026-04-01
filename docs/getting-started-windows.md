# Media Studio Setup for Windows

Use this path if you want a native Windows setup without WSL2.

## 1. Install prerequisites

Make sure these are available in PowerShell:

- `git`
- `python`
- `npm`

## 2. Clone Media Studio

```powershell
git clone <your-media-studio-repo>
cd media-studio
```

## 3. Run the Windows onboarding helper

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\onboard_windows.ps1
```

The script will:

- clone `gateway/kie-api` beside this repo if it is missing
- create or reuse the shared Python virtualenv
- install Python and web dependencies
- create `.env` if it does not exist
- create a clean local SQLite database with schema and default presets
- prompt for your KIE API key and optional prompt-enhancement providers

## 4. Add the required KIE API key

Live generation requires `KIE_API_KEY`.

Get a key here:

- [kie.ai referral](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

If you skip this during onboarding, Media Studio stays in offline-safe mode until you add the key later.

## 5. Optional prompt enhancement providers

You can also configure:

- `OPENROUTER_API_KEY` for hosted prompt enhancement
- `MEDIA_LOCAL_OPENAI_BASE_URL` for a local OpenAI-compatible endpoint
- `MEDIA_LOCAL_OPENAI_API_KEY` if your local endpoint requires one

These are optional. Users can still generate media without them.

## 6. Start the app

Manual start commands:

```powershell
npm run dev:api
npm run dev:web
```

Then open:

- `http://127.0.0.1:3000/setup`
- `http://127.0.0.1:3000/studio`

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
