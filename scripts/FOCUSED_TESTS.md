# Focused refactoring checks

Use Node 22.22.0 and this checkout's installed, locked dependencies. Each worktree
must own its `node_modules`; do not link it to the populated installation. Inspect
the test and its runtime imports before executing it. A test filename does not
prove that it is pure.

```sh
npm run test:web:focused -- apps/web/lib/studio-shortcuts.test.ts
npm run test:focused-harness
npm run lint:full
```

The focused command requires existing explicit `.test.ts`/`.test.tsx` files under
`apps/web/lib`, `hooks` or `components`. It rejects empty scope, globs, runner
options and paths resolving outside the web tree. It supplies an exact Vitest
include list, disables result caching and coverage, uses the config runner loader
to avoid bundled config writes in `node_modules`, and puts Vite caches and temporary
output in its own OS temporary `media-studio-focused-web-*` directory. That directory
is removed on normal success/failure. An externally killed process may leave it;
only remove the particular directory logged by that invocation after checking no
run owns it. Console output can be retained outside the repository.

Only system executable lookup variables are inherited. Provider keys are empty;
live submission, background polling and startup pricing refresh are disabled.
Repository dotenv loading is disabled for focused Vitest runs. **This is cache and
environment isolation, not a filesystem/network sandbox.** A test can explicitly
read a file, load dotenv, import a service or make a request. Such tests require
separate inspection/authorization; this wrapper cannot make them safe. Do not run
the whole web suite locally merely because this focused runner exists.

The inspected smoke test imports only Vitest and the pure `studio-shortcuts`
decision function. Neither reads files, starts services or calls providers. For
graph-change-copy characterization, its only current import is type-only; review
new test imports before running. For process-identification characterization,
use `node --test <explicit pure test file>` after inspection. Never import
`run_studio.mjs` or `stop_studio.mjs` executable entrypoints into tests.

## Python fixture boundary — local execution still blocked

Source inspection of `apps/api/tests/conftest.py` shows that collection creates
`media-studio-pytest-collection-*`, sets a collection DB/data path, imports
`app.store`, and bootstraps schema. `app_modules` subsequently creates `test.db`
and `data` under each pytest `tmp_path`, reloads application modules, and only
then uses the fixture's provider-off settings. `app.settings` loads repository
`.env` without overriding existing variables. Collection therefore needs the
same settings **before** Python starts; fixture-time flags alone are insufficient.

No local pytest, including `--collect-only`, is authorized by this harness.
The concrete scope for a future explicit fixture authorization is:

- One newly allocated OS temporary `media-studio-python-focused-*` parent, with
  `TMPDIR`, `TMP` and `TEMP` set to that parent before Python starts. The collection
  directory must resolve inside it.
- `--basetemp=<parent>/pytest` for pytest-owned per-test databases, and explicit
  `MEDIA_STUDIO_DB_PATH=<parent>/initial.db`,
  `MEDIA_STUDIO_DATA_ROOT=<parent>/data`, and
  `MEDIA_STUDIO_KIE_API_REPO_PATH=<parent>/provider-disabled`.
- Empty `KIE_API_KEY` and `OPENROUTER_API_KEY`; `MEDIA_ENABLE_LIVE_SUBMIT=0`,
  `MEDIA_BACKGROUND_POLL_ENABLED=0`, `MEDIA_PRICING_REFRESH_ON_STARTUP=0` before
  collection; inspect all selected tests/imports for other credentials, dotenv
  loads and flag overrides. Disable third-party pytest plugin autoload.
- Only named, inspected tests with mocked provider/network boundaries; no paid
  requests, service startup, populated database access or real provider checkout.
  Use an independently installed Python environment. Do not reuse provider venvs.
- Approval must identify the actual resolved fresh parent and selected tests,
  permit those disposable databases/data paths and cleanup of that parent only.
  Verify separation first. These proposed settings are not an implemented Python
  sandbox or permission to execute fixtures.

Static lint and standalone analyzer fixtures remain permitted because they do not
collect application tests. Existing remote CI uses its disposable checkout and
existing fixtures; a CI pass is not proof of local populated-installation safety.

Tickets 07–09 can use the inspected pure web/Node path and do not require Python
fixture authorization. Keep their worktrees independent and run the full static
gate and PR CI after focused behavior checks.
