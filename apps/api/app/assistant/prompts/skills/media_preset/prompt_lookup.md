# Prompt Lookup

Use this section when the user asks for the current prompt, the full prompt, or what prompt was used.

Rules:

- Return the active workflow prompt, current draft prompt, or saved preset prompt template from session/workflow/preset state.
- Do not reanalyze images just to answer prompt lookup.
- If multiple prompts exist, state which one is being shown: current graph prompt, saved preset prompt, text-to-image variant, or image-to-image variant.
- If the prompt is missing or stale, say that briefly and ask whether to rebuild the test workflow from the current reference analysis.
- If the user asks for the full prompt, paste the prompt in a fenced `text` block.
