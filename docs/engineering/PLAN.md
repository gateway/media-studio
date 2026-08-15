# Storyboard Multi-Board Continuity Plan

Last updated: 2026-07-10
Source spec: [SPEC.md](SPEC.md)
Task checklist: [TASKS.md](TASKS.md)

## Phase 0 - Safety Harness And Baseline

Goal: freeze the current behavior and make every later change measurable without spending credits.

- Capture the active `Sadis Adventures` workflow's exact nodes, edges, reference order, latest run IDs, and prior media.
- Add or confirm characterization tests for dependency scheduling, carried-forward media, resolved run inputs, prompt budgets, and negative prompt contamination.
- Add a deterministic three-board workflow fixture expressing the desired typed reference and handoff graph.
- Start the API/web only for browser verification; confirm Graph Studio loads through the in-app browser.

Exit criteria: failing tests reproduce missing environment-to-recipe wiring, absent previous-image continuity, or contamination; the browser baseline is recorded; no paid job runs.

Tasks: [TEST-001](TASKS.md#test-001---capture-a-durable-baseline), [TEST-002](TASKS.md#test-002---add-contract-first-regression-tests), [TEST-003](TASKS.md#test-003---establish-browser-baseline)

## Phase 1 - Recipe Continuity Contract

Goal: make Storyboard v2 and Storyboard Continuation v1 explicit about reference roles, layout lock, private handoff state, and clean visible metadata.

- Declare only the typed roles each recipe consumes.
- Define exact `@imageN` semantics for first and continuation boards.
- Make the continuation recipe preserve the previous layout/state while prioritizing the next scene brief.
- Keep one stable board layout and neutral visible labels across all boards.

Exit criteria: seed tests prove the contract, generated prompt-only outputs use the exact reference map, and unrelated recipe behavior is unchanged.

Tasks: [BUG-101](TASKS.md#bug-101---harden-storyboard-recipe-reference-and-layout-contracts)

## Phase 2 - Graph Builder And Dependency Wiring

Goal: make the Media Assistant construct the canonical environment plus three-storyboard graph correctly on the first attempt.

- Character -> every recipe `character_ref`; character -> every GPT model first image reference.
- Saved environment -> every recipe `environment_ref`; saved environment -> every GPT model second image reference.
- Prior prompt -> next recipe handoff field.
- Prior board image -> next recipe `additional_refs` and next GPT model third image reference.
- Preserve dependency order through edges; do not add imperative sleeps or node-title ordering.

Exit criteria: graph-plan tests assert exact nodes, ports, edge order, and dependency chain; the selected workflow can be repaired without rewriting unrelated workflows.

Tasks: [BUG-201](TASKS.md#bug-201---wire-environment-and-visual-handoffs-in-storyboard-graph-plans), [BUG-202](TASKS.md#bug-202---repair-the-selected-sadis-adventures-workflow)

## Phase 3 - Provider Prompt Shaping

Goal: submit concise, story-specific prompts that preserve continuity and never import unrelated state-machine instructions.

- Separate environment, generic storyboard, and time-freeze shaping decisions.
- Preserve role map, stable layout contract, panel metadata labels, causal beats, and final handoff under compaction.
- Remove model/provider names and private IDs from visible-text requests.
- Record original/submitted prompt lengths and shaping strategy in run details.

Exit criteria: all prompt fixtures are <= 4,200 target characters, below the 20,000 hard limit, semantically complete, and contamination-free.

Tasks: [BUG-301](TASKS.md#bug-301---make-storyboard-prompt-compaction-role-aware-and-contamination-free)

## Phase 4 - No-Paid Browser Verification

Goal: prove the real UI and runtime contract before image generation.

- Use `browser:control-in-app-browser`; do not substitute standalone Playwright.
- Verify typed ports and exact wires on `Sadis Adventures`.
- Keep GPT nodes disabled/muted and run prompt-only through all recipes/display nodes.
- Inspect all three effective prompts for story progression, layout identity, environment lock, neutral labels, reference map, and prompt size.
- Verify old previews remain visible until a new successful output replaces them.

Exit criteria: browser evidence passes every no-paid acceptance check and no provider image/video job is submitted.

Tasks: [VERIFY-401](TASKS.md#verify-401---browser-verify-the-prompt-only-three-board-workflow), [VERIFY-402](TASKS.md#verify-402---browser-verify-preview-retention-and-muted-states)

## Phase 5 - Paid Image Proof And Review

Goal: generate the environment and three boards once, then review all outputs against a written rubric.

- Obtain explicit action-time paid-run approval.
- Keep Seedance muted and verify it does not submit.
- Run Environment -> Board 1 -> Board 2 -> Board 3.
- Confirm each completed image surfaces before its dependent board starts.
- Review all four images side by side for character, environment, layout, story, metadata, and forbidden-text defects.

Exit criteria: one completed run with four expected image assets, no Seedance job, no stale/cleared previews, and a documented pass/fail matrix. Any second paid run requires a new approval.

Tasks: [PAID-501](TASKS.md#paid-501---run-one-approved-paid-image-proof), [VERIFY-502](TASKS.md#verify-502---review-all-paid-outputs-and-record-the-result)

## Phase 6 - CELL fidelity and safety hardening

Goal: repair the deterministic prompt-loss and framing risks observed in the first paid proof without spending credits.

- Add exact live-format `CELL NN` fixtures.
- Preserve ordered actions, dialogue, notes, and final handoffs during bounded shaping.
- Enforce covered wardrobe and neutral non-sexual production framing at the submission boundary.
- Complete a no-paid browser proof with every paid node muted.

Exit criteria: BUG-501 regression and full Graph Studio targets pass; captured paid prompts replay under budget with all required beats; no-paid browser proof completes with no media job.

Tasks: [BUG-501](TASKS.md#bug-501---preserve-cell-storyboard-beats-and-policy-safe-visual-handoffs)

## Phase 7 - Hangar-to-launch story proof

Goal: generate and review one new environment plus three-board story while proving environment and recipe-owned layout consistency.

1. Lock the three-board segmentation, the meaning of production-note metadata, the two-zone environment sheet, exact reference roles, review rubric, paid boundary, and failure behavior.
2. Back up the database and prepare only `graphwf_4fd06f50c493`. Prefer Media Assistant if it can express the exact existing-node field changes without graph drift; otherwise edit the current nodes in Graph Studio. Do not add a new public port or mutate another workflow.
3. Keep all eight paid image/save nodes muted. Run the full graph in the in-app Browser and inspect all four prompt previews plus compiled run inputs for story beats, environment terms, typed reference roles, 3x2 layout/production-note instructions, safety language, contamination, and <=4,200-character shaped prompts.
4. Confirm the graph is 17 nodes / 30 edges, valid, queue-empty, Seedance-free, backed up, and priced. Record credits and the exact four-image estimate.
5. Unmute exactly four GPT Image 2 and four Save Image nodes through the in-app Browser and start one run. Watch dependency order and terminal state; never click Run twice.
6. Inspect the new environment and every available board at full resolution. Score the Phase 7 rubric, diagnose failures from raw/shaped/submitted prompt evidence and reference snapshots, then remute all paid/save nodes regardless of result.
7. Update work state, decisions, verification evidence, handoff, and changelog. Stop before any additional paid run.

Exit criteria: the single approved run is terminal, all available outputs are reviewed with evidence, paid nodes are remuted, and any failure has a bounded root cause and next task rather than an automatic retry.

Tasks: [STORY-701](TASKS.md#story-701---lock-the-new-story-layout-and-environment-contract), [GRAPH-702](TASKS.md#graph-702---prepare-the-selected-workflow), [VERIFY-703](TASKS.md#verify-703---run-the-no-paid-browser-gate), [PAID-704](TASKS.md#paid-704---run-one-approved-four-image-proof), [VERIFY-705](TASKS.md#verify-705---review-and-close-the-paid-proof)

## Phase 8 - Reference-safety and moderation hardening (terminal)

Goal: remove the observed conflict between the covered neutral provider prompt and the exposed/private-text character reference before any later storyboard proof.

1. Completed: searched existing Media Studio references/assets and selected neutral same-identity `ref_3c38d161cdc3` without generating a new sheet.
2. Completed: replaced only the selected workflow's Character reference, preserved 17 nodes / 30 edges, froze the successful Environment, and completed no-paid prompt/reference audits.
3. Completed: used the user's new action-time approval for one three-board paid attempt, PAID-713. Board 1 was rejected; Boards 2/3 did not submit.
4. Completed: hardened the exact failed paid format through BUG-714 and returned every paid surface to safe state.

Tasks: [BUG-712](TASKS.md#bug-712---replace-the-policy-fragile-character-reference), [PAID-713](TASKS.md#paid-713---run-one-newly-approved-three-board-proof), [BUG-714](TASKS.md#bug-714---preserve-paid-spatial-panels-and-use-positive-only-coverage-framing)

## Phase 9 - Browser state repair and terminal Board 1 proof complete

Goal: make the real Graph Studio mutation/run surface preserve selected media and explicit frozen caches, then prove the positive-only Board 1 boundary with the smallest separately approved provider action.

1. Completed: implemented BUG-715 no-paid with scoped Character replacement, frozen-cache hydration/serialization, focused tests, and resolved review findings.
2. Completed: reopened `Sadis Adventures` and confirmed 17/30, Character reference 1, successful Environment reference 2, frozen cache ID, and a zero-credit browser run.
3. Completed: replayed the latest raw Board 1 through current shaping and confirmed six panels/seven rows, exact story beats, ordered refs, <=4,200 chars, and positive-only workwear/framing language.
4. Completed: received fresh action-time approval plus an explicit instruction to keep the browser-attached Character sheet.
5. Completed: enabled Board 1 GPT/Save only and ran one 10-credit / $0.05 proof. `asset_d9d0ccdff7fd` generated successfully.
6. Completed/terminal: reviewed the result, recorded layout/environment/story passes and metadata/wardrobe/final-handoff failures, left Boards 2/3 muted, and froze the successful Board 1 output.

Tasks: [BUG-715](TASKS.md#bug-715---repair-character-replace-and-frozen-cache-browser-hydration), [PAID-716](TASKS.md#paid-716---run-one-approved-board-1-only-proof), [VERIFY-717](TASKS.md#verify-717---review-board-1-and-close-phase-9)

## Phase 10 - No-paid storyboard fidelity remediation (complete)

Goal: make the accepted Board 1 provider prompt a trustworthy layout/story handoff without changing the user's Character asset or spending credits.

1. Completed TEST-1001: reproduced Phase 9 word fragments, negated `capacitor` leakage, missing closed-panel/amber/latch state, and weak identity-versus-wardrobe authority at the public prompt-shaping seam.
2. Completed BUG-1002: the existing limiter now shortens natural-language values only at punctuation or whitespace boundaries.
3. Completed BUG-1003: negated/future clauses are removed before generic state-term extraction while positive closed-panel, amber-indicator, and hand-near-latch state remains.
4. Completed BUG-1004: `@image1` owns identity/cyborg construction; the prompt owns one continuous enclosed cream/red flight-mechanic coverall.
5. Completed VERIFY-1005: exact Phase 9 replay, focused/full backend gates, duplication/patch hygiene, saved validation, and real Graph Studio inspection passed within the documented file-size exception.
6. Stop before Phase 11. Do not enable or submit Board 1, Board 2, Board 3, Environment, Seedance, or any other provider node.

Tasks: [TEST-1001](TASKS.md#test-1001---characterize-the-accepted-board-1-fidelity-failures), [BUG-1002](TASKS.md#bug-1002---make-storyboard-metadata-truncation-whole-word-safe), [BUG-1003](TASKS.md#bug-1003---isolate-board-1-state-from-negated-and-future-beats), [BUG-1004](TASKS.md#bug-1004---separate-retained-sheet-identity-from-prompt-owned-wardrobe), [VERIFY-1005](TASKS.md#verify-1005---run-the-no-paid-phase-10-gate)

## Phase 11 - Sequential paid trilogy proof

Goal: finish one accepted three-board story with consistent layout, identity, environment, metadata, and causal frame-to-frame progression within five paid attempts.

1. Preflight and back up the selected workflow. Keep Character and Environment unchanged; keep Seedance absent.
2. Enable only Board 1 GPT/Save, submit one run, and visually inspect the full-resolution sheet. Freeze it only if every Board 1 acceptance item passes.
3. Enable only Board 2 GPT/Save with accepted Board 1 as reference 3. Submit, inspect, and freeze only on acceptance.
4. Enable only Board 3 GPT/Save with accepted Board 2 as reference 3. Submit, inspect, and freeze only on acceptance.
5. If a board fails, diagnose from its raw, shaped, submitted, reference, and image evidence. Apply one bounded fix, revalidate, and retry without exceeding five total Phase 11 runs. Any changed upstream board invalidates dependent downstream outputs.
6. Browser-verify the final saved/reloaded 17/30 graph and compare all three accepted sheets as one story. Stop early once the chain passes.

Tasks: [PLAN-1101](TASKS.md#plan-1101---lock-the-five-attempt-budget-and-acceptance-rubric), [PAID-1102](TASKS.md#paid-1102---execute-the-bounded-sequential-proof-loop), [VERIFY-1103](TASKS.md#verify-1103---sign-off-the-accepted-board-1---board-2---board-3-chain)

## Phase 12 - Full-trilogy cinematic quality gate

Goal: produce several complete three-board alternatives and freeze the strongest trilogy, with exact full-sheet layout parity, photoreal cinematic movie-still panels, visibly authoritative Environment continuity, and uninterrupted cell-to-cell story progression.

1. Preserve and document the Phase 11 trilogy. Back up the database and isolate all mutations to `graphwf_4fd06f50c493` plus the bounded storyboard prompt-shaping seam.
2. Add failing fixtures for complete sheet chrome, live-action cinematic still language, dominant Environment authority, bare/distant Board 1 approach staging, and one clearly mechanical secured cyborg cat.
3. Harden the shared compact storyboard contract and the three saved story briefs without changing provider models, public ports, schemas, pricing, Character media, or Environment media.
4. Keep all three paid board pairs muted and the Environment frozen. Run the browser no-paid prompt gate; replay all three exact prompts through the current shaper; require <=4,200 characters, six complete metadata sets, exact layout tokens, ordered references, story/handoff terms, and no placeholder/control leakage.
5. Enable all three board GPT/Save pairs for one full run at an authoritative estimate of about 30 credits / $0.15. Inspect all three original-resolution assets before deciding whether to refine.
6. Repeat the complete-trilogy loop up to six paid runs total. Each refinement must name visible evidence and preserve earlier assets. Do not spend merely to consume the ceiling.
7. Compare every complete attempt, freeze the best Board 1/2/3 trio from one internally consistent run, return the graph estimate to zero, verify browser reload/health/queue, and close the phase with a scored contact sheet or asset index.

Exit criteria: one best complete trilogy is frozen; multiple new full sets remain available for user review; all three selected sheets share complete layout chrome; panels read as cinematic movie stills; Environment continuity is visibly demonstrable; story and handoffs progress across all eighteen cells; queue is empty; no Seedance; paid-run count is at most six.

Tasks: [PLAN-1201](TASKS.md#plan-1201---lock-the-full-trilogy-quality-gate), [BUG-1202](TASKS.md#bug-1202---harden-layout-cinematic-and-environment-authority), [VERIFY-1203](TASKS.md#verify-1203---run-the-zero-cost-full-trilogy-preflight), [PAID-1204](TASKS.md#paid-1204---execute-up-to-six-complete-trilogy-attempts), [VERIFY-1205](TASKS.md#verify-1205---freeze-and-sign-off-the-best-complete-trilogy)

## Phase 13 - Durable acceptance, one paid proof, and subsystem review

Goal: make trilogy signoff repeatable, prove it with one complete paid run, then produce an evidence-led cleanup backlog for Recipes, Presets, and Media Assistant.

1. Document SPEC-025 and the one-run boundary; back up the database and preserve the frozen Phase 12 trilogy.
2. Implement one pure trilogy-quality owner plus a CLI manifest generator; add focused tests for scorecard schema, prompt/reference checks, handoffs, reveal order, lift lock, and manifest evidence.
3. Run focused/full deterministic gates and audit the frozen Phase 12 best run at zero provider cost.
4. Through the in-app Browser, enable exactly the three storyboard GPT/Save pairs, verify the 30-credit estimate, run once, and inspect all three originals. Finalize the manifest and freeze the accepted trilogy or restore the prior best if the new set fails.
5. Run Uber Code Review read-only across Prompt Recipes, Media Presets, and Media Assistant entrypoints, persistence, validation, graph planning, provider boundaries, tests, duplication, and legacy paths. Write one timestamped report with `CR-*`, `DUP-*`, `LEG-*`, and `TASK-*` records.
6. Update engineering state, verification evidence, and changelog; leave Media Studio healthy, queue-empty, Seedance-free, and at zero estimated cost.

Exit criteria: deterministic audit passes; one and only one Phase 13 paid trilogy is terminal and visually reviewed; one trilogy is frozen; manifest is durable; review report and remediation tasks exist; no unresolved run or queue state remains.

Tasks: [PLAN-1301](TASKS.md#plan-1301---lock-phase-13-acceptance-and-review-scope), [BUILD-1302](TASKS.md#build-1302---add-trilogy-scorecard-checks-and-manifest), [VERIFY-1303](TASKS.md#verify-1303---run-deterministic-and-zero-cost-audit), [PAID-1304](TASKS.md#paid-1304---run-one-complete-trilogy-proof), [REVIEW-1305](TASKS.md#review-1305---audit-recipes-presets-and-media-assistant), [VERIFY-1306](TASKS.md#verify-1306---freeze-and-close-phase-13)

## Phase 15 - Adjacent-board visual handoff proof

Goal: make each next board open as the visually adjacent take to the prior board's final panel, then verify the rule with one bounded complete paid trilogy.

1. Preserve the frozen Phase 12 best trilogy and back up the database.
2. Add a deterministic handoff gate and a compact provider-facing match lock without changing public contracts.
3. Tighten only Board 2/3 continuation briefs so the first panel changes one small action from the previous final frame.
4. Run focused/full prompt tests, exact replay, health/queue checks, saved validation, and a zero-paid browser run with all six board GPT/Save nodes muted.
5. Enable exactly the three board GPT/Save pairs, confirm the 30-credit estimate and ordered references, and run once through the in-app Browser.
6. Inspect all three originals, score both adjacent-board pairs, and freeze the new same-run trilogy only if it is better overall; otherwise restore the Phase 12 best.

Exit criteria: one paid run is terminal; both handoffs are visually compared; the better complete trilogy is frozen; estimate returns to zero; queue is empty; no retry and no Seedance.

Tasks: PLAN-1501, TEST-1502, BUG-1503, VERIFY-1504, PAID-1505, VERIFY-1506.

## Phase 16 - Input-driven adjacent-but-distinct handoff proof

Goal: remove shared campaign hardcoding and footer chrome, preserve user-owned speaker/voice and appearance cues, and verify one complete trilogy.

1. Back up the database and characterize footer, story-leakage, handoff-delta, and speaker-attribution behavior.
2. Generalize the storyboard compactor and bump the two built-in storyboard recipe contracts without changing routes, schemas, ports, pricing, dependencies, Character, Environment, or another workflow.
3. Update only `graphwf_4fd06f50c493` with user-authored handoff/dialogue cues; run the full focused backend target and a zero-credit browser chain.
4. Enable exactly the three Board GPT/Save pairs, confirm 30 credits / $0.15, and run once through the in-app Browser.
5. Inspect all three originals together, freeze the outputs, restore a zero-cost graph, and record both passes and failures without retrying.

Exit criteria: the single paid run is terminal; no-footer/layout, environment, dialogue attribution, and both handoffs are reviewed; all paid outputs are frozen; queue is empty; no retry or Seedance.

Tasks: PLAN-1601, TEST-1602, BUG-1603, VERIFY-1604, PAID-1605, VERIFY-1606.

## Sequencing Notes

- First safe task: TEST-001.
- Tests-first tasks: TEST-002, BUG-101, BUG-201, BUG-301.
- Human confirmation required: BUG-202 if it mutates the saved workflow; PAID-501 immediately before submission.
- Phase 7 authorization: the current user request authorizes only PAID-704 after VERIFY-703 passes; a retry or later paid run still requires new confirmation.
- Phase 7 closure: PAID-704 was consumed and failed at Board 1 after Environment succeeded.
- Phase 8 closure: BUG-712 and BUG-714 completed; PAID-713 was consumed and failed at Board 1 without charge. No additional provider run is implied.
- Phase 9 closure: PAID-716 consumed one 10-credit Board 1 proof. VERIFY-717 found material visual gaps, so Boards 2/3 were not run and any further provider action needs fresh approval.
- Phase 10 closure: TEST-1001 through VERIFY-1005 complete.
- Phase 11 authorization: up to five paid Graph Studio runs total, used sequentially and stopped early on acceptance; Character and Environment remain unchanged; no Seedance.
- Intentionally deferred: dedicated `storyboard_ref` port, automatic migration of all saved workflows, Seedance generation, broad recipe cleanup.
- Runtime scheduling code is not a default edit target. Existing dependency-aware priority behavior should be characterized first and changed only if a failing test proves it violates [SPEC-001](SPEC.md#spec-001---canonical-dependency-chain) or [SPEC-008](SPEC.md#spec-008---output-lifecycle).

## Phase 20 - Prompt efficiency and subject fidelity

Goal: remove redundant metadata pressure and make the raw-to-provider boundary preserve camera direction, complete clauses, exact dialogue, and user-owned subject design before buying another trilogy.

1. Preserve all current paid artifacts and audit raw recipe output, submitted prompts, current-code replay, displayed caches, and original images.
2. Update the shared Storyboard v2 and Continuation contracts to one six-row layout, merging FRAMING into CAMERA with one canonical value order.
3. Refactor the compact shaper so ACTION tails stay out of NOTES, every cell reserves CAMERA before optional NOTES, exact DIALOG remains row-local, and shortening stops at complete phrases/clauses.
4. Add generic and exact-regression fixtures for all three boards, including user-supplied feline anatomy, speaker/voice attribution, silent panels, blank NOTES, and consistent label order.
5. Run focused/full checks and an in-app Browser zero-credit proof with all paid nodes frozen. Compare the recipe preview and the provider-bound prompt for each board.
6. Request fresh action-time approval for one complete paid trilogy; inspect all three original-resolution boards together and freeze only a passing set.

Exit criteria: six identical rows in every cell; CAMERA never blank; no dangling metadata fragments; dialogue remains exact and correctly attributed; feline subject cues reach Board 3; cached evidence is clearly distinguished from post-fix evidence; no paid run occurs before approval.

Tasks: AUDIT-2001, CONTRACT-2002, BUILD-2003, VERIFY-2004, PAID-2005.

## Phase 21 - Fail-closed storyboard metadata preflight

Goal: prevent a malformed storyboard metadata contract from reaching a paid provider while keeping all story content user/recipe-owned.

1. Add failing focused coverage for missing rows, empty required values, placeholders, allowed blank DIALOG, and non-storyboard isolation.
2. Make Storyboard v2 and Continuation request non-empty NOTES values derived from panel continuity/state, then refresh the two built-in recipe versions through one schema migration.
3. Validate the final provider-bound prompt after shaping and before KIE validation/submission. Report the exact panel/row and make no provider call on failure.
4. Upgrade the deterministic trilogy metadata gate from label counting to label-and-value validation.
5. Run focused and broad verification, then use the in-app Browser for a zero-credit Graph Studio proof. Preserve all frozen paid artifacts and do not authorize a new paid run.

Exit criteria: every submitted six-panel storyboard has six exact rows per panel; only silent DIALOG values may be blank; placeholders are rejected; malformed prompts stop before provider submission; recipe and runtime checks remain campaign-agnostic; Media Studio remains healthy.

Tasks: CONTRACT-2101, BUILD-2102, VERIFY-2103.

## Phase 22 - Semantic metadata and Board 1 state remediation

Goal: close BUG-2205 without another provider submission by preserving meaningful complete metadata clauses under the existing GPT Image 2 budget and strengthening the target workflow's existing Board 1 closed-state input.

1. Capture failing generic cases for clipped predicate starters/incomplete noun phrases and replay the exact Phase 22 Board 1-3 raw prompts.
2. Reuse the existing metadata limiter and panel budget owner; adjust allocation/selection only where needed to keep required values meaningful and exact dialogue intact.
3. Update only the existing Board 1 Story / Scene Brief in `graphwf_4fd06f50c493` with a positive user-owned closed-compartment-through-Panel-06 instruction. Preserve Character, Environment, references, topology, provider settings, and all artifacts.
4. Run focused preflight/shaping tests, exact replay, genericity/duplication/diff checks, then the full backend suite.
5. Restart/reload only if required for current code, inspect Graph Studio through the in-app Browser, and prove eight Frozen paid model/save nodes, approximately 0 credits / $0, healthy runner/empty queue, and no Run click.

Exit criteria: all six rows in all eighteen replayed panels are non-empty where required and semantically complete; exact dialogue is unchanged; Board 1's input keeps every service compartment closed until the Board 2 handoff; no provider job, asset, credit change, new field/port, migration, or story-specific shared-code branch occurs.

Task: BUG-2205.

## Phase 24 - Shared recipe parity and final trilogy acceptance

Goal: eliminate layout-contract drift between Storyboard v2 and Continuation, preserve semantically complete provider prompts, and use the user's newly authorized paid trilogy only after a zero-credit proof.

1. Compare both built-in recipe templates, image-role contracts, output contracts, options, and exact latest raw outputs; record every intentional difference.
2. Move the common visible-sheet requirements to one shared owner, align output/options, and keep only continuation-specific handoff behavior in the continuation recipe.
3. Extend generic semantic detection and budget fitting for the exact observed fragments; replay all three latest raw outputs at the provider boundary and prove six complete panels without story hardcoding.
4. Run focused seed, schema-refresh, prompt, preflight, trilogy, genericity, duplication, compile, and diff gates. Back up and health-check the live database before synchronizing built-in recipes.
5. Restart Media Studio if required, inspect the saved workflow, and execute a prompt-only/zero-credit browser proof with all model/save nodes Frozen. Confirm recipe versions, role order, output prompt structure, empty queue, and an approximately zero estimate.
6. Enable exactly the six Storyboard GPT/Save nodes, keep Environment Frozen, confirm the 30-credit estimate, and execute the one authorized paid trilogy in the in-app Browser. Do not submit a duplicate retry.
7. Inspect all three original-resolution images and their provider prompts for shared layout, metadata, environment/character continuity, adjacent-but-distinct handoffs, causal frame progression, dialogue, Bolts, and cinematic quality. Refreeze all paid nodes and document accounting and acceptance honestly.

Exit criteria: both recipes share one immutable sheet contract and aligned output/options; all three provider prompts pass deterministic preflight; no story literals enter shared code; the authorized run is terminal; all original outputs are reviewed together; the workflow closes frozen at zero estimated cost with an empty queue.

Tasks: CONTRACT-2401, BUG-2402, VERIFY-2403, PAID-2404, VERIFY-2405.

Post-run disposition: the first authorized Phase 24 trilogy exposed Board 1 Panel 6 handoff drift; BUG-2406 repaired that state. PAID-2407 then proved both visual handoffs but exposed additional metadata/CAMERA gaps. BUG-2408 and VERIFY-2409 repaired those exact families and passed a zero-credit proof. The user's separately authorized PAID-2410 trilogy completed as `grun_dcdcf40aa2b2` with all three outputs and both handoffs intact. It exposed a new bounded deterministic class: meaningless SHOT suffixes, curly-possessive/terminal-adjective/noun-only fragments, lost distinctive user-owned subject traits during compaction, and Board 3 duplicate panel-title strips. BUG-2412 is the next no-paid step. No retry is authorized; any later provider proof requires fresh action-time authorization.
## Phase 25 - Typed storyboard compiler and deterministic sheet renderer

Goal: make production-sheet layout and metadata deterministic while keeping all story content in recipe/workflow inputs and preserving the current one-image-per-board cost option.

1. Finish BUG-2412 with exact no-paid regressions for meaningful SHOT values, semantic fragments, distinctive subject traits, and duplicate-title instructions.
2. Define one versioned `StoryboardSheetSpec` and parser shared by first-board and continuation recipe results. Validate six ordered panels, exact metadata keys, production metadata, dialogue fidelity, and critical user-trait coverage before emitting an art prompt.
3. Add a backend-owned `storyboard.compile` utility node that accepts the canonical Prompt Recipe result and emits an art-only prompt plus the typed spec.
4. Add a deterministic `image.storyboard_sheet` utility node that accepts one equal 3x2 art grid or six ordered panel images plus the typed spec, composes a fixed 2048x1152 sheet with Pillow, stores a derived reference image, and records lineage.
5. Preserve the existing direct-sheet recipe path. Add the new nodes and tests without migrating the saved campaign workflow until the offline compositor and graph-contract gates pass.
6. Run genericity, unrelated-story permutation, focused backend/web, graph serialization, duplication, compilation, and diff gates. Refresh the graph-authoring node catalog.
7. With every provider node Frozen, add or migrate the target workflow path only after backup, then verify node discovery, wiring, saved reload, output preview, queue, and zero estimated provider cost in the in-app Browser.

Exit criteria: both storyboard recipes compile to the same typed spec; sheet chrome and metadata are pixel-deterministic; one-grid and six-image composition paths pass; no campaign literals enter shared code; existing workflows remain valid; Browser proof spends zero credits. A later paid proof requires new authorization.

Tasks: CONTRACT-2501, BUILD-2502, BUILD-2503, VERIFY-2504, GRAPH-2505, VERIFY-2506.

Closure: complete on 2026-07-15. The target workflow is migrated at 23 nodes / 37 edges with all provider/save nodes Frozen, zero estimated cost, preserved reference order/caches, clean Browser reload, and no provider submission. A future real-art trilogy is optional paid evidence, not unfinished implementation.

## Phase 26 - Distinct metadata roles and paid compositor proof

Goal: stop repeated ACTION/MOTION/NOTES values at their shared contract boundary and prove the deterministic compositor with one newly authorized real-art trilogy.

1. Capture the current Board 1 missing-NOTES and generic duplicate-row failures in focused tests.
2. Remove every cross-field ACTION/MOTION/NOTES fallback from the compiler and compact shaper; fail closed instead.
3. Add one shared campaign-agnostic duplicate/near-duplicate validator and use it for raw recipe results, mapping input, compact prompts, and provider preflight.
4. Align Storyboard v2 and Continuation instructions on distinct semantic roles and refresh the built-ins through one seed migration without adding fields or story literals.
5. Run focused, affected, full, genericity, migration, compilation, and diff gates. Back up the live database before applying the recipe refresh.
6. With paid nodes Frozen, obtain fresh recipe/compiler output and verify all eighteen metadata sets and the browser estimate at zero credits.
7. Enable exactly the three storyboard GPT and three storyboard Save nodes, keep Environment Frozen, confirm the expected 30-credit / $0.15 estimate, and use the user's authorization for one complete trilogy only.
8. Inspect all three original-resolution deterministic sheets for exact metadata, shared layout, cinematic art, character/environment/story continuity, and cross-board handoffs; refreeze and document the terminal result.

Exit criteria: no missing or duplicated required metadata reaches a provider; all three compositor outputs contain exact distinct values; one authorized paid trilogy is reviewed; the workflow closes Frozen with an empty queue and no duplicate retry.

Tasks: TEST-2601, BUG-2602, CONTRACT-2603, VERIFY-2604, PAID-2605, VERIFY-2606.

Outcome: complete. `grun_26f886636aea` consumed the one paid authorization, deterministic metadata/layout gates pass, the workflow is refrozen, and strict visual-art exceptions are recorded under VERIFY-2606. BUG-2607/VERIFY-2608 close the no-paid post-run clause-boundary regression. BUG-2610 now reports provider-observed KIE credits in Run History; optional PAID-2611 remains future work.

## Phase 27 - Legacy-layout fidelity and compact metadata correction

Goal: correct the Phase 26 presentation regression without undoing typed metadata accuracy or changing the user's story, references, workflow topology, or cost model.

1. Record red regressions proving that the Phase 26 renderer gives metadata 44.2% of each panel and discards 49.9% of a generated equal-grid cell's vertical content.
2. Restore the older compact header/grid proportions, cap metadata at one-third of panel height, and define a matching wide safe-frame contract for the single-grid art prompt.
3. Generate a 4:3 source plate as a row-major 2-column by 3-row grid so each source cell is already wide, then reflow the six ordered cells deterministically into the final 3-column by 2-row sheet.
4. Put action and spatial blocking ahead of secondary metadata-derived direction in the art prompt while preserving all user-owned continuity and subject cues within the 4,200-character target.
5. Run focused renderer/compiler tests, exact three-board replay, genericity, graph validation, compilation, and diff checks.
6. Back up the live database and complete a zero-credit in-app Browser proof with every paid node Frozen.
7. Enable exactly the intended Storyboard GPT/Save nodes, keep Environment and Seedance Frozen, verify the estimate, and submit once.
8. Inspect raw art and composed originals after each dependency boundary. Stop the attempt if a provider layout mismatch would invalidate later boards; refreeze and record the terminal accounting and visual verdict.

Tasks: TEST-2701, BUG-2702, VERIFY-2703, PAID-2704, VERIFY-2705, optional PAID-2706/VERIFY-2707.

Rollback: restore the Phase 26 renderer/prompt code and the restorable pre-run database backup; never delete or replace historical assets.

## Phase 28 - Reference-layout fidelity and cache compatibility

Goal: restore the visual hierarchy of the user-selected historical board while keeping deterministic metadata and preventing mixed source generations.

1. Preserve `asset_338f93c9c12b` and its exact submitted prompt as read-only reference evidence; compare it with the current Board 1-3 displayed outputs.
2. Add red regressions for a single SHOT presentation, five metadata rows, compact one-band header, readable display/body typography, reclaimed image height, and rejection of historical complete-sheet prompts as art sources.
3. Implement layout version 3 in the existing renderer: amber condensed board/panel headings, inline production strip, cinematic frame, then CAMERA/ACTION/MOTION/DIALOG/NOTES only.
4. Add a generic art-source compatibility seam at `image.storyboard_sheet`. Current art-only 4:3/2x3 sources and six ordered images pass; a cached model asset produced from a complete-sheet prompt fails before rendering.
5. Generate original-resolution offline proofs, run focused and full backend tests, exact prompt replay, genericity, compilation, catalog refresh, and diff checks.
6. Back up the target workflow before any mutation. Run a zero-credit Browser proof with every provider node Frozen and verify that incompatible historical Board 2-3 caches fail closed rather than producing nested layouts.
7. Document the visual verdict and request separate action-time approval only for a clean same-contract paid trilogy.

Tasks: AUDIT-2801, TEST-2802, LAYOUT-2803, GUARD-2804, VERIFY-2805, BROWSER-2806, optional PAID-2807/VERIFY-2808.

Rollback: restore layout version 2 and the pre-Phase-28 database backup. Historical media and prompts remain immutable evidence.

## Phase 29 - Historical design fidelity and concise metadata

1. Treat historical `asset_338f93c9c12b` as a read-only visual baseline and compare it to the current compositor at original resolution. Record the delta and complete the campaign pre-review.
2. Add failing tests that lock the approved hierarchy and the shared concise metadata contract before implementation.
3. Update the one shared Storyboard v2 sheet instruction and both identical output contracts. Keep SHOT typed but state unambiguously that it is rendered once as the panel heading; require complete bounded CAMERA/ACTION/MOTION values and exact user DIALOG/NOTES.
4. Bump the layout cache version and rebuild only the deterministic presentation geometry/tokens. Preserve node ports, spec contract id/version, input modes, source compatibility, graph topology, and assets.
5. Produce an offline three-board proof; run focused and complete backend suites, exact prompt replay, genericity/hardcoding, compilation, deterministic hashes, and delta review. Fix in-scope findings.
6. Use the in-app Browser for a no-paid Frozen verification. Confirm no provider job, balance change, queue residue, graph estimate, or unrelated saved mutation.
7. Close the deterministic phase honestly. Request separate action-time authorization only if the user later wants PAID-2908.

Tasks: AUDIT-2901, TEST-2902, CONTRACT-2903, LAYOUT-2904, VERIFY-2905, REVIEW-2906, BROWSER-2907, optional PAID-2908.

Rollback: restore layout version 3 and recipe versions 2.23/1.18. Historical and Phase 28 images remain unchanged evidence.

## Phase 30 - Glyph-safe metadata and final paid trilogy proof

1. Lock the observed two-line clipping with a renderer-level pixel regression that measures value glyph clearance from the lower row rule.
2. Correct only the glyph placement calculation; preserve Phase 29 geometry, font sizes, art rectangles, row dimensions, recipe contracts, and graph topology.
3. Rerender Board 1 from the accepted art source and current typed recipe result. Inspect at original resolution and prove every cinematic image rectangle is pixel-identical to the prior sheet.
4. Run focused and full backend gates, compilation, genericity/hardcoding, and diff checks.
5. Start Media Studio and use the in-app Browser to verify runtime health, queue, references, modes, and the authoritative estimate. Enable only the three storyboard GPT Image branches required by the authorized trilogy.
6. Submit once, wait for the full dependency chain, inspect all three raw sources and deterministic sheets at original resolution, record accounting, then refreeze the workflow.

Tasks: TEST-3001, FIX-3002, VERIFY-3003, BROWSER-3004, PAID-3005, VERIFY-3006, BUG-3007, VERIFY-3008, BUG-3009, VERIFY-3010.

Rollback: revert the glyph-position calculation; no layout/schema/recipe migration is involved. Paid outputs remain historical evidence and are never deleted.

## Phase 31 - Antialiased metadata clearance and saved final trilogy

1. Reproduce the reported second-line shaving from the actual Phase 30 composed sheets using all antialiased value pixels, not only the opaque text color.
2. Strengthen the public renderer regression and keep at least three pixels between wrapped glyphs and the lower rule using the existing 14px floor.
3. Remove repeated CAMERA-contract clauses at the typed spec boundary without removing subject placement.
4. Rerender all three Phase 30 sources, inspect six enlarged metadata bands, and run the exact antialiased/semantic audit.
5. Run focused and complete backend gates, compilation, genericity, runtime/queue, backup, and browser estimate checks.
6. In Graph Studio, strengthen only the user-owned Board 3 feline anatomy cue, enable exactly Boards 1-3 GPT and Save branches, run once, save all raw/composed outputs, inspect at original resolution, and refreeze.
7. If an already-submitted board succeeds but a later dependency fails at zero cost, recover only the remaining unsubmitted board(s) within the same 30-credit ceiling; never regenerate a completed paid board.

Tasks: TEST-3101, FIX-3102, TEST-3103, FIX-3104, VERIFY-3105, BROWSER-3106, PAID-3107, BUG-3109, VERIFY-3108, BUG-3110.
