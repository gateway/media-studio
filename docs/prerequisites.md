# Media Studio Prerequisites

Before running Media Studio onboarding on macOS, make sure this machine has:

- `git`
- `python3`
- Node.js **LTS** with `npm`

## Check what is already installed

Run:

```bash
git --version
python3 --version
npm --version
```

If one of those commands fails, install that prerequisite first.

## Install Git on macOS

The simplest path is Apple Command Line Tools:

```bash
xcode-select --install
```

That installs `git` and other standard developer tools.

## Install Python 3 on macOS

If `python3` is missing, install a current Python 3 release from:

- [python.org](https://www.python.org/downloads/macos/)

After install, reopen Terminal and verify:

```bash
python3 --version
```

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
- create or reuse the shared Python virtualenv
- install Python packages into that virtualenv
- install the web dependencies with `npm`
- create `.env`
- create the local database

You do **not** need to create your own Python virtualenv first.
