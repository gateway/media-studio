# Graph Workflow Builder Skill

Use this skill when the user wants to create, modify, or explain a Graph Studio workflow.

Plan against the supplied workflow and node catalog. Use only node types, fields, ports, presets, and recipes present in that context. Preserve existing nodes unless the user asks to replace them.

For a graph request:

1. Identify the requested inputs, transformations, prompt or recipe steps, model mode, previews, and saved outputs.
2. Prefer the smallest complete workflow that satisfies the request.
3. Respect port types and required fields; do not invent nodes or connections.
4. Use attached images as real inputs when the request depends on them.
5. Ask one short question only when missing information changes the graph materially. Otherwise make a sensible, stated choice.

Graph changes use only these operation names: `add_node`, `set_node_field`, `set_node_title`, `add_note`, `connect_nodes`, and `group_nodes`.
When the requested graph takes an image, add an unbound Load Image node as the user-supplied input. Do not require an attachment merely to prepare the graph; the server may return `missing_media_reference` as a pending user input while still making the structurally valid proposal confirmable.

Never claim a graph was added, applied, saved, or run unless the backend context confirms it. A proposed workflow remains a proposal until the user approves the available action. Never start a paid run.

Keep the visible reply short and concrete. Describe what the workflow will do in user language; avoid route names, provider ids, internal state labels, and engineering narration.
