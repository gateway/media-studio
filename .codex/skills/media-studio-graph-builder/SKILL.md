---
name: media-studio-graph-builder
description: Author, edit or export Media Studio Graph workflow templates. Use for canvas content and wiring; use graph-studio-node-builder for node implementation.
---

# Media Studio Graph Builder

Deliver the requested graph or portable template while preserving existing canvas work. Resolve the Media Studio checkout and its AGENTS.md; use this skill's resolved directory for helper paths and `python3` for commands.

## Choose the relevant detail

| Task | Read or use |
| --- | --- |
| Choose existing nodes | `python3 <skill-dir>/scripts/find_nodes.py <terms>`; this searches a cached catalog |
| Author or export template JSON | [Template authoring and export](references/template-authoring.md) |
| Choose a layout or model lane | [Workflow patterns](references/workflow-patterns.md) |
| Write an instructional note | [Note style](references/note-style.md) |
| Missing/stale definitions, refresh or skill maintenance | [Catalog and ownership](references/catalog-and-ownership.md) |

Use only the detail needed for the requested work. Verify affected types, fields and ports against current backend definitions when the cache lacks evidence or conflicts with the app; do not invent contracts or scan the entire repository.

## Boundaries and completion

- Preserve the selected workflow's identity, manual layout and unsaved edits. Export is not permission to overwrite or recreate it.
- Keep newly authored paid lanes frozen unless the requested template behavior specifies otherwise. Enabling a lane does not authorize spending; paid proof requires explicit authorization for that run.
- Follow the project's installation and runtime policy before accessing services, browser state or app data. Do not create/reset databases to validate a template.
- Continue through the authorized artifact and focused checks. Run `python3 <skill-dir>/scripts/validate_graph_template.py <template>` for JSON exports and inspect affected contracts; frontend implementation suites are not routine template gates.
- Use the available browser for requested visual/import/save behavior. Report offline validation separately from browser proof and paid execution, including any unresolved catalog freshness. Stop once the requested outcome and relevant checks are complete.
