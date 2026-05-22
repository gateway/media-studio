# Graph Studio Workflow Tabs TODO

Graph Studio now has a multi-tab foundation. This document tracks the remaining tab hardening work rather than the original implementation.

## Product Goal

Let users keep multiple workflows open, switch between them without losing canvas state, and close/save each workflow independently.

## Proposed Behavior

- Implemented: open workflows render as compact tabs in the top toolbar.
- Implemented: the workflow dropdown stays attached to the active tab for Save, Save As, Rename, and Close.
- Implemented: plus button creates a new blank workflow.
- Implemented: closing the last tab opens a blank `New workflow` canvas.
- Implemented: unsaved workflows are labeled `New workflow` until renamed or saved.
- Implemented: tab snapshots preserve workflow JSON, selected workflow id, active run id, dirty state, and console lines.
- Implemented: loading a saved workflow from the Workflows panel refreshes from the database-backed workflow record and restores the latest run state.
- Implemented: saved workflow tabs now persist a `saved_workflow_signature`, and restore logic prefers the database-backed workflow record whenever the tab is not actually dirty.
- Resolved: the old stale active-tab restore caveat is closed by comparing the live canvas snapshot against the last saved workflow signature instead of trusting a sticky tab `dirty` flag.
- Remaining: latest output preview overlay state still needs final browser smoke and polish.

## Persistence Shape

Use the database as the source of truth for saved workflows. Use browser storage only for open-tab session state:

```json
{
  "schema_version": 1,
  "active_tab_id": "tab_local_123",
  "tabs": [
    {
      "tab_id": "tab_local_123",
      "workflow_id": "graphwf_abc",
      "workflow_name": "Nano image pipeline",
      "workflow_json": {},
      "run_id": "grun_xyz",
      "console_lines": ["run.completed"],
      "dirty": false,
      "updated_at": "2026-05-11T00:00:00Z"
    }
  ]
}
```

Do not store media blobs, base64 payloads, or filesystem paths in tab state. Keep using asset ids, reference media ids, workflow ids, and run ids.

## Implementation Plan

1. Keep extending `use-graph-tabs.ts` and `utils/graph-tabs.ts`; do not move tab behavior back into `graph-studio.tsx`.
2. Add preview-overlay state to the tab snapshot once preview persistence needs more than run-id restore.
3. Add browser smoke coverage for new tab, save, rename, close, reload, switch, and preview restore.
4. Add a stale-session regression smoke: save a workflow with group/preview changes, close the workflow, reload it from Workflows, and verify the saved group/preview state appears instead of a restored older tab snapshot.

## Guardrails

- Do not add a second workflow store.
- Do not auto-save on every graph edit until dirty-state behavior is explicit.
- Do not lose output previews when switching tabs.
- Do not allow a tab close to delete a saved workflow; close only removes it from the open-tab session.
- Keep tab state local to the browser session unless the user explicitly saves the workflow.
