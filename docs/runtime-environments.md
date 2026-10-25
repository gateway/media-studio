# Local development environments

Media Studio uses the configured KIE provider checkout's `.venv` for its API and provider library. Use `npm run setup:shared-env` to maintain this environment; do not recreate it with system Python. The supported baseline is Python 3.11+ and Pillow 13.x. Provider CI covers Python 3.11 and 3.14; Media Studio CI uses 3.11.

The separate `.venv/static-analysis` in the Media Studio checkout contains only the pinned tools from `scripts/static-analysis/requirements.txt`. Follow `scripts/static-analysis/README.md`. Runtime and static analysis have different dependency owners; do not install analyzer packages globally or copy virtual environments between checkouts.

Run provider tests through the shared interpreter, excluding live smoke unless separately authorized. Media Studio database fixtures belong in disposable CI installations, or in an explicitly authorized, isolated local disposable environment. Local fixture runs must keep source, databases and data roots separate from the populated installation and prevent live provider requests. Without that explicit authorization, local acceptance uses the populated installation read-only and database-free contract checks; never point fixtures at user data.

Before retiring any checkout or environment, inspect processes, Git status and worktree history, and inventory databases/media/settings. Preserve uncommitted work and audit evidence. Remove only confirmed unused dependency environments or merged worktrees. A directory called `temp` can still contain valuable data. Do not delete databases, media, settings, history or backups as dependency housekeeping.

After dependency updates, use Guardian with `--include-installed`; manifest-only scans do not establish installed-runtime security. Distinguish inactive backups, bundled package-manager tooling and the serving environment. Keep operational inventories outside tracked source.

Run `npm run lint` before submitting JS/TS, Python or CSS changes. See the [static-analysis guide](../scripts/static-analysis/README.md) for setup, existing-debt baselines, regression tests and CI coverage.
