# JavaScript, TypeScript, Python and CSS development gates

From the repository root, set up the isolated analyzer environment once:

```sh
npm ci --ignore-scripts
python3.11 -m venv .venv/static-analysis
.venv/static-analysis/bin/python -m pip install -r scripts/static-analysis/requirements.txt
npm run lint
```

On Windows use `py -3.11 -m venv .venv/static-analysis` and
`.venv/static-analysis/Scripts/python.exe -m pip install -r scripts/static-analysis/requirements.txt`.
An existing dedicated environment can be selected with `STATIC_ANALYSIS_PYTHON`
(absolute path to its Python executable). Missing environments fail; lint never
installs dependencies. Python 3.11 is the verified local/CI analyzer runtime.

`npm run lint` runs web, Python, CSS/theme, then full dependency/duplication gates
and informational unused-code reporting.
`npm run lint:full` is the full-scope alias used in CI. `npm run lint:web` and the web workspace's
`npm run lint` run only the web gate; `npm run lint:python` runs only Python.
Use Node **22.22.0** to reproduce the dedicated CI job. The installed ESLint release
requires Node ^20.19.0, ^22.13.0 or >=24.0.0; older Node 20 installations must upgrade.
The static-only CI install uses `npm ci --ignore-scripts` and needs no provider checkout,
app server, database, credentials or paid generation.

These gates check JS/TS, Python, CSS/theme, import architecture and duplication;
Knip reports unused-code candidates.
Normal web builds run web lint/types before Next. Quality/release workflows run
full static lint before their existing application tests.

## What runs

- ESLint 10.13.0 with @eslint/js 10.0.1 recommended rules,
  typescript-eslint 8.71.2 recommended rules and SonarJS 4.2.2 selected rules.
  Cyclomatic complexity limit: **15**; cognitive complexity limit: **20**.
  Identical functions, duplicated branches and conditions, explicit any, unused
  variables and recommended correctness rules are enabled in `eslint.config.mjs`.
  React Hooks 7.1.1 enables rules-of-hooks and exhaustive-deps. Typed web lint enables
  no-floating-promises (including void-discarded promises), no-misused-promises and
  switch-exhaustiveness-check. array-callback-return applies to all scanned JS/TS.
- TypeScript 5.9.3 compiler API, using the web tsconfig with noEmit and incremental
  disabled, plus noUnusedLocals/noUnusedParameters. Real type/configuration errors
  always fail. Only unused diagnostics TS6133/6192/6196/6198 can enter the baseline.
- The `scripts/lint_web.mjs` custom web checks, with stateless per-file predicates. Any nonzero exit fails.
- Ruff 0.17.1 checks E4/E7/E9/F/B/C901; C901 limit 15. Radon 6.0.1 measures each
  function with its native AST visitor, including methods of nested classes missed
  by its ordinary CLI output. Independent Radon CC limit: 15. Radon CLI MI is
  informational. Python source is parsed, never imported or executed.

ESLint scans web source/tests, operational JS/TS under scripts/ and ops/, and root JS configs. It
excludes dependencies, Next output, declaration files, test-results, runtime data
and the old `tools/static-analysis` audit harness. TypeScript follows tsconfig,
which excludes web test/spec files and vitest.config.ts; ESLint still checks those.
Typed ESLint uses tsconfig.lint.json and includes web tests and vitest.config.ts.
Operational JS scripts receive syntactic rules only.
Inline eslint-disable/config comments cannot bypass this gate.

Python scans apps/api, scripts, optional tests/ and root *.py files, including test
sources. Dependencies, .venv, .git, generated/build output, __pycache__ and runtime
data are excluded explicitly. Production/test totals are reported separately. Ruff
noqa comments cannot silently bypass the gate. No pytest collection occurs. See
[baseline review](BASELINE_REVIEW.md) for narrow FastAPI and existing-debt dispositions.

## Baseline contract

`baseline.json` records existing debt, not clean-code certification. Every new
configured warning/error fails. Existing over-limit functions may not increase
their measured complexity. Matching uses checkout-relative file, rule, AST
declaration identity and token context, never global totals or source line numbers.
File/function renames require review. Anonymous callbacks use their token content
because there is no reliable declaration name: editing a flagged callback can
require explicit review even when its metric decreases. Identical ambiguous sites
fail closed rather than receiving an inferred exemption. Non-metric findings use
statement tokens, branch/adjacent context and diagnostic token position; edits to that context
can invalidate its exemption. Diagnostic locations stay in evidence for review.

The contract hashes analyzer versions, the lockfile, configuration, tsconfig,
scope and gate implementation. Changes require deliberate rebaselining; a changed
lockfile is intentionally conservative, including unrelated dependency updates.
Ordinary lint never writes the baseline. After fixing debt, remove stale exemptions
with an explicit refresh. Do not refresh simply to make a failing PR green:

```sh
npm run lint:web:baseline -- "Explain the reviewed changes or removed debt"
git diff -- scripts/static-analysis/baseline.json
npm run lint
```

Review added/removed identities and metric changes with the raw reports. Refresh
will not accept type errors, failed tools or findings in the gate implementation.
The web baseline has 761 ESLint findings and 128 TypeScript unused diagnostics;
application refactoring belongs to subsequent tickets. No findings are waived by
an LLM judgment at runtime.

Python has its own `python-baseline.json`. Refresh with
`npm run lint:python:baseline -- "Explain the reviewed Python changes"`, inspect its
diff, then run lint. Its contract includes pinned package versions, config, scope
and runner code. Paths and text line endings are normalized for portability.
Python syntax/tool errors and findings in the new gate cannot be baselined.
The initial Python baseline contains 298 Ruff findings (30 C901) and 245 Radon
functions above CC 15. These metrics remain independent; they are not combined
into a complexity score. Existing debt is visible even when the regression gate passes.

## Evidence and acceptance tests

Each run prints its evidence directory (a fresh OS temporary directory by default).
Set `STATIC_ANALYSIS_OUTPUT` to a dedicated parent directory to retain/upload runs.
Each run gets its own subdirectory so stale successful results cannot mask a failure.
It contains raw ESLint results, effective configurations, TypeScript diagnostics
and files, custom guard stdout/stderr/status, tool/config metadata, normalized
findings, and a pass/fail summary or failure record. Nonzero exit is authoritative.
The gate does not install packages, autofix, emit JS or write tsbuildinfo caches.

`npm run test:static-analysis` includes the custom-web consecutive-file regression suite and runs pure Node tests and disposable source fixtures
against the actual installed analyzers. It checks identity matching, line shifts,
renames/new files, replacement findings, worsening metrics, compiler errors,
missing dependencies and invalid configurations. Fixtures import no app code.

`npm run test:static-analysis:python` runs standalone unittest fixtures against real
Ruff/Radon, covering correctness, independent complexity metrics, nested methods,
line shifts, renames/new files, replacement findings, tool/config failures and
malformed/incomplete reports. It does not load the application test harness.

`.github/workflows/static-analysis.yml` runs all five fixture suites and the combined gate
on every PR and main push, retaining reports even on failure. Use the required-check policy below when configuring main branch protection. Committing a workflow alone does not enforce merges; remote CI
execution and branch protection must be verified separately. No hooks are installed.
# CSS checks

`npm run lint` also runs `npm run lint:css`: Stylelint over all CSS under `apps/web` (excluding dependencies, `.next`, and test results), followed by the existing theme-drift guard. It uses the same dedicated Python environment described below, or `STATIC_ANALYSIS_PYTHON`. There is no package installation during lint.

Run `npm run test:static-analysis:css` for the real-tool positive/negative fixtures; CI runs this command before the same root lint command. Fixtures cover Tailwind/token syntax, historical specificity with line shifts, new unknown properties even inside disable comments, syntax failures, and theme drift. JSON stream parsing and baseline regression policy have focused tests too.

Review [CSS_BASELINE_REVIEW.md](CSS_BASELINE_REVIEW.md) for the 1,127 historical findings, Tailwind policy, theme thresholds and dependency limitations. New occurrences fail, including warnings. A deliberate reviewed refresh uses `npm run lint:css:baseline -- "review reason"`; config, lockfile or runner changes require this explicit review. Never refresh merely to make lint green.

Every run writes raw Stylelint stdout/stderr, JSON findings, effective rules, exact versions/config hashes, coverage, theme output and exit statuses to a unique directory under `STATIC_ANALYSIS_OUTPUT` or the OS temporary directory. Missing or malformed JSON and analyzer failures block the check. CI preserves the directory as an artifact.

## Full graph and duplication gate

`npm run lint:architecture` runs Dependency Cruiser and jscpd across the complete
source inventory, with production and test clone reports separated. New production
clone pairs fail; test clones are informational. Dependency violations always fail,
including type-only cycles. See [FULL_GATE_REVIEW.md](FULL_GATE_REVIEW.md) for the
50-token/5-line mild policy, exclusions, identity and coverage limitations.

`npm run lint:architecture:baseline -- "review reason"` explicitly refreshes the
production clone baseline. Review pair endpoints and raw evidence before accepting
debt. `npm run test:static-analysis:full` proves cross-file clones, type-only cycles,
unresolved edges, source-to-test imports, line shifts, renames, invalid reports,
missing tools and invalid merge-base failure.

`npm run lint:changed -- --base origin/main` verifies the merge base and then runs
the FULL gate. A fast partial scan is not implemented; graph and clone findings
depend on unchanged files too. Missing/shallow history fails with a clear message;
fetch the base or run `npm run lint:full`. CI never uses partial scope.

Quality/release commands require the same dedicated analyzer environment as lint;
they do not install it implicitly. Existing application-test and data safeguards
remain in force. Static lint imports no application code, creates no application
database and starts no services. Shell/PowerShell and runtime semantics remain
outside these analyzers. The main branch protection policy requires these always-run GitHub Actions checks:

- `javascript-typescript-python`
- `quality-gates`
- `admin-theme`
- `publication-safeguards`
- `shared-python-onboarding (ubuntu-latest)`
- `shared-python-onboarding (macos-latest)`
- `shared-python-onboarding (windows-latest)`
- `windows-onboarding`

Require the branch to be up to date and apply checks to administrators too. Bind
checks to the GitHub Actions app. Verify the live repository protection settings;
this document and workflow files alone do not configure enforcement. The
`mechanical-contract` assistant job has path-filtered triggers and is not a
universal required check: requiring it on unrelated PRs would leave them waiting
for a job that never runs. It remains active for its matching changes.

## Knip unused-code reporting

`npm run lint:unused` runs pinned **Knip 6.42.0** in default mode. Root `npm run lint`
and `lint:full` include it; CI runs `test:static-analysis:knip` first. Findings are
**informational** while triage remains open. No Knip finding category blocks CI yet,
and there is no warning baseline. Execution failures, missing dependencies,
invalid configuration/plugin loads, timeouts and missing/malformed JSON fail the
command. The runner uses `--no-exit-code`, which suppresses finding exits while
preserving Knip's execution-error status. Existing web/Python/CSS/architecture
regression gates remain blocking.

The scan uses `knip.jsonc` and automatic workspace plugins. Entry coverage is:

- Next routes/pages/layouts and framework configs in `apps/web`, plus Vitest web
  tests and their imports (the Next/Vitest plugins).
- Root package-script commands and supported tool configs (automatic discovery).
- Seven explicit root entries: Dependency Cruiser config, PM2 ecosystem config,
  assistant conversation probe, prompt-quality audit, style-matrix audit, browser
  preset-style proof and preset-loop proof. These are externally invoked configs
  or operator CLIs, not dead files.
- `scripts/**/*.test.mjs` explicitly retains Node test consumers. Helper modules
  remain ordinary project source, so an unreachable helper can still be reported.

Only reviewed non-source exceptions are configured. `dependency-cruiser` and
`jscpd` are invoked through literal `node_modules` binary paths in `full-scan.mjs`.
`pgrep`, `xdg-open` and `sqlite3` are OS commands, not missing npm packages.
The **web workspace only** ignores `server-only`: Next 16.3.3 aliases it to compiled
server/client markers, and the marker npm package is optional. Keep those boundary
imports. See [Next server-only documentation](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning).
No application files, export names, `playwright` references or native dependencies
are suppressed. Source/dependency cleanup requires a separate consumer review
and a fresh scan after changes.

Each run creates a fresh `media-studio-knip-*` directory under
`STATIC_ANALYSIS_OUTPUT` (or the OS temp directory). `execution.json` preserves the
exact command, exit status, signal/error and raw stdout/stderr; `knip.json` retains
raw structured findings; `metadata.json` records tool/runtime versions, mode,
policy and hashes of configuration, package manifests, lockfile and runner.
`summary.json` counts categories, or `failure.json` records an execution/format
failure. CI uploads these alongside existing analysis evidence even on failure.
No previous report can satisfy a failed run.

`npm run test:static-analysis:knip` uses disposable **source-only** fixtures with
real installed Knip. It verifies Next config/routes, operator CLIs, web/Node test
consumers, informational unused-file findings, config failures, missing Knip and
malformed output. It never imports application code, starts services or creates a
database. Production mode excludes tooling/test entries and is exploratory only;
it is not a deletion policy or enforcement gate. Knip does not analyze Python/CSS
or prove dynamic/runtime consumers. Review each candidate before changing code.

Knip's native OXC parser/resolver bindings must load after an install with lifecycle
scripts disabled. A shared Ubuntu/macOS/Windows tooling matrix runs the Knip fixtures and report,
then verifies Playwright exports and an in-memory Sharp PNG round trip after the
same install. Each OS retains its own Knip artifact. These jobs require no Python
setup, browser, application runtime or database. Preserve optional platform variants in the lockfile.

The Knip addition changes the existing lockfile-hashed analyzer contracts. Its
`jiti` and `tinyglobby` minimum versions also deduplicate existing lint/build/test
consumers. Review the package-lock delta and raw analyzer evidence before updating
contract metadata; keep unchanged finding records intact. Record session-specific
counts and reconciliation evidence outside tracked source. Future blocking
categories require explicit triage and reviewed entry coverage; do not baseline
every warning or hide execution errors.
