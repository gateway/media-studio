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

Before opening a pull request, run the relevant checks:

```bash
npm --workspace apps/web run typecheck
npm --workspace apps/web run lint
npm --workspace apps/web run test
```

For backend/API changes, also run:

```bash
./scripts/run-quality-gates
```
