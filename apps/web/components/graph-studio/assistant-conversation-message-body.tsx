"use client";

import type { ComponentProps } from "react";
import type { AssistantMessage } from "./types";
import { AssistantMessageContent } from "./assistant-message-content";
import { AssistantTurnOutcome } from "./assistant-turn-outcome";
import { AssistantRunEvidence } from "./assistant-run-evidence";
import {
  AssistantRequestedResult,
  requestedResultBindings,
} from "./assistant-results";

function kernelToolActivity(message: AssistantMessage) {
  if (message.content_json?.mode !== "assistant_kernel") return null;
  const kernelTurn = message.content_json.kernel_turn;
  if (!kernelTurn || typeof kernelTurn !== "object") return null;
  const trace = (kernelTurn as Record<string, unknown>).trace;
  if (!trace || typeof trace !== "object") return null;
  const toolCalls = (trace as Record<string, unknown>).tool_calls;
  if (!Array.isArray(toolCalls)) return null;
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const call = toolCalls[index];
    if (!call || typeof call !== "object") continue;
    const activity = (call as Record<string, unknown>).activity;
    if (!activity || typeof activity !== "object") continue;
    if ((activity as Record<string, unknown>).tone === "error") continue;
    const label = (activity as Record<string, unknown>).label;
    if (typeof label === "string" && label.trim()) return label;
  }
  return null;
}

// Display persisted evidence in message order; loading and action ownership stay with the panel.
export function AssistantConversationMessageBody({
  message,
  results,
  disabled,
  onEdit,
  onAsk,
  onOpenPreview,
}: {
  message: AssistantMessage;
  results: ComponentProps<typeof AssistantRequestedResult>["results"];
  disabled: boolean;
  onEdit?: () => void;
  onAsk: () => void;
  onOpenPreview?: ComponentProps<
    typeof AssistantRequestedResult
  >["onOpenPreview"];
}) {
  const completedActivity = kernelToolActivity(message);
  return (
    <>
      <span>{message.role === "user" ? "You" : "Media Assistant"}</span>
      <AssistantMessageContent text={message.content_text || ""} />
      {message.role === "user" ? (
        <AssistantTurnOutcome message={message} onEdit={onEdit} />
      ) : null}
      {message.role === "assistant" ? (
        <>
          {typeof message.content_json?.run_review_assessment === "string" ? (
            <details aria-label="Assistant run assessment">
              <summary>Assistant assessment</summary>
              <p>Use the current run review for readiness and pricing.</p>
              <AssistantMessageContent
                text={message.content_json.run_review_assessment}
              />
            </details>
          ) : null}
          <AssistantRunEvidence content={message.content_json} />
          {requestedResultBindings(message.content_json).map((binding) => (
            <AssistantRequestedResult
              key={`${binding.run_id}:${binding.artifact_id}:${binding.version}`}
              binding={binding}
              results={results}
              disabled={disabled}
              onOpenPreview={onOpenPreview}
              onAsk={onAsk}
            />
          ))}
          {completedActivity ? (
            <details
              className="graph-assistant-activity-item"
              aria-label="Completed assistant work"
            >
              <summary>Completed work</summary>
              <span>{completedActivity}</span>
            </details>
          ) : null}
        </>
      ) : null}
    </>
  );
}
