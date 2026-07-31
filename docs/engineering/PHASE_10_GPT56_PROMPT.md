# Phase 10 GPT-5.6 Engineering Prompt

Execution status: complete on 2026-07-11. This prompt is retained as the Phase 10 implementation and review contract.

Use this prompt to resume or review Phase 10 with GPT-5.6 while preserving the campaign's engineering and paid-run boundaries.

## Purpose

Complete the no-paid storyboard-fidelity remediation needed before another Board 1 proof. Preserve the user's current Character sheet, the successful frozen Environment, the 17-node/30-edge `Sadis Adventures` graph, and all unrelated dirty-worktree changes.

## ENGINEERING SYSTEM (REQUIRED)

- Repository: `/Users/evilone/Documents/Development/Video-Image-APIs/media-studio`
- Target workflow: `graphwf_4fd06f50c493` / `Sadis Adventures` only.
- Runtime surface: Media Studio Graph Studio at `http://127.0.0.1:3000/graph-studio`.
- Character: retain canonical browser-attached asset `asset_901adc9b21d1`; do not open Replace, generate a new sheet, or change the selected asset.
- Environment: retain frozen `asset_123e29b65e70` and its current cached execution path.
- Board 1: retain frozen Phase 9 output `asset_d9d0ccdff7fd` as evidence only; it is not an accepted continuation anchor.
- Boards 2/3: keep GPT and Save nodes muted.
- Seedance/video: absent or muted; never submit.
- Paid boundary: Phase 10 is no-paid. Do not enable or submit any image/video provider node.
- Public contracts: no route, schema, migration, dependency, lockfile, pricing, provider-spec, or new recipe-port change.
- Dirty worktree: preserve unrelated modified and untracked files; never reset, clean, overwrite, or revert them.

## STORYBOARD DESIGN SYSTEM (REQUIRED)

- One 16:9 storyboard sheet per scene.
- Exactly six panels in a fixed 3x2 grid.
- One unchanged dark near-black production-board layout with thin yellow-orange accents.
- Identical panel geometry, gutters, borders, metadata-strip proportions, typography hierarchy, footer structure, palette, and production-board treatment across Boards 1-3.
- Every panel preserves this exact metadata order: `SHOT`, `CAMERA`, `FRAMING`, `ACTION`, `MOTION`, `DIALOG`, `NOTES`.
- Metadata values must be concise, meaningful, spell-checked, and shortened only at whole-word or punctuation boundaries.

## STORY AND HANDOFF CONTRACT

1. Board 1 — loading and exterior inspection. End at the closed amber-lit service panel with the pilot's hand near the latch. The panel remains closed. No capacitor, internal component, replacement, repair, boarding, cockpit, engine start, or launch state may appear.
2. Board 2 — continue from the exact closed-panel handoff. Open the panel, trace the fault, discover and replace the burnt-out capacitor, restore steady green, close the panel, and end facing the open ramp.
3. Board 3 — continue from Board 2's closed-green-panel/ramp handoff. Board through the established route, reveal Bolts already secured, strap in, perform preflight, lift, and exit through the same hangar doors.

## REFERENCE CONTRACT

- Board 1: `@image1` Character identity/cyborg construction, `@image2` Environment.
- Board 2: the same `@image1` and `@image2`, plus Board 1 as `@image3` for immediate prior ending state and board-system continuity.
- Board 3: the same `@image1` and `@image2`, plus Board 2 as `@image3`.
- The retained full Character sheet is canonical, but provider-facing prompt text must treat it as identity and cyborg-morphology evidence only. Wardrobe is controlled by a positive text lock: one high-collar, long-sleeve, full-torso cream-and-red flight-mechanic coverall continuing through waist and boots, unchanged across panels.
- Do not create a cropped/derived Character reference or alter provider image inputs during Phase 10.

## TASKS

1. TEST-1001 — add exact Phase 9 regression coverage for whole-word metadata values, Board 1 negative/future-state exclusion, closed-panel/amber/latch handoff retention, and retained-sheet identity/wardrobe separation.
2. BUG-1002 — make bounded metadata compaction shorten at punctuation or whitespace boundaries; never split a word.
3. BUG-1003 — remove negated/future Board 1 concepts before state-term extraction and preserve the exact positive closed-panel handoff.
4. BUG-1004 — strengthen positive identity-only/wardrobe ownership in the compact provider prompt without changing the Character asset or adding negative sensitive vocabulary.
5. VERIFY-1005 — run focused and full Graph Studio API tests, duplication/reference searches, compilation, patch hygiene, saved-workflow validation, server health checks, and an in-app browser no-paid audit.

## REQUIRED RED-TO-GREEN TESTS

- Reproduce Phase 9 fragments such as `ship dominat.`, `pilot lower t.`, `couplings fo.`, and `amber indica.` before the fix; assert they cannot appear after the fix.
- Assert every non-empty metadata value ends on a complete token and every board retains six copies of all seven labels.
- Assert the Board 1 compact prompt contains `closed service panel`, an amber diagnostic state, and hand-near-latch intent.
- Assert Board 1 contains no positive state for `capacitor`, `replacement`, `open service panel`, internal components, repair, boarding, cockpit, engine start, or launch.
- Assert Board 2 still preserves burnt-out capacitor, replacement, steady-green, closed-panel, and ramp handoff terms.
- Assert Board 3 still preserves ramp/corridor/cockpit, Bolts, harness, preflight, lift, hangar-door exit, and the exact requested dialogue.
- Assert the compact prompt positively assigns wardrobe ownership to the prompt and identity/cyborg ownership to `@image1`, without naming the unwanted sensitive vocabulary prohibited by SPEC-017.
- Assert all submitted prompt replays remain at or below 4,200 characters and below the 20,000-character provider hard limit.

## VERIFICATION AND STOP RULES

- Use the shared KIE Python runtime for pytest.
- Run the narrowest red test first, then focused prompt-shaping tests, then the full `apps/api/tests/test_graph_studio.py` target.
- Run Python compilation and `git diff --check`.
- Inspect the exact live Phase 9 raw prompt through current shaping after implementation.
- In the in-app browser, confirm 17 nodes/30 edges; Character unchanged; Environment and Board 1 frozen; Boards 2/3 muted; graph estimate approximately 0 credits/$0; prior previews retained; no provider job count increase.
- Stop if a public interface, schema, dependency, provider specification, Character replacement, derived reference, or paid submission becomes necessary.
- Do not mark Phase 10 complete on tests alone; document browser evidence and remaining visual uncertainty.

## OUTPUT

Report each task with status, files changed, exact tests, duplication check, browser proof, paid side effects, and residual risk. The expected Phase 10 outcome is a no-paid, test-backed provider prompt contract ready for a separately authorized sequential Phase 11 proof.

Design context note: this repository has no `DESIGN.md`; the authoritative storyboard visual system is SPEC-012 plus this Phase 10 prompt.
