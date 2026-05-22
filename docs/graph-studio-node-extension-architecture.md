# Graph Studio Node Extension Architecture

This document describes the current node ownership model and the safest future path for user-created nodes. It is an architecture note, not a claim that custom node packs are implemented today.

The current Graph Studio rollout is experimental and intentionally does **not** include an end-user executable node runtime.

## Current State

Graph Studio currently has three real node ownership layers:

1. **System nodes**
   - Repo-owned static definitions
   - Files: `apps/api/app/graph/system_nodes_<family>.py`
   - Examples: media load/save, preview, display, image/video utilities

2. **Generated model nodes**
   - Repo-owned generated definitions assembled from backend metadata
   - File: `apps/api/app/graph/registry.py`
   - Examples: KIE model nodes, preset render nodes

3. **Data-backed runtime nodes**
   - Repo-owned execution contract driven by saved records
   - Files: `apps/api/app/graph/system_nodes_prompt.py`, `apps/api/app/graph/prompt_recipe_catalog.py`
   - Examples: generic `prompt.recipe`, `preset.render`

Today there is **no** supported end-user node package format, no arbitrary code upload path, and no workflow import mechanism that creates new node types.

## Why This Matters

Graph Studio nodes are not just UI elements. A node affects:

- workflow JSON
- validation
- execution
- pricing
- media refs and artifact reuse
- run history
- import/export compatibility

That means a future custom-node system cannot be frontend-only. It must compile down to the same backend-owned `GraphNodeDefinition` and executor contract as the built-in nodes.

## Recommended Future Ownership Model

If custom nodes are added, build them in phases:

### Phase 1: User-authored data nodes

Allow user-created nodes only when they are **data-backed configurations** of already-approved runtime families.

Good examples:

- prompt-recipe-like nodes
- preset-like nodes
- simple transform templates that select from existing executors

Storage shape:

- DB row for the record
- versioned schema
- backend-generated `GraphNodeDefinition`
- no arbitrary uploaded execution code

This is the safest first extension model.

### Phase 2: Reviewed node packs

If true custom execution is needed, use a reviewed node-pack system rather than raw DB-stored code.

Recommended repo/package layout:

```text
graph-node-packs/
  <pack-name>/
    manifest.json
    definitions/
      <node-type>.json
    executors/
      <family>.py
    docs/
      README.md
    tests/
      test_<pack>.py
```

Recommended pack contract:

- `manifest.json`
  - pack id
  - version
  - compatible Graph Studio schema version
  - node types provided
  - executor module mapping
- `definitions/*.json`
  - declarative node metadata only
- `executors/*.py`
  - server-reviewed code, imported from an allowlisted path

Do **not** accept arbitrary uploaded Python/JS bundles from end users directly into production runtime execution.

## Save / Export / Import Boundaries

Keep these concepts separate:

### Workflow export/import

Current workflow export/import should continue to mean:

- export a workflow that references existing node types
- import a workflow that uses known node types

This is **not** node authoring.

### Future node-pack export/import

If user-created nodes are supported later, they need a separate bundle format:

- `graph_node_pack_bundle.zip`
- manifest + definitions + executor refs + tests/docs metadata

Import should:

1. validate manifest/schema compatibility
2. reject forbidden executor/runtime capabilities
3. install into a reviewed/allowlisted location
4. refresh backend node definitions

## Folder Guidance

For the current repo, keep the source tree disciplined:

- `apps/api/app/graph/system_nodes_<family>.py`
  - static node families
- `apps/api/app/graph/executors/`
  - runtime execution per family
- `apps/api/app/graph/registry.py`
  - generated node assembly only
- `apps/api/app/graph/*_catalog.py`
  - data-backed node catalog shaping
- `apps/api/app/graph/validator_*.py`
  - family-specific validation helpers

If custom nodes arrive later, add them under a clearly separate top-level extension area rather than mixing them into the built-in system node modules.

## Recommended Rule

The safest long-term rule is:

> User-created nodes may define behavior through backend-validated data first.
> User-created executable code should require a reviewed node-pack path, not a raw workflow or DB upload path.

That preserves Graph Studio’s current backend-owned contract and keeps pricing, validation, execution, and import/export behavior coherent.
