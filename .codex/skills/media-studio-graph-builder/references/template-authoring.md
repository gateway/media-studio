# Template authoring and export

## Authoring

Use an existing template in the target checkout's `content/graph-workflows/` to establish the export envelope, then inspect only the chosen node definitions. Keep the graph as small as the request permits; groups and notes help multi-lane examples but are not mandatory decoration for a simple graph.

- Preserve backend node `type` values; custom titles are display-only. Supply required fields and connect compatible ports, respecting array cardinality and conditional visibility.
- Persist edges with `source`, `source_port`, `target` and `target_port`; do not substitute browser-library handle names.
- Use `kind: media-studio.graph.workflow`, the supported schema version and `workflow.workflow_id: null`. Keep group metadata under `workflow.metadata.groups` and include only used full definitions in `node_definitions` when exporting that envelope. The compact catalog is not a substitute for full exported definitions.
- Keep user-selectable media placeholders blank. Remove credentials, local paths, data URLs/base64 media, private notes, provider payloads and installation-specific asset/job/run identifiers, including execution caches. Preserve public parameters and intentional instructional copy.
- Place requested reusable repository templates under `content/graph-workflows/`; honor a user-selected output location. Drafting a file does not require importing it into the running app.

## Exporting existing work

Identify the active workflow by its stable ID and reconcile the visible canvas with its saved record. Names are labels and can be duplicated. Preserve unsaved layout, fields, notes and wires; do not silently replace them with the last saved version or reconstruct the graph when no record exists. If the active state cannot be recovered, explain the specific missing state before destructive or ambiguous action.

Export a separate portable artifact. Retain positions, custom titles, group bounds and execution modes while removing instance-specific state. If current full definitions are needed, read them from the verified target runtime; if unavailable, label the export's compatibility unverified instead of manufacturing definitions from the compact cache.

## Focused validation

The helper checks the envelope, node membership of edges/groups and several forbidden text patterns. It does **not** validate every schema shape, unique IDs, node existence, required fields, port compatibility, array bounds or all possible secrets. Inspect those for the affected graph using actual definitions; successful helper output alone is not import or execution proof.

For a file-only task, validate the JSON, inspect changed contracts and portability, and report the artifact. Browser checks apply when layout, import, save or other UI behavior is part of the request. Check the affected visual flow and persistence without running paid nodes. Backend tests that create database fixtures remain subject to the project's database policy.
