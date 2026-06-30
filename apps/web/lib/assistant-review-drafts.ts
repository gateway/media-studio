"use client";

import type { MediaPreset, PromptRecipeDraftPayload } from "@/lib/types";

const STORAGE_PREFIX = "media-studio:assistant-review-draft:";

export type AssistantPromptRecipeReviewDraft = {
  kind: "prompt_recipe";
  draft: PromptRecipeDraftPayload;
  validationWarnings: string[];
  mediaSummary: Array<Record<string, unknown>>;
  createdAt: string;
};

export type AssistantMediaPresetReviewDraft = {
  kind: "media_preset";
  draft: Partial<MediaPreset> & {
    key: string;
    label: string;
    prompt_template?: string | null;
    applies_to_models?: string[];
    input_schema_json?: Array<Record<string, unknown>>;
    input_slots_json?: Array<Record<string, unknown>>;
  };
  validationWarnings: string[];
  mediaSummary: Array<Record<string, unknown>>;
  createdAt: string;
};

export type AssistantReviewDraft = AssistantPromptRecipeReviewDraft | AssistantMediaPresetReviewDraft;

function storageKey(id: string) {
  return `${STORAGE_PREFIX}${id}`;
}

function createDraftId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function writeAssistantReviewDraft(draft: Omit<AssistantReviewDraft, "createdAt">) {
  const id = createDraftId();
  sessionStorage.setItem(storageKey(id), JSON.stringify({ ...draft, createdAt: new Date().toISOString() }));
  return id;
}

export function assistantReviewDraftUrl(reviewUrl: string, draftId: string, returnTo?: string) {
  const url = new URL(reviewUrl, window.location.origin);
  url.searchParams.set("assistantDraft", draftId);
  url.searchParams.set("returnTo", returnTo ?? `${window.location.pathname}${window.location.search}`);
  return `${url.pathname}${url.search}`;
}

export function assistantReviewReturnTarget(returnTo: string | undefined, assistantSessionId?: string | null) {
  const base = returnTo ?? `${window.location.pathname}${window.location.search}`;
  if (!assistantSessionId) return base;
  const url = new URL(base, window.location.origin);
  url.searchParams.set("assistantSession", assistantSessionId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function assistantReviewUrl(reviewUrl: string, returnTo?: string) {
  const url = new URL(reviewUrl, window.location.origin);
  if (returnTo) {
    url.searchParams.set("returnTo", returnTo);
  } else if (!url.searchParams.get("returnTo")) {
    url.searchParams.set("returnTo", `${window.location.pathname}${window.location.search}`);
  }
  return `${url.pathname}${url.search}`;
}

export function openAssistantReviewDraft(reviewUrl: string, draftId: string, returnTo?: string) {
  window.location.assign(assistantReviewDraftUrl(reviewUrl, draftId, returnTo));
}

export function openAssistantReviewUrl(reviewUrl: string, returnTo?: string) {
  window.location.assign(assistantReviewUrl(reviewUrl, returnTo));
}

export async function fetchAssistantReviewDraft(
  sessionId: string | null | undefined,
  messageId: string | null | undefined,
  expectedKind: AssistantReviewDraft["kind"],
) {
  if (!sessionId || !messageId) return null;
  const response = await fetch(`/api/control/media/assistant/sessions/${encodeURIComponent(sessionId)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Unable to load assistant review draft.");
  }
  const session = (await response.json()) as {
    messages?: Array<{
      assistant_message_id?: string;
      content_json?: {
        review_draft?: {
          kind?: string;
          draft?: unknown;
          validation_warnings?: string[];
          media_summary?: Array<Record<string, unknown>>;
        };
      };
    }>;
  };
  const message = (session.messages ?? []).find((item) => item.assistant_message_id === messageId);
  const reviewDraft = message?.content_json?.review_draft;
  if (!reviewDraft || reviewDraft.kind !== expectedKind || !reviewDraft.draft || typeof reviewDraft.draft !== "object") {
    return null;
  }
  return {
    kind: reviewDraft.kind,
    draft: reviewDraft.draft,
    validationWarnings: reviewDraft.validation_warnings ?? [],
    mediaSummary: reviewDraft.media_summary ?? [],
    createdAt: new Date().toISOString(),
  } as AssistantReviewDraft;
}

export function readAssistantReviewDraft(id: string | null | undefined, expectedKind: AssistantReviewDraft["kind"]) {
  if (!id) return null;
  const raw = sessionStorage.getItem(storageKey(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AssistantReviewDraft;
    return parsed.kind === expectedKind ? parsed : null;
  } catch {
    return null;
  }
}

export function clearAssistantReviewDraft(id: string | null | undefined) {
  if (!id) return;
  sessionStorage.removeItem(storageKey(id));
}
