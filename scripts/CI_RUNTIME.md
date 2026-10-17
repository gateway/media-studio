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
