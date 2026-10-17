# JavaScript, TypeScript and Python development gates

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

`npm run lint` runs web then Python gates. `npm run lint:web` and the web workspace's
`npm run lint` run only the web gate; `npm run lint:python` runs only Python.
Use Node **22.22.0** to reproduce the dedicated CI job. The installed ESLint release
requires Node ^20.19.0, ^22.13.0 or >=24.0.0; older Node 20 installations must upgrade.
The static-only CI install uses `npm ci --ignore-scripts` and needs no provider checkout,
app server, database, credentials or paid generation.

These slices check JS/TS and Python. CSS, import architecture, duplication and
the build prerequisite are separate rollout tickets; `npm run lint` does not yet
claim coverage of them. Existing release/quality checks continue to exist.

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
- The unchanged `scripts/lint_web.mjs` custom web checks. Any nonzero exit fails.
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

`npm run test:static-analysis` runs pure Node tests and disposable source fixtures
against the actual installed analyzers. It checks identity matching, line shifts,
renames/new files, replacement findings, worsening metrics, compiler errors,
missing dependencies and invalid configurations. Fixtures import no app code.

`npm run test:static-analysis:python` runs standalone unittest fixtures against real
Ruff/Radon, covering correctness, independent complexity metrics, nested methods,
line shifts, renames/new files, replacement findings, tool/config failures and
malformed/incomplete reports. It does not load the application test harness.

`.github/workflows/static-analysis.yml` runs both fixture suites and the combined gate
on every PR and main push, retaining reports even on failure. Configure the
`javascript-typescript-python` job as a required branch-protection/ruleset check after its
first remote run. Committing a workflow alone does not enforce merges; remote CI
execution and branch protection must be verified separately. No hooks are installed.
