"use client";

export function isGraphAssistantDebugEnabled() {
  return process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG === "1";
}

export function isGraphAssistantAvailable(
  health:
    | {
        codex_local_ready?: unknown;
        media_assistant_enabled?: unknown;
      }
    | null
    | undefined,
) {
  return (
    isGraphAssistantDebugEnabled() &&
    health?.media_assistant_enabled === true &&
    health.codex_local_ready === true
  );
}
