# Media Assistant September integration handoff

PR #16 consolidates the September Assistant work plus the latest continuity, generation-status and width-first layout changes. Merge is authorized once the integration checks pass. Application data and the established installation remain unchanged by consolidation.

## Included changes

- Exact completed-result inspection, attachment reuse, reference ordering, lightbox viewing and conversation preservation across independent steps.
- Prompt-preserving generation contracts, canonical 4/6/9-panel adapters, shared preparation for preview and execution, and session-owned submitted-prompt/failure evidence.
- Retained provider threads and planning beyond fixed turn limits, while preserving Stop, repeated-no-progress recovery, stale-proposal detection and explicit run approval.
- Reviewed in-place model, connection, workflow-name and execution-mode edits; reference-analysis cache invalidation and honest nested/failure usage accounting.
- Prominent generation status while a workflow runs; completed output cards omit reference loaders and duplicate previews.
- Width-first dependency columns sized against the tallest node; measured browser reflow and layout-only apply/undo/redo preserve completed previews and run association.
- Portable graph authoring/export guidance and catalog helpers. Catalog freshness remains explicitly unknown.
- Follow-up regressions: canvas pan/zoom and empty group bookkeeping no longer invalidate an unchanged proposal; fresh grouped graphs arrange detached notes beside the complete group frame. Both cases failed before the fix and pass in database/network-denied regressions.
- Consolidation repairs: CI selects the renamed no-progress regression, file-size boundary tests use the configured cap, and read-only diagnostic scripts no longer pass removed tool-budget parameters.

## Verification for the consolidated working tree

- 49 focused web tests across generation results, delayed turns, kernel actions, layout, measured reflow and history passed.
- 30 standalone backend tests passed with database/network access denied: continuity edits (15), planning recovery (9), width-first layout (6).
- Both file-size regression tests passed directly, outside pytest collection. All eight named CI test selectors resolve in the source.
- Web typecheck, lint (527 files), theme-drift and file-size checks passed.
- Prior populated-installation browser acceptance verified layout apply/undo/redo with preserved media and fields, and planning beyond the former turn limit. This consolidation pass did not generate media or rerun those browser flows.
- Full local pytest/release suites remain unrun: their collection/fixtures create additional databases forbidden by installation policy. Existing read-only database diagnostic scripts were updated and syntax-checked, not executed against saved records.

## CI and open acceptance gates

The CI reconciliation preserves authored prompts under the model hard limit and requires bounded LLM repair for overlong display metadata. Regression scenarios now assert those contracts instead of obsolete soft compaction, inferred story edits or speculative grammar checks. Missing fields, malformed metadata and hard-limit rejection remain covered. Actual fixes separate storyboard fields, reject visibly unfinished metadata and make run-confirmation replies consistent with server state. Provider lifecycle/cache and saved-preset mocks now match the current contracts.

Local validation for that reconciliation: 804 web tests, 199 pure storyboard/graph cases, 14 generation contract/inspection cases, seven run-handoff cases and the session-reaper regression passed. Web types/lint, file-size and diff checks passed. Two additional quoted-text metadata cases protect literal text. Remote CI remains authoritative for database-backed integration, production build and smoke coverage; its latest exact revision must pass before merge.

- [ ] Reconcile remaining CI failures and verify the exact integration revision before merge.
- [ ] MALIVE-025 creative fidelity, remaining reference/quote/balance and negative-path acceptance. Successful prompt submission is not visual-quality signoff.
- [ ] MALIVE-026 measured context efficiency and broader compaction/disconnect/recovery coverage. Long-turn and Stop evidence exist; relative token savings remain unproven.
- [ ] Full release verification within an explicitly permitted test environment.

Further paid generation requires explicit authorization. No video run, account change, data migration or destructive cleanup is part of consolidation.

## Local-only records

This repository is public. Credentials, databases, media, transcripts, raw run records, private review notes and machine-specific installation guidance remain preserved locally and excluded from publication. Existing internal tickets and engineering evidence remain the detailed operator record; this handoff carries portable scope and verification limits. Neither relevant checkout currently has an obsolete registered worktree to remove.
