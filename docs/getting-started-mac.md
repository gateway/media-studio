# Media Studio Setup for macOS

Use this path if you want a clean first-run setup with the required KIE API dependency and local database created for you.

## Prerequisites

Before you start, make sure this Mac has:

- Git
- Python 3
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
- create or reuse the shared Python virtualenv
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
