# Media Assistant Reference-Storyboard Graph Fix Tasks

Last updated: 2026-07-23  
Status: Phases 0–5 complete; shipped and verified 2026-07-23  
Spec: [Media Assistant Reference-Storyboard Graph Fix](MEDIA_ASSISTANT_STORYBOARD_FIX_SPEC.md)

> The original no-paid apply contract remains complete. A 2026-07-24 live run exposed a separate environment-branch/preflight failure plus broader orchestration gaps. Follow-up tasks begin at `MAO-001` in [Media Assistant Orchestration and Storyboard Execution Tasks](MEDIA_ASSISTANT_ORCHESTRATION_TASKS.md).

## Execution Rules

- Work one task at a time.
- Preserve unrelated dirty-worktree changes.
- Add the failing regression before changing behavior.
- Do not run or save a generated graph during automated tests.
- Do not submit paid provider jobs.
- Use a disposable workflow for browser proof unless the user explicitly selects another workflow.
- Stop before a schema migration, dependency change, broad session backfill, or destructive data operation.

## Phase 0 — Safety Harness

### MAS-001 — Capture the exact incident as a failing integration regression

- Status: Completed 2026-07-23 — red contract retained and fixed by Phase 1
- Phase: 0 — Safety harness
- Spec pointers: RC-1, RC-2, SPEC-MAS-001 through SPEC-MAS-003, Acceptance Criteria
- Files allowed: `apps/api/tests/test_media_assistant.py`; narrowly scoped assistant test fixtures.
- Files forbidden: application source, web source, migrations, lockfiles, live database writes.
- Problem: existing tests pass while the exact Earth Games session compiles to a zero-operation plan.
- Why it matters: the implementation needs one deterministic signal for the user's real failure.
- Risk/confidence: P0 / High.
- Expected behavior change: None; test-only.
- Tests needed before change: preserve the current read-only database assertion output and the exact prompt/response/apply text as a sanitized fixture.
- Implementation boundaries: create a session through the real test client; attach one image fixture; post the original prompt; inject the eight-shot provider reply; post the exact apply command; assert current behavior is red because the final plan has zero operations or `missing_story_segment=true`.
- Verification: Phase 0 originally failed because the state was `graph_review`; after MAS-101 through MAS-103, the exact integration test passes without network or a live provider.
- Rollback: remove only the new test and fixture.
- Definition of done: one fast deterministic test catches the exact incident without network, provider, browser, or live database access.
- Batch eligible: Yes.
- Campaign eligible: Yes, after explicit campaign approval.

### MAS-002 — Add characterization tests for neighboring intent and parser behavior

- Status: Completed 2026-07-23 — characterization boundaries retained and Phase 1 expectations are green
- Phase: 0 — Safety harness
- Spec pointers: SPEC-MAS-001 through SPEC-MAS-004
- Files allowed: `apps/api/tests/test_media_assistant.py`.
- Files forbidden: application source, web source, migrations, provider calls.
- Problem: fixes to substring matching and storyboard parsing could regress valid graph, story, prompt-recall, or negated requests.
- Why it matters: the classifier is shared by multiple assistant paths and needs explicit boundaries.
- Risk/confidence: P1 / High.
- Expected behavior change: None; test-only.
- Tests needed before change: MAS-001.
- Implementation boundaries: cover `graph`, `workflow`, `photograph`, `photographic`, `photographed`, actual graph requests, storyboard-only requests, prompt recall, continuation, and graph negations. Add inline and multiline `Shot N / Duration / Camera / Action / Prompt` fixtures.
- Verification: photograph variants, apply routing, and inline parsing originally failed at their intended assertions; all ten MAS-001/002 cases now pass after Phase 1.
- Rollback: remove only the new characterization cases.
- Definition of done: word-boundary, reserved-label, field-isolation, and negation expectations are explicit.
- Batch eligible: Yes.
- Campaign eligible: Yes, after explicit campaign approval.

### MAS-003 — Add image-role and provider-image-order regressions

- Status: Completed 2026-07-23 — image-role regressions retained and fixed by Phase 2
- Phase: 0 — Safety harness
- Spec pointers: RC-3, RC-4, SPEC-MAS-005 through SPEC-MAS-007
- Files allowed: `apps/api/tests/test_media_assistant.py`; a new focused provider-chat unit test only if existing seams are insufficient.
- Files forbidden: application source, real image provider calls, migrations, media generation.
- Problem: current tests do not fail when an unrelated latest output is silently prepended to a user attachment or when a machine image becomes a character sheet.
- Why it matters: graph construction may succeed while creative/reference semantics are still wrong.
- Risk/confidence: P0 / High.
- Expected behavior change: None; test-only.
- Tests needed before change: MAS-001.
- Implementation boundaries: use two distinguishable local image fixtures and assert role, order, inclusion reason, and character-sheet state for new-storyboard versus output-review turns.
- Verification: both original Phase 2 failures now pass; output-review ordering, explicit character-sheet preservation, typed-role binding, and explicit-user approval also pass.
- Rollback: remove only the new tests/fixtures.
- Definition of done: tests catch both silent latest-output contamination and unconditional character-sheet promotion.
- Batch eligible: Yes.
- Campaign eligible: Yes, after explicit campaign approval.

## Phase 1 — Intent and Story-State Correctness

### MAS-101 — Replace raw graph substring checks with semantic token matching

- Status: Completed 2026-07-23
- Phase: 1 — Intent and story state
- Spec pointers: RC-1, SPEC-MAS-001
- Files allowed: `apps/api/app/assistant/story_state.py`, directly related focused tests.
- Files forbidden: provider chat, graph compiler, web UI, schemas, migrations.
- Problem: `"graph" in normalized` matches `photographic` and `Photographed`.
- Why it matters: the original storyboard never becomes structured state.
- Risk/confidence: P0 / High.
- Expected behavior change: Yes; photographic language remains story intent while real graph commands still route correctly.
- Tests needed before change: MAS-001 and MAS-002.
- Implementation boundaries: use word/phrase boundaries; preserve explicit graph negation; do not solve by special-casing only the two incident words.
- Verification: all six semantic-boundary cases pass; the exact MAS-001 incident now extracts one storyboard segment with eight shots and continues to a valid applicable plan.
- Rollback: restore the prior classifier only; retain the regression tests.
- Definition of done: the exact original prompt yields `latest_turn_kind=storyboard`, one segment, and eight parsed shots.
- Batch eligible: No.
- Campaign eligible: No.

### MAS-102 — Recognize apply and contextual approval as graph actions

- Status: Completed 2026-07-23
- Phase: 1 — Intent and story state
- Spec pointers: RC-2, SPEC-MAS-002
- Files allowed: `apps/api/app/assistant/intent.py`, `apps/web/components/graph-studio/utils/creative-assistant-intent.ts`, their focused tests.
- Files forbidden: provider implementation, graph runtime, migrations, unrelated Studio intent code.
- Problem: `Apply the approved ... graph` routes as `answer_question`.
- Why it matters: the provider produces refusal prose instead of entering the deterministic builder path.
- Risk/confidence: P0 / High.
- Expected behavior change: Yes; direct apply/approval language produces a graph-plan/apply action when valid context exists.
- Tests needed before change: MAS-001 and contextual positive/negative fixtures from MAS-002.
- Implementation boundaries: add `apply`, `put`, and contextual approval carefully; negations must win; do not treat every `yes` as mutation without a pending offered action.
- Verification: exact backend positive/negated cases pass; the focused web intent suite passes 28/28 including matching positive and negated commands.
- Rollback: revert the added vocabulary/context rule only.
- Definition of done: the exact final command routes to workflow construction, while `do not apply it` remains chat-only.
- Batch eligible: No.
- Campaign eligible: No.

### MAS-103 — Harden storyboard markdown parsing and reserved labels

- Status: Completed 2026-07-23
- Phase: 1 — Intent and story state
- Spec pointers: RC-5, SPEC-MAS-003, SPEC-MAS-004
- Files allowed: `apps/api/app/assistant/story_state.py`, focused assistant tests; a focused parser helper may be extracted in the same assistant package.
- Files forbidden: graph runtime, provider configuration, web UI, migrations.
- Problem: inline markdown fields bleed together and `Duration`, `Camera`, `Action`, and `Prompt` become characters.
- Why it matters: recovered plans may contain structurally present but semantically corrupted shots.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; cleaner shot fields and character state.
- Tests needed before change: MAS-002 inline/multiline fixtures.
- Implementation boundaries: parse explicit shot boundaries first; parse known field labels independently; strip markdown; use a reserved-label denylist; retain unknown text in a bounded notes field rather than dropping it.
- Verification: the inline labeled-field regression passes, the exact eight-shot reply parses cleanly, and six existing storyboard/continuation/recall regressions pass.
- Rollback: revert parser/helper changes while retaining red tests.
- Definition of done: all supported storyboard response layouts produce isolated clean fields and valid characters.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 2 — Reference Semantics and Context Assembly

### MAS-201 — Introduce a typed assistant image-role manifest

- Status: Completed 2026-07-23
- Phase: 2 — Reference semantics
- Spec pointers: SPEC-MAS-005, SPEC-MAS-013
- Files allowed: `apps/api/app/assistant/provider_chat.py`, focused assistant schemas/helpers, `apps/api/app/assistant/skill_kernel.py`, focused tests.
- Files forbidden: graph media-node contracts, database migrations, KIE model APIs, unrelated provider code.
- Problem: the provider sees positional images without a reliable ordinary-story role contract.
- Why it matters: it cannot distinguish the user's authoritative attachment from canvas output or inspiration.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; provider prompts include explicit image roles and traces expose sanitized role decisions.
- Tests needed before change: MAS-003.
- Implementation boundaries: keep existing image payload compatibility; add a text/context role manifest aligned exactly to path order; do not expose unrestricted local paths.
- Verification: focused tests prove payload/manifest order alignment, supported roles, authority flags, prompt-context injection, usage tracing, and absence of unrestricted local paths.
- Rollback: stop emitting the optional manifest; older payload format remains usable.
- Definition of done: every provider-bound image has one source and semantic role.
- Batch eligible: No.
- Campaign eligible: No.

### MAS-202 — Make latest-output inclusion intent-aware

- Status: Completed 2026-07-23
- Phase: 2 — Reference semantics
- Spec pointers: RC-3, SPEC-MAS-006
- Files allowed: `apps/api/app/assistant/provider_chat.py`, `apps/api/app/assistant/routes.py`, focused tests.
- Files forbidden: graph runtime, asset storage, migrations, output deletion.
- Problem: latest graph output is always placed before user attachments.
- Why it matters: unrelated current output contaminated the Earth Games storyboard with Farmer Kid.
- Risk/confidence: P0 / High.
- Expected behavior change: Yes; new storyboard turns use explicit user attachments, while review/comparison turns can still use latest output.
- Tests needed before change: MAS-003 and MAS-201.
- Implementation boundaries: determine inclusion from typed intent/output-comparison state; preserve explicit user requests to use current output; record an inclusion reason.
- Verification: new-storyboard excludes latest output; output review includes it first and labels both roles; legacy ordering tests now require explicit review intent.
- Rollback: revert the intent-aware filter while retaining role tracing.
- Definition of done: the incident provider turn receives only the cleanup-machine attachment unless the user explicitly requests the Farmer Kid output too.
- Batch eligible: No.
- Campaign eligible: No.

### MAS-203 — Remove unconditional attachment-to-character-sheet promotion

- Status: Completed 2026-07-23
- Phase: 2 — Reference semantics
- Spec pointers: RC-4, SPEC-MAS-007
- Files allowed: `apps/api/app/assistant/routes.py`, focused assistant state/helpers, tests.
- Files forbidden: reference-media schema, gallery behavior, graph media nodes, migrations.
- Problem: the first generic image attachment is automatically marked as an approved character sheet.
- Why it matters: machine, product, environment, and style references acquire false character authority.
- Risk/confidence: P0 / High.
- Expected behavior change: Yes; generic images remain generic until explicitly classified.
- Tests needed before change: MAS-003 and MAS-201.
- Implementation boundaries: use explicit user language, existing typed attachment metadata, or a confirmed assistant proposal; preserve already explicit character-sheet sessions.
- Verification: generic machine image remains non-character; typed character metadata and explicit user language bind correctly; eight existing character workflow tests and the full 367-test assistant suite pass.
- Rollback: restore legacy promotion behind a narrow compatibility fallback only if an existing explicit contract requires it.
- Definition of done: attachment presence alone can never create `approved_character_sheet`.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 3 — Graph Recovery, Compilation, and Truthful Application

### MAS-301 — Recover structured story state from recent assistant history

- Status: Completed (2026-07-23)
- Phase: 3 — Graph recovery and application
- Spec pointers: SPEC-MAS-003, SPEC-MAS-009
- Files allowed: `apps/api/app/assistant/routes.py`, `apps/api/app/assistant/story_state.py`, a focused recovery helper, assistant tests.
- Files forbidden: database-wide scripts, migrations, arbitrary history rewriting, web UI.
- Problem: the incident session contains a complete visible storyboard but no structured segment.
- Why it matters: fixing future extraction does not repair the user's existing conversation.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; explicit apply can recover a recent unambiguous storyboard.
- Tests needed before change: MAS-001 and MAS-103.
- Implementation boundaries: bounded recent history only; require `Shot N` structure; preserve source brief; record recovery metadata; fail closed if multiple candidate storyboards are ambiguous.
- Verification: the incident fixture recovers one eight-shot segment; ambiguity and no-story cases return one truthful question.
- Rollback: disable on-demand recovery; no persistent records need deletion.
- Definition of done: the existing incident shape no longer returns `missing_story_segment`.
- Completion note: explicit graph requests now scan at most 16 recent messages, recover one contiguous numbered storyboard with its source brief and audit metadata, and return one blocker question for ambiguous or missing history.
- Batch eligible: No.
- Campaign eligible: No.

### MAS-302 — Compile an approved storyboard into a count-preserving graph plan

- Status: Completed (2026-07-23)
- Phase: 3 — Graph recovery and application
- Spec pointers: SPEC-MAS-008, SPEC-MAS-012
- Files allowed: `apps/api/app/assistant/story_graph.py`, focused assistant graph helpers, `apps/api/tests/test_media_assistant.py`.
- Files forbidden: graph scheduler unless a failing test proves a separate runtime defect; paid-run code; migrations; unrelated graph templates.
- Problem: the incident produces an empty plan, and supported sheet counts may not match an approved eight-shot storyboard.
- Why it matters: a recovered story still needs a deterministic graph that honors what the assistant and user approved.
- Risk/confidence: P0 / Medium.
- Expected behavior change: Yes; non-empty validated plan preserving shot count and reference roles.
- Tests needed before change: MAS-001, MAS-103, MAS-201, and MAS-301.
- Implementation boundaries: reuse existing node/recipe contracts; do not silently change shot count; if eight shots require individual branches, keep them grouped and consistently wired; no run/save execution; no broad graph-template rewrite.
- Verification: plan operation count is positive; compiled workflow validates; all eight shots and reference roles are represented; no run request is created.
- Rollback: revert the new selection/count strategy; existing graph templates remain intact.
- Definition of done: the Earth Games fixture produces a valid applicable graph plan with eight-shot fidelity.
- Completion note: eight panels are now a supported storyboard count; the generic machine image remains typed as `machine_or_prop_reference`, is loaded and wired to the storyboard model, and compiled metadata records all eight shot numbers, environment continuity, and `run_requested: false`. Explicit count conflicts fail closed.
- Batch eligible: No.
- Campaign eligible: No.

### MAS-303 — Ground visible assistant copy in plan and apply results

- Status: Completed (2026-07-23)
- Phase: 3 — Graph recovery and application
- Spec pointers: RC-6, SPEC-MAS-010
- Files allowed: `apps/api/app/assistant/routes.py`, assistant response-shaping helpers, focused tests.
- Files forbidden: provider model configuration, global chat style, graph runtime, migrations.
- Problem: provider prose invented a button and falsely claimed graph editing was unavailable.
- Why it matters: the user cannot distinguish a creative response from actual application state.
- Risk/confidence: P0 / High.
- Expected behavior change: Yes; action claims become deterministic and truthful.
- Tests needed before change: exact provider-refusal and nonexistent-button fixtures.
- Implementation boundaries: preserve useful creative/story text; override or append authoritative action status after planning/apply; avoid exposing internal ids unless debug mode requests them.
- Verification: tests prove the UI-facing response never claims an unavailable action when a valid plan exists and never claims success without an applied workflow id.
- Rollback: revert response-grounding helper only.
- Definition of done: visible copy exactly matches `planned`, `blocked`, `applied`, or `failed` state.
- Completion note: explicit storyboard graph turns replace contradictory provider action prose with deterministic `planned` or `blocked` copy, and applied summaries carry both `action_status: applied` and the applied workflow id.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 4 — Web Plan State and User Recovery

### MAS-401 — Restore persisted plan and blocker state after reload

- Status: Completed 2026-07-23
- Phase: 4 — Web UX
- Spec pointers: RC-7, SPEC-MAS-011
- Files allowed: `apps/web/components/graph-studio/hooks/use-creative-assistant.ts`, `apps/web/components/graph-studio/creative-assistant-panel.tsx`, focused tests; existing assistant API mapper if required.
- Files forbidden: Graph canvas layout, unrelated assistant modes, global styles unless a focused state style is missing.
- Problem: reopening the assistant shows message history but not the persisted latest plan/blocker.
- Why it matters: users lose the action or explanation that belongs to the conversation.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; latest relevant plan state survives reload.
- Tests needed before change: component fixture containing unapplied, applied, invalid, and zero-operation plans.
- Implementation boundaries: scope plan to the active workflow/session; do not resurrect stale plans from another tab; no automatic apply on reload.
- Verification: component tests and browser reload proof.
- Rollback: revert plan hydration; messages remain available.
- Definition of done: reload displays the same applicable plan, applied state, or truthful blocker for the active workflow.
- Completion note: session responses now include the newest valid persisted plan; API and web guards reject malformed, foreign-session, and foreign-workflow plans. Reload restores validated, applied, invalid, and zero-operation review states without applying them. Browser verification restored a reviewable plan after reload on a disposable workflow.
- Batch eligible: No.
- Campaign eligible: No.

### MAS-402 — Verify active-workflow apply and undo behavior

- Status: Completed 2026-07-23
- Phase: 4 — Web UX
- Spec pointers: SPEC-MAS-008, SPEC-MAS-010 through SPEC-MAS-012
- Files allowed: focused Graph Studio assistant hook/component tests; source only if the new test proves a defect.
- Files forbidden: saved-workflow persistence, graph runtime, provider execution, unrelated undo/redo code.
- Problem: the user asked to modify the current open workflow, so session/workflow targeting and undo integration must be explicit.
- Why it matters: applying to the wrong tab or bypassing undo would be a serious mutation bug.
- Risk/confidence: P0 / Medium.
- Expected behavior change: None unless a failing test proves incorrect targeting or undo behavior.
- Tests needed before change: MAS-302 and MAS-401.
- Implementation boundaries: assert active workflow id, one local graph mutation, and normal undo registration; do not save the workflow or run it.
- Verification: focused web tests; manual browser undo/redo on a disposable workflow.
- Rollback: revert only any proven targeting/undo correction.
- Definition of done: the plan applies once to the intended open workflow and can be undone without affecting unrelated nodes.
- Completion note: focused tests prove existing nodes survive apply and exact base state returns on undo. Browser verification applied one restored Prompt Text change to the disposable active tab, confirmed undo and redo registration, and left the workflow blank after the final undo. Related review fixes prevent duplicate auto-plan sessions and ignore stale in-flight responses after a tab switch.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 5 — Verification and Documentation

### MAS-501 — Run focused and broad automated verification

- Status: Completed 2026-07-23
- Phase: 5 — Verification
- Spec pointers: Verification Strategy, Acceptance Criteria
- Files allowed: tests, `docs/engineering/VERIFICATION_LOG.md`, this task file for status updates.
- Files forbidden: new behavior changes during the verification task; live data mutation.
- Problem: the fix crosses backend routing, story state, provider image context, graph planning, and web auto-action behavior.
- Why it matters: narrow tests alone can miss cross-layer regressions.
- Risk/confidence: P1 / High.
- Expected behavior change: None.
- Tests needed before change: MAS-101 through MAS-402 complete.
- Implementation boundaries: begin focused; expand to assistant/graph/web gates; do not run paid providers.
- Verification:
  - exact MAS-001 regression;
  - focused `test_media_assistant.py`;
  - focused web intent/panel tests;
  - `npm run typecheck:web`;
  - `npm run lint:web`;
  - relevant theme/file-size checks if touched;
  - `git diff --check`;
  - broader release gate if focused checks pass and time allows.
- Rollback: none; failures return the owning implementation task to pending.
- Definition of done: all required automated checks pass and results are recorded.
- Completion note: exact MAS-001/002/003 gate passes 17/17; the complete Media Assistant suite passes 375/375; prompt-asset tests pass 3/3; focused web intent/panel/history tests pass 86/86; web typecheck, 494-file lint, theme drift, and `git diff --check` pass. `quality:file-size` and `release:verify:full` stop only on the unrelated pre-existing `apps/api/tests/test_graph_studio.py` boundary (7,001 lines, limit 7,000); no out-of-scope edit was made.
- Batch eligible: Yes.
- Campaign eligible: Yes, after explicit campaign approval.

### MAS-502 — Complete a no-paid browser proof with the Earth Games flow

- Status: Completed 2026-07-23
- Phase: 5 — Verification
- Spec pointers: Expected Incident Behavior, Browser proof, Acceptance Criteria
- Files/data allowed: a disposable workflow or a workflow explicitly selected by the user; documentation logs.
- Files/data forbidden: paid runs, saved generated outputs, the user's current active workflow without explicit approval, production data deletion.
- Problem: API and component tests cannot prove the complete open-tab conversational and canvas experience.
- Why it matters: the original failure occurred in the live Graph Studio assistant.
- Risk/confidence: P0 / High.
- Expected behavior change: None; verification only.
- Tests needed before change: MAS-501 green.
- Implementation boundaries: attach the original local reference; use the original prompt; confirm eight shots; approve/apply; inspect canvas and reload; do not click Run or save the workflow.
- Verification: visible eight-shot response, typed reference behavior, applied graph on active canvas, undo availability, persisted applied state, unchanged credit balance, and no new media job.
- Rollback: undo the local graph change or discard the disposable workflow tab.
- Definition of done: the exact user journey succeeds without fictional controls, graph execution, or spend.
- Completion note: disposable Graph Studio session `asst_889e59f57505` attached `138c374c-d8be-49bf-aa28-c2d1bf06e21c.png`, returned exactly Shots 1–8 before mutation, applied only after `Apply the approved Earth Games storyboard graph`, and persisted an 11-node / 23-operation graph after reload. Stored and compiled shot numbers are 1–8, `run_requested=false`, undo was available immediately after apply, and the applied assistant state restored when reopened. Credits remained 517.62; latest media job `job_ab6c459f93e2` and graph run `grun_44a5864f47ba` were unchanged. The workflow was not run or saved.
- Batch eligible: No.
- Campaign eligible: No.

### MAS-503 — Update canonical engineering records and changelog

- Status: Completed 2026-07-23
- Phase: 5 — Verification
- Spec pointers: all
- Files allowed: `docs/engineering/SPEC.md`, `docs/engineering/TASKS.md`, `docs/engineering/WORK_STATE.md`, `docs/engineering/VERIFICATION_LOG.md`, `docs/engineering/DECISIONS.md`, `docs/development/media-studio-changelog.md`.
- Files forbidden: application source.
- Problem: standalone fix docs are useful for implementation, but shipped behavior must be reflected in canonical project memory.
- Why it matters: future sessions need a single accurate record of what changed, why, and how it was verified.
- Risk/confidence: P2 / High.
- Expected behavior change: None.
- Tests needed before change: MAS-501 and MAS-502 complete.
- Implementation boundaries: link rather than duplicate long content; record exact commands/results and any accepted deviations.
- Verification: links resolve; task statuses match evidence; `git diff --check`.
- Rollback: revert only the documentation update.
- Definition of done: canonical docs identify the shipped fix, verification evidence, remaining risks, and rollback boundary.
- Completion note: the standalone spec/tasks, canonical spec/tasks/work state/verification/decisions, and changelog now link the shipped behavior and exact no-paid evidence. Links and diff hygiene were rechecked.
- Batch eligible: Yes.
- Campaign eligible: Yes, after explicit campaign approval.

## Recommended Order

1. MAS-001
2. MAS-002 and MAS-003
3. MAS-101
4. MAS-102
5. MAS-103
6. MAS-201
7. MAS-202
8. MAS-203
9. MAS-301
10. MAS-302
11. MAS-303
12. MAS-401
13. MAS-402
14. MAS-501
15. MAS-502
16. MAS-503

## Hard Stop Conditions

Stop and request direction if any task requires:

- a database schema migration;
- a dependency or lockfile change;
- a broad historical-session rewrite;
- a paid provider call;
- saving or overwriting the user's active workflow;
- deleting assistant history, media, runs, or nodes;
- changing reference-media semantics outside Media Assistant;
- resolving conflicts in unrelated dirty-worktree changes;
- silently changing the approved storyboard shot count.

## Completion Summary Template

When all tasks finish, report:

- root causes fixed;
- files changed;
- exact incident regression result;
- focused and broad verification totals;
- browser proof workflow/session;
- confirmation that no paid run occurred;
- any deferred risks or follow-up tasks.
