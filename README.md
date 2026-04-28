# Media Studio

Media Studio is a local AI image and video workspace for Kie AI models.

It gives you one place to generate images, generate videos, revise old work, build reusable presets, manage references, track jobs, and keep a local gallery of everything you make. Your prompts, presets, projects, references, database, uploads, and outputs stay on your machine.

Media Studio uses [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) for model execution, so you need a funded Kie account and a `KIE_API_KEY` before live generation will work.

![Media Studio gallery and prompt workspace](docs/images/media-studio.jpg)

## What It Is

- A local Studio UI for AI image and video generation.
- A FastAPI control API that stores jobs, batches, presets, projects, pricing, and local media metadata.
- A Next.js dashboard with Studio, Settings, Models, Presets, Jobs, Pricing, and Setup pages.
- A local-first workflow: generated files and runtime data live in your local `data/` folder.
- A Kie-powered model layer, with pricing and model support pulled through the local control API.

## Supported Models

Current model surfaces include:

- `gpt-image-2-text-to-image` - GPT Image 2 text-to-image.
- `gpt-image-2-image-to-image` - GPT Image 2 image editing with ordered image references.
- `nano-banana-2` - fast text-to-image and image editing.
- `nano-banana-pro` - higher-end text-to-image and image editing.
- `seedance-2.0` - text-to-video, first/last frame video, and multimodal reference video.
- `kling-2.6-t2v` - Kling 2.6 text-to-video.
- `kling-2.6-i2v` - Kling 2.6 image-to-video.
- `kling-3.0-t2v` - Kling 3.0 text-to-video.
- `kling-3.0-i2v` - Kling 3.0 image-to-video with start frame and optional end frame support.
- `kling-3.0-motion` - Kling 3.0 motion control with a source image and driving video.

Model availability, request rules, and pricing can change as Kie updates its platform. Media Studio exposes pricing in the dashboard at `/pricing`, and the Generate button uses server-side pricing estimates from the control API.

## Easy Setup

You need:

- `git`
- `python3`
- Node.js LTS
- a funded [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) account
- a `KIE_API_KEY`

### macOS

```bash
git clone https://github.com/gateway/media-studio.git
cd media-studio
./scripts/onboard_mac.sh
```

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

The macOS and Windows onboarding scripts handle the normal setup path for you: dependencies, local environment, database, Kie API key prompt, and optional prompt enhancement setup.

## Cool Features

- **Create Revision** restores an old asset back into Studio with the original prompt, model, settings, and reference media.
- **Projects** keep work organized without losing the global gallery.
- **Reference Library** stores reusable image inputs and supports project-scoped references.
- **Structured Presets** let you build reusable prompt workflows with text fields and image slots.
- **Import And Export Presets** makes preset sharing portable between installs.
- **Model-Aware Inputs** show the slots each model actually needs, including first frame, last frame, reference images, motion-control video, and Seedance multimodal references.
- **Prompt Enhancement** can improve prompts through OpenRouter or a local OpenAI-compatible endpoint.
- **Pricing Estimates** show expected cost before generation and save pricing summaries with jobs.
- **Queue And Job Tracking** keeps pending, running, completed, and failed work visible.
- **Retry And Restore** brings failed jobs or old assets back into the composer instead of making you rebuild requests by hand.
- **Local Data Ownership** keeps your database, uploads, downloads, outputs, presets, and project metadata on disk.
- **Version Display** shows the current Media Studio build in the admin navigation and Settings page.

## Useful Docs

- [START_HERE.md](START_HERE.md)
- [docs/prerequisites.md](docs/prerequisites.md)
- [docs/getting-started-mac.md](docs/getting-started-mac.md)
- [docs/getting-started-windows.md](docs/getting-started-windows.md)
- [docs/advanced-runtime.md](docs/advanced-runtime.md)
- [docs/pricing-integration.md](docs/pricing-integration.md)
- [docs/request-lifecycle.md](docs/request-lifecycle.md)

## Versioning

The first public release line starts at `v1.0.0`.

When you ship a new build, update the root `package.json` version. The app reads that package version and displays it as `vX.Y.Z` in the admin nav and Settings page, so testers can confirm exactly which build they are running.
