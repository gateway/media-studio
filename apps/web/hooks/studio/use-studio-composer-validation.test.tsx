// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { writeStudioComposerDraft } from "@/lib/studio-composer-draft";
import type { ComposerStatusMessage } from "@/lib/media-studio-contract";
import type { MediaModelSummary } from "@/lib/types";
import { useStudioComposer } from "./use-studio-composer";

const models = [
  {
    key: "gpt-image-2-text-to-image",
    generation_kind: "image",
    studio_exposed: true,
    input_patterns: ["prompt_only"],
    defaults: {},
  },
] as MediaModelSummary[];
const empty: never[] = [];
const callbacks = {
  setOptimisticBatches: vi.fn(),
  setLocalJobs: vi.fn(),
  upsertBatch: vi.fn(),
  pollJob: vi.fn(),
  pollBatch: vi.fn(),
  showActivity: vi.fn(),
  refreshCreditBalance: vi.fn(),
};
function useComposer() {
  const [sourceAssetId, setSourceAssetId] = useState<string | number | null>(
    null,
  );
  const [formMessage, setFormMessage] = useState<ComposerStatusMessage | null>(
    null,
  );
  return useStudioComposer({
    models,
    presets: empty,
    prompts: empty,
    enhancementConfigs: empty,
    queueSettings: null,
    queuePolicies: empty,
    localBatches: empty,
    localAssets: empty,
    favoriteAssets: null,
    projectId: null,
    sourceAssetId,
    setSourceAssetId,
    formMessage,
    setFormMessage,
    ...callbacks,
  });
}

afterEach(() => {
  cleanup();
  writeStudioComposerDraft(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("debounces changed input for 180ms without retriggering on callback identities or validation responses", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ ok: true, validation: { estimated_credits: 3 } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender, unmount } = renderHook(useComposer);
  act(() => result.current.actions.setPrompt("First prompt"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  act(() => result.current.actions.setPrompt("Current prompt"));
  rerender();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(179);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect((fetchMock.mock.calls[0][1]?.body as FormData).get("prompt")).toBe(
    "Current prompt",
  );
  expect((fetchMock.mock.calls[0][1]?.body as FormData).get("intent")).toBe(
    "validate",
  );
  rerender();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(fetchMock).toHaveBeenCalledOnce();
  act(() => result.current.actions.setPrompt("Do not validate after close"));
  unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(fetchMock).toHaveBeenCalledOnce();
});
