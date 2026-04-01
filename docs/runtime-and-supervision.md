# Runtime And Supervision

This document describes how to run Media Studio in a restartable way without forcing a permanent background service onto your machine by default.

## Architecture

Media Studio has two long-running processes:

- API: FastAPI backend, queue store, embedded Media Studio Runner, filesystem artifact publish
- Web: Next.js app

Important:

- the queue runner lives inside the API process as the Media Studio Runner
- if the API process stops, the runner stops with it
- when the API starts again, the runner reconciles queued and active jobs from the database

This means the correct production-style setup is to supervise the API process, not to expect the runner to resurrect its own parent process.

## What Happens On Restart

On API startup, the runner:

- repairs queue positions
- resets invalid active jobs
- recomputes open batch counts
- attempts to recover active jobs that already have terminal provider status cached

Studio itself rehydrates from the database and dashboard snapshot when the page loads again, so leaving `/studio` and returning later should show the latest persisted state.

## Recommended Modes

Choose one of these. Do not enable one accidentally and forget it is running.

- `pm2`: easiest cross-platform developer supervision
- `systemd`: best for Linux servers
- `launchd`: best for macOS background services
- `supervisord`: good generic process supervisor
- Docker restart policy: best if you package the app into containers

All examples live in:

- [`ops/`](../ops)

## Start Commands

API:

```bash
cd /absolute/path/to/media-studio
npm run start:api
```

Web:

```bash
cd /absolute/path/to/media-studio
npm run build
npm run start:web
```

Notes:

- `start:api` uses [`scripts/start_api.sh`](../scripts/start_api.sh)
- it loads `.env`, points at the shared KIE repo, and starts `uvicorn` without `--reload`
- `dev:api` is still the right choice for local coding sessions

## PM2

Files:

- [`ops/ecosystem.config.cjs`](../ops/ecosystem.config.cjs)

Use:

```bash
cd /absolute/path/to/media-studio
npm run build
pm2 start ops/ecosystem.config.cjs
pm2 status
pm2 logs media-studio-api
pm2 logs media-studio-web
```

Stop:

```bash
pm2 stop media-studio-api media-studio-web
```

Remove:

```bash
pm2 delete media-studio-api media-studio-web
```

If you do not want Media Studio to survive reboots, do not run `pm2 save`.

## systemd

Files:

- [`ops/media-studio-api.service`](../ops/media-studio-api.service)
- [`ops/media-studio-web.service`](../ops/media-studio-web.service)

Typical flow:

```bash
sudo cp ops/media-studio-api.service /etc/systemd/system/
sudo cp ops/media-studio-web.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now media-studio-api
sudo systemctl enable --now media-studio-web
sudo systemctl status media-studio-api
```

Disable:

```bash
sudo systemctl disable --now media-studio-api media-studio-web
```

## launchd (macOS)

Files:

- [`ops/com.media-studio.api.plist`](../ops/com.media-studio.api.plist)
- [`ops/com.media-studio.web.plist`](../ops/com.media-studio.web.plist)

Before loading the plist files, replace `__MEDIA_STUDIO_ROOT__` with your local checkout path:

```bash
ROOT="/absolute/path/to/media-studio"
sed "s|__MEDIA_STUDIO_ROOT__|$ROOT|g" ops/com.media-studio.api.plist > ~/Library/LaunchAgents/com.media-studio.api.plist
sed "s|__MEDIA_STUDIO_ROOT__|$ROOT|g" ops/com.media-studio.web.plist > ~/Library/LaunchAgents/com.media-studio.web.plist
```

Load:

```bash
launchctl load ~/Library/LaunchAgents/com.media-studio.api.plist
launchctl load ~/Library/LaunchAgents/com.media-studio.web.plist
```

Unload:

```bash
launchctl unload ~/Library/LaunchAgents/com.media-studio.api.plist
launchctl unload ~/Library/LaunchAgents/com.media-studio.web.plist
```

Verified local test flow after substituting `__MEDIA_STUDIO_ROOT__`:

```bash
cd /absolute/path/to/media-studio
npm run build
plutil -lint ops/com.media-studio.api.plist
plutil -lint ops/com.media-studio.web.plist
ROOT="$PWD"
sed "s|__MEDIA_STUDIO_ROOT__|$ROOT|g" ops/com.media-studio.api.plist > ~/Library/LaunchAgents/com.media-studio.api.plist
sed "s|__MEDIA_STUDIO_ROOT__|$ROOT|g" ops/com.media-studio.web.plist > ~/Library/LaunchAgents/com.media-studio.web.plist
launchctl unload ~/Library/LaunchAgents/com.media-studio.api.plist >/dev/null 2>&1 || true
launchctl unload ~/Library/LaunchAgents/com.media-studio.web.plist >/dev/null 2>&1 || true
launchctl load ~/Library/LaunchAgents/com.media-studio.api.plist
launchctl load ~/Library/LaunchAgents/com.media-studio.web.plist
launchctl list | rg 'com.media-studio.(api|web)'
curl http://127.0.0.1:8000/health
curl -I http://127.0.0.1:3000
```

Expected result:

- `launchctl list` shows both `com.media-studio.api` and `com.media-studio.web`
- `http://127.0.0.1:8000/health` returns `status: ok`
- `http://127.0.0.1:3000` responds and redirects to `/setup`

If launchd reports the labels as loaded but they never start, check the log files in `/tmp/` first.

Known macOS caveat:

- a repo launched from protected folders like `Documents` can fail under `launchd` with `Operation not permitted`
- if that happens, either move the repo to a less restricted location, grant the relevant shell/tooling full disk access, or use `pm2`/manual dev mode instead

If you do not want Media Studio running after logout or reboot, unload the jobs and remove the plist files from `~/Library/LaunchAgents`.

## supervisord

File:

- [`ops/supervisord.conf`](../ops/supervisord.conf)

Use:

```bash
supervisord -c ops/supervisord.conf
supervisorctl -c ops/supervisord.conf status
```

Stop:

```bash
supervisorctl -c ops/supervisord.conf shutdown
```

## Health Checks

Use the API health route:

```bash
curl http://127.0.0.1:8000/health
```

It now reports:

- queue enabled state
- queued and running job counts
- runner heartbeat
- `issues`

If `issues` is non-empty, the service is unhealthy even if the API is still responding.

## Studio Runtime Expectations

Studio now distinguishes these phases more clearly:

- validating request
- preparing and submitting
- waiting for provider completion
- publishing final output into Studio

If the provider finishes but local artifact publish fails, the UI should surface that as a publish problem rather than leaving a generic spinner.

## Secrets And GitHub Readiness

Before pushing this repo publicly or to a shared private remote:

- keep real values only in `.env`
- never commit live API keys
- keep `.env.example` as placeholders only
- keep local DBs and generated outputs ignored

Current repo state already ignores:

- `.env`
- local SQLite files
- generated data folders

## Recommendation

For your machine:

- use manual dev commands while actively building
- only enable a supervisor when you explicitly want background resilience
- prefer `pm2` or `launchd` on macOS, depending on whether you want app-style process management or native OS service management

For deployment:

- supervise both API and Web
- monitor `/health`
- restart the API automatically if the process exits
- treat runner health as part of API health, not a separate hidden concern
