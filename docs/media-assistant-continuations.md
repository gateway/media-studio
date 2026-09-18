# Recipe drafting and return to a graph

When a graph needs a Prompt Recipe that the saved catalog does not provide, Media Assistant can offer **Draft needed recipe**. The card retains the original graph request and destination. Selecting it prepares a recipe draft for review.

Review the draft, ask the Assistant to prepare its save confirmation, and select **Save recipe**. Only that explicit Assistant save enables **Return to graph proposal**. Saving in a separate editor is not an Assistant continuation save; use a fresh graph request to reference a recipe saved there.

Return checks the saved recipe and original graph, then prepares a graph proposal. **Add to canvas** and **Run** remain separate actions. A proposal may require images to be supplied before it can run.

If an attempt cannot finish, **Continue graph proposal** or **Retry recipe draft** starts a new explicit attempt with the same requirements and destination. Repeated delivery of an earlier action does not start another provider turn. No retry is automatic.

**Cancel recipe continuation** stops active work through the existing Assistant cancellation lifecycle. Completed messages, drafts and saved recipes remain available. Cancellation never triggers a save, graph application or run.

Continuations expire after 24 hours. A different destination, changed graph execution content, or changed/unavailable saved recipe requires a fresh request. The Assistant does not silently choose another tab or substitute a different recipe. Ordinary reuse of an eligible saved recipe goes directly to the existing graph proposal flow.

## Message API

The existing `POST /media/assistant/sessions/{session_id}/messages` request accepts an optional `continuation` object:

```json
{
  "content_text": "Return to graph proposal",
  "continuation": {
    "id": "server-issued-continuation-id",
    "token": "server-issued-action-token",
    "action": "return"
  },
  "workflow": {},
  "canvas_context": {"workspace_key": "original-workspace-key"}
}
```

`workflow` must contain the real current GraphWorkflow payload; the empty object above is only a placeholder. Actions are `draft`, `return`, `retry` and `cancel`. The server owns the retained requirements, destination fingerprint, saved recipe identity and action tokens in `summary_json.kernel_recipe_continuation`. Client content does not replace those requirements. Tokens distinguish attempts and are scoped to the session and continuation. Replays return retained session state without dispatching again; concurrent turns use the existing session lock.

The field is optional for existing clients. Existing recipe-save, graph-apply and run-confirmation contracts remain unchanged. No database migration or new provider lifecycle is introduced.

## Validation limits

Graph validation and pricing establish a reviewable proposal. They do not prove generated-image quality. Empty reference inputs must be supplied before execution. Provider response time varies; a bounded turn can require an explicit continuation.

## Interrupted graph planning

If graph planning reaches its time or tool limit, the assistant retains a planning checkpoint in the existing session. The card shows completed checks, errors and the remaining proposal work. **Continue planning** resumes preparation explicitly; it does not approve a generation, apply a graph or save a recipe. The original graph and selected references must still match. Changed or expired checkpoints require a fresh request.

Successful preparation must produce a fresh validated proposal before recovery is marked complete. A clarification leaves recovery available. A transient failure produces a fresh retry action, and the browser refreshes that action before another attempt. No provider generation is retried automatically.

## Saved recipe compatibility

Search results identify candidates. The assistant must inspect the full current saved recipe contract before selecting or binding it: system prompt, output format, fixed requirements, available controls and image-reference behavior. Changing the recipe invalidates prior inspection evidence. A fixed nine-panel recipe is not a six-panel option; choose its supported format, direct construction, or explicitly draft a separate recipe.

Text-port compatibility does not prove the generated text meets downstream requirements. GPT Image 2 storyboard preflight distinguishes captioned narrative boards from production metadata boards. Narrative boards retain their complete text, ordered Panel headings (including timed headings), scene descriptions and one nonempty Caption per panel. Production metadata boards keep the existing SHOT/CAMERA/ACTION/MOTION/DIALOG/NOTES checks. Preflight still runs before image submission. Completed inputs and frozen outputs are not regenerated to repair a later prompt.
