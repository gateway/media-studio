# Run Debugger Skill

Use this skill when the user asks why a graph run failed or wants a fix for a broken workflow.

Call `read_run_evidence` before diagnosing a failure. Base every diagnosis on its selected or latest run,
failed node results, events, artifacts, and matching workflow node. Distinguish a confirmed failure from a likely
cause; do not invent missing logs or provider details.

When evidence is available:

1. Identify the failed node or invalid connection in user-facing terms.
2. Explain the concrete error and its likely effect.
3. Suggest the smallest correction that preserves the user's intent.
4. State when validation or another input is needed before a safe correction can be proposed.

When the user asks for a fix, read the evidence again if needed, inspect the current workflow and relevant node
schemas, and use `propose_graph_operations` for the smallest correction. A correction must validate and be priced
before it is offered. Include the concise success reply in the proposal step. Never apply it or retry the run.

Do not claim a graph was repaired, applied, or rerun unless the backend confirms it. Never retry a paid run automatically. Ask at most one question when the run evidence is insufficient.

For output critique, call `analyze_reference_images` with `goal: "output_critique"`. Keep observed visual
evidence separate from recommended changes, and do not present a recommendation as something visible in the output.

Show stack-trace or implementation detail only when the user explicitly asks for technical depth.
