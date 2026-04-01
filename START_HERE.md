# Start Here

This is the fastest path for someone new to `media-studio`.

Media Studio is a local Next.js + FastAPI app that sits on top of the shared Python `kie-api` layer. It gives you your own image and video generation dashboard instead of another closed hosted UI.

## What you need

- `git`
- `python`
- `npm`
- a `KIE_API_KEY` for live generation

Get a KIE API key here:

- [kie.ai via our referral link](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

## Fastest setup

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

- clone the required `gateway/kie-api` repo if needed
- create the shared Python virtualenv
- install API and web dependencies
- create `.env`
- create a clean local database
- prompt for `KIE_API_KEY`
- optionally prompt for OpenRouter or a local OpenAI-compatible endpoint

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

## If you want more detail

- [README.md](/Users/evilone/Documents/Development/Video-Image-APIs/media-studio/README.md)
- [docs/getting-started-mac.md](/Users/evilone/Documents/Development/Video-Image-APIs/media-studio/docs/getting-started-mac.md)
- [docs/getting-started-windows.md](/Users/evilone/Documents/Development/Video-Image-APIs/media-studio/docs/getting-started-windows.md)
- [docs/runtime-and-supervision.md](/Users/evilone/Documents/Development/Video-Image-APIs/media-studio/docs/runtime-and-supervision.md)
