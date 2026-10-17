# Media Studio Setup for macOS

Use this path if you want a clean first-run setup with the required KIE API dependency and local database created for you.

## Prerequisites

Before you start, make sure this Mac has:

- Git
- Node.js **LTS**

If you want a short prerequisites page first:

- [docs/prerequisites.md](prerequisites.md)

If Git is missing, run:

```bash
xcode-select --install
```

If Node.js is missing, install the **LTS** release from:

- [nodejs.org](https://nodejs.org)

## 1. Clone Media Studio

```bash
git clone https://github.com/gateway/media-studio.git
cd media-studio
```

## 2. Run the onboarding helper

```bash
./scripts/onboard_mac.sh
```

The script will:

- reuse an existing sibling `../kie-api` or `../kie-ai/kie_codex_bootstrap` checkout when present
- clone `gateway/kie-api` beside this repo if no supported sibling checkout exists
- download private Python 3.11 and create or reuse its shared virtualenv
- install Python dependencies plus the web app workspace dependencies
- create `.env` if it does not exist
- create a clean local SQLite database with schema and default presets
- prompt for your Kie AI API key
- report Codex Local availability on this machine
- optionally set Codex Local as the default local AI provider for prompt enhancement and Prompt Recipe drafting
- leave OpenRouter and local OpenAI-compatible endpoints for later setup in `Settings -> AI`

The shared Python virtualenv includes editable installs of:

- `kie-api`
- `media-studio-api`

System Python and shell profiles are unchanged. Both packages run from
`kie-api/.venv`; its private interpreter lives in `kie-api/.media-studio-runtime`.
Onboarding checks imports and the Studio model list before reporting success.
For existing environment migration, see [Python setup](prerequisites.md#python-is-managed-by-onboarding).

Test-only packages are installed later only when you run the quality or release verification scripts.

Committed verification tooling such as Vitest stays out of the normal user path until you run the quality or release verification workflow.

## 3. Add the required KIE API key

Live generation requires `KIE_API_KEY`.

Get a key here:

- [kie.ai referral](https://kie.ai?ref=e7565cf24a7fad4586341a87eaf21e42)

If you skip this during onboarding, Media Studio stays in offline-safe mode until you add the key later.

## 4. Optional AI providers

During onboarding, the macOS script checks whether Codex Local is ready. If it is ready, the script can set Codex Local as the default local provider for prompt enhancement and Prompt Recipe drafting.

OpenRouter and local OpenAI-compatible endpoints are still supported, but they are advanced setup paths that should be wired later in `Settings -> AI`.

Provider paths:

- Codex Local through your local `codex` login
- `OPENROUTER_API_KEY` for hosted enhancement and drafting
- `MEDIA_LOCAL_OPENAI_BASE_URL` and optional `MEDIA_LOCAL_OPENAI_API_KEY` for a local OpenAI-compatible endpoint

Users can still generate media without prompt enhancement.

If you need to revisit any provider choice later, open the AI settings URL printed by the launcher. On a default free-port launch, that is `http://127.0.0.1:3000/settings/llms`.

## Terminal windows and port conflicts

If you choose the launch option at the end of onboarding, the script uses one launcher Terminal window for normal Mac use.

That launcher starts:

- the FastAPI control API
- the Next.js web app

behind one Terminal window, and it opens the browser to `/studio`.

Before launching, the script checks whether the configured API and web ports are already in use. If a default port is busy, the launcher chooses the next open local port for that launch and prints the actual Studio URL. If you pass explicit ports, startup stays strict and asks you to choose another pair when one is busy.

## 5. Start the app

Onboarding offers to add **Media Studio.app** to your Desktop. Double-click the icon
to start the API and web app, then open Studio in your default browser. It opens
Terminal automatically to show startup progress and errors; you do not need to
open Terminal or type a command yourself. Press **Ctrl+C** in that window to stop
Studio, or use `Stop Media Studio.command` in the checkout.

For an existing installation, create the icon once from the repo folder:

```bash
npm run desktop:install:mac
```

You can drag the app to the Dock for quick access. To install in a different folder:

```bash
npm run desktop:install:mac -- "$HOME/Applications"
```

The icon points to this checkout and remembers the Node/tool paths available when
it was installed. Reinstall it if you move the checkout or replace Node. Reinstalling
updates an icon belonging to the same checkout; it refuses to overwrite an app
belonging to another installation. Moving the icon itself is fine. To remove it,
move `Media Studio.app` to Trash; this does not remove Studio or your data.

If macOS asks whether Media Studio may control Terminal, allow it to launch the
startup command. Clicking the icon again after Studio is ready reopens the running
instance, including when startup selected temporary ports. Wait for startup to
finish before launching it again.

Friend-friendly launchers from the repo root:

- `Start Media Studio.command`
- `Stop Media Studio.command`

`Start Media Studio.command` uses one launcher Terminal window on macOS, starts both the API and web processes in production mode, waits for Studio to be ready, and opens the browser to `/studio`.

If you prefer Terminal but still want the normal user path, run:

```bash
./scripts/run_studio_mac.sh
```

That script runs the local app in production mode, waits for it to become ready, and opens the browser to `/studio`.

If the default ports are already in use by another app, the normal macOS launcher automatically chooses the next available temporary ports and prints the actual Studio URL. To force a specific pair instead, pass it directly:

```bash
./scripts/run_studio_mac.sh --api-port 8010 --web-port 3010
```

The startup scripts now derive the web control API URL from the chosen API host and port automatically, so you do not need to manually edit every related base URL when you just want alternate local ports.

If you want the friendlier launcher behavior with the same override:

```bash
./scripts/open_studio_mac.sh --api-port 8010 --web-port 3010
```

If you close the launcher window by mistake or something gets stuck locally, the easiest recovery path is:

- `Stop Media Studio.command`
- then `Start Media Studio.command`

The Mac launcher now also tries to auto-clean stale local Media Studio processes if only the API or only the web app is still running.

## Contributor Hot-Reload Mode

For normal use, prefer `Start Media Studio.command` or `./scripts/run_studio_mac.sh`. Use hot-reload mode only when you are actively editing the code:

```bash
npm run dev
```

That path runs the API and web app together with hot reload, so you may see dev-only UI such as the Next badge or overlay.

Then open the URL printed by the launcher. On a default free-port launch, that route is:

- `http://127.0.0.1:3000/studio`

If port `3000` is busy, the launcher picks another web port and prints the actual temporary Studio URL.

### Private LAN / TailScale access

If you want to open Studio from another device on your private LAN or TailScale network, add this to `.env`:

```env
MEDIA_STUDIO_ALLOW_PRIVATE_NETWORK_ACCESS=true
```

When private network access is enabled, Studio also allows active LAN/TailScale IPv4 addresses for Next.js development hydration. If your adapter or proxy is unusual, add the phone-visible host explicitly:

```env
MEDIA_STUDIO_ALLOWED_DEV_ORIGINS=100.64.x.y
```

Then restart Studio with:

```bash
./scripts/stop_studio_mac.sh
./scripts/run_studio_mac.sh
```

For an alternate port pair, stop and start with the same explicit values:

```bash
./scripts/stop_studio_mac.sh --api-port 8010 --web-port 3010
./scripts/run_studio_mac.sh --api-port 8010 --web-port 3010
```

If you are using dev mode instead of the normal production-style launcher, also set:

```env
MEDIA_STUDIO_WEB_HOST=0.0.0.0
```

If you prefer browser auth instead of the private-network flag, use:

```env
MEDIA_STUDIO_ADMIN_USERNAME=your_user
MEDIA_STUDIO_ADMIN_PASSWORD=your_password
```

Media Studio will route you automatically:

- to `/setup` if this machine still needs configuration
- to `/studio` once the API, models, and live key are ready

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

## Retiring legacy login services

Older installations may have login agents named `com.media-studio.api` and
`com.media-studio.web`. If their logs report `Operation not permitted` while
opening a checkout under Documents, macOS is denying the background service
access before Studio starts. Use the Desktop icon for normal startup.

To retire those two legacy agents, disable them persistently, then unload any
that are still running:

```bash
launchctl disable "gui/$(id -u)/com.media-studio.api"
launchctl disable "gui/$(id -u)/com.media-studio.web"
launchctl bootout "gui/$(id -u)/com.media-studio.api"
launchctl bootout "gui/$(id -u)/com.media-studio.web"
```

A bootout message saying the service was not found means it was already unloaded.
The disable setting persists across login; the plist files, checkout, Python
environment, database, and media are retained. Verify with
`launchctl print-disabled "gui/$(id -u)"`. Start Studio with the Desktop icon
afterward. This does not enable automatic startup at login.


### Connections versus AI models

`Settings → Connections` owns OpenRouter keys and local OpenAI-compatible endpoints once for the installation. Codex login and KIE credentials remain machine-managed. Codex Local is the first provider row, with a readiness badge, a read-only Refresh Codex status action and sign-in help. OpenRouter and Local OpenAI-Compatible each have their own row. Optional installation instructions and machine details stay collapsed below the connections. Saved connections apply immediately, while `.env` edits require a restart. `/setup` redirects to Connections and preserves the selected project. `Settings → General` controls queue behavior and output paths. `Settings → AI Models` selects a connected provider and model separately for Prompt Enhance, Recipe Drafts and Media Assistant. Image/video generation models remain under `Image / Video Models`. Section help links open the built-in AI guide in a new tab.

Migration 56 adds the independent connection table and private per-provider task override maps without rewriting existing configuration or media. Explicit task endpoint overrides keep priority over connection URLs, followed by matching legacy Prompt Enhance settings and environment defaults. Explicit connection keys take priority over legacy Prompt Enhance keys; Graph request/node overrides keep their existing behavior. Assistant uses explicitly saved connections, then environment configuration, and continues to avoid borrowing legacy task credentials until a connection is saved. Omitted key fields preserve the configured key; switching task providers retains legacy keys/endpoints for later use. Keys and private override maps are excluded from public responses.

Claude models can be used when offered by a connected provider such as OpenRouter. This app has no Claude subscription login adapter. Anthropic distinguishes subscription billing from API billing in its [official explanation](https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-pro-max-team-or-enterprise-plans-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan).

For OpenRouter across multiple tasks, configure `OPENROUTER_API_KEY` in the existing installation’s `.env` and restart Studio. Prompt Enhance also supports a saved provider key; other AI tasks reuse it only while Prompt Enhance uses the same provider. Switching and saving that connection replaces its previous provider settings. Machine-wide configuration keeps multiple providers available independently. Graph prompt nodes choose their own provider/model inside each workflow.
