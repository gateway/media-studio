# Storyboard Multi-Board Continuity Tasks

## Media Assistant reference-storyboard fix (completed 2026-07-23)

- [x] Phases 0–5 are complete in [Media Assistant Reference-Storyboard Graph Fix Tasks](MEDIA_ASSISTANT_STORYBOARD_FIX_TASKS.md).
- [x] Exact Earth Games flow verified in disposable session `asst_889e59f57505`: eight chat shots, eight compiled panels, applied/persisted local graph, no run/save/spend.
- [x] Accepted unrelated release-gate deviation: `apps/api/tests/test_graph_studio.py` is 7,001 lines against the 7,000-line cap; no out-of-scope file split was performed.

Last updated: 2026-07-19
Source spec: [SPEC.md](SPEC.md)
Plan: [PLAN.md](PLAN.md)

## Instructions

- Always load and follow `engineering-guardrails` before code or workflow changes.
- Always use `browser:control-in-app-browser` for Graph Studio UI verification.
- Execute one unchecked task at a time. Read its linked spec and plan sections first.
- Preserve unrelated behavior and the broad dirty worktree. Never revert changes outside the selected task.
- Mark a task complete only after its listed verification passes and `VERIFICATION_LOG.md` is updated.
- Do not run paid providers from Phases 0-4. Obtain explicit action-time approval for PAID-501.

## Phase 33 - Revised Two-Capacitor And Bolts Trilogy

- [x] PREFLIGHT-3301 - Update the active continuation briefs so exactly two engine capacitors fail and are replaced, Bolts walks beside the pilot through the ramp into the cockpit, Bolts sits and speaks from the adjacent chair, every board has assigned dialogue, and Board 3 enforces one ship. Zero-credit run `grun_02e170898650` compiled all three six-panel boards under the deterministic limit with exact dialogue and no media job.
- [x] PAID-3302 - Execute the user's one authorized full paid trilogy once. `grun_95ca568765eb` completed exactly three provider jobs with no retry for 30 credits / $0.15.
- [x] VERIFY-3303 - Verify normalized Character/Environment/previous-board reference order, inspect all three raw grids and saved 2048x1152 sheets at original resolution, confirm all three Save nodes created Sadi assets, persist the revised active source fields, and freeze the three recipes plus all nine paid/output nodes at approximately zero estimated cost.

Guardrails: preserve the selected Character and Environment, 23-node/37-edge topology, provider/model/pricing settings, and unrelated workflow tabs. PAID-3302 is consumed; no retry or additional provider run is authorized.

## Phase 23 - Post-BUG-2205 Paid Acceptance Verification

- [x] PAID-2301 - Execute the user's one newly authorized paid trilogy in the in-app Browser. Terminal partial run `grun_4adbeed15f4d`: Board 1 `job_d3bb5b05a5f3` / `asset_c97abb7d31e7` and Board 2 `job_f4545c9c3535` / `asset_de8b86098d98` completed at 2048x1152; Board 3 `job_8f06af34e56e` failed with a transient provider internal error and produced no asset. Balance 429.6 -> 409.6: exactly 20 credits / $0.10, with no retry.
- [x] VERIFY-2302 - Inspect both originals, provider-bound prompts, graph/runtime state, accounting, and Browser closure. Board 1-2 layout, Environment, character identity, closed-panel handoff, repair progression, and cinematic treatment pass. Final trilogy signoff fails because Board 3 is absent, the retained Character reference still exposes the waist, and Board 2 renders incomplete metadata clauses that the current semantic preflight incorrectly accepts.
- [x] BUG-2303 - Completed through Phase 24 BUG-2402/2406: the generic semantic-completeness guard and tight-budget repair reject/repair incomplete possessive, copular/predicate, demonstrative/time, participial, preposition-tail, and multi-clause fragments without campaign hardcoding.

Guardrails: preserve the Character reference selected by the user, the successful Environment, graph topology, recipe ownership, and all unrelated dirty-worktree changes. Do not hardcode this campaign's names, subjects, location, props, dialogue, or beats. PAID-2301 consumed the one-run authorization; no retry is authorized.

## Phase 24 - Shared Recipe Parity And Final Trilogy Acceptance

- [x] CONTRACT-2401 - Specify one immutable footer-free Storyboard v2 sheet contract shared by the first-board and continuation recipes; align their output contract and generation defaults while preserving continuation-only handoff/reference behavior. Contract: [SPEC-029](SPEC.md#spec-029---shared-storyboard-sheet-recipe-parity-and-final-paid-proof).
- [x] BUG-2402 - Finished the story-agnostic prompt compactor/preflight repair for the Phase 23 fragments, preserved complete user-owned panel clauses under budget, and proved all three raw outputs locally.
- [x] VERIFY-2403 - Passed recipe/schema/prompt/preflight/trilogy gates, synchronized Storyboard v2 `2.20` and Continuation `1.15` through schema 48, and completed zero-credit Browser run `grun_843556634ffb` at 17/17 with no new media jobs.
- [x] PAID-2404 - Executed exactly one authorized paid trilogy, `grun_466f601a6e3d`, with Environment reused/frozen. Three 2048x1152 boards completed for exactly 30 credits / $0.15; no duplicate retry occurred.
- [x] VERIFY-2405 - Inspected all three originals and prompts, recorded deterministic/visual manifest `grun_466f601a6e3d.json`, refroze the six paid nodes, and verified queue zero/estimate zero. Deterministic gate passes; strict visual signoff is withheld on V007 Board 1-to-2 handoff drift.
- [x] BUG-2406 - Post-run no-paid hardening preserves spatial objects after `before`, retains complete clauses ending in object pronouns, prioritizes the primary action before concurrent `while` activity, rejects incomplete subclauses and terminal predicate/preposition tails, and reserves a complete semantic budget for ACTION/MOTION/NOTES. Final Browser proof `grun_1b3b3ad70980` is zero-cost and fragment-free; 245 affected tests, genericity, and diff checks pass.
- [x] PAID-2407 - Executed exactly one newly authorized Browser Run as `grun_531ac2847b59`. All 17 nodes and three 2048x1152 boards completed; balance 379.6 -> 349.6, exactly 30 credits / $0.15; no retry or duplicate submission. Both cross-board visual handoffs now pass. Strict acceptance remains withheld because several submitted metadata values are incomplete and most Board 2-3 CAMERA values lack the required angle/movement/lens detail; the retained Character reference also continues exposed-waist styling.
- [x] BUG-2408 - Strengthened the shared campaign-agnostic provider-bound preflight/repair so every CAMERA row contains angle, movement, and lens direction and tight-budget ACTION/MOTION/NOTES fitting cannot emit the five PAID-2407 fragment families. Exact red-to-green regressions prove the preflight fails before submission; shared code contains no campaign story terms.
- [x] VERIFY-2409 - Passed 60 focused, 258 affected, and 823 full-backend tests plus genericity, compilation, duplication-ownership, and diff checks. Zero-credit Browser run `grun_814d284c8c6f` completed 17/17 at unchanged 349.6 credits and 701 media jobs; exact replay shapes to 4,110 / 4,179 / 4,187 characters with zero semantic fragments and zero CAMERA gaps. All eight media/save nodes remain Frozen/Cached. A later paid visual proof requires separate action-time authorization.
- [x] PAID-2410 - Executed the user's separately authorized in-app Browser trilogy once as `grun_dcdcf40aa2b2`. All 17 nodes and three 2048x1152 boards completed; balance 349.6 -> 319.6, exactly 30 credits / $0.15; media jobs 701 -> 704 with no retry or duplicate submission. The six Storyboard nodes were refrozen and the workflow saved at approximately 0 credits / $0.
- [x] VERIFY-2411 - Inspected all three originals and exact provider prompts. Cinematic quality, Environment/character continuity, story progression, dialogue, handoffs, and departure pass. Strict signoff fails V001 because Board 3 adds duplicate panel-title strips and incomplete metadata remains, and V008 because compact shaping drops Bolts' mechanical-foreleg/cyan-light traits and the result is an ordinary cat. Manifest: `data/quality-manifests/grun_dcdcf40aa2b2.json`.
- [x] BUG-2412 - No-paid only: meaningful SHOT validation, semantic-fragment repair, user-owned subject-trait preservation, and the single-title-region lock are implemented. Exact PAID-2410 replay passes at 4,168 / 4,189 / 4,193 characters; full/genericity/browser gates pass with no provider action.

Guardrails: keep the user's existing Character sheet and successful Environment unchanged; preserve topology, reference order, provider/model/pricing settings, and unrelated dirty changes. Shared code remains campaign-agnostic. PAID-2410 consumed the latest one-run authorization; no further paid run is authorized.

## Phase 22 - Final Paid Acceptance Proof

- [x] PAID-2201 - Execute the user-authorized final paid trilogy in the in-app Browser. Board 1 completed as `job_89bb63c6bbc7` / `asset_49f3103fd168`; Board 2 stopped before submission on `Panel 04 NOTES is empty`, so only 10 credits were spent in `grun_83c378c36f03`.
- [x] BUG-2202 - Fix the reproduced generic compaction defect without story hardcoding: reserve readable ACTION/MOTION/NOTES floors before distributing preferred row budgets, while preserving exact dialogue and the fail-closed provider boundary.
- [x] PAID-2203 - Resume only Boards 2-3 after the fix. `grun_cdaa9401bbbe` completed Board 2 `job_225ce43e1dff` / `asset_d82c55094f72` and Board 3 `job_fc801cfa9df1` / `asset_139ca5940aa0` for the remaining 20 credits. Phase total: exactly 30 credits / $0.15; balance 459.6 -> 429.6.
- [x] VERIFY-2204 - Inspect all three original 2048x1152 outputs and verify browser/runtime state. Layout, cinematic treatment, Environment, character, feline Bolts, causal flow, and both cross-board handoffs pass. Final visual signoff is withheld on semantic metadata fragments and the early-open Board 1 compartment. Focused tests 18/18, full backend 780/780, genericity, exact replay, diff integrity, API/runner health, and frozen zero-cost Browser closure pass.
- [x] BUG-2205 - Preserve concise but semantically complete metadata clauses under tight budgets and strengthen the user-owned Board 1 closed-panel state through its final frame. Contract: [SPEC-028](SPEC.md#spec-028---semantic-metadata-clauses-and-closed-state-handoff). Plan: [Phase 22](PLAN.md#phase-22---semantic-metadata-and-board-1-state-remediation). Generic regressions, exact no-paid replay, 789 backend tests, genericity/diff checks, saved-workflow inspection, and frozen zero-cost Browser verification pass. No provider run or credit spend occurred; the existing paid images remain unchanged evidence.

Guardrails: keep all campaign story content in workflow/recipe inputs; do not add character, ship, location, prop, or beat literals to shared code. Preserve the three Phase 22 artifacts as evidence. No additional paid run is authorized.

## Phase 21 - Fail-Closed Storyboard Metadata Preflight

- [x] CONTRACT-2101 - Require every provider-bound storyboard cell to contain exactly one non-empty `SHOT`, `CAMERA`, `ACTION`, `MOTION`, and `NOTES` value; allow only `DIALOG` to be blank; reject placeholders without adding story-specific content.
- [x] BUILD-2102 - Added the generic final-prompt validator immediately after prompt shaping and before KIE validation/submission; shared storyboard recipes now request meaningful non-empty NOTES derived from user/recipe state. Storyboard v2 `2.19`, Continuation `1.14`, schema 47.
- [x] VERIFY-2103 - Automated gates pass: 32 focused recipe/shaping/migration tests, 12 preflight tests, 777 backend tests, 758 web tests, lint, typecheck, production build, Studio browser smoke, clean schema 47, genericity/file-size/style/hygiene, and diff formatting. Live API/web/runner are healthy, queue 0/0, and media jobs remain 689. Final in-app Browser inspection confirms Sadis Adventures at 459.6 credits, approximately 0 credits / $0, eight Frozen Environment/Storyboard GPT+Save nodes, two Muted prompt-only Environment nodes, and no console warnings/errors. The local tabs display unsaved-change badges, but this verification made no workflow edit, save, Run click, or provider request.

Guardrails: preserve the frozen Phase 20 trilogy, selected workflow, Character, Environment, references, graph topology, pricing, provider settings, and all unrelated dirty-worktree changes. A validation failure must stop before provider submission and identify the panel and row. No paid run is authorized by this phase.

## Phase 20 - Prompt Efficiency And Subject Fidelity

- [x] AUDIT-2001 - Compare all three raw recipe outputs, stored provider prompts, current-code replay, displayed Graph Studio caches, and original paid images. Classify cat loss, blank CAMERA rows, dialogue behavior, and stale-cache effects without changing the workflow or spending credits.
- [x] CONTRACT-2002 - Changed Storyboard v2 and Continuation to the shared six-row contract, with legacy FRAMING merged into CAMERA in canonical camera-then-placement order. Storyboard v2 `2.18`, Continuation `1.13`, schema 46.
- [x] BUILD-2003 - Completed BUG-1910 at the shared prompt boundary: complete row-local clauses, blank NOTES values, protected dialogue, non-empty CAMERA, adjacent ACTION/MOTION reuse, and no campaign story hardcoding.
- [x] VERIFY-2004 - Focused regression/migration gates pass; corrected no-paid browser run `grun_41a60964d9b6` completed 17/17 at $0 with no new media jobs; all three provider-bound replays contain six panels and six exact labels with no FRAMING or dangling clauses.
- [x] PAID-2005 - Authorized run `grun_97a000ce7558` completed through submitted-job recovery without a duplicate request: assets `asset_d539ca196281`, `asset_b593a92980ab`, and `asset_1fba3d65bc29`; 30 credits / $0.15; deterministic and visual gates pass.
- [x] BUG-2006 - Poll-failed Graph runs can reconcile an already submitted completed KIE job, and only `upstream_failed` skipped descendants resume. Muted skips remain skipped; recovery never resubmits the recovered model job.
- [x] VERIFY-2007 - Focused recovery/trilogy target passes, full release verification passes, the saved workflow freezes all six Board GPT/Save outputs to PAID-2005, Browser inspection confirms the completed run and 459.6 balance, and the queue is empty.

## Phase 19 - Stacked Metadata Rows Paid Proof

- [x] CONTRACT-1901 - Update every visual storyboard-sheet recipe/compiler owner so per-panel metadata renders as full-width horizontal rows rather than columns; preserve story-agnostic recipe contracts.
- [x] VERIFY-1902 - Pass focused recipe/graph/assistant tests, full release verification, update the four live built-in recipes, and complete browser zero-credit preflight `grun_70c7349b9dc9` with zero media jobs.
- [x] PAID-1903 - Execute one authorized three-board proof. Terminal result: Boards 1-2 completed for 20 credits total; Board 3 was provider-policy rejected at zero credits; no retry.
- [x] BUG-1904 - Make the compact storyboard contract reject blank/missing cells and clipped metadata labels/values without reintroducing columns; use a story-agnostic positive-only Board 3 formulation.
- [x] VERIFY-1905 - Pass the focused/full gates, synchronize Storyboard v2 `2.16` and Continuation `1.11`, and complete zero-credit preflight `grun_ffe145cdfe5d` with 17/17 nodes and no media jobs.
- [x] PAID-1906 - Execute the authorized post-BUG-1904 trilogy. Terminal result: `grun_eb3d5d6c9e09` completed three boards for 30 credits / $0.15; matching layout and cinematic/environment treatment improved, but Board 3 structural prompt loss and remaining visual defects prevent acceptance.
- [x] BUG-1907 - Fix uppercase `PANEL NN IMAGE:` storyboard recognition, stop treating the generic word `sheet` as a private name, and preserve all six seven-row cells plus dialogue, wardrobe, and subject cues through semantic compaction without campaign hardcoding.
- [x] VERIFY-1908 - Pass 759 backend and 758 web tests plus every release gate; freeze PAID-1906's exact six artifacts; complete zero-cost in-app Browser proof `grun_5de1d1649627` at 17/17 with $0 graph cost and no new local media job.
- [x] PAID-1909 - Execute the authorized post-BUG-1907 trilogy. Terminal partial result: Board 1 completed for 10 credits and passes major cinematic/layout/Environment gates but exposes fragmented metadata values; Board 2 failed with a zero-additional-credit provider internal error; Board 3 dependency-skipped; no retry.
- [x] BUG-1910 - Preserve complete metadata clauses in their originating rows; keep blank NOTES values instead of redistributing clipped sentence tails. Completed through BUILD-2003.
- [x] VERIFY-1911 - Completed through Phase 20 VERIFY-2004/2007: focused compaction regressions, exact replay, full release gate, Browser proof, and frozen paid outputs pass.
- [x] PAID-1912 - Superseded by the separately authorized PAID-2005 Phase 20 trilogy and its successful deterministic/full-resolution visual sign-off.

## Phase 18 - Generic Recipe And User-Owned Visual Remediation

- [x] AUDIT-1801 - Audit reusable storyboard recipe, compiler, assistant, and quality owners for campaign-specific names, subjects, locations, props, dialogue, and actions.
- [x] CONTRACT-1802 - Add user-owned `board_title` and `production_metadata` fields; retain user-owned handoff, dialogue, wardrobe, and subject-design fields; bump Storyboard v2 to `2.14` and Continuation to `1.9`.
- [x] CLEANUP-1803 - Remove campaign lexicons and special-name rewriting from shared prompt shaping and Media Assistant paths; make visual story requirements data-driven through `TrilogyQualityContract`.
- [x] GUARD-1804 - Add `check_storyboard_recipe_genericity.py` to the mandatory quality gates so reusable source owners fail if campaign content is reintroduced.
- [x] GRAPH-1805 - Back up the database and update only the three saved storyboard recipe nodes with user-authored titles, metadata, handoff, dialogue, wardrobe, and subject-design values; preserve Character/Environment references and all 30 edges.
- [x] VERIFY-1806 - Pass focused tests, full Graph Studio tests, full release verification, schema migration 44, zero-cost graph validation, and in-app Browser field hydration after reopening the saved workflow.
- [x] PAID-1807 - Run and visually inspect one complete Board 1-3 proof. Terminal result: three boards completed for 30 credits, but feline Bolts, covered waist, exact production metadata, and the Board 2-to-3 adjacent-state gate failed.
- [x] BUG-1808 - Preserve all user-owned board title, production metadata, handoff, dialogue, wardrobe, and subject-design directives through recipe sanitization and final GPT Image 2 compaction.
- [x] VERIFY-1809 - Refreeze PAID-1807's exact six GPT/Save artifacts, run a zero-cost cached proof, verify all three new 2048x1152 paths in a fresh in-app Browser tab, and pass the full release gate.
- [x] PAID-1810 - Run one authorized post-BUG-1808 trilogy and visually re-evaluate the failed gates. Terminal result: Bolts, exact metadata, environment continuity, and the shared sheet family improved; exposed waist, the early-open Board 1 service bay, Board 2 label typos, and missing visible lift-off prevent full visual acceptance.
- [x] BUG-1811 - Stop stale errored provider catalogs from recursively force-refreshing Graph Studio and blocking the Run action; add a regression and verify web typecheck.
- [x] BUG-1812 - Treat transient Codex App Server reconnect notifications as non-terminal when the turn later completes successfully, while preserving real terminal failures; pass the full image-capable provider probe.
- [x] VERIFY-1813 - Freeze the exact PAID-1810 artifacts, reopen the saved workflow in the in-app Browser, and complete zero-credit cached proof `grun_5f1f3974594e` with no new media job or credit change.

## Phase 17 - Uber Review Remediation

- [x] REVIEW-1701 - Run the two-pass Uber Code Review and write `docs/reviews/20260712-042852-media-studio-uber-review.md`.
- [x] BUG-1702 - Fix typed Media Assistant intent arbitration and explicit multi-recipe targeting.
- [x] MIGRATION-1703 - Add and verify migration 43 for Storyboard 2.13 and Continuation 1.8.
- [x] CLEANUP-1704 - Consolidate Python Prompt Recipe contracts and storyboard cue fields; remove the unreachable prompt-shaping helper.
- [x] VERIFY-1705 - Pass 367 focused backend tests, 750 full API tests, the complete 132-file web suite, lint, typecheck, build, clean migration, Studio smoke, live health, and in-app Browser reload.
- [ ] CLEANUP-1706 - Split `test_graph_studio.py` by subsystem and extract remaining Graph Studio coordinator responsibilities, then lower the reviewed 7,000/2,350 line caps. Backlog only; no behavior change is required for Phase 17 sign-off.

## Phase 0 - Safety Harness And Baseline

### TEST-001 - Capture a durable baseline

- [x] TEST-001 - Capture a durable baseline
- Status: Completed 2026-07-10
- Spec pointer: [Evidence and references](SPEC.md#evidence-and-references), [SPEC-001](SPEC.md#spec-001---canonical-dependency-chain)
- Plan pointer: [Phase 0](PLAN.md#phase-0---safety-harness-and-baseline)
- Files allowed: `docs/engineering/*`, read-only SQLite queries, test fixtures only if needed to serialize baseline data.
- Files forbidden: application source, migrations, lockfiles, KIE specs, production config.
- Problem: current truth is split across chat history, a dirty worktree, SQLite, temporary JSON, and paid artifacts.
- Why it matters: later fixes cannot be evaluated reliably without exact wiring, prompt, run, and output baselines.
- Risk/confidence: P3 / High.
- Expected behavior change: None.
- Tests needed before change: None; read-only capture.
- Implementation boundaries: record workflow `graphwf_4fd06f50c493`, run `grun_a97f4b9ac07d`, ordered edges, prompt lengths, shaping strategies, and asset paths without exposing secrets.
- Verification: compare captured counts to SQLite; `git diff --check`.
- Rollback: remove only the newly captured documentation/fixture.
- Definition of done: baseline is reproducible and linked from spec, tasks, and verification log.
- Batch eligible: Yes.
- Campaign eligible: Yes.

### TEST-002 - Add contract-first regression tests

- [x] TEST-002 - Add contract-first regression tests
- Status: Completed 2026-07-10; intended red contract captured (11 selected checks green, 8 fail on the documented missing roles/environment wiring/contamination only).
- Spec pointer: [SPEC-001](SPEC.md#spec-001---canonical-dependency-chain), [SPEC-002](SPEC.md#spec-002---typed-recipe-reference-roles), [SPEC-007](SPEC.md#spec-007---prompt-shaping-and-contamination-guard), [SPEC-008](SPEC.md#spec-008---output-lifecycle)
- Plan pointer: [Phase 0](PLAN.md#phase-0---safety-harness-and-baseline)
- Files allowed: `apps/api/tests/test_graph_studio.py`, `apps/api/tests/test_store_seed_data.py`, `apps/api/tests/test_media_assistant.py`, focused web tests only if required.
- Files forbidden: application source, snapshots unrelated to storyboard flows, migrations, lockfiles.
- Problem: existing tests cover pieces of wiring and scheduling but do not lock the complete character/environment/text/image continuity graph or negative contamination behavior.
- Why it matters: implementation should be driven by a failing contract, especially in a heavily modified worktree.
- Risk/confidence: P2 / High.
- Expected behavior change: None; tests only.
- Tests needed before change: run the narrow existing storyboard/prompt/scheduler selections and record results.
- Implementation boundaries: add deterministic fixtures; no provider calls; no network; no timing sleeps.
- Verification: targeted pytest selections; web tests only if touched; `git diff --check`.
- Rollback: revert only new test cases/fixtures.
- Definition of done: tests fail for the known missing wiring/contamination and pass for already-correct runtime behavior.
- Batch eligible: Yes.
- Campaign eligible: Yes.

### TEST-003 - Establish browser baseline

- [x] TEST-003 - Establish browser baseline
- Status: Completed 2026-07-10 after starting the existing API/web dev commands.
- Spec pointer: [SPEC-009](SPEC.md#spec-009---browser-ux-verification)
- Plan pointer: [Phase 0](PLAN.md#phase-0---safety-harness-and-baseline)
- Files allowed: no source files; `docs/engineering/VERIFICATION_LOG.md` only.
- Files forbidden: all application source and data mutations.
- Problem: the current canvas was inspected from SQLite, not visually in Graph Studio during this planning pass.
- Why it matters: port visibility, edge rendering, muted states, and retained previews are UI behavior.
- Risk/confidence: P3 / High.
- Expected behavior change: None.
- Tests needed before change: API `/health` and web `/graph-studio` return 200.
- Implementation boundaries: start existing dev commands if needed; use the in-app browser plugin; do not run the graph.
- Verification: DOM snapshot plus visual inspection of the active `Sadis Adventures` canvas.
- Rollback: stop only server processes started for this task if requested.
- Definition of done: browser baseline and any visual discrepancies are logged.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 1 - Recipe Continuity Contract

### BUG-101 - Harden storyboard recipe reference and layout contracts

- [x] BUG-101 - Harden storyboard recipe reference and layout contracts
- Status: Completed 2026-07-10; Storyboard v2 is version 2.11 and Continuation v1 is version 1.6 with exact typed roles and shared sequence-board contract.
- Spec pointer: [SPEC-002](SPEC.md#spec-002---typed-recipe-reference-roles), [SPEC-003](SPEC.md#spec-003---ordered-gpt-image-2-references), [SPEC-004](SPEC.md#spec-004---text-handoff-semantics), [SPEC-005](SPEC.md#spec-005---stable-storyboard-layout-contract), [SPEC-006](SPEC.md#spec-006---story-continuity-contract)
- Plan pointer: [Phase 1](PLAN.md#phase-1---recipe-continuity-contract)
- Files allowed: `apps/api/app/store_seed_prompt_recipes.py`, `apps/api/app/graph/prompt_recipe_refs.py`, `apps/api/app/graph/prompt_recipe_catalog.py`, `apps/api/tests/test_store_seed_data.py`, focused graph recipe tests.
- Files forbidden: runtime scheduler, web UI unless a declared port fails to render, migrations, KIE specs, unrelated recipes.
- Problem: Storyboard v2 and continuation behavior is partly implicit; saved workflows still expose generic inputs and output prompts can drift in layout/visible metadata.
- Why it matters: the image model needs one unambiguous role map and one stable board design contract.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; storyboard recipes produce stricter continuity/layout prompts and declared typed ports.
- Tests needed before change: TEST-002.
- Implementation boundaries: preserve recipe IDs; bump versions intentionally; avoid a new port type unless existing `additional_refs` cannot express the contract.
- Verification: seed-data tests, typed-reference graph tests, prompt-only fixture inspection, `git diff --check`.
- Rollback: restore prior recipe version/template and typed-role metadata only.
- Definition of done: exact role map and layout contract are asserted; unrelated recipe fixtures remain unchanged.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 2 - Graph Builder And Dependency Wiring

### BUG-201 - Wire environment and visual handoffs in storyboard graph plans

- [x] BUG-201 - Wire environment and visual handoffs in storyboard graph plans
- Status: Completed 2026-07-10; generated plans validate/compile with Environment recipe/model/save, exact role order, and edge-derived board dependencies.
- Spec pointer: [SPEC-001](SPEC.md#spec-001---canonical-dependency-chain), [SPEC-002](SPEC.md#spec-002---typed-recipe-reference-roles), [SPEC-003](SPEC.md#spec-003---ordered-gpt-image-2-references)
- Plan pointer: [Phase 2](PLAN.md#phase-2---graph-builder-and-dependency-wiring)
- Files allowed: `apps/api/app/assistant/story_graph.py`, directly related assistant graph helpers, `apps/api/tests/test_media_assistant.py`.
- Files forbidden: runtime scheduler unless a characterization test proves a defect, web layout, migrations, unrelated assistant intents.
- Problem: current assistant plans handle character and previous-board refs in places, but the active graph lacks environment-to-recipe edges and previous-board visual handoffs.
- Why it matters: text handoff alone cannot lock geography, layout, or the visual ending state.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; newly built storyboard graphs include complete typed dependencies and ordered model refs.
- Tests needed before change: TEST-002 exact-edge tests.
- Implementation boundaries: use dependency edges; no sleeps; do not infer ordering from node titles or canvas coordinates.
- Verification: focused Media Assistant storyboard tests, graph validation tests, prompt-only compiled-order assertion.
- Rollback: restore prior assistant operation construction; no persisted workflow auto-migration.
- Definition of done: generated three-board graph matches SPEC-001 through SPEC-003 exactly.
- Batch eligible: No.
- Campaign eligible: No.

### BUG-202 - Repair the selected Sadis Adventures workflow

- [x] BUG-202 - Repair the selected Sadis Adventures workflow
- Status: Complete; workflow `graphwf_4fd06f50c493` only was repaired after a verified backup.
- Spec pointer: [SPEC-001](SPEC.md#spec-001---canonical-dependency-chain), [SPEC-002](SPEC.md#spec-002---typed-recipe-reference-roles)
- Plan pointer: [Phase 2](PLAN.md#phase-2---graph-builder-and-dependency-wiring)
- Files/data allowed: workflow `graphwf_4fd06f50c493` only, after a DB backup; documentation log.
- Files/data forbidden: all other workflows, run history, assets, migrations, broad seed refresh.
- Problem: existing persisted wiring does not automatically gain the corrected assistant-plan contract.
- Why it matters: browser verification must test the actual workflow the user is working with.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; selected workflow edges/ports change.
- Tests needed before change: BUG-201 passing; export/backup current workflow JSON.
- Implementation boundaries: preserve node fields, positions, prior outputs, assets, and unrelated branches; add/replace only required edges.
- Verification: workflow JSON diff, graph validation, in-app browser visual wiring check.
- Rollback: restore the workflow JSON backup.
- Definition of done: selected workflow matches canonical wiring and still opens with prior previews intact.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 3 - Provider Prompt Shaping

### BUG-301 - Make storyboard prompt compaction role-aware and contamination-free

- [x] BUG-301 - Make storyboard prompt compaction role-aware and contamination-free
- Status: Complete; freeze detection now prefers the story-specific labeled brief and preserves the exact positive state sequence.
- Spec pointer: [SPEC-003](SPEC.md#spec-003---ordered-gpt-image-2-references), [SPEC-005](SPEC.md#spec-005---stable-storyboard-layout-contract), [SPEC-007](SPEC.md#spec-007---prompt-shaping-and-contamination-guard)
- Plan pointer: [Phase 3](PLAN.md#phase-3---provider-prompt-shaping)
- Files allowed: `apps/api/app/graph/prompt_shaping.py`, model executor only if metrics are missing, `apps/api/tests/test_graph_studio.py`.
- Files forbidden: KIE model specs, pricing, recipe templates except through BUG-101, web UI, dependencies.
- Problem: paid run `grun_a97f4b9ac07d` submitted time-freeze instructions for an unrelated orbital sci-fi story and exposed a model-name phrase in the compacted prompt.
- Why it matters: contamination wastes paid runs and can directly distort generated imagery and visible text.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; compacted prompts become story-specific and preserve exact role/layout essentials.
- Tests needed before change: negative non-time-freeze fixture, positive time-freeze state-machine fixture, reference-role fixture, character-budget fixture.
- Implementation boundaries: deterministic shaping; no provider calls; preserve metrics and the 20,000 hard limit.
- Verification: prompt-shaping tests, graph model-input snapshot test, full target <= 4,200 chars, `git diff --check`.
- Rollback: restore previous shaper implementation; retain failing fixtures for diagnosis.
- Definition of done: no forbidden contamination; required continuity survives compaction; metrics report exact strategy and lengths.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 4 - No-Paid Browser Verification

### BUG-401A - Refresh dynamic definitions before saved-workflow hydration

- [x] BUG-401A - Refresh dynamic definitions before saved-workflow hydration
- Status: Complete; manual saved-workflow loading now refreshes data-backed definitions before edge contract filtering.
- Spec pointer: [SPEC-002](SPEC.md#spec-002---typed-recipe-reference-roles), [SPEC-009](SPEC.md#spec-009---browser-ux-verification)
- Plan pointer: [Phase 4](PLAN.md#phase-4---no-paid-browser-verification)
- Files allowed: Graph Studio saved-workflow hydration/definition helper and focused tests; selected workflow repair and verification log.
- Files forbidden: API runtime scheduling, pricing, provider execution, unrelated UI.
- Problem: opening a saved Prompt Recipe workflow can hydrate against stale data-backed definitions, drop typed edges from the canvas, and auto-save the reduced graph on Run.
- Why it matters: the selected 30-edge workflow rendered only 22 edges and lost all eight recipe-reference connections before runtime validation.
- Risk/confidence: P1 / High.
- Expected behavior change: saved dynamic workflows refresh node definitions before contract filtering/hydration.
- Tests needed before change: focused async definition-refresh regression; browser saved-workflow edge count.
- Implementation boundaries: reuse the existing definition reload path; retain current-contract filtering after fresh definitions; do not preserve genuinely stale edges blindly.
- Verification: focused Vitest, web typecheck, reopen saved workflow with 30 rendered edges and zero server validation warnings.
- Rollback: restore the prior manual-load hydration path and selected workflow from the verified repair/backup.
- Definition of done: reopening `Sadis Adventures` renders all 30 saved edges without marking the tab dirty or dropping typed recipe ports.
- Batch eligible: No.
- Campaign eligible: No.

### BUG-401B - Bound Prompt Recipe vision asset payloads

- [x] BUG-401B - Bound Prompt Recipe vision asset payloads
- Status: Complete; Prompt Recipe vision uses existing web derivatives while KIE media inputs retain originals.
- Spec pointer: [SPEC-002](SPEC.md#spec-002---typed-recipe-reference-roles), [SPEC-009](SPEC.md#spec-009---browser-ux-verification)
- Plan pointer: [Phase 4](PLAN.md#phase-4---no-paid-browser-verification)
- Files allowed: graph media-reference path selection, Prompt Recipe executor path selection, focused tests, verification log.
- Files forbidden: generated media mutation, KIE model inputs, provider configuration, unrelated executors.
- Problem: Board 2's three original 2048x1152 assets exceed the stable local-Codex vision request path and disconnect before token usage; the same provider succeeds for two images and for a full connection probe.
- Why it matters: prompt-only continuation verification cannot reach Board 2/3 even though graph/runtime contracts are valid.
- Risk/confidence: P1 / High.
- Expected behavior change: Prompt Recipe vision calls prefer existing bounded web derivatives for generated assets while downstream KIE model nodes keep original assets.
- Tests needed before change: path-selection red/green; full Graph Studio API file.
- Implementation boundaries: select an existing derivative only; do not resize/rewrite assets, reorder refs, or change `graph_ref_path` defaults.
- Verification: focused pytest, browser continuation run, exact role/image count, unchanged media jobs.
- Rollback: remove the opt-in path preference; no asset rollback required.
- Definition of done: Board 2 and Board 3 Prompt Recipes complete with three ordered references and no image/video submission.
- Batch eligible: No.
- Campaign eligible: No.

### BUG-401C - Preserve live SHOT-image storyboard beats during compaction

- [x] BUG-401C - Preserve live SHOT-image storyboard beats during compaction
- Status: Complete; live `SHOT NN image` headings and `DIALOG` rows compile into bounded panel capsules.
- Spec pointer: [SPEC-005](SPEC.md#spec-005---stable-storyboard-layout-contract), [SPEC-006](SPEC.md#spec-006---story-continuity-contract), [SPEC-007](SPEC.md#spec-007---prompt-shaping-and-contamination-guard)
- Plan pointer: [Phase 4](PLAN.md#phase-4---no-paid-browser-verification)
- Files allowed: `apps/api/app/graph/prompt_shaping.py`, focused graph tests, verification log.
- Files forbidden: recipe templates, provider configuration, web UI, KIE models.
- Problem: the live Board 1 recipe uses `SHOT 01 image —` section headings; the compactor recognizes `PANEL 01` headings only and falls back to a front-truncated prompt that omits the panel plan and final handoff.
- Why it matters: a valid <=4,200 submitted prompt can still lose the story it is supposed to render.
- Risk/confidence: P1 / High.
- Expected behavior change: live SHOT-image headings normalize into the existing deterministic panel-capsule parser.
- Tests needed before change: live-format negative fixture with final-board handoff assertion.
- Implementation boundaries: normalize heading syntax only; reuse existing field limits and capsule formatting.
- Verification: focused prompt-shaping selection, final-run prompt audit, full Graph Studio API file.
- Rollback: remove the heading normalization and retain the failing live-format fixture.
- Definition of done: Board 1 submitted prompt retains all six shots, upgrade check, and ready-for-next-adventure ending within 4,200 characters.
- Batch eligible: No.
- Campaign eligible: No.

### VERIFY-401 - Browser-verify the prompt-only three-board workflow

- [x] VERIFY-401 - Browser-verify the prompt-only three-board workflow
- Status: Complete; final no-paid run `grun_b30f605b84b9` completed the full dependency chain with clean bounded submitted prompts.
- Spec pointer: [Acceptance criteria](SPEC.md#acceptance-criteria), [SPEC-009](SPEC.md#spec-009---browser-ux-verification)
- Plan pointer: [Phase 4](PLAN.md#phase-4---no-paid-browser-verification)
- Files allowed: `docs/engineering/VERIFICATION_LOG.md`; UI source only if a concrete browser defect is separately scoped.
- Files forbidden: paid provider execution, Seedance submission, unrelated workflow edits.
- Problem: code tests cannot prove the real canvas wiring and displayed prompt quality.
- Why it matters: this is the final low-cost gate before image generation.
- Risk/confidence: P2 / High.
- Expected behavior change: None; verification only.
- Tests needed before change: all Phases 0-3 verification passing.
- Implementation boundaries: mute/disable paid models; run recipe/display nodes only; use in-app browser plugin.
- Verification: inspect all three prompts, edge/port wiring, order, lengths, forbidden terms, and story progression in browser.
- Rollback: restore only temporary mute/enable states changed for verification.
- Definition of done: every no-paid rubric item is logged with pass/fail evidence.
- Batch eligible: No.
- Campaign eligible: No.

### VERIFY-402 - Browser-verify preview retention and muted states

- [x] VERIFY-402 - Browser-verify preview retention and muted states
- Status: Complete; all eight muted model/save nodes carried four prior assets from `grun_a97f4b9ac07d` without a provider submission.
- Spec pointer: [SPEC-008](SPEC.md#spec-008---output-lifecycle), [SPEC-009](SPEC.md#spec-009---browser-ux-verification)
- Plan pointer: [Phase 4](PLAN.md#phase-4---no-paid-browser-verification)
- Files allowed: focused Graph Studio runtime/preview web and API files only if a failing reproduction requires a separate fix; related tests; verification log.
- Files forbidden: unrelated node rendering, gallery redesign, asset deletion.
- Problem: users need prior generated media to remain usable when upstream generation is muted or skipped.
- Why it matters: clearing previews destroys the continuity source needed for downstream boards.
- Risk/confidence: P1 / Medium until browser reproduction.
- Expected behavior change: None for verification; any fix requires a newly scoped bug task.
- Tests needed before change: existing carry-forward and graph-node runtime tests.
- Implementation boundaries: do not delete assets or clear saved content; verify last-successful-output semantics.
- Verification: browser run with a muted upstream node and valid prior output; confirm media remains and node state says skipped/muted/carried forward.
- Rollback: restore temporary node execution mode.
- Definition of done: retention behavior passes, or a reproducible defect with exact ownership is recorded.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 5 - Paid Image Proof And Review

### PAID-501 - Run one approved paid image proof

- [ ] PAID-501 - Run one approved paid image proof
- Status: Attempted 2026-07-10 after explicit approval; terminal failure at Board 2. Environment and Board 1 succeeded, Board 2 was provider-policy rejected, Board 3 was dependency-skipped, and no rerun was submitted. Definition of done was not met.
- Spec pointer: [SPEC-010](SPEC.md#spec-010---paid-run-gate), [Acceptance criteria](SPEC.md#acceptance-criteria)
- Plan pointer: [Phase 5](PLAN.md#phase-5---paid-image-proof-and-review)
- Files allowed: no source edits during the run; verification log and run evidence only.
- Files forbidden: Seedance enablement/submission, a second paid run, unrelated workflow execution.
- Problem: final visual consistency can only be proven through the real image provider.
- Why it matters: prompt-only correctness is necessary but not sufficient.
- Risk/confidence: P1 / Medium due probabilistic output and cost.
- Expected behavior change: External paid side effect: four image jobs.
- Tests needed before change: all Phases 0-4 complete; credit check if available; exact cost estimate visible.
- Implementation boundaries: one run; environment plus three boards; Seedance muted; monitor to terminal completion.
- Verification: run status, node order, four asset IDs, no video job, previews surface before dependent nodes.
- Rollback: paid generation cannot be undone; do not delete outputs. Workflow mutation rollback remains separate.
- Definition of done: one completed run with all expected outputs and no forbidden job.
- Batch eligible: No.
- Campaign eligible: No.

### VERIFY-502 - Review all paid outputs and record the result

- [x] VERIFY-502 - Review all paid outputs and record the result
- Status: Completed 2026-07-10 with a failed campaign verdict; both successful outputs and the terminal failure were reviewed at full size, root cause was isolated, and one follow-up task was recommended.
- Spec pointer: [Acceptance criteria](SPEC.md#acceptance-criteria), [SPEC-005](SPEC.md#spec-005---stable-storyboard-layout-contract), [SPEC-006](SPEC.md#spec-006---story-continuity-contract)
- Plan pointer: [Phase 5](PLAN.md#phase-5---paid-image-proof-and-review)
- Files allowed: verification documentation; source changes require a new task.
- Files forbidden: immediate rerun, silent prompt edits, asset deletion.
- Problem: visual output needs an objective, side-by-side verdict rather than a general impression.
- Why it matters: the campaign is complete only when layout, environment, character, story, and metadata are assessed across all boards.
- Risk/confidence: P2 / High.
- Expected behavior change: None; review only.
- Tests needed before change: PAID-501 complete.
- Implementation boundaries: score character identity, environment geography, layout system, story causality, metadata readability, forbidden text, and final handoff.
- Verification: browser previews plus original local output files at full size.
- Rollback: none; review artifact only.
- Definition of done: pass/fail matrix, root cause for each failure, and one recommended next task; any rerun requires new approval.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 6 - Paid-proof follow-up

### BUG-501 - Preserve CELL storyboard beats and policy-safe visual handoffs

- [x] BUG-501 - Preserve CELL storyboard beats and policy-safe visual handoffs
- Status: Complete 2026-07-10; exact red fixtures drove the scoped shaping change, 152 Graph Studio API tests pass, and no-paid browser run `grun_79f3d6936f53` completed without creating a media job.
- Spec pointer: [SPEC-006](SPEC.md#spec-006---story-continuity-contract), [SPEC-007](SPEC.md#spec-007---prompt-shaping-and-contamination-guard)
- Plan pointer: new follow-up slice required before any second paid proof.
- Files allowed: `apps/api/app/graph/prompt_shaping.py`, focused Graph Studio tests, and Storyboard recipe text/tests only if the red fixture proves the guard belongs there.
- Files forbidden: provider submission, a second paid run, Seedance, unrelated workflow changes.
- Problem: live recipe output placed full story actions in `CELL NN` blocks and short metadata in `SHOT:` lines; compaction kept layout/reference prose but dropped the requested action/dialogue/final-handoff beats. Board 1 also drifted toward more exposed lower-body framing before Board 2 hit provider moderation.
- Why it matters: prompt length compliance is not success if the story is removed or the visual handoff becomes policy-fragile.
- Risk/confidence: P1 / High for CELL compaction; P2 / Medium for the moderation hypothesis.
- Tests needed before change: add the exact Phase 5 Board 1/2 raw-output shapes as no-network red fixtures; assert six ordered CELL capsules, dialogue/final handoff, required story keywords, covered wardrobe, and non-sexual framing survive <=4,200-character shaping.
- Definition of done: focused and full Graph Studio tests pass, a new no-paid browser run preserves all required beats, and any second paid proof has separate action-time approval.

## Phase 7 - Hangar-to-launch story proof

### STORY-701 - Lock the new story, layout, and environment contract

- [x] STORY-701 - Lock the new story, layout, and environment contract
- Status: Complete 2026-07-10 from the refined user brief; see SPEC-011 through SPEC-015 and the Phase 7 rubric.
- Spec pointer: [SPEC-011](SPEC.md#spec-011---hangar-to-launch-three-board-story-contract) through [SPEC-015](SPEC.md#spec-015---second-paid-proof-authorization-and-failure-boundary)
- Plan pointer: [Phase 7](PLAN.md#phase-7---hangar-to-launch-story-proof)
- Files allowed: `docs/engineering/*` only.
- Files forbidden: workflow mutation, provider submission, recipe/source changes.
- Verification: compare every requested story, environment, layout, metadata, reference, dialogue, browser, paid, and failure-handling requirement to the spec.
- Definition of done: one unambiguous execution contract and rubric exists before workflow edits.

### GRAPH-702 - Prepare the selected workflow

- [x] GRAPH-702 - Prepare the selected workflow
- Status: Complete 2026-07-10 through Graph Studio; the existing 17-node/30-edge graph was preserved, only target recipe/save fields changed, all outputs save to Sadi, and all eight paid/save nodes remain muted.
- Spec pointer: [SPEC-011](SPEC.md#spec-011---hangar-to-launch-three-board-story-contract), [SPEC-012](SPEC.md#spec-012---recipe-owned-layout-and-production-note-contract), [SPEC-013](SPEC.md#spec-013---environment-lifecycle-and-intentional-scene-transition), [SPEC-014](SPEC.md#spec-014---ordered-visual-reference-contract-for-the-new-run)
- Plan pointer: [Phase 7](PLAN.md#phase-7---hangar-to-launch-story-proof)
- Files/data allowed: workflow `graphwf_4fd06f50c493` only, a restorable database backup, and engineering evidence docs.
- Files/data forbidden: other saved workflows, public recipe ports, global recipe edits without a red contract, source/config/schema/lockfile changes, provider submission.
- Implementation boundary: preserve the existing 17-node/30-edge graph; update environment and three story fields, explicit 16:9/6-panel/dialogue values, handoff text, and save groups. Prefer Media Assistant only if its preview is exact; otherwise use existing Graph Studio node fields.
- Verification: saved graph hash/count isolation, valid graph, exact typed edges/reference order, all eight paid/save nodes muted, `git diff --check`.
- Definition of done: selected saved workflow contains the Phase 7 story and two-zone environment contract with no unrelated graph drift.

### VERIFY-703 - Run the no-paid browser gate

- [x] VERIFY-703 - Run the no-paid browser gate
- Status: Complete 2026-07-10. Browser run `grun_4dab614d88dd` completed 9 local/preview nodes with 8 paid/save skips and media jobs unchanged at 636. Current-code replay passes at Environment 4,176, Board 1 3,711, Board 2 3,851, and Board 3 3,886 characters.
- Spec pointer: [SPEC-012](SPEC.md#spec-012---recipe-owned-layout-and-production-note-contract), [SPEC-014](SPEC.md#spec-014---ordered-visual-reference-contract-for-the-new-run), [SPEC-015](SPEC.md#spec-015---second-paid-proof-authorization-and-failure-boundary)
- Plan pointer: [Phase 7](PLAN.md#phase-7---hangar-to-launch-story-proof)
- Files/data allowed: run records and engineering evidence; no media provider jobs.
- Files/data forbidden: unmuting paid/save nodes, Seedance/video, provider submission.
- Verification: in-app Browser initiates one prompt-only run; all four recipes/previews complete; shaped prompts are <=4,200 chars and preserve story, layout labels, environment, roles, safety, and final quote; media-job count is unchanged.
- Definition of done: every deterministic gate passes before any paid execution state changes.

### BUG-706 - Preserve the recipe-owned production-note schema during compaction

- [x] BUG-706 - Preserve the recipe-owned production-note schema during compaction
- Status: Complete 2026-07-10; red fixture passed after exact seven-row capsule preservation, 9/9 shaper tests pass, Phase 7 replay is under budget, and the full Graph Studio target passes 153 tests.
- Spec pointer: [SPEC-012](SPEC.md#spec-012---recipe-owned-layout-and-production-note-contract), [SPEC-011](SPEC.md#spec-011---hangar-to-launch-three-board-story-contract)
- Plan pointer: [Phase 7](PLAN.md#phase-7---hangar-to-launch-story-proof)
- Files allowed: `apps/api/app/graph/prompt_shaping.py`, focused Graph Studio tests, and engineering evidence docs.
- Files forbidden: recipe source/version changes, node/edge changes, provider submission, paid execution, Seedance, unrelated compaction paths.
- Red evidence: raw recipe outputs contain the exact seven-row schema, but shaped Boards 1-3 expose abbreviated `CAM`/`ACT`/`DIALOGUE`/`CONT`, omit `FRAMING` and `MOTION`, and the generic intro requests a conflicting `SFX`/`CONTINUITY` schema. Board 1 also drops service robots, supplies, landing gear, hull seams, and status-light wording.
- Implementation boundary: preserve exact labels `SHOT`, `CAMERA`, `FRAMING`, `ACTION`, `MOTION`, `DIALOG`, `NOTES` for every ordered panel while keeping <=4,200 chars, role references, safety guards, dialogue, and final handoffs. Do not add a new public contract.
- Verification: exact Phase 7 raw-output fixtures/replay, all prompt-shaper tests, full Graph Studio API target, `py_compile`, `git diff --check`, then rerun VERIFY-703 in the in-app Browser.
- Definition of done: all four shaped prompts satisfy the Phase 7 deterministic rubric and the new browser run creates no media job.

### BUG-707 - Parse live Panel image storyboard headings

- [x] BUG-707 - Parse live Panel image storyboard headings
- Status: Complete 2026-07-10; the exact live heading now normalizes into existing capsules, explicit quoted titles survive shaping, 10/10 shaper tests pass, and the full Graph Studio target passes 154 tests.
- Spec pointer: [SPEC-011](SPEC.md#spec-011---hangar-to-launch-three-board-story-contract), [SPEC-012](SPEC.md#spec-012---recipe-owned-layout-and-production-note-contract)
- Plan pointer: [Phase 7](PLAN.md#phase-7---hangar-to-launch-story-proof)
- Files allowed: `apps/api/app/graph/prompt_shaping.py`, focused Graph Studio tests, and engineering evidence docs.
- Files forbidden: recipe/version changes, workflow edges, provider submission, paid execution, unrelated compaction paths.
- Red evidence: GPT-5.6 emitted `Panel 01 image — ...` through `Panel 06 image — ...`; the shaper recognizes `CELL NN —`, `SHOT NN image —`, and `PANEL NN:`, but not this live hybrid, so it falls back to generic truncation and loses all panel capsules.
- Implementation boundary: normalize only the live `Panel NN image —` heading variant into the existing capsule parser; preserve the BUG-706 exact label contract and budget.
- Verification: live-format red/green fixture, all shaper tests, full Graph Studio target, exact `grun_6dc068e95249` replay, `py_compile`, and `git diff --check`.
- Definition of done: all three storyboard raw outputs from the second no-paid run yield six ordered panels and six exact seven-row schemas under budget.

### GRAPH-708 - Lock Board 3 title to its new story content

- [x] GRAPH-708 - Lock Board 3 title to its new story content
- Status: Complete 2026-07-10 through Graph Studio; the saved Board 3 brief now explicitly requires `BOARDING AND LAUNCH — BOARD 3 OF 3` and forbids reusing Board 2 title/footer wording; graph remains 17/30 and fully muted.
- Spec pointer: [SPEC-011](SPEC.md#spec-011---hangar-to-launch-three-board-story-contract), [SPEC-012](SPEC.md#spec-012---recipe-owned-layout-and-production-note-contract)
- Plan pointer: [Phase 7](PLAN.md#phase-7---hangar-to-launch-story-proof)
- Files/data allowed: Board 3 continuation/style fields in workflow `graphwf_4fd06f50c493` and engineering evidence docs.
- Files/data forbidden: other nodes/workflows, recipe source, provider submission, paid execution.
- Evidence: Board 3 story/action content is correct, but its raw title copied `THE BURNT-OUT CAPACITOR` from Board 2 instead of using `BOARDING AND LAUNCH`.
- Implementation boundary: add an explicit Board 3 title/content instruction while preserving the shared layout; do not alter the reference order or graph shape.
- Verification: saved graph remains 17/30 and muted; next no-paid raw/shaped Board 3 uses the correct title without losing the exact Bolts line.
- Definition of done: Board 3 content title is distinct while layout/production-note design remains identical.

### BUG-709 - Preserve live split roles, spatial panels, titles, and late state terms

- [x] BUG-709 - Preserve live split roles, spatial panels, titles, and late state terms
- Status: Complete 2026-07-10 through exact red/green fixtures, four no-paid Browser audits, and the final current-code replay.
- Spec pointer: [SPEC-011](SPEC.md#spec-011---hangar-to-launch-three-board-story-contract), [SPEC-012](SPEC.md#spec-012---recipe-owned-layout-and-production-note-contract), [SPEC-014](SPEC.md#spec-014---ordered-visual-reference-contract-for-the-new-run)
- Plan pointer: [Phase 7](PLAN.md#phase-7---hangar-to-launch-story-proof)
- Files allowed: `apps/api/app/graph/prompt_shaping.py`, focused Graph Studio tests, and engineering evidence docs.
- Files forbidden: recipe versions, public ports, workflow edges, provider retry, Seedance, unrelated shaping paths.
- Red evidence: live prompts split `@image1`/`@image2`/`@image3` across paragraphs, used `titled exactly`, emitted fixed-grid `TOP-LEFT` through `BOTTOM-RIGHT PANEL IMAGE` headings, rewrote neutral title suffixes, and placed critical `status lights`/`steady green` terms late in long rows.
- Implementation boundary: reuse one capsule parser; prefer explicit per-token reference paragraphs; normalize only the observed fixed 3x2 spatial headings; canonicalize neutral subject board suffixes; retain bounded causal state terms without raising the 4,200-character target.
- Verification: 14 focused shaper/title cases; full `apps/api/tests/test_graph_studio.py` `158 passed`; exact final replay; `py_compile`; `git diff --check`; no-paid Browser run with media jobs unchanged.
- Definition of done: all boards retain ordered roles, exact titles, six ordered panels, six copies of all seven labels, required late story states, and prompt budgets.

### PAID-704 - Run one approved four-image proof

- [x] PAID-704 - Run one approved four-image proof
- Status: Terminal failed 2026-07-10. Browser run `grun_6ed69a0a6f86` completed and saved Environment, then Board 1 provider moderation failed; Boards 2/3 dependency-skipped. No retry occurred.
- Spec pointer: [SPEC-015](SPEC.md#spec-015---second-paid-proof-authorization-and-failure-boundary), [Phase 7 acceptance rubric](SPEC.md#phase-7-acceptance-rubric)
- Plan pointer: [Phase 7](PLAN.md#phase-7---hangar-to-launch-story-proof)
- Files/data allowed: execution-mode fields for the four GPT Image 2 and four Save Image nodes in `graphwf_4fd06f50c493`, one graph run, four expected image jobs/assets, and evidence docs.
- Files/data forbidden: Seedance/video, automatic retry, second Run click, another workflow, source edits during execution.
- Preflight: backup, valid 17/30 graph, queue empty, exact credit/cost estimate, media-job baseline, no Seedance, eight intended execution states.
- Verification: in-app Browser initiates exactly one run and watches dependency order through terminal state; record run/job/asset IDs and costs.
- Definition of done: the one authorized run is terminal and all available outputs are preserved for review; completion may be pass or documented provider failure.

### VERIFY-705 - Review and close the paid proof

- [x] VERIFY-705 - Review and close the paid proof
- Status: Complete 2026-07-10 with full-resolution Environment review, submitted-prompt/reference audit, terminal failure analysis, queue-empty proof, and all eight paid/save nodes persisted in safe `frozen` (UI Mute) mode.
- Spec pointer: [Phase 7 acceptance rubric](SPEC.md#phase-7-acceptance-rubric)
- Plan pointer: [Phase 7](PLAN.md#phase-7---hangar-to-launch-story-proof)
- Files/data allowed: read-only run/job/prompt/asset inspection, full-resolution output review, execution-mode remuting for the selected workflow, and engineering evidence docs.
- Files/data forbidden: paid rerun, asset deletion, unrelated workflow or recipe edits.
- Verification: score story, environment, ordered references, layout/production notes, continuity, safety/text, and operations; compare raw/shaped/submitted prompts for each defect; remute all eight nodes and confirm queue empty.
- Definition of done: evidence-backed pass/fail matrix, isolated causes and follow-up tasks, safe muted final state, and no additional paid submission.

## Completed

- TEST-001: durable workflow, run, prompt, model-limit, and asset baseline captured.
- TEST-002: contract-first role, exact-edge/order, handoff, scheduling, prompt budget/contamination, and output-retention coverage captured; intended failures recorded before application edits.
- TEST-003: in-app browser baseline completed without running the graph or submitting a provider job.
- BUG-101: Storyboard v2/Continuation roles, provider reference order, layout lock, private handoff, and visible-text rules hardened without a new public port.
- BUG-201: Media Assistant now constructs the canonical Environment plus three-board dependency graph with exact ordered references and prompt/image handoffs.
- BUG-202/301: the selected saved graph is repaired and deterministic prompt shaping is story-specific, ordered, and bounded.
- BUG-401A/B/C: saved dynamic edges survive hydration, Prompt Recipe vision uses bounded existing derivatives, and live SHOT/DIALOG output compacts without losing the ending.
- VERIFY-401/402: no-paid browser run and retained-preview checks complete; Phase 5 remains approval-gated.

## Blocked / Needs Human Confirmation

- PAID-501: attempted but did not meet its four-output definition of done. A second paid run requires new action-time approval and should not occur before BUG-501.
- BUG-501: complete.
- PAID-704: the one approved run was consumed and failed at Board 1 after Environment succeeded. Any retry or later paid run remains unapproved.

## Phase 8 - Reference-safety and moderation hardening

### BUG-712 - Replace the policy-fragile character reference

- [x] BUG-712 - Replace the policy-fragile character reference
- Status: Complete 2026-07-10 after explicit approval. The Character node now uses neutral private-text-free imported identity portrait `ref_3c38d161cdc3`; the target graph remains 17 nodes / 30 edges.
- Spec pointer: [SPEC-016](SPEC.md#spec-016---reference-image-safety-must-match-the-prompt-contract)
- Problem: the actual `@image1` character sheet visibly contains a repeated exposed midriff/cropped suit and private name/age text, while the provider prompt requires a fully covered unchanged wardrobe and no private text. Board 1 was moderation-rejected even though its 3,405-character submitted prompt contained the safety guards.
- Evidence boundary: provider moderation does not disclose the exact trigger. The reference/prompt conflict is the strongest observed contributor, not a proven provider root cause.
- Implementation: searched existing generated and imported media; no compliant covered character sheet existed, so reused the original neutral same-identity face/upper-body portrait rather than creating another paid asset. Strengthened every board's style field so the image controls face/hair identity only and the output uses one enclosed cream/red pilot suit with red mechanical limbs.
- Verification: workflow versions 42-46 preserve 17/30; Character reaches each recipe/model as ordered reference 1; Environment is frozen to `asset_123e29b65e70` as reference 2; no-paid runs preserved media-job baseline 638; final raw/shaped prompts contain no private name or redaction corruption.
- Definition of done: met for the no-paid reference and workflow contract. Provider acceptance remained unproven and was tested separately by PAID-713.

### PAID-713 - Run one newly approved three-board proof

- [x] PAID-713 - Run one newly approved three-board proof
- Status: Terminal failed 2026-07-10. Explicitly authorized run `grun_b005f9a1dbf8` submitted Board 1 job `job_02c012a45027`, which was provider-policy rejected; Boards 2/3 dependency-skipped.
- Preflight: valid 17/30 graph; successful Environment frozen; only six Board 1-3 GPT/save nodes enabled; 30 credits / $0.15 estimate; 959.6 credits; queue empty; no Seedance.
- Evidence: submitted prompt 3,453 chars; reference 1 was `ref_3c38d161cdc3`; reference 2 was `asset_123e29b65e70`; provider exposed no specific moderation category.
- Cost/result: no output asset, no Board 2/3 job, credits remained 959.6, media jobs advanced from 638 to 639, queue returned empty.
- Safe closure: all six board GPT/save nodes remuted; Environment nodes remain explicitly frozen to the successful cached run.

### BUG-714 - Preserve paid spatial panels and use positive-only coverage framing

- [x] BUG-714 - Preserve paid spatial panels and use positive-only coverage framing
- Status: Complete 2026-07-10 after PAID-713 evidence.
- Problem: the paid raw prompt used `Top-left panel:` / `Top-middle panel:` forms without `IMAGE`; the compactor misclassified/fell back, dropped the six-panel plan, duplicated the raw intro, and retained negative moderation vocabulary.
- Implementation: recognize LEFT/MIDDLE/RIGHT spatial panel headings with optional `IMAGE`; prevent metadata-only SHOT lines from becoming duplicated scene text; replace negative safety vocabulary with positive fully enclosed crew-workwear and task-focused professional framing.
- Tests: exact red -> green spatial-heading and positive-only fixtures; adjacent reference lines; title suffix; negative action-beat suppression; `board/boards` sanitizer exclusions.
- Verification: exact PAID-713 raw replay compacts to 3,528 chars with six copies of all seven metadata rows, ordered `@image1/@image2`, all exterior-inspection beats, and none of `non-sexual`, `pin-up`, `underwear`, `wardrobe removal`, `skin exposure`, `cleavage`, `midriff`, `gore`, or `injury`. Full Graph Studio API target: 163 passed.

### BUG-715 - Repair Character Replace and frozen-cache browser hydration

- [x] BUG-715 - Repair Character Replace and frozen-cache browser hydration
- Status: Complete 2026-07-10; no provider submission occurred.
- Problem: Character `Replace` did not open a scoped selector; choosing the imported image from the global library created an unconnected 18th node. Separately, saved frozen cached Environment nodes hydrated as Muted in Graph Studio, so browser Run would discard the explicit failed-run cache.
- Evidence: both replacement attempts were immediately undone to 17 nodes; API fallback versioned only the target workflow; saved validation remained clean.
- Implementation boundary: web Graph Studio media picker/selection target and execution-cache hydration only; do not alter provider specs, pricing, public ports, graph edges, other workflows, or submit media.
- Definition of done: browser replacement updates the selected Load Image node without changing node/edge counts, and frozen `cached_run_id` survives hydration/run serialization; focused web tests plus no-paid browser proof.
- Implementation: collapse preview replacement to one click activation, keep hidden actions out of hit testing and place visible actions above the resize handle, refresh clean Graph Studio-owned signature-less tabs from the authoritative saved record, and characterize frozen-cache round trips against older muted run state.
- Verification: 310 Graph Studio web tests, web typecheck/lint, theme-drift, and `git diff --check` pass. In-app Browser replacement reselected `ref_3c38d161cdc3` without graph growth; run `grun_5c92ebb07834` completed with 9 local completions, 2 cached Environment nodes, 6 muted skips, $0 cost, and media jobs unchanged at 639.
- Review: campaign-scoped post-implementation evidence pack is `docs/reviews/20260710_223334/`; both findings are resolved and no blocker remains.

## Phase 9 - Terminal Board 1 proof and review

### PAID-716 - Run one approved Board 1-only proof

- [x] PAID-716 - Run one approved Board 1-only proof
- Status: Complete 2026-07-10 after fresh action-time approval; no retry occurred.
- Scope: keep the browser-attached Character sheet unchanged, freeze/reuse the successful Environment, enable only Board 1 GPT/Save, and submit exactly one Graph Studio Run click.
- Preflight: backup `data/backups/media-studio-before-phase9-board1-20260710T154521Z.db` SHA-256 `f22e54c3042f06bce79633a1dbdf85eabda323df8f7931e007c4f08c3181ba32`; `quick_check=ok`; 17 nodes / 30 edges; queue empty; 959.6 credits; estimate 10 credits / $0.05; no Seedance.
- Result: run `grun_6c158a8dd274` completed; `job_64495d8b780d` succeeded with the unchanged Character sheet as reference 1 and frozen Environment as reference 2; 3,398 submitted characters; output `asset_d9d0ccdff7fd`, 2048x1152; credits ended at 949.6.
- Isolation: media jobs 639 -> 640, assets 585 -> 586, runs 693 -> 694; all 266 non-target workflows retained hash `7cca868ae7e30838f25235d5fec7ab2eb7ab78985bea6226888baa0a4d864bed`; Boards 2/3 submitted no job.

### VERIFY-717 - Review Board 1 and close Phase 9

- [x] VERIFY-717 - Review Board 1 and close Phase 9
- Status: Complete/terminal 2026-07-10; the provider proof succeeded but did not pass visual acceptance.
- Pass: exact six-panel 3x2 board, stable dark/yellow metadata layout, all SHOT/CAMERA/FRAMING/ACTION/MOTION/DIALOG/NOTES labels, blank dialogue, consistent hangar/ship/robot geography, and causal manifest -> gear -> hull -> connections -> warning progression.
- Fail: several metadata values end mid-word, the retained Character sheet overrode the covered-workwear direction with exposed-midriff wardrobe, and Panel 06 shows an open service bay instead of the required closed-panel alert handoff.
- Safe closure: Board 1 GPT/Save frozen to `grun_6c158a8dd274`; Environment GPT/Save frozen; Boards 2/3 GPT/Save muted; estimate approximately 0 credits / $0; saved workflow validates with zero errors/warnings; queue empty; no Seedance.
- Next boundary: a no-paid remediation task may address whole-word compaction and stronger identity-only/wardrobe separation, but no Board 1 retry or Board 2/3 run is authorized.

## Phase 10 - No-paid storyboard fidelity remediation

### TEST-1001 - Characterize the accepted Board 1 fidelity failures

- [x] TEST-1001 - Characterize the accepted Board 1 fidelity failures
- Status: Complete 2026-07-11; three public-seam regressions failed for the intended independent reasons.
- Spec pointers: [SPEC-019](SPEC.md#spec-019---metadata-compaction-preserves-complete-words), [SPEC-020](SPEC.md#spec-020---board-boundaries-exclude-negated-and-future-story-state), [SPEC-021](SPEC.md#spec-021---retained-character-sheet-has-identity-only-provider-authority).
- Allowed files: `apps/api/tests/test_graph_studio.py`, `docs/engineering/*`.
- Red contract: exact/reduced Phase 9 fixtures must fail on mid-word metadata, positive `capacitor` leakage into Board 1, insufficient closed-panel/amber/latch state, and weak identity-versus-wardrobe ownership.
- Verification: narrow pytest selection demonstrates the intended red failures; unrelated focused prompt-shaping tests remain green; `git diff --check`.
- Definition of done: failures are deterministic, public-seam based, and map one-to-one to BUG-1002/1003/1004.

### BUG-1002 - Make storyboard metadata truncation whole-word safe

- [x] BUG-1002 - Make storyboard metadata truncation whole-word safe
- Status: Complete 2026-07-11.
- Spec pointer: [SPEC-019](SPEC.md#spec-019---metadata-compaction-preserves-complete-words).
- Allowed files: `apps/api/app/graph/prompt_shaping.py`, `apps/api/tests/test_graph_studio.py`, `docs/engineering/*`.
- Implementation boundary: reuse the existing sentence/field limiter; no new compaction pipeline or provider contract.
- Verification: exact Phase 9 fragments absent; six panels/seven labels retained; prompt <=4,200 characters; focused and full Graph Studio API tests.
- Evidence: the dedicated red test reproduced `three-quarter inse.`, `ship dominat.`, `pilot lower t.`, `couplings fo.`, `seated cou.`, and `amber indica.`; after the existing limiter gained a whitespace fallback, the exact test passed with all six panels/seven labels and the prompt within budget.

### BUG-1003 - Isolate Board 1 state from negated and future beats

- [x] BUG-1003 - Isolate Board 1 state from negated and future beats
- Status: Complete 2026-07-11.
- Spec pointer: [SPEC-020](SPEC.md#spec-020---board-boundaries-exclude-negated-and-future-story-state).
- Allowed files: `apps/api/app/graph/prompt_shaping.py`, `apps/api/tests/test_graph_studio.py`, `docs/engineering/*`.
- Implementation boundary: sanitize negative/future clauses before existing state-term extraction and retain positive closed-panel/amber/latch signals; do not hardcode the Sadi story outside generic story-state terms.
- Verification: Board 1 excludes capacitor/replacement/open-panel/internal/repair/boarding/cockpit/launch state while Board 2/3 positive state remains intact.
- Evidence: the focused Board 1 handoff test and three adjacent late-state/spatial tests pass `4 passed, 162 deselected`; the implementation remains generic clause filtering plus specific current-state vocabulary.

### BUG-1004 - Separate retained-sheet identity from prompt-owned wardrobe

- [x] BUG-1004 - Separate retained-sheet identity from prompt-owned wardrobe
- Status: Complete 2026-07-11.
- Spec pointers: [SPEC-017](SPEC.md#spec-017---provider-facing-safety-uses-positive-production-direction), [SPEC-021](SPEC.md#spec-021---retained-character-sheet-has-identity-only-provider-authority).
- Allowed files: `apps/api/app/graph/prompt_shaping.py`, `apps/api/tests/test_graph_studio.py`, `docs/engineering/*`.
- Implementation boundary: keep `asset_901adc9b21d1`; strengthen generic positive provider-facing authority text; no asset mutation, crop/derivative, new port, or negative sensitive vocabulary.
- Verification: exact authority wording survives within budget; positive-only safety tests remain green; browser confirms Character unchanged.
- Evidence: the authority wording is emitted only when `@image1` is present, so text-only storyboard prompts do not gain an invalid reference; the seven-test Phase 10 focus set passes `7 passed, 159 deselected`.

### VERIFY-1005 - Run the no-paid Phase 10 gate

- [x] VERIFY-1005 - Run the no-paid Phase 10 gate
- Status: Complete 2026-07-11.
- Spec pointer: [SPEC-022](SPEC.md#spec-022---phase-10-is-a-no-paid-readiness-gate).
- Verification: focused tests, full `test_graph_studio.py`, Python compilation, duplication/reference search, `git diff --check`, saved workflow validation, health/queue checks, exact Phase 9 replay, and in-app browser inspection.
- Browser acceptance: 17 nodes/30 edges; Character `asset_901adc9b21d1`; Environment and Board 1 frozen; Boards 2/3 muted; estimate approximately 0 credits/$0; previews retained; media-job count unchanged; no Seedance.
- Definition of done: deterministic readiness is signed off and Phase 11 remains separately gated; no paid job is submitted.
- Evidence: exact Phase 9 replay compacts 10,102 -> 3,626 characters with six copies of all seven metadata labels, no known fragments, the closed-panel/amber/latch handoff, no capacitor/internal-component leakage, and explicit identity/wardrobe authority. Full Graph Studio tests pass `166 passed`; compile, saved validation, and diff hygiene pass. In-app Browser confirms 17 nodes/30 edges, Character retained, Environment/Board 1 frozen, Boards 2/3 muted, no Seedance, 949.6 credits, and ≈0 credits/$0. Media jobs and graph runs remained 640/694 because Run was not clicked.
- Known gate debt: `check_file_size_guardrails.py` remains red on pre-existing oversized `graph-studio.tsx` (2324/2300) and `test_graph_studio.py` (6598/4900). Phase 10 did not touch the web coordinator; its three regression cases were added to the existing Graph Studio integration-test owner.

## Phase 11 - Sequential paid trilogy proof

### PLAN-1101 - Lock the five-attempt budget and acceptance rubric

- [x] PLAN-1101 - Lock the five-attempt budget and acceptance rubric
- Status: Complete 2026-07-11 before provider work.
- Spec pointer: [SPEC-023](SPEC.md#spec-023---phase-11-proves-one-accepted-progressive-three-board-chain).
- Authorization: up to five paid Graph Studio runs total; preserve the current Character and Environment; fine-tune toward three causally progressive, visually consistent storyboards.
- Strategy: Board 1 -> inspect/freeze -> Board 2 -> inspect/freeze -> Board 3 -> inspect/freeze. Reserve attempts four and five for the earliest failing board and any dependent regeneration it invalidates.

### PAID-1102 - Execute the bounded sequential proof loop

- [x] PAID-1102 - Execute the bounded sequential proof loop
- Status: Complete 2026-07-11; five of five authorized paid runs consumed with three accepted final boards.
- Allowed state: workflow `graphwf_4fd06f50c493` only; Character `asset_901adc9b21d1`; Environment frozen; Seedance absent; only the board currently under review and its Save node may be enabled.
- Before every attempt: healthy API/runner, empty queue, valid 17/30 graph, restorable database backup, authoritative estimate, exact enabled-node audit, prompt replay <=4,200 characters, and browser confirmation.
- After every attempt: inspect full-resolution output against layout, metadata, character/wardrobe, environment, causal frame progression, and board handoff; freeze an accepted board or remute a rejected board; record run/job/asset/cost evidence.
- Fine-tuning boundary: make only a concrete evidence-led prompt/shaping/field change. Add regression coverage and rerun deterministic gates before the next paid attempt. Do not alter public ports, provider specs, pricing, schema, dependencies, Character media, or another workflow.
- Attempt 1: `grun_3abd7136960e` / `job_f748088fbb66` completed and created `asset_cf512c0663cc`, 2048x1152, from Character reference 1 plus frozen Environment reference 2. Credits 949.6 -> 939.62; media jobs 640 -> 641; graph runs 694 -> 695. PASS: matching 3x2 layout, strong environment/ship/loading continuity, complete labels, complete words, causal Panels 1-5. REJECT: retained-sheet waist/back wardrobe drift, Panel 6 points toward the ramp instead of the closed amber service panel/hand-latch handoff, and internal `State:` phrases rendered inside ACTION. Board 1 was remuted; Boards 2/3 stayed muted.
- Attempt 1 remediation: regression assertions require state guidance outside ACTION and a stronger opaque one-piece textile base layer. Target workflow Board 1 brief now explicitly requires the still-closed amber panel, hand beside latch, ramp separate in background, and opaque underlayer. Attempt 2 remains gated by full tests plus a zero-cost prompt replay/run.
- Attempt 2: `grun_f2919499d631` / `job_63ff3decc40c` created `asset_67348c76680b`; rejected for incomplete metadata thoughts and exposed upper-chest/neckline treatment despite fixing the service-panel handoff.
- Bounded remediation: bare `PANEL NN` headings, whole-word fallback, dangling metadata tails, long hand-near-latch phrases, jawline-sealed workwear, and doubled neutral articles gained regression coverage. Exact live replay passed before retry; full Graph Studio target passed 167 tests.
- Attempt 3 accepted Board 1: `grun_e1370bed4813` / `job_3982415e2b19` -> `asset_60c6f076511e` (2048x1152). Character reference 1 and frozen Environment reference 2 were submitted in order.
- Attempt 4 accepted Board 2: `grun_e8206374dbeb` / `job_5d304cc4b9b7` -> `asset_a50774289804` (2048x1152). Reference 3 was the accepted Board 1. Story progression covers panel open -> fault trace -> replacement -> removal/install -> green/closed handoff.
- Attempt 5 accepted Board 3: `grun_62ae7afc8796` / `job_be63042ba8b6` -> `asset_ca6180f66b9a` (2048x1152). Reference 3 was the accepted Board 2. Story progression covers ramp/corridor -> cockpit/cat -> harness/preflight -> lift/dialogue -> hangar exit.
- Accounting: 50 credits / $0.25 total; browser balance 949.6 -> 899.6; no Environment regeneration and no Seedance.

### VERIFY-1103 - Sign off the accepted Board 1 -> Board 2 -> Board 3 chain

- [x] VERIFY-1103 - Sign off the accepted Board 1 -> Board 2 -> Board 3 chain
- Status: Complete 2026-07-11.
- Acceptance: three accepted 2048x1152 sheets; one matching 3x2 Storyboard v2 layout; stable Character/cyborg construction and prompt-owned enclosed coverall; same Environment across unchanged locations; immediate prior-board reference 3; causal panel-by-panel progression; exact Board 1 and Board 2 handoffs; exact Board 3 dialogue and hangar exit.
- Closure: all accepted nodes frozen, queue empty, no Seedance, final workflow valid and saved/reload-stable, total Phase 11 attempts <=5, costs and residual visual risks documented.
- Evidence: in-app Browser shows 899.6 credits and approximately 0 credits/$0; API/runner healthy; queue 0/0; 17 nodes/30 edges; zero validation errors/warnings; Character unchanged; Environment and all three accepted GPT/Save pairs frozen.
- Residual: Boards 2-3 share an extra compact top production strip and bordered footer area that Board 1 omits; the required six-panel grid and per-frame SHOT/CAMERA/FRAMING/ACTION/MOTION/DIALOG/NOTES layout match across all three.

## Phase 12 - Full-trilogy cinematic quality gate

### PLAN-1201 - Lock the full-trilogy quality gate

- [x] PLAN-1201 - Lock the full-trilogy quality gate
- Status: Complete 2026-07-11 before new provider work.
- Spec pointer: [SPEC-024](SPEC.md#spec-024---phase-12-is-a-full-trilogy-cinematic-quality-gate).
- Authorization: at most six paid runs, each generating Boards 1-3 as one complete attempt; optional Environment regeneration is allowed but not planned because the established Environment itself is strong.
- Budget: planned attempt cost is 30 credits / $0.15 with Environment frozen; maximum planned six-attempt storyboard spend is 180 credits / $0.90. Any Environment regeneration must be estimated and recorded separately within the user's authorization.

### BUG-1202 - Harden layout, cinematic, and Environment authority

- [x] BUG-1202 - Harden layout, cinematic, and Environment authority
- Status: Complete 2026-07-11.
- Allowed files: `apps/api/app/graph/prompt_shaping.py`, `apps/api/tests/test_graph_studio.py`, target workflow `graphwf_4fd06f50c493`, and Phase 12 engineering docs.
- Contract: exact complete-sheet chrome on every board; photoreal live-action cinematic stills inside cells; dominant Environment reference; distant Board 1 walk-up with droids entering the ramp; causal repair/boarding/lift; clearly mechanical secured Bolts.
- Guardrails: no public port, schema, route, provider model/spec, pricing, dependency, Character replacement, non-target workflow, or Seedance change.
- Verification: focused red -> green, full Graph Studio API target, exact live prompt replay, compile/diff hygiene.
- Evidence: exact `PANEL NN image and metadata:` live headings now compact correctly; full Graph Studio API target passes 169 tests; exact Board 1/2/3 replay retains six complete metadata sets, complete-sheet chrome, movie-still language, dominant Environment authority, distant/droid approach, capacitor chain, mechanical Bolts, floor-drop lift, airborne state, and exact dialogue within 4,200 characters.

### VERIFY-1203 - Run the zero-cost full-trilogy preflight

- [x] VERIFY-1203 - Run the zero-cost full-trilogy preflight
- Status: Complete 2026-07-11.
- Browser gate: Environment frozen; Boards 1-3 GPT/Save muted; one zero-cost run; no media-job increase; exact current prompts audited; valid 17/30 graph; healthy API/runner; empty queue; estimate approximately 0.
- Paid preflight: restore all three board pairs to enabled only after the no-paid gate; browser estimate approximately 30 credits / $0.15; Character/Environment/reference order confirmed; backup and baseline counts recorded.
- Evidence: backup `data/backups/media-studio-before-phase12-20260711.db` SHA-256 `a8ba1e6f8d6160bc000e6b981544cb2dd916a9a11292ce158fecdfe072c59f77`, `quick_check=ok`; no-paid run `grun_f775621a7ce3` completed with media jobs unchanged at 645; browser paid preflight shows 899.6 credits and exactly 30 credits / $0.15.

### PAID-1204 - Execute up to six complete trilogy attempts

- [x] PAID-1204 - Execute up to six complete trilogy attempts
- Status: Complete 2026-07-11; six of six attempts consumed.
- Each attempt: one browser Run click, three board jobs in dependency order, full-resolution review of all three outputs, reference-order verification, scorecard, and evidence-led decision before another attempt.
- Preserve all outputs for user review. Do not mix boards from different attempts when judging causal continuity. Stop early only if further spending has no credible quality benefit or the best trilogy fully passes.
- Hard ceiling: six paid Graph Studio runs. No seventh run and no Seedance.
- Attempt 1: `grun_bab3560be616` completed three ordered jobs and created Boards 1-3 as `asset_6bf3ce7c653b`, `asset_615d3ef45710`, and `asset_eb6638a1d7df`. Cost: 30 credits / $0.15; balance 899.6 -> 869.6. PASS: identical complete sheet chrome, photoreal cinematic cells, wide Environment opening, causal repair, physical boarding, mechanical Bolts, and same-door departure. REJECT: exposed waist/back garment drift, Board 3 exact dialogue truncated to “Bolts.”, lift separation visually weak, and contradictory open/closed service-panel NOTES.
- Attempt 1 remediation: ignore outline-only panel headings, normalize Character reference authority to identity/cyborg construction only, add continuous waist/lower-back coverage, verbatim dialogue lock, tight open-service-panel matching, and explicit floor-drop/airborne state. Full Graph Studio target passes 170 tests. Zero-cost run `grun_018dfed216a9` created no media job; exact replay passes all attempt-2 gates.
- Attempt 2 pre-provider abort: `grun_aa382ee15e5b` failed at the unnecessary Environment Prompt Recipe after 360.92 seconds with `Codex Local App Server did not respond`; zero media jobs, zero credits, all paid nodes skipped. This is not counted as a paid trilogy attempt. Environment Recipe/Preview are now muted while the proven Environment GPT/Save pair remains frozen and continues providing reference 2.
- Attempt 2: `grun_8a5027818dd7`; assets `asset_a70d4c44ec6d`, `asset_ca443a419015`, `asset_18f5bee12e5b`. PASS: matching complete sheets, cinematic Environment, full dialogue, repair/boarding/departure. REJECT: recurring exposed-waist construction and weak Panel 5 lift separation.
- Attempt 3: `grun_538158c313b9`; assets `asset_369714fec3fe`, `asset_af6202828164`, `asset_b8602a65de4b`. PASS: exact shared sheet, strong distant Environment approach, causal repair, correct first cat reveal, exact dialogue. REJECT: exposed-waist construction remained across Boards 1-2.
- Attempt 4: `grun_94f5771700c6`; assets `asset_7754d9759568`, `asset_26ffc328781c`, `asset_4c46d57451e1`. PASS: shared gold/black sheet and fully covered Board 2. REJECT: Bolts appeared before the intended Panel 3 reveal and Boards 1/3 retained wardrobe drift.
- Attempt 5: `grun_e39207d96114`; assets `asset_362ab770ad2b`, `asset_e2f7c447794f`, `asset_cf80b084f4ff`. SELECTED BEST: identical full sheets with PAGE 1/3, 2/3, 3/3; cinematic fixed Environment; distant pilot and droid loading; covered workwear; clean repair chain; Bolts first appears in Board 3 Panel 3; exact dialogue; coherent departure. Residual: Board 3 Panel 5 shows an exterior ship through the cockpit canopy, making the initial lift image ambiguous before Panel 6 clearly shows flight.
- Attempt 6 first launch: `grun_cc64b46ca4b7` was interrupted by a local dev-server reload before provider submission; zero new media jobs and zero credits, so it does not count as a full attempt.
- Attempt 6: `grun_1f520678365b`; assets `asset_57f1ee2eb628`, `asset_c7f87aab5238`, `asset_094a16b58ae9`. PASS: the corrected cockpit floor-drop lift is visually clear. REJECT: Board 1 omits the pilot from the opening frame, footer numbering regresses to 1/1 and 2/2, and Board 3 exposes the waist again.
- Accounting: six complete trilogy runs, 18 boards, 180 credits / $0.90; browser balance 899.6 -> 719.6. No Environment regeneration and no Seedance job.

### VERIFY-1205 - Freeze and sign off the best complete trilogy

- [x] VERIFY-1205 - Freeze and sign off the best complete trilogy
- Status: Complete 2026-07-11; attempt 5 selected and frozen.
- Compare every attempt across full-sheet layout, cinematic realism, Environment visibility, character/wardrobe, story flow, handoffs, Bolts, dialogue, and metadata.
- Freeze all three outputs from the same best attempt; keep Phase 11 and other Phase 12 assets intact; validate/reload; queue 0/0; estimate 0; document costs, asset paths, selected/best rationale, and residual defects.
- Closure evidence: saved workflow remains 17 nodes / 30 edges and validates with zero errors/warnings; all six storyboard GPT/Save nodes are frozen to `grun_e39207d96114`; Environment GPT/Save remain frozen; in-app Browser loaded the authoritative saved workflow and reports approximately 0 credits / $0; API/runner healthy; queue 0/0; final Graph Studio target `172 passed in 88.28s`; `py_compile` and `git diff --check` pass.
- Best output paths: `data/outputs/2026-07-11/20260711_073404_gpt_image_2_image_to_image_job_d442eb7ba298_output_1/original/output_01.png`, `data/outputs/2026-07-11/20260711_073822_gpt_image_2_image_to_image_job_854352f25f0b_output_1/original/output_01.png`, and `data/outputs/2026-07-11/20260711_074133_gpt_image_2_image_to_image_job_beb8d161b9ab_output_1/original/output_01.png`.

## Phase 13 - Durable trilogy acceptance and subsystem review

### PLAN-1301 - Lock Phase 13 acceptance and review scope

- [x] PLAN-1301 - Lock Phase 13 acceptance and review scope
- Status: Complete 2026-07-11 before implementation or provider work.
- Contract: [SPEC-025](SPEC.md#spec-025---phase-13-adds-a-durable-trilogy-acceptance-and-audit-boundary); one paid complete trilogy maximum; no Environment/Character replacement; no Seedance; Uber review is read-only except its report.

### BUILD-1302 - Add trilogy scorecard, checks, and manifest

- [x] BUILD-1302 - Add trilogy scorecard, checks, and manifest
- Status: Complete 2026-07-11.
- Allowed files: one focused graph-quality module, one CLI script, new focused tests, and Phase 13 docs.
- Contract: stable deterministic gate IDs, explicit visual-review gates, ordered reference evidence, prompt hashes, run/job/asset manifest, and no public route/schema/database migration.
- Evidence: `storyboard_trilogy_quality.py` owns ten deterministic gates plus ten visual gates; `audit_storyboard_trilogy.py` records run/job/asset/reference/prompt-hash/accounting evidence under `data/quality-manifests/`; four focused tests pass.

### VERIFY-1303 - Run deterministic and zero-cost audit

- [x] VERIFY-1303 - Run deterministic and zero-cost audit
- Status: Complete 2026-07-11.
- Verification: focused tests, full relevant Graph Studio target, compilation/diff hygiene, health/queue check, and manifest generation for frozen `grun_e39207d96114` without creating a media job.
- Evidence: Browser zero-cost run `grun_4319c5f1170a`; media jobs unchanged at 663; current-code replay manifest `data/quality-manifests/grun_4319c5f1170a.json` passes all ten deterministic gates. The gate first caught lost Board 1 distance and a negated early-cat token; both were fixed at the shared shaping boundary. Full focused+Graph Studio target: `176 passed in 92.55s`; readiness, compilation, and diff hygiene pass.

### PAID-1304 - Run one complete trilogy proof

- [x] PAID-1304 - Run one complete trilogy proof
- Status: Complete 2026-07-11; the single authorized run was consumed with no retry.
- Boundary: one Browser Run click with Boards 1-3 GPT/Save enabled, Environment frozen, expected 30 credits / $0.15, followed by full-resolution review. No retry.
- Evidence: `grun_9e02c78b4ce0`; jobs `job_19ed197ecb32`, `job_d7a5968cc321`, and `job_1c3c3c27c080`; assets `asset_963b5c26dc08`, `asset_dddfee74c8b7`, and `asset_42d8236654c3`; 2048x1152 each; balance 719.6 -> 689.6; 30 credits / $0.15.
- Verdict: deterministic gate passed; visual gate did not. Passes layout geometry, board numbering, cinematic cells, Environment/character continuity, causal flow, Bolts reveal, and exact dialogue. Fails the strict final gate because Board 3 Panel 6 renders `DIALOS`, Board 1 Panel 6 visually opens the service bay before the Board 2 handoff, and Board 3 Panel 5 omits Bolts/clear landing-foot separation.

### REVIEW-1305 - Audit Recipes, Presets, and Media Assistant

- [x] REVIEW-1305 - Audit Recipes, Presets, and Media Assistant
- Status: Complete 2026-07-11; review remained read-only except its report.
- Scope: backend/frontend entrypoints, persistence, validation, prompt compilation, graph planning/apply, provider execution boundary, tests, duplication, legacy, docs, and operations. Exclude unrelated model integrations and generated/vendor code.
- Output: one timestamped `docs/reviews/` Uber Code Review report with validated findings and remediation tasks; no finding fixes during review.
- Evidence: `docs/reviews/20260711-173000-recipes-presets-media-assistant.md`; 2 High and 2 Medium findings, one harmful duplication cluster, two verification-only compatibility paths, and TASK-001 through TASK-008.
- Test evidence: focused backend 343 passed / 9 failed; focused frontend 94 passed / 0 failed. The backend failures are preserved as ship-blocking remediation evidence rather than fixed during the review.

### VERIFY-1306 - Freeze and close Phase 13

- [x] VERIFY-1306 - Freeze and close Phase 13
- Status: Complete 2026-07-11.
- Closure: freeze accepted same-run trilogy or restore Phase 12 best, finalize manifest, valid 17/30 graph, browser estimate 0, API/runner healthy, queue 0/0, docs updated, and no Seedance.
- Evidence: paid manifest `data/quality-manifests/grun_9e02c78b4ce0.json` plus visual review `data/quality-manifests/grun_9e02c78b4ce0-visual-review.json`; strict CLI exits 1 with deterministic `pass`, visual `needs_review`, overall `not_accepted`. The saved workflow restores and freezes all six Board GPT/Save nodes to Phase 12 best `grun_e39207d96114`; Character and Environment remain unchanged; no retry and no Seedance.

## Phase 14 backlog - Recipes, Presets, and Media Assistant remediation

These tasks are documented from REVIEW-1305 and are not implicitly authorized for implementation by Phase 13 closure. The full acceptance criteria and evidence are in the review report.

- [ ] REVIEWFIX-1401 (P0) - Correct assistant action arbitration so generic `set_node_field` operations cannot override preset save/refinement intent. Links: CR-001 / TASK-001.
- [ ] REVIEWFIX-1402 (P0) - Resolve Prompt Recipe targets by semantic identity/selection instead of first-node order in multi-recipe graphs. Links: CR-002 / TASK-002.
- [ ] REVIEWFIX-1403 (P0) - Restore the 352-test focused backend gate after product fixes and documented intentional contract updates. Links: CR-001–003 / TASK-003.
- [ ] REVIEWFIX-1404 (P1) - Establish one versioned Prompt Recipe field/reference contract authority with backend/frontend parity tests. Links: CR-003 / DUP-001 / TASK-004.
- [ ] REVIEWFIX-1405 (P1) - Extract the Media Assistant decision pipeline incrementally behind behavior-lock tests. Links: CR-004 / TASK-005.
- [ ] REVIEWFIX-1406 (P2) - Add shared backend/frontend intent vectors. Links: CR-001 / CR-004 / TASK-006.
- [ ] REVIEWVERIFY-1407 (P3) - Audit persisted legacy skill ids before considering compatibility removal. Links: LEG-001 / TASK-007.
- [ ] REVIEWVERIFY-1408 (P3) - Audit pre-hash attachment-session reachability. Links: LEG-002 / TASK-008.

## Phase 15 - Adjacent-board visual handoff proof

### PLAN-1501 - Lock the one-run handoff proof

- [x] PLAN-1501 - Lock the one-run handoff proof
- Status: Complete 2026-07-11 before implementation or provider work.
- Contract: [SPEC-026](SPEC.md#spec-026---phase-15-locks-adjacent-board-visual-handoffs); one paid trilogy maximum; Character/Environment unchanged; no Seedance or retry.

### TEST-1502 - Characterize bounded handoff continuity

- [x] TEST-1502 - Characterize bounded handoff continuity
- Status: Complete 2026-07-11.
- Acceptance: Board 2/3 compact prompts must explicitly match Panel 01 to Panel 06 in `@image3` across camera, lens, framing, pose/placement, object state, Environment anchors, lighting, and color, advancing only one small action one-to-two seconds later.
- Evidence: prior submitted prompts retained only generic previous-ending-state language; focused red/green coverage now asserts the exact near-match lock for both continuation boards.

### BUG-1503 - Preserve the visual-match lock through compaction

- [x] BUG-1503 - Preserve the visual-match lock through compaction
- Status: Complete 2026-07-11.
- Allowed source: `apps/api/app/graph/prompt_shaping.py`, `apps/api/app/graph/storyboard_trilogy_quality.py`, focused tests, and the selected workflow's Board 2/3 continuation text.
- Guardrails: no public route/port/schema/provider/pricing/dependency changes; no Character/Environment mutation; no other workflow.
- Evidence: compact prompts replace the generic `@image3` description with an exact prior-Panel-06 authority and retain a dedicated one-to-two-second camera/framing/state match lock. Board 2/3 saved briefs specify their exact single-action delta. Full relevant backend target: 177 passed in 105.13s.

### VERIFY-1504 - Run deterministic and zero-paid gates

- [x] VERIFY-1504 - Run deterministic and zero-paid gates
- Status: Complete 2026-07-11.
- Acceptance: focused/full relevant tests pass; exact prompts <=4,200; new deterministic handoff gate passes; backup valid; API/runner healthy; queue empty; one browser run creates no media job; paid preflight estimate is 30 credits / $0.15.
- Evidence: backup `data/backups/media-studio-before-phase15-20260711.db`, SHA-256 `8e94f93a4148c4e2f087f24cea772c0453ff69b565065f388ea30bf902167c67`, `quick_check=ok`; zero-paid run `grun_8d21c7ba504f`; media jobs unchanged at 666; exact replay 3,784/3,927/4,182 characters with all eleven deterministic gates passing; full relevant target 177 passed in 100.70s; saved validation zero errors/warnings; browser preflight 689.6 credits and 30 credits / $0.15.

### PAID-1505 - Run one complete handoff proof

- [x] PAID-1505 - Run one complete handoff proof
- Status: Complete 2026-07-11; the single authorized Phase 15 run was consumed with no retry.
- Authorization: exactly one Board 1-3 paid run, explicitly approved by the user on 2026-07-11. No retry.
- Acceptance: three terminal 2048x1152 outputs, exact accounting, reference order 1/2/3, and original-resolution review of both cross-board frame pairs.
- Evidence: `grun_96397a59122a`; jobs `job_060157400131`, `job_4e4f81264478`, `job_cc2491ec7037`; assets `asset_919583f09e54`, `asset_c5240bd45474`, `asset_9f90738c27b9`; all 2048x1152; credits 689.6 -> 659.6; 30 credits / $0.15.
- Handoff verdict: PASS. Board 1 Panel 6 -> Board 2 Panel 1 and Board 2 Panel 6 -> Board 3 Panel 1 are recognizably the same 50mm eye-level adjacent compositions and mechanical states, with only the requested first small action advancing.

### VERIFY-1506 - Freeze the better trilogy and close Phase 15

- [x] VERIFY-1506 - Freeze the better trilogy and close Phase 15
- Status: Complete 2026-07-11; Phase 12 best remains the final frozen baseline.
- Acceptance: freeze the new same-run trilogy only if it improves the adjacent handoffs without material regression; otherwise restore Phase 12 best. Final graph 17/30, valid, estimate 0, queue empty, documentation complete, no Seedance.
- Evidence: `data/quality-manifests/grun_96397a59122a.json` and `grun_96397a59122a-visual-review.json`. Deterministic gate passes, including D011; visual handoff V007 passes. Overall visual acceptance fails because all sheets say PAGE 1 OF 1, Board 1 omits the numbered panel badges used by Boards 2/3, exposed-midriff wardrobe returns, Bolts becomes humanoid, and the lift frame remains ambiguous.
- Closure: all six Board GPT/Save nodes restored/frozen to `grun_e39207d96114`; Environment and Character unchanged; saved workflow valid with zero errors/warnings; API/runner healthy; queue empty; no retry and no Seedance.

## Phase 16 - Input-driven adjacent-but-distinct proof

### PLAN-1601 / TEST-1602 / BUG-1603 - Lock and implement the generic contract

- [x] PLAN-1601 - Record one-run scope, backup, invariants, and visual acceptance.
- [x] TEST-1602 - Add failing coverage for no footer, generic story shaping, distinct handoff action/shot purpose, speaker/voice attribution, and user-owned appearance cues.
- [x] BUG-1603 - Generalize shared shaping and update Storyboard v2 `2.13` / Continuation `1.8`.
- Evidence: backup `data/backups/media-studio-before-phase16-20260712.db`, SHA-256 `7a240437ede08a096e8f0f04f36b0abdef79db42324524e4ba9d39365fdf3fbe`; full focused target 179 passed.

### VERIFY-1604 / PAID-1605 - Prove deterministically, then run once

- [x] VERIFY-1604 - Zero-credit browser/deterministic proof.
- [x] PAID-1605 - One complete Board 1-3 paid proof.
- Evidence: no-paid `grun_b0b8fc718710`, media jobs unchanged at 669, all 11 deterministic gates pass, prompts 3,190 / 4,137 / 4,100 chars. Paid `grun_d7da4a50b807`; jobs `job_ed8bf461f177`, `job_f0aef5f221fd`, `job_6bb3d65a039d`; assets `asset_0e8ee679bbcb`, `asset_9bbd91cff75d`, `asset_0c5ce89879e3`; 30 credits / $0.15; balance 659.6 -> 629.6.

### VERIFY-1606 - Freeze and record the terminal visual verdict

- [x] VERIFY-1606 - Freeze the Phase 16 outputs and close without retry.
- Pass: identical no-footer 3x2 layout and metadata rows; shared hangar/ship treatment; causal inspection/repair/boarding/launch; Board 1->2 action/camera delta; explicit DROID/PILOT voice attribution.
- Fail: exposed waist persists; Bolts is humanoid rather than feline; Board 2->3 opening remains too visually close. The actual paid deterministic manifest also rejects missing feline/cockpit-lift tokens. Outputs remain available but Phase 16 is not final visual acceptance.
- Closure: six Board GPT/Save nodes frozen to `grun_d7da4a50b807`; estimate 0; queue empty; Character/Environment unchanged; no retry or Seedance.
## Phase 25 - Typed Storyboard Compiler And Deterministic Sheet Renderer

- [x] CONTRACT-2501 - `StoryboardSheetSpec` v1 plus additive zero-cost `storyboard.compile` and `image.storyboard_sheet` contracts are implemented and fail closed on contract/layout/title drift.
- [x] BUILD-2502 - Shared first-board/continuation compiler and art-only prompt serializer are implemented with exact six-panel validation, critical trait preservation, no story hardcoding, and a 4,200-character ceiling.
- [x] BUILD-2503 - Deterministic 2048x1152 Pillow composition supports one equal 3x2 art grid or six ordered images, exact horizontal metadata rows, Unicode punctuation, overflow failure, data-root output, and lineage.
- [x] VERIFY-2504 - 91 focused/regression and 844 full backend tests pass; prior web 758, typecheck, lint, file-size/hygiene, catalog, genericity, duplication, compile, and diff gates remain green.
- [x] GRAPH-2505 - Backed up the live database and migrated only `graphwf_4fd06f50c493` to 23 nodes / 37 edges. Exact Character, Environment, prior-board image/text references and historical caches are unchanged; all provider/save nodes remain Frozen; validation is 0 errors/0 warnings and estimate 0 credits/$0.
- [x] VERIFY-2506 - In-app Browser confirms discovery and one instance of each new lane node, saved reload, zero graph cost, clean console, unchanged 319.62-credit balance, empty queue, and no Run click. Offline latest-artifact composition proves identical three-board chrome with exact Unicode metadata.

## Phase 26 - Distinct Metadata Roles And Paid Compositor Proof

- [x] TEST-2601 - Add generic red coverage for missing ACTION/MOTION/NOTES and exact/near-duplicate narrative rows, including the current Board 1 missing-NOTES family.
- [x] BUG-2602 - Remove cross-field metadata fallbacks and fail closed at compiler, mapping, compaction, and provider-preflight boundaries.
- [x] CONTRACT-2603 - Align both storyboard recipe instructions on distinct ACTION/MOTION/NOTES ownership; refresh through schema 51 with the identical user-owned Panel Notes Cues field.
- [x] VERIFY-2604 - Pass focused/affected/full tests, exact generic replay, migration, genericity, compilation, diff, backup, health, and zero-credit browser gates.
- [x] PAID-2605 - Execute exactly one user-authorized three-board compositor proof; completed as `grun_26f886636aea` for 30 credits / $0.15 with no retry.
- [x] VERIFY-2606 - Inspect all three originals and exact specs, record accounting/acceptance, refreeze the six storyboard GPT/Save nodes, save the workflow, and verify an empty queue/zero estimate.
- [x] BUG-2607 - Prevent the art-only compiler from joining a truncated narrative clause directly to the next user-owned field; exact replay remains below 4,200 characters.
- [x] VERIFY-2608 - Pass 39 focused compiler tests and the complete release gate: 863 backend / 758 web plus lint, typecheck, build, genericity, schema, file-size, and diff checks.
- [ ] BUG-2610 - Correct Graph Run History cost presentation so externally billed KIE runs do not display `$0.00` when the balance and provider jobs show paid usage.
- [ ] PAID-2611 - Optional separately authorized post-BUG-2607 visual trilogy for stricter cat anatomy, cockpit-lift staging, Board 1 establishing scale, and sealed exterior state. No authorization exists.

Guardrails: preserve the selected Character, Environment, story inputs, 23-node/37-edge topology, reference order, provider/model/pricing settings, and unrelated dirty changes. Shared code and recipe text remain campaign-agnostic. The PAID-2605 authorization is consumed; no further paid run is authorized.

## Phase 27 - Legacy Layout Fidelity And Compact Metadata Correction

- [x] TEST-2701 - Add exact red regressions for metadata occupying more than one-third of a panel, wide-frame geometry drift, missing safe-frame art direction, and action losing priority to camera/notes.
- [x] BUG-2702 - Restore compact older-board proportions; generate a 4:3 row-major 2x3 source grid whose wide cells reflow into the final 3x2 sheet; preserve typed metadata, story ownership, topology, references, provider settings, and one-image-per-board cost.
- [x] VERIFY-2703 - Pass focused tests, exact three-board prompt replay, genericity, graph validation, compilation, diff, health, backup, and zero-credit in-app Browser preflight.
- [x] PAID-2704 - Terminal partial attempt `grun_b8c24c36819a`: Board 1 completed for 10 credits / $0.05; Board 2 was canceled and refunded after the provider exposed a 2x3 source-grid behavior; Board 3 was never submitted. No retry occurred.
- [x] VERIFY-2705 - Reflow and inspect the accepted paid Board 1 source as `asset_graph_c75aa12f04307fd5b67c25bf`; old-layout fidelity, wide action imagery, compact exact metadata, Environment, character, and closed-panel story state pass. Full trilogy signoff remains withheld because Boards 2-3 have no post-fix paid output.
- [ ] PAID-2706 - Optional separately authorized continuation proof: reuse accepted Board 1 and generate only Boards 2-3, estimated 20 credits / $0.10. Environment and Board 1 remain Frozen; no retry is implied.
- [ ] VERIFY-2707 - Inspect Boards 2-3 and the complete trilogy together, verify both handoffs and story/character/Environment continuity, then issue final visual signoff only if all gates pass.

Guardrails: Phase 26 assets remain immutable evidence. Preserve the selected Character sheet even if it retains known wardrobe bias. Do not modify another workflow, add a public port/schema/dependency, regenerate Environment, enable Seedance, or submit PAID-2706 without fresh authorization.

## Phase 28 - Reference Layout Fidelity And Cache Compatibility

- [x] AUDIT-2801 - Inspect `asset_338f93c9c12b`, its exact submitted prompt, and the three currently displayed sheets. Confirm that Board 1 is current art-only input while Boards 2-3 are historical complete sheets being resliced as art.
- [x] TEST-2802 - Added red-to-green regressions for one visible SHOT heading, five metadata rows, compact inline header geometry, reclaimed image height/readable fonts, deterministic consecutive renders, and incompatible complete-sheet source rejection.
- [x] LAYOUT-2803 - Implemented deterministic layout v3 using the approved dark/amber condensed design, panel SHOT heading above the image, and CAMERA/ACTION/MOTION/DIALOG/NOTES below it.
- [x] GUARD-2804 - A one-image cached provider asset must prove the current art-only 4:3/2x3 contract through its prompt or explicit contract-plus-grid lineage. Six ordered images and manual reference-media grids remain supported.
- [x] VERIFY-2805 - Passed 111 focused tests, 871 full backend tests, original-resolution offline trilogy proof, exact 3,411/3,661/4,094-character prompt replay, genericity, compilation, catalog refresh, deterministic rerender comparison, and `git diff --check`.
- [x] BROWSER-2806 - Backed up the database and ran zero-credit `grun_be172e6a307c`: Board 1 renders layout v3; the historical Board 2 complete sheet fails closed; Board 3 skips upstream; balance and media-job count remain unchanged.
- [ ] PAID-2807 - Optional separately authorized same-contract Board 1-3 generation after every no-paid gate passes. No authorization exists.
- [ ] VERIFY-2808 - Inspect all three raw art sources and composed sheets together, then sign off only if layout, typography, metadata, cinematic action, character, Environment, story progression, and handoffs pass.

Guardrails: preserve every historical asset and prompt, selected Character, Environment, user story inputs, reference order, 23-node/37-edge topology, provider/model/pricing, and unrelated changes. No OCR/content guess, campaign-specific asset id, public port/schema/dependency, or paid submission is allowed in Phase 28 implementation.

## Phase 29 - Historical Design Fidelity And Concise Metadata

- [x] AUDIT-2901 - Compare `asset_338f93c9c12b` and layout v3 at original resolution in the in-app Browser; identify geometry, typography, header, row-density, and prompt-contract causes; create the required pre-implementation campaign code review under `docs/reviews/20260716_220119/`.
- [x] TEST-2902 - Added red-to-green coverage for historical hierarchy, one SHOT heading, five visible rows, minimum type, image-first proportions, bounded complete metadata, inline/multiline/compact recipe forms, and false-positive semantic clauses.
- [x] CONTRACT-2903 - Storyboard v2 `2.24` and Continuation `1.19` share one generic output/display contract. Six fields remain typed; SHOT is heading-only; generated display fields are bounded; exact user-owned DIALOG/NOTES remain protected.
- [x] LAYOUT-2904 - Layout v4 restores the thin amber frame, unified inline header, strong condensed headings, near-black five-row metadata, and image-first 3x2 proportions. Final SHOT headings are deterministically closed at complete boundaries.
- [x] VERIFY-2905 - Offline final proof `tmp/phase29-proof/board-1-layout-v4-final.png`, focused regressions, genericity, compilation, and diff checks pass. Full-suite result is recorded in `VERIFICATION_LOG.md`.
- [x] REVIEW-2906 - Campaign post-change delta `docs/reviews/20260716_220119/10_implementation_delta_review.md` closes all three pre-review medium findings with no open medium-or-higher issue.
- [x] BROWSER-2907 - Frozen in-app Browser proof `grun_0c441e491fd6` passes all recipes/compilers and Board 1 layout v4, then intentionally rejects the incompatible historical Board 2 complete-sheet cache. Balance remains 279.6 and graph estimate remains approximately 0 credits / $0.
- [ ] PAID-2908 - Optional separately authorized same-contract Board 1-3 visual proof. Not authorized in this phase; do not submit a provider job.

Guardrails: historical assets/prompts are immutable evidence. Preserve Character, Environment, story inputs, graph topology, reference order, provider/model/pricing, Frozen states, unrelated dirty files, and the user's open unsaved workflows. Shared code must contain no current-story names, asset IDs, dialogue, ship/hangar/cat/droid nouns, or campaign-specific repair branches.

## Phase 30 - Glyph-safe metadata and final paid trilogy proof

- [x] TEST-3001 - Reproduce the wrapped-row clipping at the public compositor seam with a pixel-level glyph-clearance assertion.
- [x] FIX-3002 - Center actual multi-line glyph bounds without changing layout v4 geometry, fonts, image rectangles, recipe contracts, or graph topology.
- [x] VERIFY-3003 - Passed 129 focused tests and 896 full backend tests; genericity, compilation, and diff checks pass. `tmp/phase30-proof/board-1-glyph-safe.png` is clean at original resolution and its six art rectangles are pixel-identical to the pre-fix sheet.
- [x] BROWSER-3004 - Media Studio was healthy and queue-empty; browser preflight confirmed the intended references/story, only three storyboard models enabled, Environment Frozen, 279.6 credits, and an authoritative ≈30-credit / $0.15 estimate. `grun_6c19e98fb442` then stopped before provider submission on an art-only/finished-sheet preflight routing defect; media jobs and credits remained unchanged.
- [x] PAID-3005 - Executed exactly one authorized Board 1-3 trilogy as `grun_c14f1f0b747a`: `job_003f5c129f7b`, `job_aa86b0cde9b4`, and `job_2263a662aadd`. Balance moved 279.6 -> 249.6, exactly 30 credits / $0.15; no retry occurred.
- [x] VERIFY-3006 - Inspected all three raw sources and final composed originals. Identical 2048x1152 geometry passes and every non-empty metadata value has 4-13 px lower-row clearance, closing the clipping defect. Environment, pilot/wardrobe, causal progression, both handoffs, cinematic treatment, dialogue, and launch pass. Strict global signoff remains withheld because Board 2 Panel 2 repeats CAMERA wording and Board 3 renders Bolts with an upright human-shaped body rather than compact four-legged feline anatomy.
- [x] BUG-3007 - Route typed, explicitly text-free `storyboard_art_grid_v1` prompts around finished-sheet row validation while retaining strict validation for visible sheet prompts. Exact failed-prompt replay now returns no sheet preflight; 130 focused tests pass.
- [x] VERIFY-3008 - Exact failed-prompt replay, 130 focused tests, compilation, genericity/diff checks, and a clean complete backend rerun at 897/897 pass. The unrelated order-sensitive Media Assistant test failed once in an intermediate run, passed alone, and passed in the clean full rerun. Browser remains Frozen at ≈0 / $0 with 279.6 credits and a healthy 0/0 queue.
- [x] BUG-3009 - Update the trilogy quality audit to treat typed `StoryboardSheetSpec` plus text-free provider art as the authoritative architecture. Legacy full-sheet prompt auditing remains supported; typed audits validate all six panels, one shared layout contract, the reference chain, and adjacent action/camera deltas.
- [x] VERIFY-3010 - Added red-to-green typed-art audit coverage; 7 focused quality-audit tests, 101 affected storyboard tests, and the complete backend suite at 898/898 pass. `data/quality-manifests/grun_c14f1f0b747a.json` passes D001-D004/D010-D011 and records the strict visual exceptions.
- [x] BUG-3011 - Phase 31 removes equivalent repeated CAMERA-contract clauses at the typed boundary and strengthens the user-owned compact four-legged feline anatomy cue. Neutral regression and paid visual proof pass.
- [ ] BUG-3012 - Investigate Graph Studio preview hydration when a completed compositor output exists in `graph_run_nodes`/`reference_media` but the node still says `No preview yet`. Phase 30 Board 3 output `ref_16628910c88b` exists at 2048x1152 and was inspected directly; this is a UI evidence-display defect, not a missing paid artifact.

Guardrails: preserve historical assets, selected Character, Environment, story fields, 23-node/37-edge topology, reference order, provider/model/pricing, and unrelated dirty files. Environment and non-storyboard paid nodes remain Frozen. Phase 30 authorization was consumed by `grun_c14f1f0b747a`; it permits no retry. Phase 31 has a separate one-trilogy authorization under PAID-3107.

## Phase 31 - Antialiased metadata clearance and saved final trilogy

- [x] TEST-3101 - Reproduce the actual Phase 30 defect by scanning all antialiased text pixels. Thirty rows wrap; 18 reach only one pixel above the lower rule and reproduce the visibly shaved second line.
- [x] FIX-3102 - Require three-pixel lower-rule clearance at the renderer fit boundary. Preserve 15px single-line text and use the existing 14px floor only for wrapped values that cannot satisfy the clearance.
- [x] TEST-3103 - Add a neutral typed-spec regression for a repeated full CAMERA contract after subject framing.
- [x] FIX-3104 - Remove only a repeated equivalent CAMERA-contract clause while preserving framing/subject placement.
- [x] VERIFY-3105 - Offline rerender of all three Phase 30 art sources passes enlarged visual inspection: 15 wrapped rows remain, minimum antialiased lower clearance is 3px, all semantic endings are complete, and Board 2's repeated CAMERA clause is gone.
- [x] BROWSER-3106 - Backup integrity passed; API/runner/queue were healthy; browser balance was 249.6 and the authoritative estimate was exactly 30 credits / $0.15 with Boards 1-3 enabled.
- [x] PAID-3107 - Three successful provider jobs completed within the exact 30-credit ceiling: Board 1 `job_03628ebae938`, Board 2 `job_a8240e7aa90c`, Board 3 `job_781f42c08b0d`. Board 2 local recipe timeout and one Board 3 provider-policy rejection were recovered without regenerating a successful board; the rejection consumed 0 credits. Balance 249.6 -> 219.6.
- [x] BUG-3109 - Convert provider-bound visual context to affirmative directions. Red-to-green coverage proves positive traits survive while negative identity/body exclusions are removed. Exact Board 3 outgoing prompt excludes the policy-trigger terms and the paid image completes.
- [x] VERIFY-3108 - Original-resolution visual review and exact pixel audit pass all three sheets: 15 wrapped rows, 3px minimum glyph-to-rule clearance, zero failures, identical 2048x1152 layout/fonts/chrome, complete metadata, cinematic causal progression, coherent character/environment, and compact feline cyborg Bolts. All three 2048x1536 raw assets and three sheets are saved to Sadi; paid nodes are refrozen at ≈0 credits / $0. Final backend verification passes 900/900 in 264.06s; compilation, genericity, integrity, and diff checks pass.
- [x] BUG-3110 - Fixed the no-paid Graph Studio cache-hydration defect: a trustworthy completed node now refreshes its reusable cache from artifacts belonging to the same run/node/output ports, so freezing it after a later node fails pins the newest completed output. Failed, empty, partial, and mismatched artifact states preserve the prior known-good cache. Public hydration-to-freeze-to-serialization coverage, focused lifecycle tests, full 900-backend/762-web gates, production build, and zero-credit in-app Browser smoke pass; signed-off storyboard assets remain unchanged.

Guardrails: no layout/schema/recipe/provider/pricing/topology change; no Character or Environment replacement; no shared story hardcoding; no Seedance. Stop before submission if the estimate is not exactly 30 credits / $0.15, the queue is unhealthy, any Save branch is not enabled, or any prompt/spec gate fails.

## Phase 32 - Post-BUG-3110 full trilogy confirmation

- [x] PAID-3201 - Terminal partial `grun_e2afaa39b574`. Browser preflight passed with queue 0/0, integrity `ok`, all three Save branches enabled, and exact 30-credit / $0.15 estimate. Board 1 `job_e795f18b3f4f` / `asset_677de9a66248` and Board 2 `job_a86146618b44` / `asset_cc82aca40ca8` completed. Board 3 `job_9641977d3661` failed with provider `Internal Error, Please try again later.` Balance 219.6 -> 199.6, exactly 20 credits / $0.10; no retry or duplicate submission.
- [x] VERIFY-3202 - Partial evidence reviewed at original resolution. Saved sheets `asset_graph_1e903703e74422d26657f56d` and `asset_graph_e9e02eb7d91cf74f0f31ea3d` have identical 2048x1152 layout/fonts/chrome/metadata geometry, complete rows, coherent covered pilot and Environment, causal loading/inspection/repair progression, and a passing Board 1 -> 2 handoff. Actual requests prove ordered Character/Environment/prior-board references for all three submissions. Full trilogy/Bolts/Board 2 -> 3 signoff is withheld because Board 3 produced no asset. All paid branches are refrozen; estimate is approximately 0 credits / $0; queue is empty; focused tests pass 110/110 plus genericity/integrity/diff checks.
- [x] PAID-3203 - Fresh authorization was consumed once by Board 3-only run `grun_3e468f355396`. Exact 10-credit / $0.05 preflight passed with Character, Environment, and accepted PAID-3201 Board 2 raw art in order; Boards 1-2 stayed Frozen. `job_978911d388e6` produced raw `asset_06af0960023d`, the compositor produced `ref_a101ca1c93b1`, and Save created `asset_graph_cc5b59dd67dc246f10a1fa64`. Balance 199.6 -> 189.6; no retry or duplicate submission.
- [x] VERIFY-3204 - Terminal original-resolution review completed. The trilogy passes identical layout v4 chrome/fonts/geometry, readable rows, character/Environment continuity, both adjacent-but-advanced handoffs, boarding, compact feline cyborg Bolts, two secured occupants, and final departure. Strict full-trilogy signoff is withheld because Board 3 Panel 5 depicts a second matching ship outside the occupied cockpit instead of an unambiguous lift of the current ship. The output remains saved evidence; all nine storyboard art/compositor/Save nodes are Frozen, estimate is approximately 0 credits / $0, queue is empty, integrity is `ok`, and no retry is authorized.

Guardrails: no Character or Environment replacement; no recipe/layout/schema/topology/provider/model/pricing changes; no story hardcoding; no Seedance; preserve all Phase 31 and Phase 32 assets. PAID-3201 and PAID-3203 authorizations are consumed. Any further provider run requires fresh authorization and must not regenerate accepted boards implicitly.
