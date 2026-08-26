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

### Assistant package-growth boundary

`scripts/check_file_size_guardrails.py` caps the recursively counted Python source under `apps/api/app/assistant/` at 11,299 lines, the exact total on reviewed post-Ticket-7 candidate `8abd72b`. The count includes every `*.py` source file, ignores `__pycache__` and non-Python artifacts, and runs in both `npm run quality:assistant-ci` and the release quality gates. Individual-file caps remain in force, so the package cap cannot be bypassed by splitting a large module.

Do not raise the cap merely to make a gate pass. An approved increase must accompany necessary, reviewed Assistant capability, state the before/after package total and why equivalent deletion or reuse was not appropriate, retain the individual-file caps, and include the cap change in the same review. Net-neutral refactors and reductions need no cap change.

## Release checklist

The Assistant remains an explicit per-install pilot until all of these criteria pass on one release candidate:

- **Correctness and safety:** the exact continuous browser walks for presets, graphs, recipes, production planning, restart continuity, and voice/safety score Human, Grounded, Correct, Useful, and Safe on every accepted reply. There are no HTTP 5xx responses or timeouts, unconfirmed graph mutations, saves, or provider jobs. Recipe proof includes populated graph construction and stale-canvas rejection; run proof stops at a typed confirmation unless a paid run was separately approved.
- **Verification currency:** the mechanical probe, full browser pass, release gate, and Studio smoke run on the candidate commit. A later change to Assistant runtime, provider lifecycle, panel/actions, or run-evidence behavior invalidates the affected proof and requires that portion to be rerun.
- **Latency and provider steps:** across three isolated real-provider conversation-suite runs, ordinary replies have wall-time p50 at or below 15 seconds and p95 at or below 30 seconds. Reference-analysis replies are reported separately and have p95 at or below 60 seconds with truthful visible progress. At least 90% of replies complete in no more than two provider steps, none exceed four, and no turn exhausts its step or wall-clock budget.
- **Cost:** across those three runs, summed provider tokens average no more than 50,000 per accepted reply and p95 is no more than 100,000. Maximum tokens in one provider step are reported separately. Media-generation credits remain governed by the normal priced confirmation and are never implied by conversation alone.
- **Continuity:** the existing lowered-threshold compaction proof remains valid unless provider lifecycle code changed, and the release browser pass proves thread recovery plus correct recall across an API restart.
- **Staged rollout:** `NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG=1` remains the per-install opt-in. Before considering any default exposure change, record at least 100 attempted pilot Assistant requests across ordinary preset, recipe, and graph work, reporting accepted replies and failures separately.
- **Release hygiene:** Tickets 07–08 and the standing release gates pass; the Assistant route adapter retains file-size headroom; Assistant package growth has a reviewed package-total cap; and no migration or saved-artifact compatibility change is introduced without separate approval.

Immediately disable the per-install flag and stop the pilot after any unconfirmed mutation, save, spend, cross-session evidence use, wrong-run/output association, stale quality approval, data loss, saved-artifact incompatibility, or auth boundary failure. Also stop after a reproducible rubric zero, two or more HTTP 5xx/timeouts in a rolling 100 attempted requests, ordinary-reply p95 above 45 seconds in two consecutive 50-attempt windows, or repeated budget exhaustion. Re-enable only after a focused regression test, the affected browser walk, and exact-candidate verification pass again.

Meeting this checklist does not change the default feature gate. Default exposure is a separate human release decision.

## Pilot decision — 2026-08-24

**NO-GO.** Keep the Assistant behind the existing per-install opt-in. Runtime candidate `86ded2ab5635ae96509278283be9b7fd28439093` does not meet the latency, token, provider-step, availability, or complete-proof criteria above.

Three isolated 23-turn conversation suites produced these distributions:

| Run | Mechanical | Ordinary p50 / p95 | Reference p95 | Tokens avg / p95 | Replies in ≤2 steps | Max steps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 17 / 23 | 20.3s / 64.1s | 51.9s | 80.9k / 149.7k | 69.6% | 5 |
| 2 | 16 / 23 | 17.0s / 56.4s | 94.1s | 77.3k / 142.5k | 69.6% | 5 |
| 3 | 16 / 23 | 12.8s / 32.8s | 48.5s | 73.5k / 174.8k | 73.9% | 6 |

No suite exhausted its provider-step budget, but every suite exceeded at least one accepted ceiling. The strict fixture also rejected several turns where the live Assistant safely asked for missing inputs instead of manufacturing a graph; those contract deviations remain failures until the fixture and intended contract are reconciled deliberately.

The continuous human browser pass covered reference-backed preset design, graph construction, saved Prompt Recipe reuse, stale-canvas rejection, production/story work, API-restart continuity, conversational guidance, invalid/empty graph review, and repair. Preset, graph, recipe, restart, and safety responses were grounded and useful, and no provider media job or credit spend occurred without an explicit run action. One real saved-recipe defect was fixed test-first: when graph planning persisted a useful clarification but returned the known no-plan 400, the panel now renders that clarification; unrelated 5xx errors remain visible, and Stop owns the recovery refresh so a late response cannot replace cancelled state.

The Ticket 02 pickup independently proved Prompt Recipe creation and reuse through the in-app browser. In Assistant session `asst_8878b5814d6b`, the text-only `Product Hero Prompt Director` saved as `recipe_b6a96fddaaad`, survived a workspace reload, and ran as that exact identity in `grun_de751062a696`, rendering a clean 1,411-character prompt through Display Anything. The reference-informed `Vintage Travel Collage Prompt Director` saved as `recipe_8f5e225bb7a8`; its Italy analysis attachment was omitted from the first runtime graph, then the same recipe identity was explicitly revised to optional `direct_reference` mode and `grun_c1f80b929991` used the exact selected reference through a typed image wire to render a 2,240-character prompt. Both graph runs completed with no media node, no media credits, no credit-balance change, and no browser errors. Focused verification passed 24 backend and 13 web tests, Assistant CI passed 11 deterministic and 26 backend tests, and the full release gate passed 795 backend and 735 web tests plus all repository guardrails and build checks.

The Ticket 03 pickup independently proved Media Preset creation and reuse in the same browser session. The Italy reference produced distinct T2I and I2I drafts: T2I kept three visible text fields with zero image slots, while I2I kept those controls plus one required `featured_scene` runtime image slot and a content-preservation contract. Existing confirmed run `grun_820ebbb0163f` and output `asset_68d42d766885` supplied exact no-generation comparison evidence. The approved T2I draft saved through its typed product action as `preset_7fe77be6a7ec` / `vintage_travel_scrapbook`; applied plan `asplan_72363f2bfbf6` then reused that identity with editable Kyoto / Explore / Lanterns Through Time values, two output wires, one enclosing group, clean validation, and a 6-credit / $0.03 estimate. Reload preserved the unsaved graph, and no new run or credit spend occurred. The walk exposed and fixed one saved-artifact handoff defect: clean replacement planning used a blank base while confirmation posted the occupied canvas. The client now submits that exact blank base only while the source canvas is unchanged; real graph edits still reach the server's stale-plan guard.

The Ticket 04 pickup independently proved custom-graph orchestration and precise revision through the in-app browser. Session `asst_d1c8a6ec508a` built a useful typed product graph, safely clarified the validator-required Preview, added Save through the selected existing group, and changed only GPT Image 2 resolution from 1K to 2K while preserving 5 nodes, 3 wires, the exact prompt and note, 4:3, Preview, Save, positions, and group membership. The walk fixed two connected defects test-first: visible group selection now reaches the Assistant's existing typed canvas context, and `add_node.group_ref` now expands the referenced existing group and recomputes padded bounds instead of leaving the added output outside the promised frame. A second session, `asst_f39a5e4f78ec`, built a distinct grouped still-to-motion graph with separate still/motion prompts, GPT Image 2 1K/16:9 feeding Seedance's start frame, Seedance 5 seconds/720p/audio on, and branched Preview Video/Save Video outputs. The 321-credit/$1.61 graph remained a reviewed proposal until it was added to the canvas. A direct toolbar boundary check inherited the browser profile's stored pricing-dialog opt-out and was immediately cancelled: run `grun_1a0834681a01` spent 6 credits on the prerequisite image, while Seedance and downstream video work were cancelled.

The Ticket 05 pickup independently proved image-output chaining without another provider run. Session `asst_d93b25798f34` / plan `asplan_102c3532447c` built a valid T2I graph whose GPT Image 2 output branches directly to Preview Image, Save Image, and Seedance 2.5 `start_frame`; Seedance used a separate useful motion/audio prompt, 5 seconds, 720p, audio on, Preview Video, and Save Video. Session `asst_2c706e2b9193` / plan `asplan_d75488913f12` began with exact generated output `asset_68d42d766885` chosen from Graph Studio's Generated Images library. It preserved one asset-backed `media.load_image`, used zero Assistant reference attachments and no `reference_id`, routed that image into GPT Image 2 I2I and directly into a separate Seedance start frame, then routed the I2I output to Preview Image, Save Image, and another Seedance start frame. Both reviewed workflows validated with zero errors or warnings. The backend estimator showed approximately 321 credits/$1.61 and 636 credits/$3.18 from the current complete site-pricing snapshot; observed site pricing remains explicitly non-authoritative provider billing. Credits stayed at 876.6, no Run action or retry occurred, and the browser reported no warnings or errors.

The Ticket 06 pickup refuted the earlier production 502s on the current candidate and closed the related restart-continuity gap. Browser session `asst_94a3af6eb507` completed the continuous 45-second salvage-production walk without retry: character and environment anchors, exactly three 15-second shots, and a narrow revision whose persisted hashes changed only Shot 2. A reviewed 1K, 9:16 Shot 1 graph retained exactly Prompt Text → GPT Image 2 → Preview Image, no Save node, and one enclosing group. After a complete local API/web restart, provider thread `01a039e8-ceb1-7293-bbde-06cf46586651` resumed from disk and accurately recalled the 45/15/3 plan, the isolated revision, and all graph constraints. The walk found and fixed one public evidence omission test-first: `read_current_workflow` now returns the existing bounded group summary, allowing the restarted Assistant to identify `Shot 1 — Breach Keyframe` and its three member nodes. No media ran and credits remained 876.6.

The Ticket 07 pickup removed one measured source of avoidable debugger work without changing the six-step or 90-second safety budgets. On the exact candidate, both baseline debugger turns called the same `read_run_evidence` request twice after the typed, non-retryable `failed_run_not_found` result. The kernel now accepts that exact terminal absence as grounded evidence instead of forcing a second lookup. It does not accept `selected_run_not_found`; a regression proves that an invented provider run id cannot bypass valid UI-selected run evidence. Across six post-change debugger turns, every turn executed the evidence lookup once, five of six completed within two provider steps, wall-time p50/p95 were 14.6s/21.6s, and average provider tokens were 72.1k. The pre-change debugger pair used four provider steps each, averaged 26.9s and 136.2k tokens, so the bounded path improved average wall time by 40.9% and average tokens by 47.1%.

Three complete post-change 23-turn suites still produce an overall **NO-GO**:

| Run | Mechanical | Ordinary p50 / p95 | Reference p95 | Tokens avg / p95 | Replies in ≤2 steps | Max steps |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 15 / 23 | 16.4s / 69.8s | 47.2s | 84.4k / 206.6k | 68.2% | 5 |
| 2 | 16 / 23 | 19.5s / 85.8s | 58.0s | 79.2k / 156.7k | 72.7% | 5 |
| 3 | 16 / 23 | 18.2s / 76.8s | 54.1s | 75.3k / 146.5k | 77.3% | 4 |

Across the 66 ordinary post-change turns, p50/p95 were 19.5s/76.8s, average/p95 provider tokens were 79.6k/156.7k, and 72.7% completed within two provider steps. Reference-analysis p95 was 58.0s and no turn exhausted a provider-step or wall-clock budget. Prompt volume and process reuse did not materially regress: prompt bytes averaged 9.9k with 36.6k p95, with 39 process spawns and 100 live-process reuses across the ordinary cohort. Mechanical availability was 44/66; the same graph, recipe, preset, and six-shot contract failures remain release blockers. The largest remaining repeated production-flow tails are S4 story-to-graph materialization, followed closely by S2 six-shot expansion, but Ticket 07 deliberately stops after one measured lever instead of adding generic parallel tools or changing budgets by intuition.

Human in-app-browser verification used the ordinary prompt “It failed, what happened?” against a real persisted failed run. The Assistant named the empty six-panel sequence, downstream skipped save, zero generation cost, and a bounded repair; it scored Human / Grounded / Correct / Useful / Safe at 1/1/1/1/1. Persisted trace `asmsg_6c64dee8bf02` used one typed evidence call, two provider steps, 20.1 seconds, and 68.2k provider tokens, with no confirmation action, mutation, new run, media job, or spend.

Remaining release blockers:

- Ordinary latency, token volume, and provider-step distributions exceed the checklist ceilings. Reference analysis met its separate 60-second p95 ceiling in all three Ticket 07 samples.
- Prompt Recipe and Media Preset persistence/reuse are now proven; the paid Seedance video proof remains unproven. The private-reference audit passed at 9 / 10 overall (9 structural, 10 conversation, fields, slots, planner, and directness). The original 6-credit GPT Image 2 run predated toolbar provenance and correctly did not count. A later approved toolbar run completed once for exactly 6 credits (`898.6` → `892.6`). After the API restarted on the candidate code, the exact-match association seam recovered Assistant session `asst_8878b5814d6b`, applied plan `asplan_7f25e03a511b`, run `grun_820ebbb0163f`, and output `asset_68d42d766885` as the same preset-test evidence. The Assistant then returned a grounded visual comparison with Matches / Missing-or-drifting / one prompt change, without another provider job. The no-run output asset → Seedance 2.5 graph remains correctly configured at 5 seconds, 720p, audio enabled, with a motion/audio prompt, Preview Video, Save Video, and an authoritative 315-credit / $1.58 estimate.

Verification on candidate `86ded2ab5635ae96509278283be9b7fd28439093`: `npm run quality:assistant-ci` passed (11 deterministic contract tests and 26 backend tests); the focused preset/recipe evidence and preset-kernel suites passed 93 tests; and `npm run release:verify:full` passed with 795 backend tests and 735 web tests plus repository hygiene, genericity, file-size and style guardrails, lint, typecheck, production build, Studio browser smoke, clean-database bootstrap, migration status, and diff formatting. The in-app browser restored the exact Assistant proof session, displayed the grounded comparison and explicit no-run assurance, retained the 892.6-credit balance, and reported no browser errors. Earlier independent Standards and Spec Compliance reviews reported no remaining findings after their 5xx and cancellation concerns were fixed; the final Ticket 08 review found the toolbar provenance gap and one-cent Assistant-plan rounding drift, fixed both test-first, and found no further actionable issue.

Historical engineering campaigns and paid-proof logs are preserved by the archive tag `archive/media-assistant-development-2026-08-18`. The changelog records shipped outcomes; this document owns the current architecture and safety boundary.
