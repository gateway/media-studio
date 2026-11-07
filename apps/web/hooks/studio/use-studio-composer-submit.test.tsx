// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStudioComposerSubmit } from "./use-studio-composer-submit";
import { StudioEnhanceDialog } from "@/components/studio/studio-enhance-dialog";
import type { MediaEnhancePreviewResponse } from "@/lib/types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function EnhancementFlow() {
  const [preview, setPreview] = useState<MediaEnhancePreviewResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const options: Parameters<typeof useStudioComposerSubmit>[0] = {
    autoValidateTimerRef: { current: null },
    validationRequestIdRef: { current: 0 },
    currentModelEnabled: true,
    currentModel: null,
    currentPreset: null,
    currentPresetCompatibleWithModel: false,
    currentPresetDefaultOptions: null,
    selectedPresetId: "",
    modelKey: "gpt-image-2",
    inferredInputPattern: "prompt_only",
    optionValues: {},
    prompt: "Keep warm amber light and 4:3 framing.",
    structuredPresetActive: false,
    structuredPresetPromptPreview: "",
    outputCount: 1,
    selectedPromptIds: [],
    seedanceComposer: false,
    effectiveSeedanceMode: "",
    multiShotsEnabled: false,
    multiShotScript: { shots: [], totalDurationSeconds: 0, error: null },
    multiShotScriptError: null,
    presetRequirementError: null,
    missingRequiredInputError: null,
    projectId: null,
    presetInputValues: {},
    structuredPresetImageSlots: [],
    presetSlotStates: {},
    currentImageMaxBytes: null,
    sourceAssetId: "existing-image",
    attachments: [],
    enhanceSupportsImage: true,
    enhanceSupportsText: true,
    enhanceEnabledForModel: true,
    enhanceHasSavedSystemPrompt: true,
    enhanceConfiguredForModel: true,
    enhancementPreviewVisual: "/existing-image.png",
    validationReady: true,
    maxConcurrentJobs: 1,
    localBatches: [],
    setValidation: vi.fn(),
    setFormMessage: vi.fn(),
    setBusyState: vi.fn(),
    setEnhanceDialogOpen: vi.fn(),
    setEnhancePreview: setPreview,
    setEnhanceError: setError,
    setEnhanceBusy: setBusy,
    setOptimisticBatches: vi.fn(),
    setLocalJobs: vi.fn(),
    upsertBatch: vi.fn(),
    setMobileComposerCollapsed: vi.fn(),
    showActivity: (payload) => setActivity(payload.message),
    showFloatingComposerBanner: vi.fn(),
    refreshCreditBalance: vi.fn(),
    pollJob: vi.fn(),
    pollBatch: vi.fn(),
  };
  const flow = useStudioComposerSubmit(options);
  return (
    <>
      <output aria-label="Activity">{activity}</output>
      <StudioEnhanceDialog
        open
        previewVisual="/existing-image.png"
        userPrompt={options.prompt}
        enhancedPrompt={preview?.final_prompt_used || null}
        imageAnalysisText={null}
        currentModelLabel="GPT Image 2"
        currentPresetLabel={null}
        providerLabel="Codex Local"
        providerModelId="configured"
        modeLabel="Text and image"
        readinessLabel="Configured"
        imageAnalysisStatus="Available"
        configuredForModel
        hasSavedSystemPrompt
        busy={busy}
        error={error}
        warnings={[]}
        onClose={vi.fn()}
        onRequestPreview={() => {
          flow.requestEnhancementPreview().catch((error: unknown) => {
            throw error;
          });
        }}
        onOpenSetup={vi.fn()}
        onUsePrompt={vi.fn()}
      />
    </>
  );
}

it("explains an unreachable enhancement and preserves prompt and image for a successful retry", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(
      Response.json({
        ok: true,
        preview: {
          final_prompt_used:
            "Warm amber light, deep navy shadows, 4:3 framing.",
        },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  render(<EnhancementFlow />);
  fireEvent.click(screen.getByRole("button", { name: "Enhance", exact: true }));
  const message =
    "Couldn’t enhance your prompt. Check your connection and try again.";
  expect(
    await within(screen.getByTestId("studio-enhance-dialog")).findByText(
      message,
    ),
  ).toBeTruthy();
  expect(screen.getByLabelText("Activity").textContent).toBe(message);
  expect(
    (screen.getByRole("button", { name: "Use prompt" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    screen.getByText("Keep warm amber light and 4:3 framing."),
  ).toBeTruthy();
  expect(screen.getByAltText("Enhancement reference").getAttribute("src")).toBe(
    "/existing-image.png",
  );
  fireEvent.click(screen.getByRole("button", { name: "Enhance", exact: true }));
  expect(
    await screen.findByText(
      "Warm amber light, deep navy shadows, 4:3 framing.",
    ),
  ).toBeTruthy();
  expect(screen.getByLabelText("Activity").textContent).toBe(
    "Enhancement preview is ready.",
  );
  for (const [, init] of fetch.mock.calls) {
    expect(init.body.get("prompt")).toBe(
      "Keep warm amber light and 4:3 framing.",
    );
    expect(init.body.get("source_asset_id")).toBe("existing-image");
  }
});

it("removes an older preview while retrying and after failure", async () => {
  let rejectRetry!: (error: Error) => void;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          preview: { final_prompt_used: "Old enhancement." },
        }),
      )
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectRetry = reject;
        }),
      ),
  );
  render(<EnhancementFlow />);
  fireEvent.click(screen.getByRole("button", { name: "Enhance", exact: true }));
  expect(await screen.findByText("Old enhancement.")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Enhance again", exact: true }),
  );
  expect(screen.queryByText("Old enhancement.")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Use prompt" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rejectRetry(new TypeError("Failed to fetch"));
  expect(
    await within(screen.getByTestId("studio-enhance-dialog")).findByText(
      /Check your connection and try again/,
    ),
  ).toBeTruthy();
  expect(screen.queryByText("Old enhancement.")).toBeNull();
});

it("turns an internal upstream route failure into supported recovery guidance", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          ok: false,
          error: "Control API returned 503 for /media/enhance/preview.",
        },
        { status: 502 },
      ),
    ),
  );
  render(<EnhancementFlow />);
  fireEvent.click(screen.getByRole("button", { name: "Enhance", exact: true }));
  const message =
    "Couldn’t enhance your prompt. Try again, or check the enhancement provider in Settings.";
  expect(
    await within(screen.getByTestId("studio-enhance-dialog")).findByText(
      message,
    ),
  ).toBeTruthy();
  expect(screen.getByLabelText("Activity").textContent).toBe(message);
  expect(screen.queryByText(/Control API returned/)).toBeNull();
});

it.each([
  [
    "Enhancement provider returned the original prompt unchanged. Update the enhancement prompt in Models or switch the enhancement model in Settings.",
    "Enhancement provider returned the original prompt unchanged. Update the enhancement prompt in Models or switch the enhancement model in Settings.",
  ],
  [
    "openrouter enhancement failed with 503.",
    "Couldn’t enhance your prompt. Try again, or check the enhancement provider in Settings.",
  ],
  [
    "local_openai_compatible enhancement failed with 502.",
    "Couldn’t enhance your prompt. Try again, or check the enhancement provider in Settings.",
  ],
  [
    "codex_local enhancement failed with 503. Retry failed with 500.",
    "Couldn’t enhance your prompt. Try again, or check the enhancement provider in Settings.",
  ],
  [
    "openrouter recipe draft failed with 503.",
    "openrouter recipe draft failed with 503.",
  ],
  [
    "The Control API is unavailable right now.",
    "Couldn’t enhance your prompt. Check your connection and try again.",
  ],
  [
    "Save an enhancement system prompt in Models before using Enhance.",
    "Save an enhancement system prompt in Models before using Enhance.",
  ],
  [
    "The enhancement provider timed out. Try again or switch the enhancement model in Settings.",
    "The enhancement provider timed out. Try again or switch the enhancement model in Settings.",
  ],
])("keeps dialog and activity consistent for %s", async (error, expected) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(Response.json({ ok: false, error }, { status: 502 })),
  );
  render(<EnhancementFlow />);
  fireEvent.click(screen.getByRole("button", { name: "Enhance", exact: true }));
  expect(
    await within(screen.getByTestId("studio-enhance-dialog")).findByText(
      expected,
    ),
  ).toBeTruthy();
  expect(screen.getByLabelText("Activity").textContent).toBe(expected);
  expect(
    (screen.getByRole("button", { name: "Use prompt" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("times out the enhancement with an actionable message and keeps the original input", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ),
  );
  render(<EnhancementFlow />);
  fireEvent.click(screen.getByRole("button", { name: "Enhance", exact: true }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90000);
  });
  const message =
    "Enhancement timed out. Check the provider in Settings and try again.";
  expect(
    within(screen.getByTestId("studio-enhance-dialog")).getByText(message),
  ).toBeTruthy();
  expect(screen.getByLabelText("Activity").textContent).toBe(message);
  expect(
    screen.getByText("Keep warm amber light and 4:3 framing."),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Use prompt" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it.each([
  "Codex Local App Server returned invalid JSON.",
  "Codex Local returned an empty response.",
])(
  "keeps %s in optional enhancement details and preserves input",
  async (error) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ok: false, error }, { status: 502 }),
        ),
    );
    render(<EnhancementFlow />);
    fireEvent.click(
      screen.getByRole("button", { name: "Enhance", exact: true }),
    );
    const message =
      "Couldn’t enhance your prompt. Try again, or check the enhancement provider in Settings.";
    const dialog = screen.getByTestId("studio-enhance-dialog");
    expect(await within(dialog).findByText(message)).toBeTruthy();
    expect(within(dialog).getByText(error).closest("details")).toBeTruthy();
    expect(screen.getByLabelText("Activity").textContent).toBe(message);
    expect(
      screen.getByText("Keep warm amber light and 4:3 framing."),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Use prompt" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  },
);
