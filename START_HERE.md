# Start Here

This is the fastest way to get `media-studio` running for the first time.

Media Studio is a local Next.js + FastAPI app that sits on top of the shared Python `kie-api` layer. It gives you your own image and video generation dashboard instead of another closed hosted UI, and it uses Kie AI for pay-as-you-go generation.

The shortest way to think about it:
- local dashboard
- shared Python generation backend
- your own prompts, presets, queue, and outputs
- pay-as-you-go model usage through Kie AI

## What you need

- `git`
- `python`
- `npm`
- a `KIE_API_KEY` for live generation through Kie AI

Kie AI, pronounced "key AI," is the external model marketplace and provider used by Media Studio. The models do not run on your machine. The app runs locally, but live image and video jobs are sent to Kie AI.

Kie AI uses a credit-based pay-as-you-go system. As of April 3, 2026, Kie AI pages describe entry-level credit purchases starting at $5, and some current model pages cite 1,000 credits for $5. Each model has its own credit usage, so different image and video jobs cost different amounts.

Get a Kie AI key here:

- [kie.ai](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

## Fastest setup

Clone the repo, run one setup script, add your KIE key, and you can start generating right away.

macOS:

```bash
git clone https://github.com/gateway/media-studio.git
cd media-studio
./scripts/onboard_mac.sh
```

Windows:

```powershell
git clone https://github.com/gateway/media-studio.git
cd media-studio
powershell -ExecutionPolicy Bypass -File .\scripts\onboard_windows.ps1
```

Those scripts will:

- reuse an existing sibling `../kie-api` or `../kie-ai/kie_codex_bootstrap` checkout when present
- clone the required `gateway/kie-api` repo if no supported sibling checkout exists
- create the shared Python virtualenv
- install API and web dependencies
- create `.env`
- create a clean local database
- prompt for `KIE_API_KEY`
- optionally prompt for OpenRouter or a local OpenAI-compatible endpoint

If you skip the KIE key during setup, Media Studio still installs cleanly, but live generation stays off until you add it.

## First step to use the models

The first real step is to get and add a valid `KIE_API_KEY`.

Without that key, the app can install and open, but it will stay in offline-safe mode and will not submit live image or video jobs.

## After setup

Run the app:

```bash
npm run dev:api
npm run dev:web
```

Then open:

- `http://127.0.0.1:3000/setup`
- `http://127.0.0.1:3000/studio`
- `http://127.0.0.1:3000/pricing`

## What to look at first

- `/setup`
  Confirms readiness, keys, and runner state.
- `/studio`
  Main generation interface.
- `/pricing`
  Shows the current pricing catalog and how request totals are estimated.
- `/jobs`
  Shows queue state, outputs, and saved estimate snapshots for submitted batches.

## Optional extras

- `OPENROUTER_API_KEY`
  For hosted prompt enhancement.
- `MEDIA_LOCAL_OPENAI_BASE_URL`
  For a local OpenAI-compatible endpoint.
- `MEDIA_LOCAL_OPENAI_API_KEY`
  Only if that local endpoint requires auth.
- `MEDIA_STUDIO_ADMIN_USERNAME` and `MEDIA_STUDIO_ADMIN_PASSWORD`
  Add these if you want browser auth instead of localhost-only access.

## If you want more detail

- [README.md](README.md)
- [docs/getting-started-mac.md](docs/getting-started-mac.md)
- [docs/getting-started-windows.md](docs/getting-started-windows.md)
- [docs/runtime-and-supervision.md](docs/runtime-and-supervision.md)
