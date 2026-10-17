# Contributing

Thanks for improving Media Studio.

## Local Setup

Start with the README, then use the setup guide for your operating system:

- `docs/getting-started-mac.md`
- `docs/getting-started-windows.md`
- `docs/prerequisites.md`

## Development Rules

- Do not commit `.env`, local databases, generated media, uploads, downloads, or runtime logs.
- Do not commit internal review reports, security scan outputs, or private operator notes.
- Keep model behavior changes covered by tests when request shape, validation, pricing, or restore behavior changes.
- Keep docs public-facing unless they are intentionally part of the product documentation.

## Checks

Developers and coding agents must prepare the pinned analyzer environment using
[the static-analysis setup guide](scripts/static-analysis/README.md). Before
opening a pull request, run full static lint and relevant behavior checks:

```bash
npm run lint:full
npm --workspace apps/web run test
```

For backend/API changes, also run:

```bash
./scripts/run-quality-gates
```

Record exact commands, exit statuses and new findings in the PR. An LLM review or
an unrun check is not pass evidence. Ordinary lint must not update baselines; an
explicit refresh requires review of the identity/metric diff and raw reports.
Wait for full PR CI before merge. Required-check protection must be configured
separately; a workflow file alone does not enforce merging.

Normal web builds run web lint/types before Next. Full quality/release commands
run aggregate static lint before their existing tests. Confirm the repository's
data and fixture restrictions before running database-backed tests.
