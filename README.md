# Media Studio

Media Studio is a local AI image and video workspace for the Kie AI model marketplace.

Media Studio gives you one place to generate images, generate videos, revise old work, build reusable presets, manage references, track jobs, and keep a local gallery of everything you make. Your prompts, presets, projects, references, database, uploads, and outputs stay on your machine.

Media Studio uses [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42), a model marketplace that puts many image and video providers behind one credit-based API. Instead of keeping separate subscriptions for every model provider, you fund one account and spend credits only when you generate.

You can start with as little as $5 funded into your Kie AI account.
Media Studio is not affiliated with Kie AI; however, we do have an affiliate code that buys us a coffee if you use it: [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

> **Pricing disclaimer:** Prices shown in Media Studio are estimates based on the latest pricing data available from Kie AI and the options selected in Studio. Kie can change model pricing, rules, and credit costs at any time. The final charge is determined by Kie, so confirm current Kie pricing before large runs.

![Media Studio gallery and prompt workspace](docs/images/media-studio.jpg)

## What It Is

- A local Studio UI for AI image and video generation.
- A FastAPI control API that stores jobs, batches, presets, projects, pricing, and local media metadata.
- A Next.js dashboard with Studio, Settings, Models, Presets, Jobs, Pricing, and Setup pages.
- A local-first workflow: generated files and runtime data live in your local `data/` folder.
- A Kie-powered model layer, with pricing and model support pulled through the local control API.

## Experimental Surfaces

Graph Studio and Prompt Recipe graph execution are available for local workflow building, with a narrower release boundary than the main Studio surface.

- Graph Studio lets you build node-based workflows with media loaders, prompt nodes, model nodes, preview nodes, save nodes, groups, notes, run diagnostics, and reusable workflow templates.
- Current graph model lanes include image, video, audio/music, Prompt Recipe, and utility nodes where the backend owns validation, pricing, execution, and saved run history.
- Graph workflows can be saved locally, exported as portable templates, and loaded back into another Media Studio install.
- A repo-local Codex skill for building/exporting graph templates lives at `.codex/skills/media-studio-graph-builder/`.
- Saved workflows are database-backed; browser tab state is only a session convenience layer.
- Prompt Recipes are a supported data-backed graph surface.
- End-user custom executable nodes are **not** part of the current release boundary.

Media Studio also now tracks **actual OpenRouter spend** for successful OpenRouter-backed Studio runs. That accounting is shown separately from the KIE credit and USD estimates used for KIE-powered image/video jobs.

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

## Install And Run

You need:

- `git`
- `python3`
- Node.js LTS
- a funded [Kie AI](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42) account
- a `KIE_API_KEY`

Video thumbnails, posters, and browser-friendly playback derivatives are handled through the shared `kie-api` Python environment. A system FFmpeg install can be used when present, but it is not required for normal setup.

### macOS

Install:

```bash
git clone https://github.com/gateway/media-studio.git
cd media-studio
./scripts/onboard_mac.sh
```

Run:

```bash
./scripts/run_studio_mac.sh
```

Stop:

```bash
./scripts/stop_studio_mac.sh
```

Restart:

```bash
./scripts/stop_studio_mac.sh
./scripts/run_studio_mac.sh
```

<details>
<summary><strong>Windows</strong></summary>

Install:

```powershell
git clone https://github.com/gateway/media-studio.git
cd media-studio
powershell -ExecutionPolicy Bypass -File .\scripts\onboard_windows.ps1
```

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run_studio.ps1
```

Stop:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop_studio.ps1
```

Restart:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop_studio.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\run_studio.ps1
```

</details>

<details>
<summary><strong>Linux</strong></summary>

Install:

```bash
git clone https://github.com/gateway/media-studio.git
cd media-studio
./scripts/onboard_linux.sh
```

Run:

```bash
./scripts/run_studio_linux.sh
```

Stop:

```bash
./scripts/stop_studio_linux.sh
```

Restart:

```bash
./scripts/stop_studio_linux.sh
./scripts/run_studio_linux.sh
```

</details>

### What The Runner Does

The macOS, Windows, and Linux onboarding scripts handle the normal setup path for you: dependencies, local environment, database, Kie API key prompt, and optional LLM provider setup for Codex Local, OpenRouter, or a local OpenAI-compatible endpoint.

The run scripts start the API and web app together in production mode, check the sibling `kie-api` checkout for new releases, offer a fast-forward update when safe, check the local database before migrations, create a migration backup when needed, refresh shared Python dependencies and the production web build if needed, write runtime logs under `data/runtime/`, wait for readiness, and open Studio.

If the default ports are busy, Studio automatically chooses the next open API and web ports for that launch. To force a specific pair, pass explicit ports:

```bash
npm run start:studio -- --api-port 8010 --web-port 3010
```

At the end of onboarding, any displayed `127.0.0.1:3000` URL is only the configured/default URL. If that port is busy, the launcher prints and opens the actual temporary Studio URL it selected.

The standalone developer commands use the same port-safety behavior: `npm run dev:api`, `npm run start:api`, `npm run dev:web`, and `npm run start:web` auto-select a temporary open port unless you pass an explicit `--port`.

### Release Flags

Graph Studio hides the experimental Media Assistant chat button by default. To expose it for internal debugging, set `NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG=1` in `.env` and restart the web app so Next.js picks up the client-side flag.

## Cool Features

- **Create Revision** restores an old asset back into Studio with the original prompt, model, settings, and reference media.
- **Projects** keep work organized without losing the global gallery.
- **Reference Library** stores reusable image inputs and supports project-scoped references.
- **Structured Presets** let you build reusable prompt workflows with text fields and image slots.
- **Prompt Recipes** let you build reusable LLM director templates for Graph Studio and future orchestration flows.
- **Graph Studio** is an experimental node graph for chaining prompts, recipes, model runs, previews, saves, notes, and reusable workflow templates.
- **Import And Export Presets** makes preset sharing portable between installs.
- **Model-Aware Inputs** show the slots each model actually needs, including first frame, last frame, reference images, motion-control video, and Seedance multimodal references.
- **Prompt Enhancement** can improve prompts through OpenRouter, the local Codex App Server session, or a local OpenAI-compatible endpoint.
- **Pricing Estimates** show expected cost before generation and save pricing summaries with jobs.
- **Actual OpenRouter Spend Tracking** records successful OpenRouter-backed Studio usage separately from KIE estimates.
- **Queue And Job Tracking** keeps pending, running, completed, and failed work visible.
- **Retry And Restore** brings failed jobs or old assets back into the composer instead of making you rebuild requests by hand.
- **Local Data Ownership** keeps your database, uploads, downloads, outputs, presets, and project metadata on disk.

## Codex Local Provider

Media Studio can now use a local Codex App Server session, authenticated through the operator's local Codex login, as a subscription-backed text + vision provider for:

- Studio prompt enhancement
- Prompt Recipe drafting
- Graph `prompt.llm`
- Graph `prompt.recipe`

Current rollout assumptions:

- `codex_local` is **stateless per request**
- it is treated as **included in your Codex / ChatGPT plan**
- Media Studio does **not** assign a USD estimate or spend ledger entry to `codex_local`
- image generation is **not** part of the current Codex Local rollout boundary
- provider setup and shared LLM defaults now live under `/settings/llms`
- **Version Display** shows the current Media Studio build in the admin navigation.

## Presets

Presets are reusable creative workflows. A preset can hold a prompt template, editable text fields, required image slots, model defaults, and a thumbnail, so you can run a repeatable style or workflow without rebuilding the prompt every time.

You can:

- Create your own presets from the Presets page.
- Use structured fields and image slots for guided workflows.
- Choose which compatible image models a preset can run on.
- Import presets shared by someone else.
- Export your own presets as portable bundles.

Current built-in presets include:

- **2x2 Pose Grid** - generate four fresh pose and camera variations from one person reference.
- **3D Caricature Style** - turn a portrait into a polished 3D caricature while keeping the likeness.
- **Exploding Food** - create high-end commercial food photography with suspended pieces and particles.
- **Food Recipe Infographic** - build clean recipe infographic layouts from a food name.
- **Giant Animal Anywhere** - place a huge cute animal into a real-world location.
- **Photo Restoration** - colorize and clean old photos from one uploaded source image.
- **Selfie with Movie Character** - place your portrait into a cinematic selfie with a named character.

If you build presets you want to share with other users, let us know. We would love to collect good community presets and add them to the project.

## Controls

Common shortcuts:

| Input | Action |
| --- | --- |
| `G` | Open Projects |
| `N` | Open Graph Studio |
| `P` | Open Presets |
| `S` | Open Settings |
| `C` | Toggle the bottom console |
| `Cmd/Ctrl+Z` | Undo |
| Right-click empty Graph canvas | Open node search at the pointer |
| Drag from an output port to an input port | Create a wire |

See [keyboard and mouse controls](docs/keyboard-mouse-controls.md) for the full Studio and Graph Studio control reference.

## Useful Docs

- [START_HERE.md](START_HERE.md)
- [docs/prerequisites.md](docs/prerequisites.md)
- [docs/getting-started-mac.md](docs/getting-started-mac.md)
- [docs/getting-started-linux.md](docs/getting-started-linux.md)
- [docs/getting-started-windows.md](docs/getting-started-windows.md)
- [docs/keyboard-mouse-controls.md](docs/keyboard-mouse-controls.md)
- [docs/advanced-runtime.md](docs/advanced-runtime.md)
- [docs/pricing-integration.md](docs/pricing-integration.md)
- [docs/release-packaging.md](docs/release-packaging.md)

## License

Media Studio is source-available for non-commercial use under the terms in [LICENSE](LICENSE) and [ADDITIONAL_TERMS.md](ADDITIONAL_TERMS.md).

You may install it, run it, study it, modify it, and use it to make creative work for non-commercial purposes. Commercial use requires prior written approval. For commercial licensing, contact [@gateway on X](https://x.com/gateway).

AI coding assistants may be used to understand, debug, modify, or contribute to this project within the allowed license scope. They may not be used to copy substantial parts of this codebase into another project, train a model on it, or recreate it for redistribution without prior written permission.

## Versioning

The first public release line starts at `v1.0.0`. The current build is `v1.0.1`.

When you ship a new build, update the root `package.json` version. The app reads that package version and displays it as `vX.Y.Z` in the admin nav, so testers can confirm exactly which build they are running.
