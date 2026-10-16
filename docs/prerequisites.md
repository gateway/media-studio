# Media Studio Prerequisites

Before running Media Studio onboarding on macOS, make sure this machine has:

- `git`
- Node.js **LTS** with `npm`

## Check what is already installed

Run:

```bash
git --version
npm --version
```

If one of those commands fails, install that prerequisite first.

## Install Git on macOS

The simplest path is Apple Command Line Tools:

```bash
xcode-select --install
```

That installs `git` and other standard developer tools.

## Python is managed by onboarding

You do not need to install Python. Onboarding downloads a private Python 3.11
runtime using [uv](https://docs.astral.sh/uv/), into
`kie-api/.media-studio-runtime/`. It creates one shared `kie-api/.venv` for
`kie-api` and `media-studio-api`. The web frontend uses Node.js separately.

The installer does not replace system Python, install global Python packages,
or edit your shell profile or PATH. The first setup needs internet access to
download uv, Python and packages.

If an existing `.venv` uses another interpreter, onboarding stops and preserves
it. Stop Studio, move that `.venv` folder to a backup location, then rerun
onboarding. Leave `.env`, databases and media folders in place. An environment
from an earlier setup is preserved even if it happens to use Python 3.11;
the new environment must use the private runtime.

## Install Node.js LTS on macOS

Install the current **LTS** release from:

- [nodejs.org](https://nodejs.org)

After install, reopen Terminal and verify:

```bash
npm --version
node --version
```

## What onboarding installs for you

Once the prerequisites above exist, `./scripts/onboard_mac.sh` will:

- clone or reuse the shared `kie-api` dependency
- download isolated Python 3.11 and create or reuse its shared virtualenv
- install Python packages into that virtualenv
- verify backend/provider imports, the model registry, and package compatibility
- install the web dependencies with `npm`
- create `.env`
- create the local database

You do **not** need to create your own Python virtualenv first.
