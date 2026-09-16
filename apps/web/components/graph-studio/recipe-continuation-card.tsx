"use client";

import type { AssistantRecipeContinuationAction } from "./types";

export function RecipeContinuationCard({ value, busy, onAction, onCancelRunning }: {
  onCancelRunning: () => void;
  value: unknown;
  busy: boolean;
  onAction: (action: AssistantRecipeContinuationAction, label: string) => void;
}) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const { id, token, state, request, workflow_name: destination } = record;
  if (typeof id !== "string" || typeof token !== "string" || typeof state !== "string") return null;
  if (["cancelled", "returned"].includes(state)) return null;
  const label = state === "offered" ? "Draft needed recipe" : state === "ready" ? "Return to graph proposal" : state === "interrupted" ? record.recipe_id ? "Continue graph proposal" : "Retry recipe draft" : null;
  return (
    <section className="graph-assistant-message graph-assistant-message-assistant" aria-label="Recipe continuation">
      <strong>Recipe for {String(destination || "original graph")}</strong>
      <details>
        <summary>Original graph request</summary>
        <p>{String(request || "")}</p>
        <p>{String(record.missing_requirements || "")}</p>
      </details>
      {state === "awaiting_save" ? <p>Review the recipe draft, then ask to save it and confirm Save recipe. Return becomes available after that save.</p> : null}
      {state === "ready" ? <p>Saved recipe: {String(record.recipe_label || "")}. Return prepares a proposal for review.</p> : null}
      {["expired", "stale", "drafting", "returning"].includes(state) && !busy ? <p>This continuation needs a fresh graph request. Retained drafts and saved recipes remain available.</p> : null}
      {state === "interrupted" ? <p>The previous attempt is incomplete. Continue explicitly with the same requirements and destination.</p> : null}
      {label ? <button className="graph-assistant-action-button" type="button" disabled={busy} onClick={() => onAction({ id, token, action: state === "interrupted" ? "retry" : state === "offered" ? "draft" : "return" }, label)}>{label}</button> : null}
      <button className="graph-assistant-action-button" type="button" onClick={() => busy ? onCancelRunning() : onAction({ id, token, action: "cancel" }, "Cancel recipe continuation")}>Cancel recipe continuation</button>
    </section>
  );
}
