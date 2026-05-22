# Release Packaging

Media Studio is local-first software. Public release material should help a user understand what it does, what it needs, how to run it, and how local data is handled.

## Public Docs

These docs are intended to be safe for public release after final review:

- `README.md`
- `START_HERE.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `docs/prerequisites.md`
- `docs/getting-started-mac.md`
- `docs/getting-started-linux.md`
- `docs/getting-started-windows.md`
- `docs/runtime-and-supervision.md`
- `docs/advanced-runtime.md`
- `docs/pricing-integration.md`
- `docs/media-studio-preset-system.md`
- `docs/graph-studio-design.md`
- `docs/graph-studio-node-authoring.md`
- `docs/graph-studio-node-extension-architecture.md`
- `docs/graph-studio-node-library.md`
- `content/README.md`
- curated portable bundles under `content/media-presets/`, `content/prompt-recipes/`, and `content/graph-workflows/`

## Internal-Only Material

These files are local development notes, audit artifacts, or generated reports. They should not be treated as release docs or marketing material:

- `docs/development/`
- `docs/reviews/`
- `docs/API_SECURITY_FULL_REPORT.md`
- `docs/review-remediation-plan.md`
- local screenshots such as `tmp-graph-studio.png`
- local runtime folders such as `data/`, `output/`, `outputs/`, `tmp/`, and `temp/`

The repo ignores development notes and generated artifacts by default. `.gitattributes` also excludes them from generated source archives.

## Release Checklist

Before publishing a public repository or source archive:

- Replace the early MIT license with the intended distribution license.
- Confirm the README license section matches `LICENSE` and `package.json`.
- Run repo hygiene checks so local secrets, databases, logs, review outputs, and generated media are not tracked.
- Confirm macOS, Linux, and Windows setup docs tell the same provider story: KIE is required for generation; Codex Local, OpenRouter, and Local OpenAI-compatible providers are optional prompt providers.
- Confirm onboarding scripts and `/setup` use the same status language: Ready, Connecting, Running, Failed, and Not set up.
- Confirm curated content under `content/` contains only portable exports and no local database state, generated output folders, credentials, or private reference media.
