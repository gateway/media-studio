# Media Studio

Media Studio is a local AI studio for image and video generation.

You run the app on your own machine, keep your prompts and outputs local, and connect it to [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) for pay-as-you-go model access.

![Media Studio gallery and prompt workspace](docs/images/media-studio.jpg)

If you want the fastest path first:

- [START_HERE.md](START_HERE.md)

## What It Includes

- gallery-style Studio UI
- prompt composer with source images, presets, and references
- local queue, jobs, retries, and output history
- local SQLite state plus local uploads, downloads, and generated outputs
- Kie-backed pricing, validation, submit, polling, and artifact publishing

Important:

- the app runs locally
- the models do not run on your machine
- live generation is sent to [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

## Models In The Studio

Image models:

- `nano-banana-2`
  General image generation and image editing.
- `nano-banana-pro`
  Higher-end Nano Banana generation and editing.

Video models:

- `seedance-2.0`
  Multi-input video workflow with start/end frames plus image, video, and audio references.
- `kling-2.6-t2v`
  Text-to-video.
- `kling-2.6-i2v`
  Image-to-video from one starting image.
- `kling-3.0-t2v`
  Newer Kling text-to-video flow.
- `kling-3.0-i2v`
  Newer Kling image-to-video flow.
- `kling-3.0-motion`
  Motion-control workflow.

The exact pricing and request rules can change over time, so the app also exposes:

- `/pricing` in the dashboard
- `GET /media/pricing` in the control API

## What You Need Before Setup

- `git`
- `python3`
- `Node.js` LTS
- a `KIE_API_KEY` from [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

Optional:

- `OPENROUTER_API_KEY`
  Only needed if you want prompt enhancement during onboarding. You can skip this and add it later in `Settings`.

If you need install help first:

- [docs/prerequisites.md](docs/prerequisites.md)

## Quick Start

### macOS

```bash
git clone https://github.com/gateway/media-studio.git
cd media-studio
./scripts/onboard_mac.sh
```

What happens during onboarding:

- clones or reuses sibling `kie-api`
- creates or reuses the shared Python virtualenv
- installs Python and web dependencies
- creates `.env`
- creates a clean local database
- asks for your `KIE_API_KEY`
- asks whether you want optional OpenRouter prompt enhancement now
- can launch Studio for you when setup finishes

If you skip OpenRouter, that is fine. Core image and video generation only requires `KIE_API_KEY`.

### Windows

```powershell
git clone https://github.com/gateway/media-studio.git
cd media-studio
powershell -ExecutionPolicy Bypass -File .\scripts\onboard_windows.ps1
```

### Linux

```bash
git clone https://github.com/gateway/media-studio.git
cd media-studio
./scripts/bootstrap_local.sh
```

Then add your `KIE_API_KEY` to `.env` and run:

```bash
npm run dev:api
./scripts/dev_web.sh
```

## Starting The App Later

### macOS friendlier launchers

- `Start Media Studio.command`
- `Stop Media Studio.command`

### macOS Terminal launch

```bash
./scripts/run_studio_mac.sh
```

Studio opens at:

- `http://127.0.0.1:3000/studio`

### Developer mode

```bash
npm run dev:api
./scripts/dev_web.sh
```

## Running On Different Ports

If `3000` or `8000` is already in use, use explicit port overrides.

Start:

```bash
./scripts/open_studio_mac.sh --api-port 8010 --web-port 3010
```

Or from Terminal:

```bash
./scripts/run_studio_mac.sh --api-port 8010 --web-port 3010
```

Stop the same pair:

```bash
./scripts/stop_studio_mac.sh --api-port 8010 --web-port 3010
```

The startup scripts now wire the web app to the matching API port automatically, so you do not need to hand-edit multiple base URL vars just to change local ports.

## Private LAN / TailScale Access

By default, Studio stays localhost-only unless you configure browser credentials.

If you want private LAN or TailScale access without browser auth, set:

```env
MEDIA_STUDIO_ALLOW_PRIVATE_NETWORK_ACCESS=true
```

That allows private-network access only. It does not open Studio to arbitrary public internet traffic.

If you are using development mode and want remote device access too, also set:

```env
MEDIA_STUDIO_WEB_HOST=0.0.0.0
```

Browser-auth alternative:

```env
MEDIA_STUDIO_ADMIN_USERNAME=your_user
MEDIA_STUDIO_ADMIN_PASSWORD=your_password
```

## Optional Prompt Enhancement

Prompt enhancement is optional.

You can use Media Studio with only:

- `KIE_API_KEY`

If you want prompt rewriting before generation, you can also configure:

- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`

The onboarding flow asks whether you want this now, but you can skip it and add it later in `Settings`.

## How It Works

- you open Studio and choose a model or preset
- you write a prompt and optionally add source or reference media
- the local app validates and stores the request
- [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) runs the model remotely
- finished outputs come back into your local gallery and files

For the full submit, queue, polling, publish, and retry lifecycle:

- [docs/request-lifecycle.md](docs/request-lifecycle.md)

## Under The Hood

- `Next.js` dashboard
- `FastAPI` control API
- `SQLite` for jobs, batches, presets, queue state, and local metadata
- `kie-api` for model registry, validation, pricing, submit, polling, and artifacts
- local filesystem storage for uploads, downloads, and outputs

Repo layout:

```text
apps/
  api/   FastAPI backend
  web/   Next.js frontend
scripts/
docs/
data/
```

## Docs

- [START_HERE.md](START_HERE.md)
- [docs/getting-started-mac.md](docs/getting-started-mac.md)
- [docs/getting-started-windows.md](docs/getting-started-windows.md)
- [docs/runtime-and-supervision.md](docs/runtime-and-supervision.md)
