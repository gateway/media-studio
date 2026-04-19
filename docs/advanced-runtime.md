# Advanced Runtime And Operations

This doc is for the operator side of Media Studio: launch commands, alternate ports, development mode, private LAN / TailScale access, backups, and background supervision.

If you just want to install and start generating, use:

- [START_HERE.md](../START_HERE.md)
- [getting-started-mac.md](./getting-started-mac.md)

## Normal Launch

From the repo root:

```bash
./scripts/run_studio_mac.sh
```

That starts:

- the FastAPI control API
- the Next.js web app

Then it waits for Studio to become ready and opens the browser to:

- `http://127.0.0.1:3000/studio`

Friendlier macOS launchers:

- `Start Media Studio.command`
- `Stop Media Studio.command`

## Alternate Ports

If `3000` or `8000` is already in use, launch with a different pair:

```bash
./scripts/run_studio_mac.sh --api-port 8010 --web-port 3010
```

If you want the same override through the macOS opener:

```bash
./scripts/open_studio_mac.sh --api-port 8010 --web-port 3010
```

Stop the same pair with:

```bash
./scripts/stop_studio_mac.sh --api-port 8010 --web-port 3010
```

The startup scripts derive the matching web-to-API base URL automatically, so you do not need to hand-edit multiple environment variables just to move to a different local port pair.

## Developer Mode

If you are actively working on the code and want hot reload:

```bash
npm run dev:api
./scripts/dev_web.sh
```

Then open:

- `http://127.0.0.1:3000/studio`

Use this for development only. It runs the web app in Next.js dev mode.

## Private LAN / TailScale Access

If you want to open Studio from another device on your private LAN or TailScale network, add this to `.env`:

```env
MEDIA_STUDIO_ALLOW_PRIVATE_NETWORK_ACCESS=true
```

Then restart Studio:

```bash
./scripts/stop_studio_mac.sh
./scripts/run_studio_mac.sh
```

For an alternate port pair:

```bash
./scripts/stop_studio_mac.sh --api-port 8010 --web-port 3010
./scripts/run_studio_mac.sh --api-port 8010 --web-port 3010
```

If you are using development mode instead of the normal production-style launcher, also set:

```env
MEDIA_STUDIO_WEB_HOST=0.0.0.0
```

If you prefer browser auth instead of the private-network shortcut, use:

```env
MEDIA_STUDIO_ADMIN_USERNAME=your_user
MEDIA_STUDIO_ADMIN_PASSWORD=your_password
```

## Local Backups And Database Safety

Back up the current database:

```bash
./scripts/backup_db.sh
```

Check migration status:

```bash
npm run db:migration-status
```

Create a clean schema-only database:

```bash
./scripts/create_clean_db.sh --output ./data/backups/media-studio-clean.sqlite --overwrite
```

Important:

- `data/` is persistent local app state
- do not commit it
- do not use blanket cleanup commands that can remove it

If you need to sync the repo safely without wiping local runtime data:

```bash
./scripts/safe_sync_repo.sh main
```

## Background Supervision

If you want Media Studio to run under a real process supervisor instead of a Terminal window, use:

- `pm2`
- `launchd`
- `systemd`
- `supervisord`

Detailed supervision examples live here:

- [runtime-and-supervision.md](./runtime-and-supervision.md)

That doc covers:

- `pm2`
- `launchd`
- `systemd`
- `supervisord`
- health checks
- restart behavior
- deployment-style supervision guidance

## Health Check

The main API health endpoint is:

```bash
curl http://127.0.0.1:8000/health
```

It reports queue and runner state in addition to simple process liveness.

## Best Use

Use this doc when you need to:

- change ports
- expose Studio to a private LAN or TailScale network
- run in developer mode
- back up or inspect local DB state
- supervise Media Studio like a longer-running service
