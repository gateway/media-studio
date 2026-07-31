# Media Assistant Orchestration and Storyboard Execution Spec

Last updated: 2026-07-24  
Mode: Read-only audit and bug-fix planning  
Status: Audit complete; implementation not started

## Objective

Make Media Assistant behave like one capable creative chat system across Graph Studio:

1. understand an attached image and explain what is visually important;
2. propose a reusable Media Preset with a small set of meaningful user fields;
3. diagnose a reference storyboard and turn it into a reusable Prompt Recipe;
4. develop a story conversationally before any graph mutation;
5. compile an approved artifact into the active graph;
6. run only after the normal explicit run/price confirmation boundary;
7. preserve enough typed state that a later turn does not have to rediscover the user's intent from phrases.

This work follows the completed reference-storyboard graph-application fix. It does not reopen the already-green intent, image-role, shot-count, and explicit-apply contracts except where the new live evidence proves a remaining cross-layer failure.

## Confirmed Live Evidence

### Incident

- Assistant session: `asst_889e59f57505`
- Applied graph template: `story_gpt_image_2_storyboard_stills_v1`
- Applied plan: 23 operations / 11 nodes / 8 compiled shots
- Persisted workflow run: `grun_233afa2fcd42`
- Workflow: `graphwf_4030e4539bf6`

The assistant successfully created and applied the Earth Games graph, but the later graph run failed on the first paid-model branch:

```text
Storyboard preflight failed: panel sequence is empty; expected [1, 2, 3, 4, 5, 6, 7, 8].
```

The failing node was `assistant-storyboard-environment-model`, not the storyboard model. The graph builder passed the complete eight-shot storyboard prompt into the Environment Sheet recipe's `user_prompt`. The environment recipe output therefore looked like storyboard content to the generic GPT Image 2 preflight, which required eight panel metadata rows from an environment image prompt and rejected the run.

No run was started during this audit. The failure was already present in persisted local run history.

## Findings

### BUG-MAO-001 — Storyboard preflight is inferred from prompt text instead of typed execution intent

Risk: P0  
Confidence: High

`model.kie.gpt_image_2_*` applies storyboard metadata preflight whenever `_looks_like_storyboard(original_prompt)` returns true. The executor does not know whether its upstream prompt is an environment sheet, storyboard art source, preset, or other image prompt.

Consequence: any non-storyboard GPT Image 2 branch containing enough storyboard vocabulary can be rejected as though it were the final storyboard sheet.

### BUG-MAO-002 — Environment compilation receives the complete storyboard contract

Risk: P0  
Confidence: High

`story_graph.py` assigns `_storyboard_still_prompt_text(...)` directly to the Environment Sheet recipe's `user_prompt`. The live node contained the full eight-shot story, mandatory beats, and panel count instead of a bounded environment/geography brief.

Consequence: prompt duplication, very large graph fields, wrong preflight classification, and weaker environment-sheet focus.

### ARCH-MAO-003 — A single turn can have incompatible skill identities

Risk: P1  
Confidence: High

The live trace labeled the first turn `graph_workflow_builder` while loading only `skills/story_project.md`. The approval turn was labeled `general_helper`, still loaded the story prompt, and then emitted `create_graph_plan`.

Consequence: allowed operations, prompt instructions, persisted skill state, and frontend action behavior do not share one authoritative decision.

### BUG-MAO-004 — Story chat contaminates Media Preset state

Risk: P1  
Confidence: High

The same session persisted both `story_project` and `reference_style_brief`. The preset brief was synthesized from the assistant's storyboard prose, produced the title `A Strong Storyboard Arc Would Move Through...`, and exposed a generic `Location` field even though the user had not asked for a preset.

Consequence: follow-up routing can be captured by the preset loop, stale state can leak across modes, and artifact drafts can be based on assistant prose instead of the source image and user goal.

### ARCH-MAO-005 — Backend and frontend both implement phrase-based action arbitration

Risk: P1  
Confidence: High

The backend `routes.py` contains many special request detectors and deterministic early returns. The frontend independently uses a large phrase/regex matrix to decide whether to chat, draft, save, plan, auto-apply, or run.

Consequence: natural paraphrases can route differently across layers; a provider response can be correct while the UI performs the wrong action; every new use case adds more exclusions.

### ARCH-MAO-006 — Core assistant skills are declared but not implemented symmetrically

Risk: P1  
Confidence: High

Media Preset Builder has a detailed orchestrator and focused prompt assets. Prompt Recipe Builder, Graph Workflow Builder, Run Debugger, and General Helper are five-line placeholder prompt skills. Prompt Recipe Builder explicitly states that full implementation follows later.

Consequence: the assistant feels capable only inside narrow recognized lanes and generic elsewhere. Storyboard-to-recipe is not owned by a complete artifact-specific orchestration contract.

### UX-MAO-007 — Storyboards are emitted as oversized chat prose

Risk: P2  
Confidence: High

The live storyboard assistant message is 9,418 characters. The built-in transcript-quality audit fails it with `assistant_long_unformatted_reply`. The panel renders one long message rather than a compact diagnosis plus structured, collapsible shots.

Consequence: the user cannot easily compare, edit, approve, or reuse individual shots and fields.

### BUG-MAO-008 — Applied-plan restoration is weak for unsaved/standalone tabs

Risk: P2  
Confidence: Medium

The live session is `owner_kind=standalone`, `owner_id=null`; its applied plan has `applied_workflow_id=null`. The current canvas contains the 11 applied nodes, but the reopened assistant panel shows no plan card.

Consequence: the graph and chat can disagree about whether an artifact was applied, especially before a workflow is saved.

### TEST-MAO-009 — Existing suites do not cover the real artifact-to-runtime seam

Risk: P0  
Confidence: High

The focused web assistant tests and typecheck pass. Existing storyboard-preflight tests cover prompt parsing in isolation. They do not execute an assistant-generated environment-plus-storyboard graph with stubbed provider executors and assert that only the actual storyboard model receives storyboard preflight.

## Product Contract

### SPEC-MAO-001 — One authoritative turn decision

Every user turn must produce one typed decision containing:

- conversational intent;
- artifact target: none, preset, recipe, storyboard/story project, or graph;
- requested action: discuss, analyze, propose, draft, apply, run, save, or repair;
- image roles and authority;
- clarification requirement;
- mutation/spend safety class;
- response kind;
- allowed next actions.

The frontend consumes this decision. It must not independently re-derive the primary action from user phrases.

### SPEC-MAO-002 — Typed visual analysis artifact

Image analysis must persist a source-grounded artifact with:

- observable visual traits;
- subject/identity/prop/environment/style roles;
- composition, palette, lighting, texture, camera, and layout;
- visible storyboard panel structure when present;
- uncertainties and focused questions;
- candidate reusable fields;
- candidate image slots;
- candidate artifact types.

Assistant prose may summarize this artifact but must not be the only durable representation.

### SPEC-MAO-003 — Artifact proposals before artifact creation

The assistant may propose one or more artifacts from the same analysis:

- Media Preset proposal;
- Prompt Recipe proposal;
- structured storyboard/story project;
- Graph workflow proposal.

Each proposal has its own typed lifecycle and must not create another artifact's state as a side effect.

### SPEC-MAO-004 — Storyboard-to-recipe contract

When a user supplies a storyboard reference, the assistant must be able to:

1. identify panel count, grid/layout, metadata rows, visual continuity, camera/action language, and reusable variables;
2. distinguish fixed template structure from user-editable story inputs;
3. propose a recipe with a concise user prompt and meaningful form fields;
4. preserve optional image roles;
5. create a reviewable Prompt Recipe draft only after the user asks;
6. test it in Graph Studio without saving or running paid media unless separately approved.

### SPEC-MAO-005 — Explicit prompt semantics at execution

Storyboard preflight must be selected from typed prompt/node provenance, not inferred solely from words inside a prompt.

At minimum, the runtime must distinguish:

- environment sheet;
- storyboard sheet with metadata;
- storyboard art-only source;
- character/reference sheet;
- ordinary image prompt.

Unknown or legacy prompts may use conservative compatibility detection, but new assistant-generated graphs must carry explicit semantics.

### SPEC-MAO-006 — Environment brief isolation

The environment branch receives only environment-owned information: geography, zones, materials, lighting, entrances/exits, action lanes, and state variants needed downstream. It must not receive the complete per-shot storyboard contract or panel metadata count.

### SPEC-MAO-007 — Chat-first structured response

Normal image/storyboard analysis should render:

- a short diagnosis;
- a compact “what can be reused” summary;
- structured shots or fields when applicable;
- one clear next question/action.

Large storyboard bodies must be collapsible or rendered as structured shot cards. The transcript-quality gate must pass.

### SPEC-MAO-008 — Stable session and active-tab ownership

Assistant sessions, plans, and applied state must remain associated with the active tab even before a workflow is saved. Reload must reconcile:

- session identity;
- tab/workspace identity;
- current canvas;
- latest applicable/applied plan;
- undo state.

### SPEC-MAO-009 — Safe execution boundary

Analysis, proposals, drafts, and local graph application do not authorize:

- a paid provider run;
- workflow save/overwrite;
- artifact save;
- output save;
- deletion.

### SPEC-MAO-010 — End-to-end verification

Tests must cross the actual seams:

- attachment → analysis → artifact proposal;
- story chat → structured storyboard;
- storyboard approval → applied graph;
- applied graph → stubbed environment and storyboard execution;
- persisted session/plan → reload;
- exact UI auto-action from the typed server decision.

## Scope and Non-Goals

In scope:

- assistant routing/orchestration;
- typed visual analysis and artifact proposal state;
- story/preset/recipe isolation;
- environment/storyboard graph compilation;
- explicit storyboard preflight semantics;
- assistant panel response structure and applied-state restoration;
- focused no-network and no-paid verification.

Not in scope:

- replacing the configured LLM provider;
- redesigning all of Graph Studio;
- changing paid model pricing;
- migrating all historical assistant sessions;
- automatically running or saving;
- broad recipe or preset schema migration before contract tests exist.

## Verification Commands

```bash
./scripts/with_shared_python.sh -m pytest apps/api/tests/test_media_assistant.py apps/api/tests/test_storyboard_metadata_preflight.py -q
npm --workspace apps/web test -- --run components/graph-studio/creative-assistant-panel.test.tsx components/graph-studio/hooks/use-creative-assistant-intent.test.ts
npm run typecheck:web
git diff --check
```

New Phase 0 tests must run without network, provider calls, media jobs, saved workflows, or credit changes.

