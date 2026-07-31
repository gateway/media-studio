# Media Assistant Orchestration and Storyboard Execution Tasks

Last updated: 2026-07-24  
Status: Planned; no implementation task started  
Spec: [Media Assistant Orchestration and Storyboard Execution Spec](MEDIA_ASSISTANT_ORCHESTRATION_SPEC.md)

## Execution Rules

- Use `engineering-guardrails` for every implementation phase.
- Add the failing no-network regression before changing runtime behavior.
- Preserve unrelated dirty-worktree changes.
- Do not run a paid provider or save/overwrite a workflow during Phases 0–4.
- Keep Media Studio running for user testing unless the user explicitly asks to stop or restart it.
- Stop before schema, dependency, lockfile, broad backfill, or destructive data changes.

## Phase 0 — Safety Harness

### MAO-001 — Reproduce the environment-branch storyboard-preflight failure

- Status: Pending
- Phase: 0 — Safety harness
- Spec pointers: BUG-MAO-001, BUG-MAO-002, TEST-MAO-009, SPEC-MAO-005, SPEC-MAO-006, SPEC-MAO-010
- Files allowed: focused tests and fixtures under `apps/api/tests/`.
- Files forbidden: application source, web source, live database, provider calls, migrations, lockfiles.
- Problem: the applied Earth Games graph passes plan validation but fails when the environment model is mistaken for an eight-panel storyboard.
- Why it matters: graph creation success is meaningless if the first real execution path fails before the storyboard branch.
- Risk/confidence: P0 / High.
- Expected behavior change: None; test-only.
- Tests needed before change: retain the current unit tests; add one assistant-plan-to-runtime integration fixture.
- Implementation boundaries: build the graph through the real assistant planner; execute with stubbed recipe/model providers; assert the environment model is not subjected to storyboard metadata-row validation and the actual storyboard model is.
- Verification: new test must fail with the exact `panel sequence is empty` signal; neighboring preflight tests remain green.
- Rollback: remove only the new test/fixture.
- Definition of done: one deterministic red test reproduces `grun_233afa2fcd42` without network, media jobs, or credits.
- Batch eligible: Yes.
- Campaign eligible: Yes after explicit approval.

### MAO-002 — Add routing and state-isolation regressions

- Status: Pending
- Phase: 0 — Safety harness
- Spec pointers: ARCH-MAO-003 through ARCH-MAO-006, SPEC-MAO-001 through SPEC-MAO-004
- Files allowed: `apps/api/tests/test_media_assistant.py`; focused prompt-asset tests.
- Files forbidden: application source, live sessions, provider calls, schemas, migrations.
- Problem: one storyboard turn currently receives incompatible skill labels and creates Media Preset state.
- Why it matters: this is the main reason the chat works only for recognized phrases.
- Risk/confidence: P0 / High.
- Expected behavior change: None; test-only.
- Tests needed before change: MAO-001 may run independently.
- Implementation boundaries: cover storyboard discussion, storyboard-to-recipe proposal, explicit preset creation, generic image analysis, and graph approval; assert exactly one authoritative artifact target and no cross-artifact state.
- Verification: focused pytest with explicit red assertions; existing reference-storyboard regression remains green.
- Rollback: remove only the new tests.
- Definition of done: tests fail when story chat writes `reference_style_brief`, when skill/prompt/action identities conflict, or when a recipe request falls through a placeholder path.
- Batch eligible: Yes.
- Campaign eligible: Yes after explicit approval.

### MAO-003 — Add applied-state restoration and structured-chat regressions

- Status: Pending
- Phase: 0 — Safety harness
- Spec pointers: UX-MAO-007, BUG-MAO-008, SPEC-MAO-007, SPEC-MAO-008
- Files allowed: focused assistant hook/panel tests and transcript-quality tests.
- Files forbidden: production source, saved workflow data, browser mutation.
- Problem: the live applied graph reloads without its applied plan card, and the 9,418-character storyboard fails transcript quality.
- Why it matters: users cannot tell what happened or efficiently edit the storyboard.
- Risk/confidence: P1 / High.
- Expected behavior change: None; test-only.
- Tests needed before change: existing applied-plan and transcript-quality characterizations.
- Implementation boundaries: cover unsaved tab identity, null workflow id, applied plan restoration, structured shot rendering, and one concise next action.
- Verification: focused Vitest/pytest; no browser run.
- Rollback: remove only new tests.
- Definition of done: tests prove the current live behavior is red without weakening saved-workflow safeguards.
- Batch eligible: Yes.
- Campaign eligible: Yes after explicit approval.

## Phase 1 — Execution Correctness

### MAO-101 — Isolate the environment brief from storyboard panel content

- Status: Blocked on MAO-001
- Phase: 1 — Execution correctness
- Spec pointers: BUG-MAO-002, SPEC-MAO-006
- Files allowed: `apps/api/app/assistant/story_graph.py`; one focused helper only if extraction is necessary; related tests.
- Files forbidden: provider adapters, web UI, recipe schema, migrations, unrelated graph templates.
- Problem: the environment recipe receives the full storyboard/panel prompt.
- Why it matters: it causes the confirmed run failure and degrades environment generation focus.
- Risk/confidence: P0 / High.
- Expected behavior change: Yes; new assistant environment branches receive bounded environment-owned content.
- Tests needed before change: MAO-001 red.
- Implementation boundaries: derive only facts already present in structured story state; do not invent locations; preserve exact downstream storyboard shot content.
- Verification: MAO-001 green; exact plan still has eight storyboard shots and typed reference edges.
- Rollback: revert only environment-brief construction.
- Definition of done: the environment branch prompt contains geography/style/action-lane context but no storyboard panel-count/metadata contract.
- Batch eligible: No.
- Campaign eligible: No.

### MAO-102 — Make storyboard preflight opt in through typed provenance

- Status: Blocked on MAO-001
- Phase: 1 — Execution correctness
- Spec pointers: BUG-MAO-001, SPEC-MAO-005
- Files allowed: focused graph value/provenance, Prompt Recipe output, executor, schema-compatible metadata helpers, and tests.
- Files forbidden: dependency upgrades, database migrations, broad prompt-shaping rewrite.
- Problem: execution semantics are inferred from arbitrary prompt text.
- Why it matters: non-storyboard GPT Image 2 prompts can be rejected, while malformed storyboards can evade checks by changing wording.
- Risk/confidence: P0 / Medium.
- Expected behavior change: Yes for new typed flows; legacy prompts retain conservative compatibility behavior.
- Tests needed before change: MAO-001 plus existing preflight suite.
- Implementation boundaries: prefer optional backward-compatible metadata; do not remove validation from actual storyboard sheets.
- Verification: environment, character, ordinary image, storyboard art-only, and storyboard-metadata fixtures; complete assistant execution seam.
- Rollback: restore legacy detection while retaining the new regression.
- Definition of done: only explicitly typed storyboard-metadata prompts require ordered panel rows in new graphs.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 2 — Unified Orchestration

### MAO-201 — Introduce one authoritative creative-turn decision

- Status: Blocked on MAO-002
- Phase: 2 — Unified orchestration
- Spec pointers: ARCH-MAO-003, ARCH-MAO-005, SPEC-MAO-001, SPEC-MAO-003
- Files allowed: assistant decision/orchestrator modules, schemas, thin route integration, focused tests.
- Files forbidden: graph runtime, artifact persistence schema migration, frontend auto-action removal until the server contract is green.
- Problem: skill, prompt route, capability, response kind, and next action are decided independently.
- Why it matters: natural chat paraphrases fall between lanes and special cases accumulate.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; ambiguous turns ask one focused question and clear turns have one action contract.
- Tests needed before change: MAO-002.
- Implementation boundaries: extract before deleting; keep legacy adapters until parity is proven.
- Verification: use-case decision table plus all existing assistant regressions.
- Rollback: route through the legacy adapter.
- Definition of done: one typed decision owns artifact target, safety, prompt assets, and permitted next actions for every turn.
- Batch eligible: No.
- Campaign eligible: No.

### MAO-202 — Separate story, preset, recipe, and graph state

- Status: Blocked on MAO-201
- Phase: 2 — Unified orchestration
- Spec pointers: BUG-MAO-004, SPEC-MAO-002 through SPEC-MAO-004
- Files allowed: focused assistant state helpers, route facade, tests.
- Files forbidden: broad historical-session migration, destructive cleanup, provider replacement.
- Problem: story chat creates a preset style brief from assistant prose.
- Why it matters: later turns inherit the wrong artifact context.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; only an explicit proposal/transition creates another artifact's state.
- Tests needed before change: MAO-002 and MAO-201.
- Implementation boundaries: preserve readable legacy sessions; do not erase existing state.
- Verification: state-transition matrix across all modes and attachment changes.
- Rollback: retain optional legacy readers while disabling only the new writer.
- Definition of done: each use case owns its state and cross-artifact transitions are explicit and traceable.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 3 — Real Prompt Recipe Capability

### MAO-301 — Implement storyboard-reference-to-recipe orchestration

- Status: Blocked on MAO-201 and MAO-202
- Phase: 3 — Prompt Recipe capability
- Spec pointers: ARCH-MAO-006, SPEC-MAO-002 through SPEC-MAO-004
- Files allowed: Prompt Recipe skill prompt/assets, typed proposal/draft helpers, narrow routes, tests.
- Files forbidden: automatic recipe save, paid execution, unrelated preset builder behavior.
- Problem: Prompt Recipe Builder is a placeholder and does not own the full reference-storyboard journey.
- Why it matters: this is a primary requested use case.
- Risk/confidence: P1 / High.
- Expected behavior change: Yes; the assistant can diagnose a reference storyboard and propose meaningful recipe fields.
- Tests needed before change: Phase 2 green.
- Implementation boundaries: reuse existing Prompt Recipe contracts and editor; analysis/proposal remains chat-first; draft/save require explicit actions.
- Verification: image fixture → structured analysis → proposal → reviewable draft → no-paid graph test.
- Rollback: disable the new proposal-to-draft route; keep analysis readable.
- Definition of done: a user can turn a storyboard reference into a reusable recipe with a user prompt, form fields, optional image roles, and output contract.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 4 — Chat UX and Client Simplification

### MAO-401 — Render structured creative responses and restore unsaved-tab applied state

- Status: Blocked on MAO-003 and Phase 2
- Phase: 4 — Chat UX
- Spec pointers: UX-MAO-007, BUG-MAO-008, SPEC-MAO-007, SPEC-MAO-008
- Files allowed: focused assistant panel/hook/components, compatible session identity helper, tests.
- Files forbidden: Graph Studio redesign, local-storage/session-store inspection hacks, workflow auto-save.
- Problem: long prose and missing applied state make the assistant feel unlike a chat system.
- Why it matters: users need to inspect, adjust, approve, and continue without decoding internal state.
- Risk/confidence: P1 / Medium.
- Expected behavior change: Yes; concise diagnosis, structured shots/fields, one next action, reliable applied-state card.
- Tests needed before change: MAO-003.
- Implementation boundaries: preserve accessible text and plain-message fallback; do not infer mutations on the client.
- Verification: focused Vitest, typecheck, Chrome no-paid proof, transcript-quality pass.
- Rollback: fall back to plain message rendering and existing saved-workflow plan restoration.
- Definition of done: the live Earth Games session is readable, its applied state is visible after reload, and normal chat does not depend on mode-specific phrase macros.
- Batch eligible: No.
- Campaign eligible: No.

### MAO-402 — Reduce frontend phrase arbitration to a typed-action adapter

- Status: Blocked on MAO-201
- Phase: 4 — Client simplification
- Spec pointers: ARCH-MAO-005, SPEC-MAO-001
- Files allowed: `creative-assistant-intent.ts`, `use-creative-assistant.ts`, related tests.
- Files forbidden: server behavior changes, run-confirmation weakening, paid action auto-approval.
- Problem: the frontend independently reclassifies user text into side effects.
- Why it matters: backend and client decisions drift.
- Risk/confidence: P1 / Medium.
- Expected behavior change: None for covered cases; broader paraphrase reliability improves.
- Tests needed before change: typed server-decision contract and parity fixtures.
- Implementation boundaries: retain only safety checks and backward-compatible legacy translation; explicit run/save confirmation remains fail closed.
- Verification: complete action matrix, assistant panel tests, typecheck, no-paid Chrome proof.
- Rollback: restore the legacy phrase adapter.
- Definition of done: new server responses drive actions directly and phrase matching is not the primary orchestrator.
- Batch eligible: No.
- Campaign eligible: No.

## Phase 5 — End-to-End Verification

### MAO-501 — Verify the three primary image use cases

- Status: Blocked on Phases 1–4
- Phase: 5 — Verification
- Spec pointers: all
- Files allowed: tests, disposable local sessions/workflows, engineering verification docs.
- Files forbidden: paid runs without fresh action-time approval, workflow overwrite, destructive cleanup.
- Problem: isolated green suites missed the live execution failure.
- Why it matters: completion must be based on user journeys, not module coverage.
- Risk/confidence: P0 / High.
- Expected behavior change: None; verification only.
- Tests needed before change: all owning tasks green.
- Implementation boundaries: run three disposable no-paid flows: photo→preset proposal, storyboard image→recipe draft/test graph, photo→storyboard→applied graph→stubbed/runtime-safe execution.
- Verification: focused/full tests, typecheck/lint, Chrome proof, persisted reload, unchanged credits/jobs unless a separately approved paid proof is later requested.
- Rollback: undo/discard disposable graph changes.
- Definition of done: all three use cases remain conversational, create only the requested artifact, apply to the intended tab, and pass the execution seam.
- Batch eligible: No.
- Campaign eligible: No.

## Recommended Next Task

Start with `MAO-001`. It is the narrowest safe task and converts the confirmed live failure into a deterministic red signal before any runtime or orchestration change.

