---
name: media-studio-graph-builder
description: Build, edit, export, and validate Media Studio Graph Studio workflow templates from natural-language graph requests without rereading the codebase. Use when the user asks to create a graph/workflow/template, arrange nodes/groups/notes, wire model inputs/outputs, or export reusable Graph Studio content.
---

# Media Studio Graph Builder

Use this skill to turn a user workflow idea into a clean Graph Studio canvas and portable template.

## Source Of Truth

- Node contracts: use `python3 scripts/find_nodes.py <terms>` first. Read `references/node-catalog.json` only when broad inspection is required.
- Common layouts: read `references/workflow-patterns.md`.
- Note copy rules: read `references/note-style.md`.
- Refresh the catalog only when node definitions changed: `python3 scripts/refresh_node_catalog.py`.

Do not scan the repo to discover ordinary node fields or ports. The catalog is the contract. Inspect source only when the catalog is stale, the app behavior contradicts the catalog, or the user asks for implementation changes.

## Build Workflow

1. Translate the user's intent into lanes: inputs, model/recipe/action nodes, previews, saves, and notes.
2. Pick nodes from `node-catalog.json` by `type`, required fields, inputs, and outputs.
3. Wire only compatible port types. For array inputs, respect `max`.
4. Create one group per meaningful lane. Use clear group names like `GPT Image 2 - Image to Image`.
5. Keep paid/model lanes frozen unless the user wants them active by default.
6. Add a note node near the top-left with plain-language instructions and helpful links.
7. Save/export the workflow as a template under `content/graph-workflows/`.
8. Validate exported JSON with `python3 scripts/validate_graph_template.py <file>`.

## Export Existing Browser Workflows

- If the user has been arranging a workflow manually, preserve that work.
- Prefer the saved workflow record that matches the active browser tab name; only regenerate from scratch when no saved record exists.
- Strip `workflow_id` for templates, but keep node positions, custom titles, group bounds, group execution modes, and note copy.
- Re-fetch current node definitions and include only the definitions used by the exported workflow.

## Template Rules

- `kind` must be `media-studio.graph.workflow`.
- `workflow.workflow_id` must be `null`.
- Do not include local paths, API keys, tokens, provider payloads, base64 blobs, asset ids, job ids, run ids, or private notes.
- Keep placeholders blank when users should select their own media.
- Preserve group metadata under `workflow.metadata.groups`.
- Do not rename node `type` values. Custom node titles are display-only.

## Verification

Run the smallest relevant checks:

```bash
python3 scripts/validate_graph_template.py content/graph-workflows/<template>.media-studio-graph.json
npm --workspace apps/web run test -- graph-node-field graph-node-header
git diff --check
```

Use the in-app browser for any visual layout, link, import, save, or run-flow verification.
