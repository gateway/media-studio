// @vitest-environment jsdom

import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { StudioComposerControls } from "@/components/studio/studio-composer-controls";
import { StudioPromptComposerBody } from "@/components/studio/studio-prompt-composer-body";
import { useStudioComposer } from "@/hooks/studio/use-studio-composer";
import { MULTI_SHOT_MODEL_KEYS } from "@/lib/media-studio-helpers";
import type { ComposerStatusMessage } from "@/lib/media-studio-contract";
import { writeStudioComposerDraft } from "@/lib/studio-composer-draft";
import type { MediaModelSummary } from "@/lib/types";

// Existing catalog contracts; no provider, DB or generation calls.
const models = [
  {
    key: "kling-3.0-t2v",
    input_patterns: ["prompt_only"],
    options: {
      duration: { type: "int_range", min: 3, max: 15, default: 3 },
      aspect_ratio: { type: "enum", allowed: ["1:1", "9:16", "16:9"] },
      mode: { type: "enum", allowed: ["std", "pro", "4K"], default: "std" },
      sound: { type: "bool", default: false },
      multi_shots: { type: "bool", default: false },
    },
  },
  {
    key: "kling-3.0-i2v",
    input_patterns: ["single_image", "first_last_frames"],
    image_inputs: { required_min: 1, required_max: 2 },
    options: {
      aspect_ratio: {
        type: "enum", allowed: ["1:1", "16:9", "9:16"],
        ui_visible_when: { $input_pattern: ["prompt_only", "single_image"] },
      },
    },
  },
  {
    key: "kling-2.6-t2v",
    input_patterns: ["prompt_only"],
    options: {
      duration: { type: "enum", allowed: [5, 10], default: 5 },
      sound: { type: "bool", default: false },
      aspect_ratio: { type: "enum", allowed: ["1:1", "16:9", "9:16"] },
    },
  },
  {
    key: "kling-2.6-i2v",
    input_patterns: ["single_image"],
    image_inputs: { required_min: 1, required_max: 1 },
  },
  {
    key: "kling-3.0-turbo-i2v",
    input_patterns: ["single_image", "first_last_frames"],
    image_inputs: { required_min: 1 },
    options: {
      duration: { type: "int_range", min: 3, max: 15, default: 5 },
      resolution: { type: "enum", allowed: ["720p", "1080p"], default: "720p" },
    },
  },
  ...["kling-2.6-motion", "kling-3.0-motion"].map((key) => ({
    key,
    input_patterns: ["motion_control"],
    image_inputs: { required_min: 1, required_max: 1 },
    video_inputs: { required_min: 1, required_max: 1 },
    options: {
      character_orientation: {
        type: "enum",
        allowed: ["image", "video"],
        default: "image",
      },
      mode: { type: "enum", allowed: ["720p", "1080p"], default: "720p" },
    },
  })),
].map((entry, index, entries) => ({
  generation_kind: "video",
  studio_exposed: true,
  image_inputs: { required_max: 0 },
  video_inputs: { required_max: 0 },
  audio_inputs: { required_max: 0 },
  ...entry,
  label: entry.key,
  options:
    entry.options ??
    (index === 1
      ? entries[0].options
      : {
          duration: { type: "enum", allowed: [5, 10], default: 5 },
          sound: { type: "bool", default: false },
        }),
})) as MediaModelSummary[];
const empty: never[] = [];
const noop = vi.fn();

function KlingComposer() {
  const [sourceAssetId, setSourceAssetId] = useState<string | number | null>(
    null,
  );
  const [formMessage, setFormMessage] = useState<ComposerStatusMessage | null>(
    null,
  );
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const { refs, state, derived, actions } = useStudioComposer({
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
    setOptimisticBatches: noop,
    setLocalJobs: noop,
    upsertBatch: noop,
    pollJob: noop,
    pollBatch: noop,
    showActivity: noop,
    refreshCreditBalance: noop,
  });
  return (
    <>
      <select
        aria-label="Model"
        value={state.modelKey}
        onChange={(event) => void actions.setModelKey(event.target.value)}
      >
        {models.map((model) => (
          <option key={model.key}>{model.key}</option>
        ))}
      </select>
      <button
        onClick={() =>
          actions.setAttachments([
            {
              id: "image",
              kind: "images",
              file: null,
              previewUrl: "/source.png",
            },
            {
              id: "video",
              kind: "videos",
              file: null,
              previewUrl: "/drive.mp4",
              durationSeconds: 20,
            },
          ])
        }
      >
        Stage motion inputs
      </button>
      <button
        onClick={() =>
          actions.setAttachments([
            {
              id: "first",
              kind: "images",
              file: null,
              previewUrl: "/first.png",
            },
            { id: "last", kind: "images", file: null, previewUrl: "/last.png" },
          ])
        }
      >
        Stage frames
      </button>
      <p>{derived.missingRequiredInputError}</p>
      <span data-testid="pricing-options">{JSON.stringify(derived.pricingOptions)}</span>
      <StudioPromptComposerBody
        promptInputRef={refs.promptInputRef}
        prompt={state.prompt}
        multiShotsEnabled={derived.multiShotsEnabled}
        multiShot={
          MULTI_SHOT_MODEL_KEYS.has(state.modelKey)
            ? {
                script: derived.multiShotScript,
                error: derived.multiShotScriptError,
                duration: state.optionValues.duration,
                onToggle: () =>
                  actions.updateOption(
                    "multi_shots",
                    !derived.multiShotsEnabled,
                  ),
              }
            : undefined
        }
        promptReferencePickerOpen={false}
        promptReferenceChoices={[]}
        promptReferenceActiveIndex={0}
        enhanceEnabledForModel={false}
        enhanceConfiguredForModel={false}
        enhanceHasSavedSystemPrompt={false}
        onPromptChange={actions.setPrompt}
        onPromptFocusChange={noop}
        onPromptReferenceDismissedChange={noop}
        onPromptCursorSync={noop}
        onPromptReferenceActiveIndexChange={noop}
        onApplyPromptReferenceChoice={noop}
        onOpenEnhanceDialog={noop}
        onOpenEnhancementSetup={noop}
      />
      <StudioComposerControls
        structuredPresetActive={false}
        openPicker={openPicker}
        modelKey={state.modelKey}
        modelMaxOutputs={1}
        outputCount={1}
        compactOptionEntries={derived.compactOptionEntries}
        optionValues={derived.requestOptions}
        canSubmit={derived.canSubmit}
        generateButtonLabel="Generate"
        onOpenPickerChange={setOpenPicker}
        onOutputCountChange={noop}
        onOptionChange={actions.updateOption}
        onClear={noop}
        onSubmit={noop}
      />
      <button
        onClick={() => {
          actions.submitMedia("validate").catch(noop);
        }}
      >
        Check request
      </button>
    </>
  );
}

function mockService() {
  const fetch = vi
    .fn()
    .mockImplementation(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  writeStudioComposerDraft(null);
  vi.unstubAllGlobals();
});

it("keeps timed-script editing, duration errors and validated request values through the new switch", async () => {
  const fetch = mockService();
  render(<KlingComposer />);
  fireEvent.click(
    screen.getByRole("switch", { name: "Multi-shot", checked: false }),
  );
  expect(screen.queryByTestId("studio-picker-multi_shots")).toBeNull();
  const prompt = screen.getByRole("textbox", { name: "Prompt" });
  fireEvent.change(prompt, {
    target: { value: "3 | Walk through the city gate." },
  });
  expect(screen.getByRole("status").textContent).toBe("1 shot · 3 / 3 seconds");
  fireEvent.click(screen.getByTestId("studio-picker-duration"));
  fireEvent.click(screen.getByTestId("studio-picker-option-duration-10"));
  expect(screen.getByRole("status").textContent).toContain(
    "Shot durations total 3s, but the selected duration is 10s.",
  );
  expect(
    (screen.getByTestId("studio-generate-button") as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check request" }));
  expect(fetch).not.toHaveBeenCalled();
  const script =
    "3 | Walk through the city gate.\n4 | Follow across the bridge.\n3 | Reveal the castle.";
  fireEvent.change(prompt, { target: { value: script } });
  expect(screen.getByRole("status").textContent).toBe(
    "3 shots · 10 / 10 seconds",
  );
  fireEvent.click(screen.getByTestId("studio-picker-mode"));
  fireEvent.click(screen.getByTestId("studio-picker-option-mode-pro"));
  fireEvent.click(screen.getByRole("button", { name: "Check request" }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const body = fetch.mock.calls.at(-1)![1].body as FormData;
  expect(body.get("intent")).toBe("validate");
  expect(body.get("prompt")).toBe(script);
  expect(JSON.parse(String(body.get("options")))).toMatchObject({
    duration: 10,
    mode: "pro",
    multi_shots: true,
    sound: false,
  });
  expect(JSON.parse(String(body.get("multi_prompt")))).toEqual([
    { duration: 3, prompt: "Walk through the city gate." },
    { duration: 4, prompt: "Follow across the bridge." },
    { duration: 3, prompt: "Reveal the castle." },
  ]);
  fireEvent.click(
    screen.getByRole("switch", { name: "Multi-shot", checked: true }),
  );
  expect((prompt as HTMLTextAreaElement).value).toBe(script);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check request" }));
  await waitFor(() =>
    expect(fetch.mock.calls.at(-1)![1].body.get("multi_prompt")).toBeNull(),
  );
});

it.each(["kling-2.6-motion", "kling-3.0-motion"])(
  "keeps %s orientation validation and quality values",
  async (key) => {
    const fetch = mockService();
    render(<KlingComposer />);
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: key },
    });
    fireEvent.click(screen.getByText("Stage motion inputs"));
    expect(
      screen.getByText(/allows up to 10s when character orientation is image/),
    ).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Multi-shot" })).toBeNull();
    expect(screen.getByTestId("studio-picker-mode").textContent).toBe("720p");
    fireEvent.click(screen.getByTestId("studio-picker-character_orientation"));
    fireEvent.click(
      screen.getByTestId("studio-picker-option-character_orientation-video"),
    );
    expect(screen.queryByText(/allows up to 10s/)).toBeNull();
    fireEvent.click(screen.getByTestId("studio-picker-mode"));
    fireEvent.click(screen.getByTestId("studio-picker-option-mode-1080p"));
    fireEvent.click(screen.getByRole("button", { name: "Check request" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const body = fetch.mock.calls.at(-1)![1].body as FormData;
    expect(JSON.parse(String(body.get("options")))).toMatchObject({
      character_orientation: "video",
      mode: "1080p",
    });
    expect(body.get("multi_prompt")).toBeNull();
  },
);

it.each(models.map((model) => model.key))(
  "exposes only existing model controls for %s",
  (key) => {
    mockService();
    render(<KlingComposer />);
    fireEvent.change(screen.getByLabelText("Model"), {
      target: { value: key },
    });
    expect(Boolean(screen.queryByRole("switch", { name: "Multi-shot" }))).toBe(
      MULTI_SHOT_MODEL_KEYS.has(key),
    );
    expect(
      Boolean(screen.queryByTestId("studio-picker-character_orientation")),
    ).toBe(key.endsWith("-motion"));
    expect(Boolean(screen.queryByTestId("studio-picker-resolution"))).toBe(
      key.includes("turbo"),
    );
  },
);

it("suppresses aspect only for Kling3 image first/last frames and strips it from the request", async () => {
  const fetch = mockService();
  render(<KlingComposer />);
  fireEvent.change(screen.getByLabelText("Model"), {
    target: { value: "kling-3.0-i2v" },
  });
  expect(screen.getByTestId("studio-picker-aspect_ratio")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
    target: { value: "Move toward the city." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Stage frames" }));
  expect(screen.queryByTestId("studio-picker-aspect_ratio")).toBeNull();
  expect(JSON.parse(screen.getByTestId("pricing-options").textContent ?? "{}")).not.toHaveProperty("aspect_ratio");
  fireEvent.click(screen.getByRole("button", { name: "Check request" }));
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const body = fetch.mock.calls.at(-1)![1].body as FormData;
  expect(JSON.parse(String(body.get("options")))).not.toHaveProperty(
    "aspect_ratio",
  );
  expect(body.get("multi_prompt")).toBeNull();
  fireEvent.change(screen.getByLabelText("Model"), {
    target: { value: "kling-3.0-t2v" },
  });
  expect(screen.getByTestId("studio-picker-aspect_ratio")).toBeTruthy();
});
