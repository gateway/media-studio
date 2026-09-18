"use client";

export function PlanningRecoveryCard({ value, busy, onContinue }: {
  value: unknown;
  busy: boolean;
  onContinue: (id: string) => void;
}) {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !["offered", "resuming", "stale", "expired"].includes(String(record.state))) return null;
  const completed = Array.isArray(record.completed) ? record.completed.filter((item): item is string => typeof item === "string") : [];
  const errors = Array.isArray(record.errors) ? record.errors : [];
  return (
    <section className="graph-assistant-message graph-assistant-message-assistant" aria-label="Planning recovery">
      <strong>Planning paused: {String(record.workflow_name || "Graph")}</strong>
      <details><summary>Saved progress</summary>
        <p>{String(record.request || "")}</p>
        {completed.length ? <ul>{completed.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No checks completed yet.</p>}
        {errors.map((error, index) => <p key={index}>{String((error as { message?: unknown })?.message || "A check needs attention.")}</p>)}
      </details>
      <p>{String(record.remaining || "Finish the proposal and review it before running.")}</p>
      {record.state === "offered" ? <button className="graph-assistant-action-button" type="button" disabled={busy} onClick={() => onContinue(String(record.id))}>Continue planning</button> : <p>{record.state === "resuming" && busy ? "Continuing planning…" : "Start a fresh request using the current graph and references."}</p>}
      <span>Continuing does not start generation.</span>
    </section>
  );
}
