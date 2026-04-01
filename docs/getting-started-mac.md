# Media Studio Setup for macOS

Use this path if you want a clean first-run setup with the required KIE API dependency and local database created for you.

## 1. Clone Media Studio

```bash
git clone <your-media-studio-repo>
cd media-studio
```

## 2. Run the onboarding helper

```bash
./scripts/onboard_mac.sh
```

The script will:

- clone `gateway/kie-api` beside this repo if it is missing
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
npm run dev:web
```

Then open:

- `http://127.0.0.1:3000/setup`
- `http://127.0.0.1:3000/studio`

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
