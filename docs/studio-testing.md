# Studio Testing

Use these commands when tightening the Studio client without changing public behavior.

## Fast Gates

- `./scripts/run-quality-gates`
- `npm run release:verify`

`release:verify` now runs:
- API tests
- web tests, lint, typecheck, production build
- the main browser smoke
- the preset/image-slot browser smoke
- the prompt-only enhancement browser smoke

## Browser Smokes

- `npm run smoke:studio-browser`
  - covers basic Studio load, model selection, generate path, lightbox, favorite toggle, filters, and duplicate-card checks
- `npm run smoke:studio-browser-preset`
  - covers Nano preset selection, preset image-slot upload, and queue-card creation
- `npm run smoke:studio-browser-enhance`
  - covers prompt-only enhancement for `nano-banana-2`, enhancement preview loading, and using the rewritten prompt back in the composer
  - `release:verify` forces the isolated temp API onto the built-in enhancement path so this smoke stays deterministic without mutating a real local database

Both scripts default to `http://127.0.0.1:3000` and write artifacts under `output/browser-smoke/`.

## Provider-Backed Smoke

- `npm run smoke:studio-live`

This is intentionally separate from `release:verify` because it uses live provider capacity and can take longer.

The live smoke covers:
- `Nano Banana 2` text-to-image
- `Nano Banana Pro` preset submit with an image slot
- `Kling 2.6 I2V` with `5s` and `sound: false`
- `Kling 3.0 I2V` with `5s` and `sound: false`

It defaults to `http://127.0.0.1:3000`, uses `docs/images/media-studio.jpg` as the preset image fixture, and writes a JSON report under `output/live-smoke/`.

## Notes

- The browser smokes are for wiring regressions, not provider completion latency.
- The live smoke is the release-confidence check when model submission, polling, and publish handoff need to be validated end to end.
