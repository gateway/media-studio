# Quality CI timing

`tests.yml` enables `MEDIA_STUDIO_CI_PROFILE_DIR` in its disposable quality job.
The existing full suite still runs serially with the same fixtures and assertions.
The optional recorder writes `backend.json`, and pytest writes `backend-junit.xml`;
the workflow retains both as `quality-runtime-profile` even when tests fail.
Without that environment variable the quality script uses its original pytest command.

JSON records every collected test identity, setup/call/teardown outcome and duration,
and each executed fixture setup's name, scope, requesting node and duration. Fixture
setup durations are nested within test setup phases: do not add them to phase totals.
Cached fixture reuse does not execute setup again and therefore has no extra entry.
Initial conftest loading (including collection schema bootstrap) and collection have
separate wall timers. The overall wall timer also includes pytest initialization and
shutdown. Collection failure can produce no test phases; `exit_code` remains nonzero.
Runner image, architecture, Python/pytest versions and commit/run metadata accompany
the report. Bash `time` reports real/user/sys for the larger quality gates in logs.

The first three `app_modules` setups also have standard-library cProfile samples
(`app-modules-*.pstats`, with exact test IDs in JSON). These isolate import versus
schema bootstrap/seed costs without changing the fixture. Only those three setups
include cProfile overhead; do not extrapolate their timings to the entire suite.
Inspect with `python -m pstats <file>` or the standard-library pstats API. Function
cumulative times overlap; compare self time or specific call paths rather than
adding nested cumulative times. These files are diagnostic CI artifacts only.

Compare exact test identities/outcomes and runner image/runtime metadata before
comparing timings. Retain multiple equivalent samples: previous unchanged backend
runs ranged from 489.63 to 846.25 seconds. One fast run is not proof of a speedup.
Do not broaden mutable fixture scope, parallelize tests, or delete compatibility,
migration, auth or removed-endpoint regression tests based on their names or age.

Pure recorder hook tests can run with `python scripts/test_ci_pytest_profile.py` in
an owned environment containing the API's existing pytest dev dependency. They use
unittest with synthetic reports and mocked pytest.main; they never collect tests.
`test_ci_pytest_profile_integration.py` runs real pytest on synthetic temporary files
in CI only. Local pytest collection, including the application suite, remains subject
to the explicit fixture authorization described in `FOCUSED_TESTS.md`.

## Redundant gate removal

Quality runs full static lint before application tests and uses the normal web
build, whose prerequisite is the same workspace lint command. The standalone
web lint formerly between web tests and typecheck repeated that command on the
same source/configuration. Removing that invocation preserves both enforcement
points, the separate typecheck, all tests and the normal build prerequisite.
Web test source inspection found no file-writing operations; typecheck's generated
cache is excluded from lint. CI results must still verify the complete sequence.

The workflow and quality script both install the editable API dev dependency.
This duplication is recorded, but retained in this slice: the workflow needs
pytest for recorder integration checks before quality, and the standalone quality
entrypoint must continue preparing its existing API environment. Avoid introducing
a setup-bypass flag solely to save an unmeasured dependency resolution step.

Use the capped profiles to split fresh-schema migration/seed time from
application import time within `app_modules`, then inspect the second bootstrap
in TestClient startup. Initial conftest collection also bootstraps its own schema.
No fixture lifetime or schema behavior is changed here: those paths protect
migration and application startup contracts and require isolation evidence first.

## Standalone unit bytecode policy

Thirteen standalone unittest modules previously disabled bytecode writes during
collection for the entire test process. Each now starts a `sys.dont_write_bytecode`
patch at the beginning of `setUp` and registers its restoration before application
imports or other cleanups. Unittest runs cleanup after setup/test/teardown failures;
LIFO ordering keeps writes disabled through the case's remaining cleanup. The
patch restores the incoming value, including an existing no-write policy. No
application imports occur at module scope in these thirteen modules.

`python -B scripts/test_ci_bytecode_policy.py` is a pure standalone regression
check: it loads those module definitions without pytest, stops setup at the first
application import, and probes both incoming values through success and setup,
test, teardown and cleanup errors. Full application tests still belong in the
disposable CI workspace. The case-scoped patch deliberately repeats the standard
unittest idiom so standalone files need no shared import helper or fixture.

This contains process state; runtime benefit requires comparable repeated CI
profiles. Capped compilation samples alone do not establish a suite speedup.
