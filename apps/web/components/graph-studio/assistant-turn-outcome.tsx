import type { AssistantMessage } from "./types";

const OUTCOME_COPY: Record<string, string> = {
  assistant_provider_failed: "The assistant couldn't finish this request. Review any saved work before trying again.",
  assistant_unavailable: "Media Assistant couldn't start this request. Check AI Settings and try again.",
  assistant_turn_interrupted: "This request was interrupted. Review any saved work before making a new attempt.",
};

export function AssistantTurnOutcome({ message, onEdit }: { message: AssistantMessage; onEdit?: () => void }) {
  const outcome = message.content_json?.turn_outcome;
  if (!outcome || typeof outcome !== "object") return null;
  const code = String((outcome as Record<string, unknown>).code || "");
  const copy = OUTCOME_COPY[code];
  if (!copy) return null;
  const trace = message.content_json?.assistant_turn_trace;
  const calls = trace && typeof trace === "object" ? (trace as Record<string, unknown>).tool_calls : null;
  const completed = Array.isArray(calls) ? calls.flatMap(call => {
    if (!call || call.error || call.activity?.tone !== "success" || typeof call.activity?.label !== "string") return [];
    return [call.activity.label as string];
  }) : [];
  return <div role="status" aria-label="Assistant request outcome">
    <p className="graph-assistant-error">{copy}</p>
    {completed.length ? <ul>{Array.from(new Set(completed)).map(label => <li key={label}>{label}</li>)}</ul> : null}
    {onEdit ? <><p>Sending an edited request makes a new attempt.</p><button type="button" onClick={onEdit}>Edit request</button></> : null}
    <details><summary>Request details</summary><p>Outcome: {code}. Request: {message.assistant_message_id}.</p></details>
  </div>;
}
