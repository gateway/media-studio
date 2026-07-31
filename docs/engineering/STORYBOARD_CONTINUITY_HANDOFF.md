# Media Studio Storyboard Continuity Handoff

Date: 2026-07-11
Repo: `/Users/evilone/Documents/Development/Video-Image-APIs/media-studio`

## Mission

Finish the multi-board storyboard continuity campaign for `Sadis Adventures`. The goal is one generated environment and three sequential Storyboard v2 sheets that preserve the same character, environment, layout system, and metadata structure while advancing a coherent story.

Start with [WORK_STATE.md](WORK_STATE.md), then [CAMPAIGN.md](CAMPAIGN.md), [TASKS.md](TASKS.md), [SPEC.md](SPEC.md), and [PLAN.md](PLAN.md).

## Mandatory Operating Rules

- Load and follow `engineering-guardrails` before any code, workflow, or verification action.
- Use `browser:control-in-app-browser` for all Graph Studio UI verification.
- Preserve the broad dirty worktree; inspect scoped diffs and never revert unrelated changes.
- Do not run paid image/video work until Phase 4 passes and the user gives action-time approval.
- Keep Seedance muted. Do not submit a Seedance job.
- Do not silently migrate every saved workflow or introduce a new public port.

## Current Truth

- Active workflow: `graphwf_4fd06f50c493`, name `Sadis Adventures`.
- Final no-paid proof is `grun_4dab614d88dd`; all nine local/preview nodes completed, all eight paid/save nodes skipped, media jobs stayed 636, and the current shaped-prompt rubric passed.
- Latest paid run is `grun_6c158a8dd274`, the consumed PAID-716 Board 1 proof. It created `asset_d9d0ccdff7fd`; Boards 2/3 remained muted and no Seedance/video job occurred.
- The saved workflow has 17 nodes and 30 edges. Character and Environment reach every storyboard recipe through typed ports; Boards 2/3 receive the immediate prior board through `additional_refs` and model reference position 3.
- Storyboard 1/2 prompt text reaches the next continuation through `previous_storyboard_prompt`.
- BUG-709/714 plus Phase 10 now cover split/adjacent refs, spatial headings, exact-title suffixes, complete-word compaction, negated/future-state isolation, closed-panel/amber/latch handoffs, and prompt-owned covered workwear. Full Graph Studio tests pass 166/166.
- New Environment `asset_123e29b65e70` is a strong two-zone continuity sheet with the fixed ship, hangar routes, ramp/corridor transition, cockpit, adjacent cat chair, harnesses, materials, lighting, and takeoff path.
- Phase 9 now keeps the user's browser-attached Character sheet `asset_901adc9b21d1` exactly as directed; no Replace action was used. This intentionally supersedes the Phase 8 neutral-portrait selection and reintroduces a known covered-workwear conflict.
- PAID-713 submitted 3,453 characters with the neutral portrait first and Environment `asset_123e29b65e70` second, then failed provider moderation. No new storyboard image exists; credits stayed 959.6.
- Exact failed raw replay after BUG-714 is 3,528 characters with six complete panels/seven rows, both ordered refs, all story beats, and positive-only coverage language.
- Environment and Board 1 GPT/save nodes are frozen; Boards 2/3 GPT/save nodes are muted; queue empty; media jobs 640; graph runs 694; credits 949.6. Any retry or character generation requires new approval.
- BUG-715 is complete: selected replacement opens the shared attach-node picker above the resize hit area, clean Graph Studio cache snapshots refresh authoritatively, and run `grun_5c92ebb07834` proved the frozen Environment without provider work.

## Target Wiring

```text
Character -> each recipe.character_ref
Character -> each GPT.image_refs position 1

Environment recipe -> Environment GPT -> Save Environment
Save Environment -> each recipe.environment_ref
Save Environment -> each GPT.image_refs position 2

Storyboard 1 recipe.text -> Storyboard 2 previous handoff
Storyboard 1 GPT.image -> Storyboard 2 recipe.additional_refs
Storyboard 1 GPT.image -> Storyboard 2 GPT.image_refs position 3

Storyboard 2 recipe.text -> Storyboard 3 previous handoff
Storyboard 2 GPT.image -> Storyboard 3 recipe.additional_refs
Storyboard 2 GPT.image -> Storyboard 3 GPT.image_refs position 3
```

The environment must fully complete and surface before Board 1. Each board must fully complete, preview, and save before its dependent continuation board executes. The graph edges establish this order.

## Prompt Contract

- Same 16:9 grid, panel count, panel geometry, metadata labels, typography hierarchy, palette, and production-board styling across all three boards.
- New story/scene brief controls the next events.
- Previous prompt is private continuity state.
- Previous board image controls visual layout and ending state, not scene duplication.
- Environment image controls geography, landmarks, materials, lighting, and action lanes only.
- Character image controls identity, face, body, wardrobe, and character design only.
- Visible metadata uses neutral subject labels; no private names, filenames, model/provider names, or invented IDs.
- Submitted GPT Image 2 prompt target <= 4,200 chars; provider hard max 20,000 chars.

## Reference Material

- Original Time Freeze target: `/Users/evilone/Desktop/IMG_0847.JPG`.
- Current architecture: `docs/graph-studio-design.md`, `docs/graph-studio-node-authoring.md`.
- Key implementation: `apps/api/app/store_seed_prompt_recipes.py`, `apps/api/app/assistant/story_graph.py`, `apps/api/app/graph/prompt_shaping.py`, `apps/api/app/graph/runtime.py`, `apps/api/app/graph/prompt_recipe_refs.py`, `apps/api/app/graph/prompt_recipe_catalog.py`.
- Key tests: `apps/api/tests/test_store_seed_data.py`, `apps/api/tests/test_media_assistant.py`, `apps/api/tests/test_graph_studio.py`.
- KIE model source: `/Users/evilone/Documents/Development/Video-Image-APIs/kie-ai/kie_codex_bootstrap/specs/models/gpt_image_2_image_to_image.yaml`.
- Prior handoff: `/var/folders/l9/vs3_pmvn1n19qf0_9v25sl4c0000gn/T/media-studio-handoff-2026-07-08.md`.
- Paid assets and original output paths: [VERIFICATION_LOG.md](VERIFICATION_LOG.md#paid-baseline-assets).

## Start Here

1. Confirm repo and read the linked docs in the required order.
2. Refresh `git status --short`; do not clean the tree.
3. Confirm current SQLite workflow/run evidence has not changed.
4. Phase 8 is terminal. BUG-712/714 completed and PAID-713 failed at Board 1. Do not rerun it.
5. Phase 9 is terminal. BUG-715 is signed off; PAID-716 produced Board 1 `asset_d9d0ccdff7fd`; VERIFY-717 found material visual gaps. Keep Environment and Board 1 frozen, Boards 2/3 muted, and do not submit another provider job without fresh approval.
6. Phase 10 is complete. [PHASE_10_GPT56_PROMPT.md](PHASE_10_GPT56_PROMPT.md) remains the executed contract; `asset_901adc9b21d1` was retained and no provider or graph run was submitted. Stop before Phase 11.

## Definition Of Success

The deterministic continuity contract, Environment proof, browser replacement/cache repair, and positive-only exact-format shaping are complete. Board 1 now generates, but cross-board visual consistency remains unproven because the first accepted Board 1 image contains clipped metadata, exposed-midriff wardrobe drift from the retained Character sheet, and an early-open service panel; Boards 2/3 were intentionally not run. The next safe task is no-paid remediation evidence, not another provider submission.
