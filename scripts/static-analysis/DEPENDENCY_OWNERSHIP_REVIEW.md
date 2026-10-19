# Ticket 30 dependency ownership review (2026-10-19)

Knip 6.42.0's configured trial on `d35169c` reported one unused direct
dependency, two unlisted Playwright imports and four unlisted Next markers.
This change addresses dependency ownership without removing application code.

## Decisions

- Both browser scripts import `chromium` from the existing root
  `@playwright/test` development dependency. Its installed 1.59.1 public export
  is the identical object previously imported from transitive `playwright`.
  Browser launch, fallback and proof behavior stay unchanged.
- Keep all four `server-only` imports. Installed Next 16.3.3 resolves the marker
  to `next/dist/compiled/server-only/empty` on the server and its throwing
  `index` on the client. Both targets were resolved and their behavior checked.
  [Next documents that installation is optional and npm package contents are
  unused](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning).
  Knip adoption should recognize this marker only in the web workspace; the
  existing Dependency Cruiser web-only marker rule remains unchanged.
- Remove the web workspace's direct `@emnapi/runtime` declaration. Commit
  `c82102d` originally added it alongside Sharp 0.34.5. No application source
  imports it. Current Sharp 0.35.4's macOS, Linux and Windows native packages
  have no runtime dependency on it. FreeBSD and WebContainers WASM packages
  declare their own `@emnapi/runtime` dependency; Tailwind's optional WASM
  package declares and bundles it. Preserve those package-owned dependencies.
  [Sharp documents its native platforms and optional WASM support](https://sharp.pixelplumbing.com/install/).

`npm uninstall --workspace apps/web @emnapi/runtime --package-lock-only
--ignore-scripts` produces exactly two lockfile changes: remove the direct
workspace declaration and mark the retained runtime entry optional. All 547
package entries, versions, resolutions and integrity values remain unchanged.
Fresh installs use `npm ci --ignore-scripts`.

The trial's documented jscpd/Dependency Cruiser binary-path exceptions and OS
command dispositions remain unchanged. This ticket adds no Knip configuration.

## Contract reconciliation

The lockfile hash changes the web, CSS and full gate contracts. Analyzer versions,
configuration, thresholds and other contract hashes remain unchanged.

- Web: 723 actual findings before and after; identical complete findings arrays.
- CSS: 1,121 actual findings before and after; identical complete findings arrays.
  Preserve the existing 1,127 baseline entries, including six already stale
  entries, rather than mixing unrelated CSS cleanup into this ticket.
- Production clones: 283 before and after, with identical raw fragments,
  endpoint files/line ranges, token counts and line counts. Preserve 275
  fingerprints; replace eight fingerprints solely because the import statements
  change surrounding file context. Preserve existing order and unchanged entries.
- Python: its contract is unaffected. Informational test clones remain 559.

The eight context-only pairs are:

| Endpoints (under `scripts/`) | Tokens | Lines |
| --- | ---: | ---: |
| assistant_conversation_probe 289–299 / prove_media_preset_style_browser 53–63 | 51 | 11 |
| assistant_conversation_probe 628–640 / smoke_studio_playwright 221–233 | 78 | 13 |
| audit_media_assistant_prompt_quality 123–133 / prove_media_preset_style_browser 54–64 | 54 | 11 |
| prove_media_preset_style_browser 222–230 / 210–218 | 64 | 9 |
| assistant_conversation_probe 609–614 / smoke_studio_playwright 200–205 | 51 | 6 |
| audit_media_assistant_prompt_quality 20–27 / prove_media_preset_style_browser 37–44 | 108 | 8 |
| prove_media_preset_style_browser 476–482 / 403–409 | 55 | 7 |
| assistant_conversation_probe 112–133 / smoke_studio_playwright 28–49 | 135 | 22 |

No new analyzer finding or production clone debt is accepted. Raw before/after
reports and structural lock/baseline comparisons are retained outside source.

## Verification scope

Configured Knip after this change reports zero unused dependencies and only the
four reviewed `server-only` unlisted references. Its unrelated six files, 134
exports, 83 types and one duplicate-export group remain for their owning tickets;
the whole Knip scan therefore still exits 1.

The existing focused mapper/Studio/recipe/thumbnail tests pass (15 before, 17
after including two dependency checks). The new web dependency test imports the
declared Playwright API and performs an in-memory Sharp PNG round trip. CI runs
it after a fresh install on Ubuntu, macOS and Windows. It starts no browser,
application, database or provider operation. Existing application/fixture coverage
is retained; restricted local Python application tests and runtime smoke scripts
are not invoked.
