# Media Assistant September integration handoff

Draft PR #16 consolidates the September Assistant work plus the latest local continuity, generation-status and width-first layout changes. This is a review checkpoint, not release signoff or an automatic merge. Application data and the established installation remain unchanged by consolidation.

## Included changes

- Exact completed-result inspection, attachment reuse, reference ordering, lightbox viewing and conversation preservation across independent steps.
- Prompt-preserving generation contracts, canonical 4/6/9-panel adapters, shared preparation for preview and execution, and session-owned submitted-prompt/failure evidence.
- Retained provider threads and planning beyond fixed turn limits, while preserving Stop, repeated-no-progress recovery, stale-proposal detection and explicit run approval.
- Reviewed in-place model, connection, workflow-name and execution-mode edits; reference-analysis cache invalidation and honest nested/failure usage accounting.
- Prominent generation status while a workflow runs; completed output cards omit reference loaders and duplicate previews.
- Width-first dependency columns sized against the tallest node; measured browser reflow and layout-only apply/undo/redo preserve completed previews and run association.
- Portable graph authoring/export guidance and catalog helpers. Catalog freshness remains explicitly unknown.
- Consolidation repairs: CI selects the renamed no-progress regression, file-size boundary tests use the configured cap, and read-only diagnostic scripts no longer pass removed tool-budget parameters.

## Verification for the consolidated working tree

- 49 focused web tests across generation results, delayed turns, kernel actions, layout, measured reflow and history passed.
- 28 standalone backend tests passed with database/network access denied: continuity edits (14), planning recovery (9), width-first layout (5).
- Both file-size regression tests passed directly, outside pytest collection. All eight named CI test selectors resolve in the source.
- Web typecheck, lint (527 files), theme-drift and file-size checks passed.
- Prior populated-installation browser acceptance verified layout apply/undo/redo with preserved media and fields, and planning beyond the former turn limit. This consolidation pass did not generate media or rerun those browser flows.
- Full local pytest/release suites remain unrun: their collection/fixtures create additional databases forbidden by installation policy. Existing read-only database diagnostic scripts were updated and syntax-checked, not executed against saved records.

## CI and open acceptance gates

At the preceding pushed head (1714397), the mechanical-contract job had two stale file-size assertion failures (31 passed). The broad quality job had 97 failures / 819 passes, concentrated in storyboard prompt shaping, metadata and compiler expectations, with lifecycle and the same file-size assertions also failing. These counts do not establish 97 independent defects; each remaining failure needs comparison against the intended contract and baseline. Latest PR checks are authoritative for the new revision. Do not weaken checks solely to obtain a green merge.

- [ ] Reconcile remaining CI failures and verify the exact integration revision before merge.
- [ ] MALIVE-025 creative fidelity, remaining reference/quote/balance and negative-path acceptance. Successful prompt submission is not visual-quality signoff.
- [ ] MALIVE-026 measured context efficiency and broader compaction/disconnect/recovery coverage. Long-turn and Stop evidence exist; relative token savings remain unproven.
- [ ] Full release verification within an explicitly permitted test environment.

Further paid generation requires explicit authorization. No video run, account change, data migration or destructive cleanup is part of consolidation.

## Local-only records

This repository is public. Credentials, databases, media, transcripts, raw run records, private review notes and machine-specific installation guidance remain preserved locally and excluded from publication. Existing internal tickets and engineering evidence remain the detailed operator record; this handoff carries portable scope and verification limits. Neither relevant checkout currently has an obsolete registered worktree to remove.
