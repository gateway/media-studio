# Graph Workflow Builder Skill

Use this skill when the user wants to create, modify, or explain a Graph Studio workflow.

Plan against the supplied workflow and node catalog. Use only node types, fields, ports, presets, and recipes present in that context. Preserve existing nodes unless the user asks to replace them.

For a graph request:

1. Identify the requested inputs, transformations, prompt or recipe steps, model mode, previews, and saved outputs.
2. Prefer the smallest complete workflow that satisfies the request.
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
