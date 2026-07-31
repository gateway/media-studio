# New Session Prompt

Paste the following into a new Codex session:

```text
Continue the Media Studio storyboard continuity campaign in:
/Users/evilone/Documents/Development/Video-Image-APIs/media-studio

First, load and follow these skills:
- $engineering-guardrails
- $browser:control-in-app-browser for every Graph Studio UI verification

Read these repo documents in this exact order before acting:
1. docs/engineering/WORK_STATE.md
2. docs/engineering/CAMPAIGN.md
3. the active task in docs/engineering/TASKS.md
4. docs/engineering/SPEC.md
5. docs/engineering/PLAN.md
6. docs/engineering/STORYBOARD_CONTINUITY_HANDOFF.md
7. docs/engineering/DECISIONS.md
8. docs/engineering/VERIFICATION_LOG.md

Then inspect the current dirty worktree and current SQLite workflow state. Do not revert or clean unrelated changes. Start from the active task only and update TASKS.md, WORK_STATE.md, VERIFICATION_LOG.md, and DECISIONS.md as work progresses.

Core target:
- Environment recipe -> Environment GPT -> Save Environment.
- Character -> every storyboard recipe as character_ref and every storyboard GPT as ordered image ref 1.
- Saved environment -> every storyboard recipe as environment_ref and every storyboard GPT as ordered image ref 2.
- Storyboard 1 prompt -> Storyboard 2 previous handoff.
- Storyboard 1 image -> Storyboard 2 visual/layout handoff and ordered image ref 3.
- Storyboard 2 prompt -> Storyboard 3 previous handoff.
- Storyboard 2 image -> Storyboard 3 visual/layout handoff and ordered image ref 3.
- Preserve one stable board layout, environment, character, metadata structure, and neutral visible labels while each board advances a different causal story segment.

Known baseline:
- Workflow graphwf_4fd06f50c493, Sadis Adventures.
- Paid run grun_a97f4b9ac07d completed 17/17 nodes.
- Current saved graph lacks environment-to-storyboard-recipe edges and previous-board image handoffs.
- Current recipe character inputs use generic image_refs.
- Paid non-time-freeze orbital prompts were contaminated with time-freeze continuity language after prompt compaction.
- GPT Image 2 local contract allows 1-16 images and 20,000 prompt chars; Media Studio target is <= 4,200 submitted chars.

Guardrails:
- Tests first for wiring, reference order, prompt contamination, prompt budgets, output retention, and dependency order.
- Dependency edges own execution order; do not use sleeps, title sorting, or canvas position.
- Do not introduce a new public storyboard_ref port unless existing additional_refs is proven insufficient and I approve it.
- Do not mutate persisted workflow graphwf_4fd06f50c493 until the relevant code/tests pass and I confirm that repair step.
- Do not run paid image generation until all no-paid browser gates pass and you ask for action-time approval.
- Keep Seedance muted and never submit it in this campaign.
- Use the in-app browser plugin, not standalone Playwright, for Graph Studio signoff.

TEST-001 and TEST-003 are complete. Begin with TEST-002 from docs/engineering/TASKS.md. Refresh the baseline only if the saved workflow changed, then add contract-first tests if isolation is safe. Stop before Phase 1 unless I explicitly ask you to proceed with implementation.
```
