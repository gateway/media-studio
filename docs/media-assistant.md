# Media Assistant

Media Assistant is an experimental Graph Studio collaborator for building and reviewing Media Studio artifacts through ordinary conversation. It is intentionally hidden from normal users while its release boundary is hardened.

## Current exposure boundary

Operational Assistant API routes are enabled only when
`NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG=1` is present when the API starts.
The Graph Studio panel has two additional requirements:

1. the same flag was present when the web app started;
2. API health reports both the backend gate enabled and Codex Local ready.

The example environment leaves this flag unset. The API fails closed with `404` for operational Assistant routes when disabled, while normal Studio, Graph, Preset, Recipe, health, and provider-configuration routes remain available. Existing control-token access still applies when the Assistant is enabled. Do not enable the panel for general users until the release checklist is complete.

## Responsibilities

Media Assistant can:

- discuss Media Studio concepts without changing the canvas;
- inspect the active Graph workflow and propose validated operations;
- analyze attached references and persist typed visual evidence;
- draft, revise, test, and prepare Media Presets for explicit save confirmation;
- draft, revise, test, and prepare Prompt Recipes for explicit save confirmation;
- develop persistent story, character, continuity, and shot state;
- prepare grounded production plans with ordered dependencies;
- inspect persisted run evidence and explain failures;
- compare an eligible generated image with its attached references.

Media Presets, Prompt Recipes, Graph workflows, and story state remain separate artifacts. One capability must not create another capability's state as an incidental side effect.

## Turn lifecycle

Each user turn follows one backend-owned path:

1. Assemble stable base/developer instructions plus the one selected capability prompt.
2. Provide bounded user, attachment, session, workflow, and selected-run context.
3. Select one capability and one typed artifact intent.
4. Use only the registered Media Studio tools needed for that turn.
5. Validate typed artifacts and provenance before persisting or presenting an action.
6. Return a compact human-facing reply plus any server-owned next action.

The client renders typed results. It does not infer the primary action from phrases or silently perform a second workflow.

Current capabilities are:

- `general`
- `graph_builder`
- `preset_builder`
- `recipe_builder`
- `story_builder`
- `run_debugger`

The assistant should understand natural, incomplete language and ask one focused question when a required decision is genuinely missing. Scenario-specific keyword routing and production test phrases are not part of the contract.

## Typed state and provenance

Durable assistant state lives in the existing Assistant session/message/plan records and their JSON state. No separate assistant database is required.

Important state includes:

- capability and artifact intent;
- preset, recipe, story, and production-plan drafts;
- reference-analysis evidence;
- graph proposal and applied-plan identity;
- workflow and quality-contract fingerprints;
- run confirmation and exact run association;
- generated-output evidence and explicit human quality decisions;
- provider thread identity and prompt-contract generation.

Artifact changes invalidate incompatible evidence. Name-only edits may preserve quality state when the execution contract is unchanged. Missing or ambiguous associations fail closed instead of selecting the latest run, output, plan, or recipe by convenience.

## Action and spend boundaries

Conversation, analysis, drafting, validation, and graph proposals do not authorize mutation or spend.

Separate user-visible confirmation boundaries protect:

- adding or replacing a graph on the canvas;
- starting a workflow run;
- saving a Media Preset;
- saving a Prompt Recipe;
- overwriting a saved workflow;
- starting another refinement run.

A completed output does not authorize another provider call. The assistant may recommend one focused refinement, but it must wait for the user's decision and the normal run confirmation.

## Preset and recipe quality loop

A reusable image workflow normally progresses through these distinct turns:

1. Analyze references or the user's written goal.
2. Propose a typed Preset or Recipe draft.
3. Prepare a validated, priced test graph.
4. Add the approved graph to the canvas.
5. Confirm and run the graph.
6. Bind the exact completed run and eligible output to the originating assistant plan.
7. Compare pixels with source references.
8. Record the user's approve, continue-refining, or stop decision.
9. Save only from the compatible validated contract.

References used for critique are not automatically model inputs. The graph's typed recipe/preset contract decides what the model consumes.

## Story and storyboard behavior

Story work persists premise, characters, world rules, continuity facts, and shots before graph construction. Exact shot counts and untouched shots survive narrow revisions.

Storyboard execution uses typed prompt semantics for current built-in recipes:

- environment sheet;
- storyboard sheet with metadata;
- storyboard art-only source;
- supported ordinary/non-storyboard prompt semantics.

Unknown or legacy prompts keep conservative content detection. Environment prompts must not be treated as metadata-bearing storyboard sheets merely because they contain story vocabulary.

The current deterministic storyboard path uses `storyboard.compile` to produce `StoryboardSheetSpec` and `image.storyboard_sheet` to compose the final sheet. The Graph node and Prompt Recipe contracts remain authoritative; campaign-specific stories, run IDs, assets, and visual proofs do not belong in shared runtime code.

## Session continuity

Codex Local sessions reuse persisted provider threads when the prompt contract is compatible. A prompt-contract change advances the provider generation so stale instructions are not reused. Assistant state remains server-owned and should survive ordinary page reloads and supported API restarts.

Long turns have bounded tool steps and wall time, remain cancellable, and expose conservative progress states. Successful typed artifacts terminate without an unnecessary extra provider step.

## Verification

Changes to Media Assistant require proportionate proof:

- focused backend tests for the affected typed contract;
- focused web tests for rendering and action state;
- no exact assistant-sentence assertions;
- no-network integration coverage across proposal, apply, and runtime seams;
- browser verification for user-facing Graph Studio behavior;
- explicit paid-run approval when generation is necessary;
- unchanged pricing, auth, persistence, and saved-workflow behavior unless separately approved;
- `git diff --check` and the relevant release gates.

Assistant-relevant pushes and pull requests also run `npm run quality:assistant-ci` through the path-scoped `media-assistant-ci` workflow. This credential-free gate runs deterministic fixtures for typed tool traces, required evidence, next-action shape, workflow validity, banned vocabulary, process reuse, step limits, and unconfirmed mutation. A focused fake-provider backend suite exercises the same runtime boundaries without Codex credentials, network inference, generation, or paid work.

This mechanical gate does not judge whether a live reply feels human, is contextually useful, or makes the best creative choice. Exact live conversations and the Human / Grounded / Correct / Useful / Safe browser rubric remain mandatory at the release boundary.

Historical engineering campaigns and paid-proof logs are preserved by the archive tag `archive/media-assistant-development-2026-08-18`. The changelog records shipped outcomes; this document owns the current architecture and safety boundary.
