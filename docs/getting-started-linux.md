# Getting Started On Linux

This is the normal local install path for Linux desktops and workstations.

## Requirements

- `git`
- `python3`
- Node.js LTS with `npm`
- a funded Kie AI account for live generation
- a `KIE_API_KEY`

## Install

```bash
git clone https://github.com/gateway/media-studio.git
cd media-studio
./scripts/onboard_linux.sh
```

The onboarding script will:

- reuse or clone the sibling KIE API repo
- create or reuse the shared Python virtualenv
- install the API and web dependencies
- create `.env`
- create the local database
- prompt for your KIE API key
- optionally prompt for prompt enhancement providers

## Start And Stop

Start Studio:

```bash
npm run start:studio
```

Stop Studio:

```bash
npm run stop:studio
```

The start command runs the API and web app together in one terminal, checks migration safety, refreshes the production web build if needed, writes logs under `data/runtime/`, waits for readiness, and opens Studio.

Alternate ports:

```bash
npm run start:studio -- --api-port 8010 --web-port 3010
```

If the default ports are busy, Studio automatically chooses the next open API and web ports for that launch. Passing explicit ports keeps startup strict: if one of those ports is busy, startup stops and asks you to choose another pair.

Developer hot-reload mode:

```bash
npm run dev
```

Use developer mode only when editing the code. Normal users should use `npm run start:studio`.
