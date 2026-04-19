# Media Studio

Media Studio is a local AI image and video studio you run on your own machine.

Your gallery, prompts, presets, projects, references, and generated files stay with you. Media Studio connects to [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42), a credit-based model API marketplace, so you can run strong image and video models without paying for another fixed monthly hosted studio.

![Media Studio gallery and prompt workspace](docs/images/media-studio.jpg)

Important before you install:

- Installing Media Studio is not enough by itself.
- You need a funded [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) account and a `KIE_API_KEY`.
- You can usually get started with a small credit balance, often around `$5`.
- Once you have credits and your API key, Media Studio becomes a self-contained local studio for prompts, presets, projects, references, queueing, revisions, and output history.
- More models will keep getting added over time as they become available on [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42).

If you want the fastest path first:

- [START_HERE.md](START_HERE.md)

What you need:

- a local machine
- a funded [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) account
- a `KIE_API_KEY` from [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)
- a small Kie credit balance to start generating, often something like `$5`

## Current Feature Set

### Studio Workspace

- one Studio for prompts, media, presets, references, jobs, and history
- global gallery with image, video, favorites, and all-media views
- fullscreen asset viewer with inspector and quick actions like `Create Revision`, `Animate`, and `Use image`
- batch tracking that keeps completed, pending, and failed jobs visible together
- retry and revision flows that put work back into the composer instead of making you rebuild it by hand

### Projects And Organization

- project workspaces for organizing content without losing the global gallery
- project create, edit, archive, and restore flows
- optional project cover image
- option to hide a project from the global gallery
- project-scoped references with a global gallery that can still show everything

### Presets And Prompt Tools

- built-in presets that ship with Studio, including:
  - `3D Caricature Style`
  - `Selfie with Movie Character`
- custom preset creation with structured text fields and media slots
- preset import and export for sharing or moving setups between installs
- prompt enhancement before generation
- optional OpenRouter-based enhancement
- optional local OpenAI-compatible enhancement endpoint

### References And Inputs

- reusable reference library for stored image inputs
- drag-and-drop from the gallery into compatible slots
- model-aware input slots instead of one generic upload rail
- reference restore for revisions, retries, and preset-driven flows

### Local Safety And Runtime

- local queue, polling, and output publishing
- local migration tracking with schema registry tables
- automatic backup before pending migrations on existing installs
- safe local sync script that preserves persistent `data/`
- local files stay on disk and are not meant to be committed to git

Important:

- if your [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) account is not funded, Studio can open but it cannot generate

## Models In The Studio

- `nano-banana-2`
  Fast text to image and image editing.
- `nano-banana-pro`
  Higher-end text to image and image editing.
- `seedance-2.0`
  Text to video, start/end frames, and multimodal image, video, and audio references.
- `kling-2.6-t2v`
  Text to video.
- `kling-2.6-i2v`
  Image to video from one starting image.
- `kling-3.0-t2v`
  Newer text to video workflow.
- `kling-3.0-i2v`
  Newer image to video workflow with start frame and optional end frame support.
- `kling-3.0-motion`
  Motion control with a source image plus driving video.

The exact pricing and request rules can change over time, so the app also exposes:

- `/pricing` in the dashboard
- `GET /media/pricing` in the control API

## What You Need Before Setup

- `git`
- `python3`
- `Node.js` LTS
- a `KIE_API_KEY` from [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)
- credits in your [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) account so live generation can run

Optional:

- `OPENROUTER_API_KEY`
  Only needed if you want prompt enhancement during onboarding. You can skip this and add it later in `Settings`.
- `MEDIA_LOCAL_OPENAI_BASE_URL`
  Optional if you want prompt enhancement through a local OpenAI-compatible endpoint instead of OpenRouter.

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
- asks for your `KIE_API_KEY` from [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)
- asks whether you want optional OpenRouter prompt enhancement now
- can launch Studio for you when setup finishes

If you skip OpenRouter, that is fine. Core image and video generation only requires a `KIE_API_KEY` from [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42).

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

Then add your `KIE_API_KEY` from [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) to `.env` and run:

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

- a `KIE_API_KEY` from [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

If you want prompt rewriting before generation, you can also configure:

- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `MEDIA_LOCAL_OPENAI_BASE_URL`
- `MEDIA_LOCAL_OPENAI_API_KEY`

The onboarding flow asks whether you want this now, but you can skip it and add it later in `Settings`.

Supported enhancement paths:

- built-in helper flow
- OpenRouter-hosted prompt enhancement
- local OpenAI-compatible prompt enhancement

## How It Works

- you open Studio and choose a model, project, or preset
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
