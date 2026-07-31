# Storyboard Multi-Board Continuity Spec

## Related shipped Media Assistant fix (2026-07-23)

The reference-image-to-storyboard assistant flow is specified separately in [Media Assistant Reference-Storyboard Graph Fix](MEDIA_ASSISTANT_STORYBOARD_FIX_SPEC.md). That contract is complete through Phase 5: reference-storyboard chat defaults to eight shots when no count is supplied, stays conversational until explicit graph approval, preserves exact shot count/reference roles, and applies without running or saving.

Last updated: 2026-07-10
Mode: Bug-fix planning and feature hardening

## Objective

- User request: make a three-board story preserve one character, one environment, one storyboard layout, and a coherent causal story while each board advances to new scenes.
- Intended outcome: Graph Studio and the Media Assistant build and run a dependency-correct Environment -> Storyboard 1 -> Storyboard 2 -> Storyboard 3 workflow with explicit reference roles, bounded GPT Image 2 prompts, stable output previews, and browser-verifiable results.
- Non-goals: Seedance generation, a broad Graph Studio rewrite, unrelated recipe cleanup, schema changes, dependency upgrades, or automatic paid runs.

## Requirements

### SPEC-001 - Canonical dependency chain

The workflow must enforce this execution graph:

```text
Character sheet ---------------------------> Storyboard 1 recipe/model
Environment recipe -> Environment GPT -> Save Environment
Saved Environment ------------------------> Storyboard 1 recipe/model
Storyboard 1 recipe prompt ----------------> Storyboard 2 previous handoff
Storyboard 1 image ------------------------> Storyboard 2 visual continuity
Saved Environment ------------------------> Storyboard 2 recipe/model
Storyboard 2 recipe prompt ----------------> Storyboard 3 previous handoff
Storyboard 2 image ------------------------> Storyboard 3 visual continuity
Saved Environment ------------------------> Storyboard 3 recipe/model
```

No downstream storyboard recipe or GPT node may run before every enabled upstream dependency connected to it has completed or supplied a valid carried-forward output.

### SPEC-002 - Typed recipe reference roles

- Character sheet -> each storyboard recipe `character_ref`.
- Saved environment image -> each storyboard recipe `environment_ref`.
- Immediate previous storyboard image -> continuation recipe `additional_refs` unless a dedicated storyboard-continuity role is deliberately introduced and approved.
- Generic `image_refs` remains the ordered provider input on GPT Image 2 nodes.
- Recipe ports must only surface roles declared by that recipe.

### SPEC-003 - Ordered GPT Image 2 references

The final model prompt must explain the same order used by the model node:

- Board 1: `@image1` character, `@image2` environment.
- Board 2: `@image1` character, `@image2` environment, `@image3` Storyboard 1 visual/layout handoff.
- Board 3: `@image1` character, `@image2` environment, `@image3` Storyboard 2 visual/layout handoff.

The immediate previous board is the visual continuity source. Board 1 may be added as an additional master-layout reference for Board 3 only after a prompt-only comparison proves the extra role is unambiguous. GPT Image 2 supports up to 16 image inputs, so capacity is not the constraint; role clarity is.

### SPEC-004 - Text handoff semantics

- Storyboard 1 prompt output -> Storyboard 2 previous-board handoff field.
- Storyboard 2 prompt output -> Storyboard 3 previous-board handoff field.
- The next board's story/scene brief describes what happens next; it must not be replaced by copied prior-board content.
- Prior prompt text is private continuity context. It must not leak prior titles, model names, provider names, filenames, character names, profile IDs, or unrelated metadata into visible board text.

### SPEC-005 - Stable storyboard layout contract

All boards in one sequence must use the same:

- aspect ratio and panel count;
- grid geometry, panel borders, metadata-strip proportions, and section order;
- metadata labels and typography hierarchy;
- palette, rendering style, and production-board treatment;
- neutral subject naming policy.

Scene content, action, camera choice, dialogue, and continuity state may change per board. Layout and visual-system instructions may not silently drift.

### SPEC-006 - Story continuity contract

Each board must start from the prior board's ending state and advance a distinct causal beat. It must preserve identity, wardrobe, held props, environment geography, lighting logic, entrances/exits, screen direction, unresolved obstacles, and the story's final target. It must not repeat the prior board's six beats or jump to an unearned location/state.

### SPEC-007 - Prompt shaping and contamination guard

- GPT Image 2 hard limit: 20,000 characters from the local KIE model spec.
- Media Studio target: at most 4,200 submitted characters, unless this contract is intentionally revised.
- Compaction must preserve reference-role mapping, layout contract, panel order, causal action, dialogue policy, and final handoff.
- A non-time-freeze story must never receive time-freeze instructions.
- A time-freeze story must preserve `NORMAL -> FREEZE TRIGGER -> FROZEN INTERVENTION -> UNFREEZE TRIGGER -> RESUMED` order.
- Submitted prompts must not expose `GPT Image 2`, provider names, personal character names, filenames, or invented profile IDs as requested visible text.

### SPEC-008 - Output lifecycle

Starting a run must not clear the last successful image/video preview or saved content. A node's visible media is replaced only when that node produces a newer successful output. Muted/frozen/skipped nodes retain usable prior media and show an explicit non-running state.

### SPEC-009 - Browser UX verification

Every UI-affecting implementation phase must be verified with `browser:control-in-app-browser` against `http://127.0.0.1:3000/graph-studio`. Verification must include current wiring, typed ports, node status transitions, prompt previews, retained prior media, and final image previews. Browser verification is not satisfied by API tests alone.

### SPEC-010 - Paid-run gate

No paid provider run is allowed until prompt-only and browser no-paid gates pass. Obtain explicit action-time approval immediately before the paid run. Seedance stays muted and must not submit.

### SPEC-011 - Hangar-to-launch three-board story contract

The new story is one approximately 45-second sequence split into three six-panel boards of roughly 15 seconds each:

1. **Board 1 - Loading and exterior inspection:** establish the fixed hangar, ship, loading lanes, and service robots; show the lead supervising supplies and performing a causal exterior walkaround; end when a diagnostic reading directs her to a deeper service-panel inspection.
2. **Board 2 - Burnt-out capacitor:** continue in the exact same hangar beside the same ship; open the reachable service panel, isolate a visibly burnt-out capacitor, use sparse funny dialogue, replace the part, verify systems green, and end with loading complete and the ramp ready for boarding.
3. **Board 3 - Boarding and launch:** begin from the same hangar/ramp handoff, visibly move through the ship into the locked cockpit, reveal the same cyborg cat Bolts in the adjacent secured chair, strap both occupants in, lift off through the established hangar exit, and include the exact DIALOG line `"Bolts, are you ready for this next adventure?"` during the launch payoff.

Each board must advance these beats rather than compressing the whole story into Board 1 or repeating the prior board.

### SPEC-012 - Recipe-owned layout and production-note contract

“Metadata” means the recipe-owned production-note system rendered under each storyboard image cell, not ad hoc Graph Studio fields and not copied text from reference images.

All three outputs must use one unchanged Storyboard v2 board system:

- 16:9 sheet, exactly six panels, fixed 3x2 grid, matching panel/image/metadata-strip proportions, borders, spacing, palette, and section order;
- the same typography hierarchy, dark near-black board, thin yellow-orange UI lines, and premium cinematic previsualization treatment;
- the same labels in the same order under every frame: `SHOT`, `CAMERA`, `FRAMING`, `ACTION`, `MOTION`, `DIALOG`, and optional `NOTES`;
- the same compact footer pattern and neutral subject-label policy.

The story-specific values inside those rows may change. The labels, layout, styling, and information hierarchy may not. Dialogue belongs in `DIALOG` rows, not speech bubbles or a replacement layout.

### SPEC-013 - Environment lifecycle and intentional scene transition

Generate one updated environment continuity sheet with one fixed ship and two explicitly connected zones:

- **Hangar repair/loading zone:** fixed ship exterior, ramp, gantries, cranes, diagnostic wall, robot supply lane, service panel location, tool carts, lighting, materials, and hangar exit geography.
- **Ship cockpit zone:** fixed pilot and adjacent cat chair, harnesses, controls, window geometry, instrument palette, lighting, and the physical transition path from ramp/corridor to cockpit.

The sheet remains an environment reference, not a storyboard and not a character sheet. Boards 1 and 2 stay entirely in the hangar zone. Board 3 begins in the established hangar/ramp zone, earns the transition into the cockpit, then exits through the established hangar doors. An unexplained outdoor, alternate hangar, alternate cockpit, or teleporting transition is invalid.

### SPEC-014 - Ordered visual-reference contract for the new run

For every storyboard model submission:

- `@image1` = approved character identity reference; face, hair, age impression, and recognizable identity only when the selected asset is a portrait. Wardrobe/cyborg construction then comes from the explicit positive prompt contract.
- `@image2` = newly generated environment continuity sheet; hangar/cockpit geography, ship design, lighting, materials, entrances/exits, and action lanes only.
- `@image3` = immediate previous storyboard image for Boards 2 and 3; prior ending state plus layout and production-note geometry, not content to repeat.

The same environment output must feed all three recipe `environment_ref` inputs and all three GPT Image model `image_refs` inputs. The prior board must feed both the next continuation recipe `additional_refs` and next model `image_refs`. Connected typed role text is the source of truth and must appear in the compiled prompt.

### SPEC-015 - Second paid-proof authorization and failure boundary

The 2026-07-10 user request authorizes preparation and exactly one new paid Environment -> Board 1 -> Board 2 -> Board 3 image run after the no-paid browser gate passes. Expected scope is four image jobs; Seedance and all video generation remain forbidden.

Before submission, record the exact estimate, available credits, workflow validation, database backup, media-job baseline, and eight required paid/save execution states. If a provider node fails, continue safe evidence collection, output review, documentation, and remuting; do not convert “continue” into an automatic paid retry. Any additional paid run requires new action-time approval.

### SPEC-016 - Reference-image safety must match the prompt contract

A storyboard identity reference must visually agree with the provider-boundary wardrobe and text rules. Do not rely on prompt text alone to override a character sheet that repeatedly depicts exposed or underwear-like styling, sexualized framing, private names, ages, profile text, or other forbidden visible labels.

Before any later paid proof:

- `@image1` must preserve the same approved face, cyborg construction, proportions, palette, and identity while showing a fully covered practical wardrobe in neutral production views;
- private names, ages, profile-card headings, filenames, and provider/model text must be absent from the visible reference sheet;
- an existing compliant asset is preferred over generating a replacement;
- changing the selected character asset must remain scoped to `graphwf_4fd06f50c493`, preserve the canonical role order, and pass a no-paid Browser audit;
- generating a new reference or retrying the storyboard requires separate action-time approval.

Provider moderation does not disclose the exact rejected feature. Treat a reference/prompt conflict as evidence-backed risk, not a proven moderation root cause.

### SPEC-017 - Provider-facing safety uses positive production direction

The compacted provider prompt must describe the desired image rather than enumerate unwanted sensitive concepts. For storyboard submissions:

- request one practical fully enclosed crew-workwear design that remains unchanged across panels;
- request neutral task-focused professional framing;
- preserve exact character, mechanical-limb, environment, layout, metadata, and story continuity through positive language;
- do not emit negative lists naming sexualized clothing/framing, body exposure, gore, or injury when those concepts are not part of the requested story;
- recognize the live spatial forms `Top/Bottom × Left/Middle/Right panel:` with or without the word `IMAGE`, and never fall back to a front-truncated prompt that drops the panel plan;
- every bounded submitted prompt retains all six panels, all seven metadata rows, required references, story beats, and exact requested dialogue within 4,200 characters.

### SPEC-018 - Graph Studio replacement and frozen-cache state are lossless

Media replacement and execution-cache hydration must preserve graph intent:

- replacing a selected Load Image node updates that node's media fields and does not create an additional unconnected node;
- the graph remains 17 nodes / 30 edges for the selected workflow;
- a saved `frozen` mode with explicit `cached_run_id` hydrates and serializes as frozen, not muted;
- running or saving from the browser must not discard a valid explicit cached output;
- UI fixes remain no-paid and scoped to Graph Studio media selection/execution hydration.

### SPEC-019 - Metadata compaction preserves complete words

Provider-bound storyboard metadata may be shortened to meet the 4,200-character target, but it must never end mid-word. Compaction must prefer sentence punctuation, clause punctuation, then whitespace boundaries. Every panel retains all seven metadata labels in the declared order, and every non-empty value remains a readable complete phrase rather than fragments such as `ship dominat.` or `amber indica.`.

### SPEC-020 - Board boundaries exclude negated and future story state

State-term extraction must distinguish positive current state from prohibitions and future-board instructions. Phrases governed by `do not`, `does not`, `must not`, `never`, `without`, `no`, or equivalent negative direction cannot become positive `State:` values.

Board 1 must end at a closed service panel with an amber diagnostic indicator and hand-near-latch anticipation. Its compact prompt may describe the open loading ramp, but it must not positively introduce a capacitor, replacement, opened service panel, internal components, repair, boarding, cockpit, engine start, or launch. Board 2 and Board 3 retain their own later state terms when those terms are positively requested.

### SPEC-021 - Retained Character sheet has identity-only provider authority

Phase 10 preserves `asset_901adc9b21d1` as the user's canonical Character sheet and does not create or select another asset. The compact provider prompt must assign `@image1` authority over recognizable identity and cyborg construction only. Wardrobe authority belongs to a positive prompt-owned garment contract: one high-collar, long-sleeve, full-torso cream-and-red flight-mechanic coverall continuing through the waist and boots, unchanged across panels.

Phase 10 must not create a crop/derivative, change the ordered image inputs, or enumerate negative sensitive wardrobe/framing terms. A later derived identity reference would be a separate approved design decision.

### SPEC-022 - Phase 10 is a no-paid readiness gate

Phase 10 may change only the bounded GPT Image 2 storyboard prompt-shaping path, focused tests, and engineering documentation unless browser evidence proves another in-scope owner is necessary. Environment and Board 1 stay frozen; Boards 2/3 stay muted; Seedance stays absent/muted. Completion requires exact Phase 9 replay, focused and full regression gates, saved-workflow validation, and in-app browser proof with no media-job increase. Any paid Board 1 retry or Board 2/3 submission belongs to a separately approved Phase 11.

### SPEC-023 - Phase 11 proves one accepted progressive three-board chain

- Phase 11 may submit at most five paid Graph Studio runs under the user's 2026-07-11 authorization. The Environment is reused, the Character remains `asset_901adc9b21d1`, and Seedance/video remains absent or muted.
- Paid attempts are sequential. Accept and freeze Board 1 before Board 2; accept and freeze Board 2 before Board 3. A downstream board must use the immediately preceding accepted board as provider reference 3.
- Board 1 progresses loading/inspection and ends at the closed amber-lit panel with the pilot's hand near the latch. Board 2 begins from that exact state, replaces the burnt-out capacitor, closes the panel at steady green, and ends facing the ramp. Board 3 begins from that exact state, follows the established ramp/corridor/cockpit route, reveals Bolts already secured, straps the pilot in, launches through the same hangar doors, and uses the exact requested dialogue.
- Every accepted sheet uses one obvious 16:9 six-panel 3x2 layout system with the same panel geometry, metadata-strip proportions, ordered labels, typography hierarchy, dark/yellow production treatment, and concise complete-word values.
- Reuse the established Environment whenever the location remains the same. The Board 3 exterior-to-interior transition must follow zones already defined by that Environment rather than inventing another ship, hangar, ramp, corridor, cockpit, lighting scheme, or geography.
- Each frame must advance the active board's causal story. Reject duplicated beats, time reversal, teleportation, premature next-board events, reopened completed state, wardrobe drift, identity drift, geography drift, layout drift, or incomplete metadata.
- After each attempt, inspect the rendered image before enabling the next paid board. If an accepted upstream board changes, every dependent downstream output becomes stale and must be regenerated before final signoff.
- Stop early when one accepted Board 1 -> Board 2 -> Board 3 chain passes. Five attempts are a hard ceiling, not a completion requirement.

### SPEC-024 - Phase 12 is a full-trilogy cinematic quality gate

- The user's 2026-07-11 authorization permits at most six complete paid trilogy attempts. One attempt means one Graph Studio run with Boards 1-3 GPT/Save pairs enabled and the Environment frozen unless a documented environment defect justifies one separately reviewed regeneration. Seedance/video remains absent.
- Preserve the accepted Phase 11 assets and run history. New attempts create additional saved assets; they do not overwrite or discard prior accepted outputs. At closure, freeze the best complete trilogy, which may come from any Phase 12 attempt.
- Every board uses the same complete sheet template: 16:9 canvas; title at upper left; one compact top production strip with `PROJECT`, `SEQUENCE`, `LOCATION`, `DATE`, and `ARTIST`; exact 3x2 panel grid; identical panel borders and metadata-strip proportions; and exact `SHOT`, `CAMERA`, `FRAMING`, `ACTION`, `MOTION`, `DIALOG`, `NOTES` row order. Do not add a page footer; use that height for images and readable per-panel metadata. Board-specific values may change, but geometry, typography, color, and chrome may not.
- Every image cell renders as a photoreal live-action cinematic movie still with physically plausible production lighting, lens depth, atmospheric perspective, detailed materials, and restrained film color. Metadata remains clean production typography outside the image cells.
- The Environment is a dominant spatial/vehicle/lighting reference, not merely a palette hint. When a panel remains in the hangar, it must visibly preserve recognizable ship silhouette/orientation, ramp, hangar doors, loading lane, gantries, diagnostic wall, floor markings, practical lighting, and depth where the shot scale permits.
- Board 1 Panel 1 is a wide environmental story frame: the pilot begins materially separated from the ship, walking toward it while multiple service droids carry readable supply crates into the open starboard ramp. The pilot, complete ship, droid route, ramp, doors, and hangar depth remain simultaneously readable. Subsequent cells progressively close distance and advance inspection without repeating the same composition.
- Board 2 begins from Board 1's closed amber-panel handoff and causally performs open -> diagnose burnt capacitor -> acquire replacement -> remove -> install -> steady green -> close/turn toward ramp. Board 3 begins there and causally performs ramp approach -> board/corridor -> one visibly mechanical cyborg cat secured beside the pilot -> pilot harness/preflight -> unmistakable lift -> same-door departure with the exact dialogue once.
- A full attempt fails if any board uses different full-sheet chrome, materially hides or redesigns the Environment, repeats a story beat without progression, loses immediate prior-board reference 3, renders concept-art/sketch imagery instead of movie-still imagery, weakens Bolts into an ordinary cat, or compresses boarding/lift into an unsupported jump.
- After each complete attempt, inspect all three original-resolution assets together and record layout, movie-still quality, environment evidence, character/wardrobe, causal flow, handoffs, cat design, dialogue, and reference-order results before any refinement or next paid run.

### SPEC-025 - Phase 13 adds a durable trilogy acceptance and audit boundary

- One trilogy acceptance scorecard owns the deterministic and visual signoff vocabulary. Required visual gates are complete-sheet layout parity, `1/3`-`3/3` numbering, cinematic imagery, visible Environment authority, character/wardrobe continuity, causal panel flow, exact handoffs, ordered Bolts reveal, exact dialogue, and grounded-to-airborne progression.
- Deterministic preflight must fail before paid execution when any submitted board prompt loses six ordered metadata sets, the Environment reference, immediate prior-board reference, the Board 1 pilot/droid approach, closed service-panel handoffs, the Board 3 Panel 3 cat reveal boundary, exact dialogue, or cockpit-only lift lock.
- Every audited trilogy produces a durable JSON manifest containing workflow/run/job/asset IDs, prompt hashes, ordered input references, deterministic check results, visual review results, cost/balance evidence when available, and an overall gate. The manifest is an operator artifact under `data/quality-manifests/`, not a public API or database migration.
- The selected workflow remains `graphwf_4fd06f50c493`; Character and Environment assets remain unchanged; Seedance remains absent. Phase 13 permits exactly one complete paid Board 1-3 run after deterministic and zero-cost proof.
- The paid output is accepted only after all three original-resolution sheets are reviewed together. A failure is documented and frozen/preserved; it does not authorize another paid retry.
- After implementation and paid verification, Recipes, Presets, and Media Assistant are reviewed read-only with Uber Code Review. Validated findings and handoff-ready remediation tasks live in one timestamped report under `docs/reviews/`; review findings are not fixed during the review pass.

### SPEC-026 - Phase 15 locks adjacent-board visual handoffs

- Board 2 Panel 01 must read as the next take, approximately one to two seconds after Board 1 Panel 06. It uses Board 1 as reference 3 and preserves the same camera side, lens class, framing scale, pilot placement/pose, hand and prop positions, service-panel state, ship/hangar anchors, lighting, and color. The only material delta is the first small action: releasing the latch and beginning to open the previously closed amber panel.
- Board 3 Panel 01 must likewise read as the next take after Board 2 Panel 06. It preserves the same camera/framing, pilot placement, closed green repaired panel, open ramp, ship/hangar anchors, lighting, and color. The only material delta is the pilot turning or taking the first step toward the ramp.
- “Continue from the previous board” is insufficient. The bounded provider prompt must retain an explicit handoff-match lock naming `Panel 06 in @image3`, the near-identical visual attributes, a one-to-two-second time step, and the no-restage/no-location-jump rule.
- The immediate prior complete board remains ordered reference 3 for Boards 2 and 3. Character and Environment remain references 1 and 2; their assets are unchanged.
- Exactly one paid Board 1-3 trilogy is authorized after deterministic and zero-cost gates. Expected cost is 30 credits / $0.15. No retry, Environment regeneration, Character replacement, Seedance, schema, route, provider, pricing, or dependency change is authorized.
- Visual acceptance compares Board 1 Panel 06 to Board 2 Panel 01 and Board 2 Panel 06 to Board 3 Panel 01 at original resolution. Each pair passes only when the second frame is recognizably the same composition/state with one small causal advance.

### SPEC-027 - Phase 16 uses adjacent-but-distinct handoffs and user-owned story cues

- Board N+1 Panel 01 begins from Board N Panel 06 state but must not duplicate it. Preserve location, subjects, wardrobe, props, lighting, color, and spatial anchors while advancing a visible action, reaction, attributed dialogue beat, or purposeful camera angle/framing/lens/movement delta.
- Every spoken line uses a user-supplied speaker label and optional voice hint. When multiple speaking-capable subjects share a frame, attribution is mandatory and the recipe may not invent speaker names or voice traits.
- Shared Prompt Recipes and provider shaping remain campaign-agnostic. Named subjects, wardrobe, creature/robot design, dialogue, handoff action, location, and story beats come from recipe fields, briefs, typed references, or connected prior-board evidence.
- All boards share the same top production strip, 3x2 grid, borders, metadata proportions, row order, typography, palette, and rendering treatment. No page footer is rendered.
- Phase 16 authorizes one complete Board 1-3 paid proof after a zero-credit deterministic/browser gate. Character and Environment remain unchanged; Seedance remains absent; no retry is implied.

### Phase 7 acceptance rubric

- **Story:** all eighteen panels follow SPEC-011 causally, including the burnt capacitor, funny dialogue, Bolts, strapping in, launch, and exact final spoken line.
- **Environment:** Boards 1/2 preserve one hangar; Board 3 earns the ramp-to-cockpit transition and exits through the same hangar geography.
- **References:** compiled and submitted prompts preserve the exact SPEC-014 role map and ordering.
- **Layout/production notes:** all three sheets visibly share the same 3x2 design, label order, metadata-strip proportions, typography, palette, and no-footer system.
- **Continuity:** face, wardrobe, cyborg body, ship exterior/interior, robots, lighting, props, capacitor state, and prior ending state remain coherent.
- **Safety/text:** workwear remains practical and fully enclosed, framing remains neutral and task-focused, visible text excludes private/model/provider identifiers, and the exact requested Bolts line appears only where intended.
- **Operations:** exactly one approved run, no Seedance/video job, retained previews until replacement, terminal run evidence, full-resolution review, and paid nodes restored to muted.

## Acceptance Criteria

- The Media Assistant can build or repair the canonical three-board graph without manual generic-port substitutions.
- Environment, character, prior prompt, and prior image dependencies are present on every applicable board.
- Prompt-only outputs are within the shaping target and contain no cross-story contamination or forbidden visible metadata.
- The browser shows Environment completing and surfacing before Storyboard 1; each storyboard surfaces before the next dependent storyboard begins.
- All three output sheets share one obvious layout system and environment while depicting distinct, causally ordered scenes.
- Existing previews remain visible until replaced by successful new content.
- Seedance remains muted/skipped and submits no job.

## Constraints

- Behavior preservation: preserve unrelated recipes, graph node contracts, saved workflows, and provider payloads.
- Public interfaces: typed recipe-port behavior may change only where declared in recipe metadata; no route or API shape changes are planned.
- Data/API/schema impact: no migration planned. Existing saved workflows may need a scoped repair path or manual rewiring; do not silently rewrite every workflow.
- UX/visual impact: only Graph Studio port visibility, wiring, execution state, and preview behavior in this campaign.
- Security/auth/permission impact: none expected.
- Performance impact: additional dependency edges serialize required boards intentionally; unrelated independent branches may remain parallel.
- Dependency/config impact: no new packages, lockfile changes, or provider config changes.

## Scope

- In scope: Storyboard v2, Storyboard Continuation v1, Environment Sheet v1 reference contracts; Media Assistant storyboard graph construction; prompt shaping; graph scheduling/output retention characterization; Graph Studio browser verification.
- Out of scope: Seedance generation, recipe-wide redesign, unrelated legacy deletion, database migrations, pricing changes, production deployment.
- Files likely involved: `apps/api/app/store_seed_prompt_recipes.py`, `apps/api/app/assistant/story_graph.py`, `apps/api/app/graph/prompt_shaping.py`, `apps/api/app/graph/prompt_recipe_refs.py`, `apps/api/app/graph/prompt_recipe_catalog.py`, focused API tests, and only Graph Studio web files proven necessary by a failing UI gate.
- Files not to touch: KIE pricing/spec files, lockfiles, generated artifacts, migrations, production config, unrelated assistant/preset modules.

## Verification Plan

| Command or check | Purpose | Confidence |
|---|---|---|
| `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_graph_studio.py -k 'prompt_shape or execution_order or carried_forward or resolved_input'` | Prompt/scheduler/runtime regression gate | High |
| `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_store_seed_data.py` | Seed recipe contract and version gate | High |
| `./scripts/with_shared_python.sh -m pytest apps/api/tests/test_media_assistant.py -k 'storyboard_stills or storyboard_continuation or storyboard_section'` | Media Assistant graph wiring and story segmentation | High |
| `npm --workspace apps/web test -- graph-node.test.tsx graph-node-runtime.test.ts graph-workflow-hydration.test.ts` | UI node state and workflow hydration | Medium; refine to changed files |
| `npm --workspace apps/web run typecheck` | Web type safety | High |
| `git diff --check` | Patch hygiene | High |
| In-app browser prompt-only run | Wiring, prompt output, order, and retained preview proof | High |
| In-app browser paid image run after approval | Final visual continuity proof | High |

## Risks

| ID | Risk | Level | Mitigation |
|---|---|---|---|
| RISK-001 | Adding prior board images changes ordered provider roles | P1 | Assert exact edge order and prompt role map before a paid run. |
| RISK-002 | Long prior prompts crowd out the next story brief | P1 | Summarize private continuity state and test character budgets. |
| RISK-003 | Compactor leaks unrelated recipe clauses | P1 | Add negative fixtures, including non-time-freeze sci-fi. |
| RISK-004 | Saved workflows still use generic ports | P2 | Repair only the selected workflow or provide an explicit migration action. |
| RISK-005 | Layout reference overpowers new scene content | P2 | State that prior board image is layout/state reference, not content to duplicate. |
| RISK-006 | Paid visual output remains probabilistic | P2 | Define objective review rubric and allow one approved refinement cycle. |
| RISK-007 | Broad dirty worktree obscures ownership | P1 | Use scoped diffs; never revert unrelated changes. |

## Evidence And References

- Current workflow: SQLite `data/media-studio.db`, workflow `graphwf_4fd06f50c493` (`Sadis Adventures`).
- Paid baseline: run `grun_a97f4b9ac07d`, completed 2026-07-09 with 17/17 nodes.
- Paid output assets: environment `asset_d4ab90a294ae`; boards `asset_199a95569540`, `asset_a523dece2157`, `asset_b3333ad9da1c`.
- Original visual target: `/Users/evilone/Desktop/IMG_0847.JPG`.
- KIE model contract: `/Users/evilone/Documents/Development/Video-Image-APIs/kie-ai/kie_codex_bootstrap/specs/models/gpt_image_2_image_to_image.yaml` (20,000 prompt chars, 1-16 images).
- Existing architecture: `docs/graph-studio-design.md` and `docs/graph-studio-node-authoring.md`.
- Prior handoff: `/var/folders/l9/vs3_pmvn1n19qf0_9v25sl4c0000gn/T/media-studio-handoff-2026-07-08.md`.

## Links

- [Plan](PLAN.md)
- [Tasks](TASKS.md)
- [Work state](WORK_STATE.md)
- [Campaign](CAMPAIGN.md)
- [Verification log](VERIFICATION_LOG.md)
- [Decisions](DECISIONS.md)
- [Focused handoff](STORYBOARD_CONTINUITY_HANDOFF.md)
- [New-session prompt](NEW_SESSION_PROMPT.md)

## Phase 20 - Compact Metadata And Subject-Fidelity Contract

Phase 20 tightens the provider-facing storyboard contract without changing story ownership, graph ports, provider models, pricing, references, or workflow topology.

- Every standard Storyboard v2 and Continuation cell uses the same six visible rows in this order: `SHOT`, `CAMERA`, `ACTION`, `MOTION`, `DIALOG`, `NOTES`.
- `CAMERA` owns both camera and framing language. Its canonical order is camera angle/movement/lens first, then shot size and subject placement, for example: `Over-shoulder, 50mm slow push-in; medium two-shot, pilot foreground-left, companion readable.`
- Every cell has a meaningful CAMERA value. Compaction may shorten wording only at complete phrase or clause boundaries; it may not emit an empty value or a dangling article/preposition.
- DIALOG remains row-local. Exact user-owned dialogue, speaker label, optional voice hint, and panel assignment survive verbatim. Silent panels keep an empty value; speech is never copied into ACTION, NOTES, or another panel.
- NOTES is a mandatory visible row label whose value is optional state, continuity, VFX, emotion, or handoff information supplied or usefully derived as a complete clause. It is never an overflow sink for truncated ACTION/CAMERA/MOTION text and its value stays blank when no note exists.
- User-owned subject-design cues must survive raw-to-shaped compaction. A feline/cat request must still reach the provider as feline anatomy and may not be replaced by reusable campaign-specific code.
- The same layout contract applies to Boards 1-3. Story content, subject design, dialogue, titles, and production metadata continue to come from recipe/workflow inputs.
- Acceptance requires exact raw-to-shaped replay, story-agnostic genericity coverage, zero-credit browser verification, and only then a separately authorized complete paid trilogy.

## SPEC-027 - Fail-closed storyboard metadata preflight

- Immediately after final prompt shaping and before KIE validation or submission, storyboard prompts must pass a deterministic semantic preflight.
- Each standard six-panel storyboard must contain exactly one `SHOT`, `CAMERA`, `ACTION`, `MOTION`, `DIALOG`, and `NOTES` row per panel.
- `SHOT`, `CAMERA`, `ACTION`, `MOTION`, and `NOTES` values must be non-empty complete values. `DIALOG` alone may be blank when the cell has no spoken line.
- Placeholder values such as `None`, `N/A`, `Silence`, `No dialogue`, hyphens, and em dashes are invalid; a silent DIALOG row is represented by an empty value after the colon.
- The compact shaper may reuse only existing user/recipe-owned metadata from the same panel to repair an adjacent empty ACTION/MOTION/NOTES value. It may not invent campaign names, subjects, locations, dialogue, props, or story beats.
- A failed preflight must identify the panel and row and stop before any paid provider request is created.
- The existing Prompt Recipe schema validator remains responsible for recipe structure and variables. This provider-bound semantic validator owns the final rendered storyboard metadata contract.
- A correct prompt cannot guarantee that an image model renders every character. Post-generation visual review remains a separate acceptance gate.

## SPEC-028 - Semantic metadata clauses and closed-state handoff

- Provider-bound storyboard metadata must remain concise, but every non-empty row value must express a meaningful complete phrase or clause rather than a whole-word fragment created by budget clipping.
- The compact shaper must reject or avoid truncated predicate starters and incomplete noun phrases such as `Panel opening is.`, `Only the clean.`, and `Final payoff —.`. It may shorten at an existing punctuation/connector boundary or reuse complete user/recipe-owned text from the same panel; it may not invent campaign content.
- Exact DIALOG remains verbatim and row-local. Semantic repair may not consume, move, rewrite, or duplicate spoken text.
- Required SHOT, CAMERA, ACTION, MOTION, and NOTES rows remain non-empty and continue to pass SPEC-027 before provider submission.
- Board-boundary state remains user-owned. When the Board 1 workflow brief says repair begins on Board 2, its positive input must keep every service/access compartment visibly closed through Board 1 and reserve the first opening action for Board 2.
- The fix may change only shared prompt shaping, focused regression coverage, and the target workflow's existing Board 1 user-authored brief. It may not add recipe fields, graph ports, story literals in shared code, provider/model/pricing changes, or a schema migration.
- Acceptance is no-paid: generic regressions, exact Phase 22 raw-prompt replay, story-genericity/duplication checks, full backend verification, and an in-app Browser proof with all paid nodes frozen and graph estimate approximately zero.

## SPEC-029 - Shared storyboard-sheet recipe parity and final paid proof

- Storyboard v2 and Storyboard Continuation must embed one shared immutable visible-sheet contract rather than maintaining duplicated layout prose. Both require the same footer-free 16:9 canvas, title/top-strip placement, exact 3x2 panel geometry, cinematic rendering treatment, and six stacked metadata rows in `SHOT / CAMERA / ACTION / MOTION / DIALOG / NOTES` order.
- The recipes must publish the same output contract and default generation options. Their differences are limited to their user-owned story inputs and Continuation's prior-board handoff/reference role.
- Character references lock identity and subject construction. User-owned wardrobe inputs remain the clothing authority. Environment references lock location geography, materials, lighting, routes, vehicle orientation, and depth; prior-board references lock the immediate visual state without duplicating the prior action.
- Shared recipe and compact-shaper code must remain story-agnostic. Campaign names, characters, creatures, locations, props, dialogue, and beats belong only to user/workflow inputs and test fixtures.
- Provider-bound prompts must preserve all six panels and every required metadata value as a complete phrase or clause within the GPT Image 2 compact budget. Exact attributed dialogue remains verbatim and silent `DIALOG` alone may be blank.
- Acceptance requires seed/schema regression tests, exact replay of the latest three raw recipe outputs, genericity and diff checks, a zero-credit in-app Browser proof, then the user's one authorized complete paid trilogy. Final signoff additionally requires original-resolution review of all three boards together and restoration of all paid nodes to Frozen.
## SPEC-030 - Typed storyboard specification and deterministic sheet composition

The storyboard system must stop asking a generative image model to own production-sheet chrome, typography, and metadata placement. Story content remains user-owned, while Media Studio owns the visible sheet deterministically.

- Both `Storyboard v2 - GPT Image 2 Sheet` and `Storyboard Continuation v1` compile through one versioned `StoryboardSheetSpec` intermediate contract. Continuation may add prior-board evidence and a handoff delta, but it may not define a different visible-sheet structure.
- `StoryboardSheetSpec` contains a layout-contract id/version, board title, ordered production metadata, and exactly six ordered panels. Every panel contains `shot`, `camera`, `action`, `motion`, optional `dialog`, and `notes`; required fields must pass the existing semantic and CAMERA contracts before image generation.
- User-owned board title, production metadata, dialogue, wardrobe, subject-design, environment, handoff, and story fields remain the only sources of campaign content. Shared compiler, validator, and compositor code must remain campaign-agnostic.
- A backend-owned compiler emits an art-only prompt plus the typed sheet spec. The art prompt requests either one equal 3x2 image grid or six ordered panel images and explicitly excludes titles, metadata, borders, dashboards, captions, and other production-sheet chrome.
- A deterministic backend-owned compositor accepts one equal 3x2 art grid or six ordered images plus the typed spec. It renders the 16:9 canvas, title, `PROJECT / SEQUENCE / LOCATION / DATE / ARTIST` strip, exact 3x2 geometry, borders, row heights, typography, colors, and `SHOT / CAMERA / ACTION / MOTION / DIALOG / NOTES` rows using Pillow.
- The compositor must wrap text inside its assigned row, reject overflow that cannot fit without clipping, preserve exact dialogue, allow only an empty `DIALOG`, and never silently truncate metadata.
- Existing Prompt Recipe output ports and saved workflows remain compatible. The new compiler/compositor path is additive until a saved workflow is explicitly migrated and verified; historical paid outputs remain immutable evidence.
- One-grid mode preserves the current one-image-per-board provider cost. Six-image mode is an optional higher-fidelity input shape and must not be enabled for paid execution without separate action-time approval.

Acceptance requires typed-contract unit tests, first/continuation parity tests, genericity and cross-story contamination tests, compositor pixel/layout tests, media-lineage tests, graph validation/serialization tests, focused backend/web gates, and a zero-credit in-app Browser proof. A paid visual trilogy remains a separate action-time gate.

Non-goals: changing Character or Environment assets, hardcoding the current campaign, adding dependencies, changing pricing, enabling Seedance/video, deleting the legacy direct-sheet path, or spending credits during implementation.

## SPEC-031 - Distinct storyboard metadata roles and paid compositor proof

- `ACTION`, `MOTION`, and `NOTES` are separate production meanings. `ACTION` states what the subject or scene element does; `MOTION` states camera, subject, environmental, rhythm, VFX, or transformation movement over time; `NOTES` states continuity, state, emotion, VFX, or handoff constraints derived from the user-owned brief.
- A missing required row must fail closed. The compiler and compact shaper may not fill `ACTION`, `MOTION`, or `NOTES` by copying another metadata row, a SHOT title, or campaign-specific fallback text.
- Within one panel, normalized duplicate or substantially overlapping `ACTION`, `MOTION`, and `NOTES` values are invalid. Validation must identify the panel and conflicting labels before provider submission.
- `DIALOG` remains the only row whose value may be empty. Exact attributed dialogue remains verbatim and row-local.
- Storyboard v2 and Continuation must publish the same semantic-role and non-duplication rules. All story content continues to come from recipe/workflow inputs; shared code and recipe instructions remain campaign-agnostic.
- The deterministic compositor must render the validated typed values exactly and may not rewrite, infer, shorten, or duplicate metadata.
- Acceptance requires red-to-green missing/duplicate tests, seed migration/version coverage, exact generic replay, full regression and zero-credit browser preflight. Only after those gates pass may the user's one authorized three-board paid proof run, followed by original-resolution review and refreezing.

Non-goals: changing the selected Character or Environment, changing the story itself, adding graph ports, changing provider/model/pricing, enabling video, or submitting a second paid retry. The identical `panel_notes_cues` field added to both recipe families is the bounded exception: it moves NOTES authorship into explicit user input and may not contain campaign defaults.

Outcome: the typed/compositor contract and distinct-metadata acceptance criteria pass. The one authorized paid proof is preserved as `grun_26f886636aea`; strict generative-art acceptance remains withheld on documented visual adherence issues, which do not weaken the deterministic sheet/layout or metadata guarantees.

## SPEC-032 - Legacy-layout fidelity and compact deterministic metadata

The deterministic compositor must preserve the approved older storyboard presentation instead of introducing a metadata-dominant redesign.

- The final sheet remains 2048x1152 with the existing title, five-field production strip, footer-free 3x2 grid, palette, borders, and six horizontal metadata rows.
- Cinematic imagery must own at least two-thirds of each panel. Metadata may occupy no more than one-third of panel height.
- One-image generation uses a 4:3 source plate containing a row-major 2-column by 3-row grid. Each source cell is therefore approximately 2:1 and already matches the compositor's wide art window; the compositor reflows those six ordered cells into the final 3-column by 2-row sheet.
- Art generation must compose each source cell for the compositor's wide extraction. The complete action, principal subjects, essential props, and environment landmarks remain within a declared central safe band; only expendable background may extend beyond it.
- Provider-bound cell instructions prioritize the user-owned action before camera, motion, continuity, and optional dialogue performance. Shared code remains story-agnostic.
- The compositor must not silently discard action-bearing content. Its crop contract and geometry are deterministic, tested, and reported in render metadata.
- Exact typed SHOT/CAMERA/ACTION/MOTION/DIALOG/NOTES values, semantic validation, dialogue fidelity, user-owned references, story inputs, workflow topology, provider settings, pricing, and one-image-per-board cost remain unchanged.
- Acceptance requires red/green geometry and prompt regressions, exact current-workflow replay below 4,200 characters, genericity and graph checks, a zero-credit in-app Browser preflight, then one user-authorized paid attempt and original-resolution inspection. If a new provider layout behavior is discovered during that attempt, stop before knowingly spending on dependent boards, preserve/refund terminal accounting evidence, and require fresh authorization for any remaining paid boards.

## SPEC-033 - Reference-layout fidelity and compatible storyboard art sources

The deterministic compositor must match the approved visual language demonstrated by historical asset `asset_338f93c9c12b` without copying that asset's malformed story metadata or returning sheet typography to the image provider.

- The 2048x1152 sheet uses one compact top band: an amber condensed board title at left and inline `PROJECT / SEQUENCE / LOCATION / DATE / ARTIST` production values to its right.
- Every panel uses the typed SHOT value once as a compact amber-bordered heading above the cinematic frame. The metadata block below the image contains exactly `CAMERA / ACTION / MOTION / DIALOG / NOTES`; it must not repeat SHOT.
- Removing the duplicate SHOT row must return its vertical space to the cinematic image. Images remain the dominant panel region, while the five metadata rows retain readable deterministic typography and exact untruncated values.
- Dark near-black chrome, restrained amber rules/labels, condensed display typography, footer-free geometry, three columns by two rows, and consistent board-to-board dimensions remain fixed by Media Studio.
- A one-image source is valid only when it was generated from the current art-only 4:3 / row-major 2x3 source contract, or when its explicit lineage declares that contract. A historical complete storyboard sheet must fail closed before composition instead of being sliced into nested sheet fragments.
- The compatibility rule is story-agnostic and based on source-contract provenance, never campaign nouns, visual OCR, or a specific asset id. Six explicit ordered panel images remain supported.
- Existing typed panel fields, recipe inputs, story ownership, Character/Environment references, dialogue fidelity, provider/model/pricing settings, one-image-per-board cost, and saved workflow topology remain unchanged.

Acceptance requires red-to-green renderer geometry/label tests, source-contract compatibility tests including the historical full-sheet prompt family, original-resolution offline proofs, exact prompt replay, full backend regression, genericity/diff checks, and a zero-credit in-app Browser proof. Any new provider submission remains separately authorized.

## SPEC-034 - Historical design fidelity with deterministic concise metadata

Status: Complete  
Owner: Media Studio storyboard pipeline  
Baseline: read-only historical `asset_338f93c9c12b`; current layout v3 is regression evidence, not the approved visual target.

### Problem

Layout v3 removed the duplicate SHOT row and blocked mixed complete-sheet caches, but it did not faithfully restore the selected board design. Its boxed production strip, compressed title, small panel headings, bluish dashboard rows, and 8-13px metadata differ materially from the historical production-board hierarchy. Saved recipe results also emit 140-240-character generated rows, forcing the renderer to shrink type instead of presenting concise director notes.

### Required contract

- Keep the typed panel schema `SHOT, CAMERA, ACTION, MOTION, DIALOG, NOTES` for validation and art prompting.
- Present SHOT exactly once as the heading above the image. Present only CAMERA, ACTION, MOTION, DIALOG, NOTES below it.
- Both storyboard recipes must use the same immutable visible-sheet contract, output contract, generation settings, and concise display budgets. Continuation may differ only in its prior-board/handoff inputs and continuity instructions.
- Generated SHOT, CAMERA, ACTION, and MOTION values must be complete, semantically distinct, and concise enough for readable deterministic display. Generic complete-boundary compaction is allowed inside the typed sheet compiler; it may not add campaign content. Any value that remains incomplete or over budget fails closed rather than clipping or shrinking below the readability floor.
- User-owned DIALOG and PANEL NOTES content remains exact. Blank DIALOG is valid; every other field is required. If exact user content cannot fit, fail with a field/panel-specific message rather than changing meaning.
- Shared recipe/compiler/renderer code must be story-agnostic. All character, environment, plot, wardrobe, dialogue, subject, prop, and handoff facts come from recipe inputs and connected typed references.

### Visual acceptance

- 2048x1152 footer-free sheet; thin outer amber frame; dark near-black background.
- Unified header: large amber condensed board title at left and inline amber labels/white values in PROJECT, SEQUENCE, LOCATION, DATE, ARTIST order. No individually boxed production fields.
- Exact 3x2 panel grid with one bold condensed SHOT heading, a wide cinematic image, and five compact near-black metadata rows.
- Minimum visible metadata value size is 14px in the production canvas; labels and headings are visibly stronger than values.
- The removed duplicate SHOT row is returned to image/metadata readability, not replaced with new chrome.
- Board 1, Board 2, and Board 3 must be byte-deterministic for identical inputs and share identical geometry/tokens. Only user-owned titles, values, and art differ.

### Out of scope

No paid generation, provider submission, graph topology migration, reference replacement, public API/port change, schema/dependency change, OCR reconstruction, or mutation of historical outputs.

### Verification

Red-to-green unit/regression tests, offline three-board render and pixel/hash comparison, exact recipe replay, genericity/hardcoding guard, full backend suite, campaign post-review, and a zero-credit in-app Browser proof with all provider/save nodes Frozen.

## SPEC-035 - Glyph-safe wrapped metadata and paid trilogy proof

Status: Complete for glyph safety; strict trilogy art signoff withheld  
Owner: Media Studio storyboard pipeline  
Baseline: completed Phase 29 layout v4 and read-only historical `asset_338f93c9c12b`.

### Problem

Layout v4 fits two 14px metadata lines into a 30px row, but it centers the nominal line box without compensating for the selected font's positive top bearing. The second line can therefore extend to the final interior pixel immediately above the lower rule and appear slightly clipped at original resolution.

### Required contract

- Center metadata values by their actual rendered glyph bounds across all wrapped lines.
- Keep every glyph strictly inside its row rules with visible bottom clearance; never mask, crop, or silently truncate a value.
- Preserve the exact Phase 29 canvas, header, title, SHOT heading, image rectangles, five row heights, fonts, font floors, label positions, palette, footer-free design, typed schema, recipe versions, graph topology, and story inputs.
- Keep the fix generic: no current-story terms, asset ids, dialogue, character, environment, or handoff facts in renderer code.
- The one authorized paid proof may submit exactly one Board 1-3 GPT Image trilogy after automated, deterministic-image, runtime-health, queue, and browser-estimate gates pass. Maximum expected spend is 30 credits / $0.15. No retry is implied.

### Visual acceptance

All three composed 2048x1152 sheets must use identical geometry, fonts, labels, colors, and row ordering. Wrapped metadata must be fully visible at original resolution. SHOT appears once above each image; CAMERA/ACTION/MOTION/DIALOG/NOTES appear once below it; blank DIALOG remains valid. Character, Environment, story progression, Board 1→2 and Board 2→3 handoffs, cinematic action, and Bolts' feline design remain strict visual gates.

### Verification

Red-to-green pixel regression, focused and full backend suites, genericity and diff checks, deterministic Board 1 rerender with pixel-identical art rectangles, in-app Browser preflight, exactly one authorized paid trilogy, original-resolution three-board inspection, accounting verification, and final refreeze.

## SPEC-036 - Antialiased metadata clearance and saved full-trilogy proof

Status: Complete  
Owner: Media Studio storyboard pipeline  
Baseline: Phase 30 paid trilogy `grun_c14f1f0b747a` and deterministic layout v4.

### Problem

The Phase 30 regression counted only fully opaque text-color pixels. Enlarged inspection of the actual composed sheets proves that gray antialiased edge pixels in 18 wrapped rows reach the final interior pixel above the lower rule, making the second line appear shaved even though every word is present.

### Required contract

- Measure every non-background antialiased glyph pixel in the metadata value region.
- Keep wrapped values at least three pixels from the lower rule by using the existing 14px metadata font floor only when 15px cannot satisfy the clearance.
- Preserve the 2048x1152 canvas, layout v4 geometry, row heights, image rectangles, labels, palette, recipe contracts, graph topology, Character, Environment, and user story ownership.
- Remove repeated full CAMERA-contract clauses generically while preserving subject/framing text.
- Keep Bolts design changes in the Board 3 user-owned Subject Design Cues; shared renderer, compiler, recipes, and validators remain campaign-agnostic.
- Convert user visual-context exclusions into affirmative provider-facing directions before the art request. Preserve the user's positive traits and never add campaign nouns in shared code.
- The authorized proof is exactly one new Board 1-3 provider trilogy. All three raw art outputs and all three deterministic composed sheets must be saved. No retry is implied.

### Acceptance

All actual composed sheets pass an original-resolution antialiased-pixel audit with at least three pixels of lower clearance, complete semantic clauses, and no repeated CAMERA contract. All six paid/composed images exist as saved assets. Layout, character, Environment, causal progression, adjacent handoffs, cinematic action, dialogue, compact feline Bolts, and launch remain strict visual gates.

### Outcome

Complete. Three successful provider jobs consumed exactly 30 credits / $0.15. One Board 3 policy rejection consumed 0 credits and was resolved by the generic affirmative provider-boundary guard. All three 2048x1536 raw grids and all three 2048x1152 deterministic sheets are saved in the Sadi project. Original-resolution and antialiased-pixel review pass every acceptance gate.
