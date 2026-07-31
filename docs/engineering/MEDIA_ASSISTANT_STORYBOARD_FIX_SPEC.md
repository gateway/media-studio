# Media Assistant Reference-Storyboard Graph Fix

Last updated: 2026-07-23  
Mode: Bug-fix specification  
Status: Complete through Phase 5; shipped and verified 2026-07-23

> Follow-up found 2026-07-24: graph application remains verified, but the first live execution of the generated Environment branch failed because its full storyboard-shaped prompt was incorrectly subjected to eight-panel storyboard preflight. The broader orchestration and execution follow-up is specified in [Media Assistant Orchestration and Storyboard Execution Spec](MEDIA_ASSISTANT_ORCHESTRATION_SPEC.md).

## 1. Objective

Make Graph Studio's Media Assistant reliably complete this conversational workflow:

1. The user attaches one or more reference images.
2. The user asks for a storyboard based on those references and supplies creative direction.
3. The assistant produces structured storyboard shots and persists them as story-project state.
4. The user approves the storyboard and asks to add it to the current workflow.
5. Media Studio creates and applies a validated graph plan to the open canvas.
6. Media Studio does not run the graph, save generated media, or spend credits without a separate explicit request and any required confirmation.

The fix must make the assistant truthful about what it can do, preserve explicit reference roles, and recover when an older session contains a readable storyboard but is missing structured `story_segments`.

## 2. Confirmed Incident

### 2.1 Reproduction session

- Assistant session: `asst_735de65f5fb5`
- Workflow: `graphwf_b5fd05f41380` (`Immortal Prism`)
- Attached image: `138c374c-d8be-49bf-aa28-c2d1bf06e21c.png`
- Attached reference id: `ref_f4d9fe1f6d72`
- Final user command: `Apply the approved Earth Games storyboard graph`

The attached image depicts large hard-tech cleanup machines on a polluted tropical shoreline. It is not a character sheet and does not depict the Farmer Kid.

### 2.2 Observed failure

The assistant:

- produced an eight-shot Earth Games storyboard in chat;
- introduced the Farmer Kid from the current graph's latest output even though the user asked to use the attached machine reference;
- claimed that two references were locked, while the assistant tray showed one user attachment;
- invented an `Add to current workflow` button that did not exist;
- later claimed the chat lacked graph-editing access;
- created a validated graph plan with zero operations;
- did not modify or run the workflow.

The persisted plan contained:

```json
{
  "summary": "I need an approved storyboard segment before I can build the story graph.",
  "operations": [],
  "metadata": {
    "missing_story_segment": true
  },
  "applied_workflow_id": null
}
```

### 2.3 Read-only red signal

The durable incident assertion is:

```text
RED: approved storyboard request compiled to zero graph operations
```

This signal must become green after implementation:

```text
GREEN: approved storyboard request produced and applied a non-empty graph plan
```

## 3. Root Causes

### RC-1 — Substring collision misclassifies photographic language

`story_state._turn_kind()` checks whether `"graph"` occurs anywhere in normalized text. Both `photographic` and `Photographed` contain the substring `graph`, so the original storyboard request was classified as `graph_review` instead of `storyboard`.

Because the turn was not classified as a storyboard turn, the assistant's eight visible shots were never stored in `story_project.story_segments`.

One-variable confirmation:

| Input | Turn kind | Story segments | Parsed shots |
| --- | --- | ---: | ---: |
| Original prompt containing `photographic` and `Photographed` | `graph_review` | 0 | 0 |
| Same prompt with those two words replaced | `storyboard` | 1 | 8 |

### RC-2 — `apply` is not an explicit graph-action verb

`is_explicit_graph_creation_request()` recognizes `create`, `build`, `make`, `add`, `wire`, and `connect`, but not `apply`.

Therefore `Apply the approved Earth Games storyboard graph` routes to the story/general answer path rather than directly to the workflow builder. The provider then writes conversational refusal text even though the application has graph-planning and graph-application capabilities.

### RC-3 — Latest graph output is silently mixed with user attachments

Provider image paths are assembled in this order:

1. latest graph output images;
2. assistant-tray attachment images.

The incident turn therefore sent two images to the provider:

1. the current graph's Farmer Kid output;
2. the attached cleanup-machine image.

The ordinary story prompt does not provide a typed role manifest that explains this ordering. The provider treated both as references and chose the Farmer Kid as the human anchor, even though the user specifically said the storyboard should be based on the attached image.

### RC-4 — Any attached image is promoted to an approved character sheet

`_story_project_with_attachment_character_sheet()` assigns the first image attachment to `approved_character_sheet` when no sheet is already present.

This incorrectly turned the cleanup-machine reference into an approved character sheet. Story attachments need explicit roles; image presence alone is not evidence of character-sheet semantics.

### RC-5 — Markdown field labels are parsed as character names

`_candidate_character_names()` accepts any bold `**Name:**` label. The assistant's inline storyboard formatting caused `Duration`, `Camera`, `Action`, and `Prompt` to be stored as characters.

The shot parser also retained markdown markers and allowed later fields to bleed into earlier values when all shot fields appeared on one rendered line.

### RC-6 — Visible assistant claims are not grounded in action results

Provider-generated chat copy can claim that an action is unavailable or instruct the user to click a nonexistent control. The actual graph plan and application state are computed separately.

Visible mutation claims must be derived from deterministic plan/apply results, not trusted from provider prose.

### RC-7 — Empty plans and plan recovery are not durable enough in the UI

The zero-operation plan was persisted, but after reload the assistant panel showed only the conversation. It did not expose the persisted blocker or an actionable recovery path.

## 4. Product Contract

### SPEC-MAS-001 — Word-boundary intent classification

- `graph`, `workflow`, and related command terms must be matched as semantic tokens or phrases.
- Words such as `photograph`, `photographic`, `photographed`, `biographical`, and `telegraphic` must not trigger graph intent.
- A message containing `storyboard` or explicit numbered shots must remain a storyboard turn unless it contains an actual graph/workflow command.
- Classification helpers shared across API and web must use compatible vocabulary and test fixtures.

### SPEC-MAS-002 — Approval and apply commands are first-class actions

The following must be recognized as direct graph actions when a usable story or proposed graph exists:

- `apply the approved storyboard graph`;
- `add it to the current workflow`;
- `put this on the canvas`;
- `use that storyboard and build it`;
- `yes, do it`;
- `you're approved`;
- equivalent contextual follow-ups after the assistant has offered a graph action.

`apply`, `put`, `setup`, and contextual approval language must be part of the action contract. Negations such as `do not apply`, `do not add`, and `chat only` must continue to win.

### SPEC-MAS-003 — Storyboard text becomes structured durable state

- A storyboard reply with `Shot N` sections must be parsed into one `story_segment`.
- The segment must retain the exact number of visible shots.
- Each shot must have clean fields for duration, camera, action, motion when present, prompt, and continuity notes.
- Markdown markers and neighboring field labels must not leak into values.
- Story state must be persisted before a later approval/apply turn depends on it.
- Unsupported or partially parsed formats must produce a visible, truthful blocker rather than silently storing zero segments.

### SPEC-MAS-004 — Reserved storyboard labels are not characters

At minimum, the following labels are reserved and cannot become character names:

`Shot`, `Scene`, `Duration`, `Camera`, `Framing`, `Action`, `Motion`, `Prompt`, `Continuity`, `Notes`, `Dialog`, `Dialogue`, and `Environment`.

Character extraction must prefer explicit character declarations, named-subject structures, approved character references, or typed provider output.

### SPEC-MAS-005 — Typed image-role manifest

Every provider turn with images must receive a role manifest aligned with the image order. Supported roles should include:

- `user_attachment`;
- `character_identity`;
- `body_shape`;
- `environment_reference`;
- `machine_or_prop_reference`;
- `style_reference`;
- `previous_storyboard`;
- `latest_graph_output_for_review`.

The role manifest must include the visible label/reference id where safe, the source, and whether the image is authoritative or inspiration-only.

The provider must never have to infer image roles only from position.

### SPEC-MAS-006 — Latest output is opt-in outside review

- The latest graph output may be included automatically for explicit output review, comparison, repair, or continuation requests.
- It must not be silently added to a new storyboard request that explicitly refers to the attached image.
- If both latest output and user attachments are needed, the assistant must label their roles and state that both are being used.
- User-attached references take precedence when the user says `attached image`, `this image`, or equivalent.

### SPEC-MAS-007 — Character-sheet promotion requires evidence

An attachment may become `approved_character_sheet` only when at least one of these is true:

- the user explicitly calls it a character sheet or character reference;
- the attachment already carries a typed character role;
- the user approves a prior assistant proposal that explicitly assigned the character-sheet role.

A generic image attachment must remain a generic/user reference until classified. No schema migration is required if the role can be stored in existing attachment metadata or assistant state.

### SPEC-MAS-008 — Deterministic graph compilation

When an approved storyboard exists and the user asks to apply it:

- the backend must create a non-empty typed graph plan;
- the plan must validate before application;
- the plan must preserve the approved shot count and reference roles;
- the graph must be added to the current open workflow, not a hidden or unrelated workflow;
- the graph change must enter normal undo history;
- no provider run may start as part of graph application;
- no output asset may be saved as part of graph application.

If a storyboard uses a supported sheet layout, the compiler may use the existing storyboard recipe contract. If the approved shot count or requested output does not fit a supported sheet contract, the compiler must either build count-preserving shot branches or ask one focused question before applying. It must not silently change eight approved shots into another count.

### SPEC-MAS-009 — Recovery for existing malformed sessions

For a session with:

- no structured `story_segments`;
- a recent assistant message containing parseable `Shot N` sections;
- a later explicit apply request;

Media Studio must attempt deterministic history recovery before returning `missing_story_segment`.

Recovery must:

- parse only the relevant recent storyboard response;
- preserve the original user brief;
- record that recovery occurred in the turn trace;
- avoid rewriting unrelated session history;
- fail closed with a specific question if parsing is ambiguous.

The incident session must become recoverable without a database-wide migration.

### SPEC-MAS-010 — Truthful assistant action copy

- Provider prose may describe creative content, but it may not be the source of truth for whether a graph was planned or applied.
- After planning, visible copy must be rendered from the actual plan result.
- After application, visible copy must be rendered from the actual apply result and workflow id.
- The assistant must not mention buttons or controls that are not rendered in the current UI.
- `I cannot edit this workflow` is allowed only when the server has positively determined that the action is unavailable.
- A zero-operation plan must show its real blocker and recovery action.

### SPEC-MAS-011 — Persisted plan visibility

- Reopening the assistant must restore the latest relevant plan or blocker for the current workflow.
- Applied, unapplied, invalid, and zero-operation states must be distinguishable.
- A non-empty valid plan must expose the real add/apply control.
- A zero-operation plan must not expose an apply button, but it must display its question or recovery path.

### SPEC-MAS-012 — Safe mutation and spend boundary

Applying an assistant graph is a local workflow mutation. It does not authorize:

- running the workflow;
- submitting paid media or LLM jobs;
- saving generated outputs;
- overwriting a saved workflow;
- deleting nodes, assets, runs, or assistant history.

Existing confirmation and pricing gates remain in force.

### SPEC-MAS-013 — Traceability

The sanitized assistant turn trace must record:

- resolved intent and triggering phrase family;
- story turn kind;
- story segment count before and after;
- parsed shot count;
- image role manifest and provider image count;
- latest-output inclusion reason;
- graph plan operation count;
- plan template id;
- validation result;
- application result/workflow id;
- history recovery status.

Do not record secrets or unrestricted local paths.

## 5. Expected Incident Behavior After the Fix

Given the original Earth Games request:

1. The turn is classified as `storyboard`, despite the words `photographic` and `Photographed`.
2. The attached cleanup-machine image is identified as a user machine/environment/design reference, not a character sheet.
3. The latest Farmer Kid graph output is not automatically included.
4. The assistant returns eight structured shots without inventing a character from unrelated canvas output.
5. The session stores one segment containing eight shots.
6. `lets do it`, `yea add it to the current open workflow please`, or `Apply the approved Earth Games storyboard graph` resolves to a direct graph action.
7. The backend produces a validated non-empty plan that preserves all eight approved shots.
8. The web client applies that plan to the active workflow and shows the actual applied state.
9. No graph run, media save, or credit spend occurs.

## 6. Public Interface and Data Impact

### API behavior

Existing assistant message, plan, and apply endpoints remain the public surface. Response schemas should remain backward compatible.

New optional trace or metadata fields may be added for:

- image roles;
- story recovery;
- resolved action;
- plan/apply grounding.

### Persistence

Prefer existing JSON columns:

- attachment `metadata_json`;
- assistant message `content_json`;
- session `summary_json`;
- session `state_snapshot_json`;
- plan `plan_json`.

No relational schema migration is expected. If implementation proves a typed persistent role column is required, stop and revise this spec before adding a migration.

### Existing workflows

Do not migrate or rewrite saved workflows. The fix changes newly created assistant plans and on-demand recovery of assistant session state only.

## 7. Files Likely in Scope

Backend:

- `apps/api/app/assistant/story_state.py`
- `apps/api/app/assistant/intent.py`
- `apps/api/app/assistant/routes.py`
- `apps/api/app/assistant/provider_chat.py`
- `apps/api/app/assistant/story_graph.py`
- focused assistant schemas/helpers if a typed image-role structure is extracted
- `apps/api/tests/test_media_assistant.py`

Web:

- `apps/web/components/graph-studio/utils/creative-assistant-intent.ts`
- `apps/web/components/graph-studio/hooks/use-creative-assistant.ts`
- `apps/web/components/graph-studio/creative-assistant-panel.tsx`
- their focused tests

Documentation:

- this spec;
- `MEDIA_ASSISTANT_STORYBOARD_FIX_TASKS.md`;
- `docs/engineering/VERIFICATION_LOG.md` when implementation begins;
- canonical changelog/task tracker only when the fix ships.

## 8. Non-Goals

- Redesigning all Media Assistant modes.
- Replacing the provider or model.
- Rewriting Graph Studio.
- Changing Prompt Recipe semantics unrelated to storyboard state.
- Migrating every historical assistant session.
- Automatically running newly created graphs.
- Performing a paid proof.
- Modifying the current Earth Games workflow during implementation without a separate explicit request.

## 9. Verification Strategy

### Backend unit and integration tests

- Exact original Earth Games prompt including `photographic` and `Photographed`.
- Exact final apply command.
- Contextual approval variants and negations.
- Inline and multiline storyboard markdown parsing.
- Reserved-label character rejection.
- Typed image-role ordering.
- Latest-output exclusion for new storyboard creation.
- Latest-output inclusion for explicit output comparison.
- Existing-session story recovery.
- Non-empty graph plan and validation.
- No run/save side effect during apply.

### Web tests

- Auto-action resolution for `apply`.
- Plan application on the active workflow.
- Persisted plan/blocker restoration.
- No nonexistent-button language supplied by UI helpers.
- Applied graph enters undo history.

### Browser proof

Use the original reference and creative brief in Graph mode on a disposable or explicitly approved workflow:

1. attach the cleanup-machine reference;
2. request the Earth Games storyboard;
3. confirm eight shots are visible;
4. approve and apply;
5. confirm the new graph is on the active canvas;
6. confirm the graph is unrun and no credit balance changed;
7. reload and confirm the assistant shows the persisted applied state.

Do not use the user's active production workflow for the first proof.

### Recommended commands

```bash
./scripts/with_shared_python.sh -m pytest apps/api/tests/test_media_assistant.py -q
npm run test -- --run apps/web/components/graph-studio/hooks/use-creative-assistant-intent.test.ts
npm run test -- --run apps/web/components/graph-studio/creative-assistant-panel.test.tsx
npm run typecheck:web
npm run lint:web
git diff --check
```

Use the repository's current supported web-test command if the targeted `npm run test` syntax differs.

## 10. Acceptance Criteria

The fix is complete only when:

- the exact incident prompt stores one eight-shot segment;
- `photographic` and `Photographed` do not trigger graph intent;
- the exact final apply command routes to graph construction;
- the incident attachment is not classified as a character sheet;
- unrelated latest graph output is not sent to the provider;
- `Duration`, `Camera`, `Action`, and `Prompt` are not characters;
- the resulting plan contains graph operations and validates;
- the graph applies to the active workflow;
- the UI reports the actual applied result and no fictional control;
- reloading preserves the relevant plan/applied state;
- no run, save, paid job, or credit change occurs;
- focused backend/web tests and browser no-paid proof pass.

## 11. Rollback

The implementation must remain separable by concern:

1. intent/story parser changes;
2. image-role/context changes;
3. history recovery;
4. graph apply grounding;
5. UI plan persistence.

If a phase regresses unrelated assistant behavior, revert that phase only. No rollback may delete assistant history, saved workflows, runs, or media. New JSON metadata must be optional so older records remain readable.
