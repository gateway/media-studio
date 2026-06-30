"use client";

export function isGraphAssistantDebugEnabled() {
  return process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG === "1";
}

export function isGraphAssistantAvailable(
  health: { codex_local_ready?: unknown } | null | undefined,
) {
  return isGraphAssistantDebugEnabled() && health?.codex_local_ready === true;
}
