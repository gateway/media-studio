# Gradual Prettier rollout

Prettier 3.9.10 handles formatting. ESLint and the existing analysis gates handle
correctness and maintainability. No import sorting, plugins, hooks or formatting
baseline are installed. Defaults match the web code's double quotes, semicolons
and two-space indentation; the config explicitly uses LF line endings.

From the repository root, after installing the locked development dependencies:

```sh
npm run format:check
npm run format
npm run lint
```

`format:check` is read-only and fails on formatting differences or tool errors.
`format` writes only the same explicit initial file list:

- `.prettierrc.json`
- `package.json`
- `apps/web/package.json`
- `apps/web/lib/dependency-ownership.test.ts`
- `scripts/static-analysis/FORMATTING.md`

Root `lint` starts with `format:check`, so `lint:full` and the existing required
static-analysis CI check enforce this scope on every PR and main push. Web-only
lint still checks web correctness; it does not run this formatting rollout.

All other legacy files are outside the automatic formatting check. For new files
or a deliberately small cleanup, add their explicit paths to both format scripts,
review the formatting diff, and run full lint. Do not use a repository-wide write
or reformat large legacy files incidentally. Existing formatting debt stays backlog.

`.prettierignore` protects dependencies, build output, runtime data/media,
environment files, private docs/evidence, lockfiles and analysis baselines. It is
a safety exclusion list, not the rollout scope; the two package scripts own that
scope. Editors should use the locally pinned Prettier and avoid repository-wide
format-on-save during this rollout.

See the official [installation guide](https://prettier.io/docs/install) and
[ignore rules](https://prettier.io/docs/ignore).
