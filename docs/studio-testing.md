# Studio Testing

Use these commands when tightening the Studio client without changing public behavior.

## Fast Gates

- `./scripts/run-quality-gates`
- `npm run release:verify`

`release:verify` now runs:
- API tests
- web tests, lint, typecheck, production build

## Committed Verification

Committed Studio confidence lives in deterministic checks:

- `npm --workspace apps/web run test`
  - helper and controller coverage for slot contracts, restore flows, staged attachments, admin persistence helpers, routing helpers, and UI primitives
- `npm --workspace apps/web run lint`
- `npm --workspace apps/web run typecheck`
- `npm --workspace apps/web run build`
- API pytest coverage via `./scripts/run-quality-gates`

## Local-Only Smoke Checklist

Browser and live smoke tooling is developer-owned and intentionally untracked. Keep any local helpers under `temp/local-smoke/` and keep artifacts under `output/browser-smoke/` or `output/live-smoke/`.

Use this manual checklist when you want extra local confidence beyond the committed gates:

- base Studio load, model selection, and duplicate-card sanity
- standard slot flows for non-Seedance, non-Nano models
  - `Kling 3.0 i2v` shows both `Start frame` and `End frame`
  - `Kling 3.0 Motion Control` shows one image slot and one video slot
- retry / `Create Revision` restore
  - prompt, model, and source/reference media restore correctly
- prompt enhancement with a staged image
- Nano preset image-slot flow
- optional provider-backed live submit when validating real model execution

## Notes

- The committed repo contract is deterministic and GitHub-safe.
- Local smoke is still useful during development, but it is not part of tracked repo automation.
