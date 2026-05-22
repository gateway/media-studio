type StatusTone = "healthy" | "warning" | "danger" | "neutral";

export function readyStatus(): { label: string; tone: StatusTone } {
  return { label: "Ready", tone: "healthy" };
}

export function connectingStatus(): { label: string; tone: StatusTone } {
  return { label: "Connecting", tone: "warning" };
}

export function failedStatus(): { label: string; tone: StatusTone } {
  return { label: "Failed", tone: "danger" };
}

export function notSetUpStatus(): { label: string; tone: StatusTone } {
  return { label: "Not set up", tone: "neutral" };
}

export function readinessStatus(ready: boolean, configured: boolean) {
  if (ready) return readyStatus();
  if (configured) return connectingStatus();
  return notSetUpStatus();
}

export function binaryReadinessStatus(ready: boolean) {
  return ready ? readyStatus() : notSetUpStatus();
}

export function humanizeGraphRunStatus(status: string) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "queued" || normalized === "submitted") return "Queued";
  if (normalized === "running" || normalized === "processing") return "Running";
  if (normalized === "cancelling") return "Running";
  if (normalized === "completed") return "Completed";
  if (normalized === "failed") return "Failed";
  if (normalized === "cancelled") return "Cancelled";
  if (!normalized) return "Ready";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
