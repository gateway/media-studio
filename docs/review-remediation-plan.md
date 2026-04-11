# Media Studio Review Remediation Plan

This document turns the April 2026 engineering review into an execution plan.

It is meant to be a working checklist for closing the known repo-level issues without losing context between slices.

## Scope And Assumptions

- Media Studio is a localhost-first operator tool.
- The app should not be treated as an internet-facing public SaaS deployment.
- That lowers the external exposure risk of admin-route inconsistencies, but it does not remove the need for internal contract and control-surface consistency.
- The highest-value work is correctness, replay fidelity, and state-model hardening around Studio jobs, retries, and staged media.

## Current Priorities

1. Fix retry fidelity so retried jobs preserve the original request contract.
2. Add authoritative API validation for queue settings and queue policy bounds.
3. Keep admin route protection internally consistent, including `/presets`.
4. Move reference-library backfill off the first user request path.
5. Reduce core Studio state coupling in the composer and retry flows.
6. Refresh repo docs so architecture and operator behavior match reality.

## Execution Principles

- Make small, reviewable slices.
- Prefer contract-preserving changes over rewrites.
- Add or tighten tests in the same slice as the fix.
- Do not combine correctness fixes and large refactors in one pass.
- Preserve current product behavior unless the slice explicitly changes the UX.

## Phase 1: Correctness And Replay Safety

### Goal

Remove the highest-risk paths that can produce incorrect user-visible behavior today.

### Tasks

- [ ] Rework `POST /media/jobs/{job_id}/retry` so it replays the original normalized request instead of rebuilding a partial request by hand.
- [ ] Persist or derive a replay-safe canonical request shape for retries if the current job record is not sufficient.
- [ ] Ensure retry preserves:
  - [ ] `source_asset_id`
  - [ ] images
  - [ ] videos
  - [ ] audios
  - [ ] preset image slots
  - [ ] selected system prompts
  - [ ] resolved options
- [ ] Add API tests that compare the retried request shape to the original submitted request.
- [ ] Verify failed-job retry from Studio still restores the correct composer state after the backend replay fix.

### Validation

- [ ] API tests for retry fidelity
- [ ] Browser smoke for retry from a failed Studio job
- [ ] Manual check with:
  - [ ] prompt-only job
  - [ ] source asset job
  - [ ] preset-backed job
  - [ ] multi-reference Nano job

## Phase 2: Queue And Policy Contract Validation

### Goal

Move queue limits and policy rules to the authoritative API boundary.

### Tasks

- [ ] Add Pydantic bounds to:
  - [ ] `max_concurrent_jobs`
  - [ ] `default_poll_seconds`
  - [ ] `max_retry_attempts`
  - [ ] `max_outputs_per_run`
- [ ] Confirm UI controls align with the same minimums and maximums.
- [ ] Reject invalid direct API requests cleanly with actionable validation messages.
- [ ] Add endpoint tests for negative, zero, and extreme values.

### Validation

- [ ] API validation tests for queue settings
- [ ] API validation tests for model queue policy updates
- [ ] Manual admin check in `/settings` and `/models`

## Phase 3: Local Admin Surface Consistency

### Goal

Keep the localhost-only admin surface coherent so all operator pages follow the same guardrails.

### Tasks

- [ ] Add `/presets` to the protected web-route list.
- [ ] Audit the admin route matcher for parity across:
  - [ ] `/studio`
  - [ ] `/settings`
  - [ ] `/models`
  - [ ] `/presets`
  - [ ] `/jobs`
  - [ ] `/pricing`
  - [ ] `/setup`
- [ ] Add a route coverage test so new admin pages do not bypass the proxy by accident.

### Validation

- [ ] Proxy/auth route test
- [ ] Manual browser check with and without configured browser credentials

## Phase 4: Reference Library Backfill Hardening

### Goal

Keep the new reference library from doing expensive work on a normal user request.

### Tasks

- [ ] Remove automatic full backfill from the first `GET /media/reference-media` path.
- [ ] Replace `read_bytes()` hashing with streaming hashing for large files.
- [ ] Decide on one explicit backfill mode:
  - [ ] admin-triggered action
  - [ ] background task
  - [ ] startup maintenance job
- [ ] Keep the process idempotent.
- [ ] Log backfill duration and summary counts.

### Validation

- [ ] API tests for idempotent backfill
- [ ] Large-file performance smoke
- [ ] Manual check that first library open stays responsive on a populated uploads directory

## Phase 5: Studio Composer And State Cleanup

### Goal

Reduce regression risk by shrinking the amount of core behavior living in oversized shared modules.

### Tasks

- [ ] Define one canonical staged-input model for Studio submit and retry flows.
- [ ] Separate retry/replay orchestration from generic composer state.
- [ ] Continue extracting logic out of:
  - [ ] `apps/web/components/media-studio.tsx`
  - [ ] `apps/web/hooks/studio/use-studio-composer.ts`
- [ ] Consolidate staged-media request building so it is not rebuilt in multiple UI paths.
- [ ] Keep Nano multi-reference handling independent from older single-source assumptions where possible.

### Validation

- [ ] Existing Studio smoke suite still passes
- [ ] Multi-reference Nano smoke still passes
- [ ] Filter/composer persistence still passes
- [ ] Retry and queued-output flows still pass

## Phase 6: Documentation And Handoff

### Goal

Make the repo easier to understand and safer to extend.

### Tasks

- [ ] Update `README.md` repo layout to match the actual structure.
- [ ] Add a short request lifecycle note covering:
  - [ ] compose
  - [ ] validate
  - [ ] submit
  - [ ] optimistic queue state
  - [ ] polling
  - [ ] publish
  - [ ] retry
- [ ] Document the chosen reference-library backfill strategy.
- [ ] Keep localhost-only deployment assumptions explicit in repo docs.

### Validation

- [ ] README walkthrough sanity check
- [ ] Docs reviewed after implementation slices land

## Do Not Forget

- [ ] Do not treat localhost-only deployment as a reason to skip contract validation.
- [ ] Do not refactor the whole Studio composer in one shot.
- [ ] Do not ship a retry fix without a replay-fidelity test.
- [ ] Do not leave UI-only limits without matching API validation.
- [ ] Do not keep expensive filesystem backfill on a normal user request path.
- [ ] Do not change queue behavior without rerunning browser smoke on multi-output batches.

## Suggested Slice Order

1. Retry fidelity
2. Queue and policy schema validation
3. `/presets` route protection parity
4. Reference-library backfill redesign
5. Studio composer/state extraction
6. README and request-lifecycle docs

## Recommended Next Slice

Start with retry fidelity.

It is the highest-value correctness fix, it has a clear API boundary, and it gives immediate confidence to failed-job recovery without requiring a broad frontend refactor.
