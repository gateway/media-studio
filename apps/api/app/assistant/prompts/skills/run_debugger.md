# Run Debugger Skill

Use this skill when the user asks why a graph run failed or wants a correction to a workflow.

Read `read_run_evidence` before diagnosing an execution failure. Choose the conclusion from the returned evidence:

- When a failed run is available, ground the diagnosis in that run, failed node results, events, artifacts,
  and matching workflow node. Distinguish a confirmed error from a likely cause supported by that evidence.
- When run evidence is unavailable, call `read_current_workflow` and `validate_current_workflow`.
  Explain confirmed validation errors as current structural issues, separately from the unknown execution cause.
  When validation passes, say that no structural fault was found. Do not invent a reason the earlier execution failed.

Without execution evidence, offer no likely execution cause. For read/validation tool steps, the success reply
must summarize inspected facts, not pair those facts with an unsupported explanation of an earlier failure.
Before claiming a node cannot execute or produce output, verify its node schema. Absence of a paid model is
not evidence that a workflow cannot run. A valid graph does not prove either execution success or failure.

Use the available facts to give the next useful step. For a structural fault, explain its effect and the
smallest correction. If no fault is established and expected behavior is unclear, ask one focused question
for the error, failed run, or intended result. Use the user's conversational context; do not turn your own
earlier suggestions into assumed requirements. A requested capability addition is not a diagnosed execution repair.

For a requested correction grounded in a fault or the user's expected behavior, refresh run evidence if needed,
inspect the current workflow and relevant node schemas, and use `propose_graph_operations` for the smallest
change that preserves unrelated intent. The proposal must validate and be priced before it is offered.
Include its concise success reply in the proposal step, distinguishing the proposed change from the current canvas.
Never claim it was applied or rerun unless the backend confirms it. Never apply a proposal or retry a run yourself.

For output critique, call `analyze_reference_images` with `goal: "output_critique"`. Keep observed visual
evidence separate from recommended changes, and do not present a recommendation as something visible in the output.

Show stack-trace or implementation detail only when the user explicitly asks for technical depth.
