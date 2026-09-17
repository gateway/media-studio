# Graph Workflow Builder Skill

Use this skill when the user wants to create, modify, or explain a Graph Studio workflow.

Plan against the supplied workflow and node catalog. Use only node types, fields, ports, presets, and recipes present in that context. Preserve existing nodes unless the user asks to replace them.

For a graph request:

1. Identify the requested inputs, transformations, prompt or recipe steps, model mode, previews, and saved outputs.
2. Prefer the smallest complete workflow that satisfies the request.
   Keep catalog discovery scoped: search the exact chosen/default model key separately from input, prompt and output parts, with a small result limit appropriate to each need. Avoid combining a long model name with every graph component in one broad query. Reuse the compact fields and typed ports already returned; inspect full schemas only for reported omissions or genuinely unresolved values. Further distinct discovery is allowed whenever a required part is still missing.
3. Respect port types and required fields; do not invent nodes or connections.
4. Use attached images as real inputs when the request depends on them.
5. Ask one short question only when missing information changes the graph materially. Otherwise make a sensible, stated choice.

When reusing a saved recipe on a graph that already has a paid model path, update the compatible
recipe/model/preview path instead of appending another one. Set `additional_paid_path_intent` to
`explicitly_requested` only when the user clearly asks for another paid output path.
If the server returns a test-lane replacement-required error, ask whether to replace that lane. Only
after the user approves in a later turn, retry with `test_lane_replacement_intent=explicitly_requested`;
the resulting replacement remains a reviewed confirmation action.
For a graph-local creative adjustment to an existing `prompt.recipe` test lane, update its supported
`refinement` field. Do not invent `user_prompt` or another input that the selected recipe does not expose.

Graph changes use only these operation names: `add_node`, `set_node_field`, `set_node_title`, `add_note`, `connect_nodes`, and `group_nodes`.
For one workflow group, include every connected non-note node created for the requested workflow in `node_refs`, including prompt and media-input nodes. Keep `add_note` nodes outside the group, and use separate `group_nodes` operations only when the user requests distinct groups.
When the requested graph takes an image, add an unbound Load Image node as the user-supplied input. Do not require an attachment merely to prepare the graph; the server may return `missing_media_reference` as a pending user input while still making the structurally valid proposal confirmable.

Never claim a graph was added, applied, saved, or run unless the backend context confirms it. A proposed workflow remains a proposal until the user approves the available action. Never start a paid run.
When the user asks to run the current graph, validate it with `request_run_confirmation=true` so the server can present the reviewed confirmation action. Do not rely on prose alone to prepare a run.

In the reply, describe what the workflow will do and name any missing required input.

When a graph requires a Prompt Recipe, inspect saved recipes first. If none meets the required behavior, call `offer_recipe_continuation` with the concrete missing requirements and explain the Draft needed recipe action. Do not silently draft a recipe or fabricate its saved ID. The explicit action retains the original graph request and destination. Reuse an eligible saved recipe directly when one exists.


## Completed results and independent stages

For completed output selection/reuse, call read_run_results on the exact selected run. The returned numbered candidate order, artifact ID, run ID and version are authoritative; do not use a different run's latest output. Use select_run_result only for the user's explicit choice. Results selected using the UI are in session_context.selected_results. Missing/changed results block reuse; ask for selection again rather than regenerating them.

For a new stage, independent revision or variant, preserve the old graph: call propose_graph_operations with new_stage_name and reused_results [{artifact_id, node_ref, title}]. The server loads exact selected media into ordinary loaders and exact text into prompt.text. Wire from those node_refs to new generators/previews. Never rewrite the text from a truncated tool preview. Existing reference attachments can be additional loaders. Do not include previous generators, replace their IDs, or claim disconnected nodes are excluded from a whole-graph run. Open new stage applies the reviewed graph into a separate tab without running it. Normal linked workflows remain available when explicitly requested.

Read current execution metadata before describing reuse/freeze. Freezing a node does not freeze its ancestors. Model selection is not spend approval; prepare a reviewed current estimate and wait for the explicit run action, particularly for video. No automatic generation or retries.
