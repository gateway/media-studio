// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStudioComposer } from "./use-studio-composer";
import { readStudioComposerDraft, writeStudioComposerDraft } from "@/lib/studio-composer-draft";
import type { MediaPreset, MediaModelSummary, MediaJob, MediaAsset } from "@/lib/types";
import type { ComposerStatusMessage } from "@/lib/media-studio-contract";
import { useStudioRestoreActions } from "./use-studio-restore-actions";
import { buildStudioRetryRestorePlan } from "@/lib/media-studio-helpers";

const model = { key: "gpt-image-2-image-to-image", label: "GPT Image 2", generation_kind: "image", studio_exposed: true,
  task_modes: ["image_edit"], input_patterns: ["image_edit"], image_inputs: { required_min: 1, required_max: 16 },
  defaults: { quality: "low" }, options: { quality: { choices: ["low", "high"] } } } as MediaModelSummary;
const summary: MediaPreset = { preset_id: "older", key: "older", label: "Older preset", status: "active", source_kind: "custom",
  model_key: model.key, applies_to_models: [model.key], applies_to_task_modes: [], applies_to_input_patterns: [], image_input_policy: "required" };
const detail: MediaPreset = { ...summary, prompt_template: "Unit {{unit_code}}",
  input_schema_json: [{ key: "unit_code", label: "Unit Code", default_value: "AX-17", required: true }],
  input_slots_json: [{ key: "personal_reference", label: "Personal Reference", required: true }],
  default_options_json: { quality: "low" } };
const models = [model], empty: never[] = [];
const callbacks = { setOptimisticBatches: vi.fn(), setLocalJobs: vi.fn(), upsertBatch: vi.fn(), pollJob: vi.fn(), pollBatch: vi.fn(), showActivity: vi.fn(), refreshCreditBalance: vi.fn() };

function useComposer(presets: MediaPreset[], availableModels = models) {
  const [sourceAssetId, setSourceAssetId] = useState<string | number | null>(null);
  const [formMessage, setFormMessage] = useState<ComposerStatusMessage | null>(null);
  return useStudioComposer({ models: availableModels, presets, prompts: empty, enhancementConfigs: empty, queueSettings: null, queuePolicies: empty,
    localBatches: empty, localAssets: empty, favoriteAssets: null, projectId: "project-1", sourceAssetId, setSourceAssetId,
    formMessage, setFormMessage, ...callbacks });
}

function savedDraft() {
  writeStudioComposerDraft({ modelKey: model.key, selectedPresetId: "older", selectedPromptIds: [], prompt: "Saved prompt",
    presetInputValues: { unit_code: "USER-42" }, presetSlotStates: { personal_reference: { assetId: "asset-1", previewUrl: "/existing.png", file: null } },
    optionValues: { quality: "high" }, attachments: [], outputCount: 1, sourceAssetId: null, stagedSourceAssetSnapshot: null, lastNanoPresetModelKey: model.key });
}

afterEach(() => { cleanup(); writeStudioComposerDraft(null); vi.unstubAllGlobals(); });

it("restores an older draft only after detail is available without erasing saved inputs/options", async () => {
  savedDraft();
  let resolve!: (response: Response) => void;
  const fetch = vi.fn().mockImplementation(() => new Promise<Response>(r => { resolve = r; }));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useComposer([summary]));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/control/media-presets/older", expect.anything()));
  expect(result.current.state.selectedPresetId).toBe("older");
  expect(result.current.derived.canSubmit).toBe(false);
  expect(readStudioComposerDraft()?.presetInputValues).toEqual({ unit_code: "USER-42" });
  await act(async () => resolve(Response.json({ ok: true, preset: detail })));
  await waitFor(() => expect(result.current.derived.structuredPresetTextFields[0]?.defaultValue).toBe("AX-17"));
  expect(result.current.state.presetInputValues).toEqual({ unit_code: "USER-42" });
  expect(result.current.state.presetSlotStates.personal_reference.assetId).toBe("asset-1");
  expect(result.current.state.optionValues.quality).toBe("high");
  expect(readStudioComposerDraft()?.selectedPresetId).toBe("older");
});

it("applies exact selected detail defaults without refetching or retaining the previous draft fields", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected fetch")));
  const { result } = renderHook(() => useComposer([summary]));
  act(() => result.current.actions.applyPresetSelection("older", { presetOverride: detail }));
  await waitFor(() => expect(result.current.derived.structuredPresetTextFields[0]?.defaultValue).toBe("AX-17"));
  expect(result.current.state.presetInputValues).toEqual({ unit_code: "AX-17" });
  expect(result.current.state.optionValues.quality).toBe("low");
  expect(fetch).not.toHaveBeenCalledWith("/api/control/media-presets/older", expect.anything());
});

const asset = { asset_id: "asset-1", generation_kind: "image", hero_thumb_url: "/existing.png" } as MediaAsset;
const job = { job_id: "job-1", model_key: model.key, resolved_preset_key: "older", project_id: "project-1", raw_prompt: "Original job prompt",
  resolved_options: { quality: "high" }, normalized_request: { preset_inputs_json: { unit_code: "JOB-99" }, preset_slot_values_json: { personal_reference: [{ asset_id: "asset-1" }] } } } as MediaJob;

function useRestore() {
  const composer = useComposer([summary]);
  const plan = buildStudioRetryRestorePlan({ job, models, presets: [summary], localAssets: [asset], favoriteAssets: null });
  const restore = useStudioRestoreActions({ selectedFailedJobRetryPlan: plan, selectedFailedJobPrimaryInput: null, selectedFailedJobReferenceInputs: [],
    selectedAssetJob: job, selectedAssetBatch: null, selectedAssetRevisionPlan: plan, models, presets: [summary], localAssets: [asset], favoriteAssets: null,
    selectedProjectId: "project-1", setSelectedProjectId: vi.fn(), studioHrefForProject: () => "/studio?project=project-1",
    setLocalAssets: vi.fn(), setLocalJobs: vi.fn(), upsertBatch: vi.fn(), restoreDependencies: {
      ...composer.actions, setSelectedFailedJobId: vi.fn(), setSelectedAssetId: vi.fn(), setSelectedMediaLightboxOpen: vi.fn(),
      setSelectedReferencePreview: vi.fn(), setFormMessage: vi.fn(), revealComposer: vi.fn(),
    } });
  return { composer, restore };
}

it("hydrates retry detail before rebuilding saved text and image-slot state", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, preset: detail })));
  const { result } = renderHook(useRestore);
  await act(async () => result.current.restore.retryFailedJobInStudio(job));
  await waitFor(() => expect(result.current.composer.state.presetSlotStates.personal_reference?.assetId).toBe("asset-1"));
  expect(result.current.composer.state.presetInputValues.unit_code).toBe("JOB-99");
  expect(result.current.composer.state.optionValues.quality).toBe("high");
  expect(result.current.composer.state.selectedPresetId).toBe("older");
});

it("hydrates revised job details before restoring its image slots and saved options", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("media-jobs") ? { ok: true, job } : { ok: true, preset: detail })));
  const { result } = renderHook(useRestore);
  await act(async () => result.current.restore.reviseSelectedAssetInStudio({ ...asset, job_id: job.job_id }));
  expect(result.current.composer.state.presetInputValues.unit_code).toBe("JOB-99");
  expect(result.current.composer.state.presetSlotStates.personal_reference.assetId).toBe("asset-1");
  expect(result.current.composer.state.optionValues.quality).toBe("high");
});

it("leaves the populated draft intact when retry detail cannot be hydrated", async () => {
  savedDraft();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false }, { status: 503 })));
  const { result } = renderHook(useRestore);
  await act(async () => result.current.restore.retryFailedJobInStudio(job));
  expect(result.current.composer.state.presetInputValues.unit_code).toBe("USER-42");
  expect(result.current.composer.state.presetSlotStates.personal_reference.assetId).toBe("asset-1");
  expect(result.current.composer.state.optionValues.quality).toBe("high");
  expect(readStudioComposerDraft()?.presetInputValues.unit_code).toBe("USER-42");
});

it("ignores a delayed draft detail after the user selects a different preset", async () => {
  savedDraft();
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { resolve = r; })));
  const { result } = renderHook(() => useComposer([summary]));
  const other = { ...detail, preset_id: "other", key: "other" };
  act(() => result.current.actions.applyPresetSelection("other", { presetOverride: other }));
  act(() => result.current.actions.setPresetInputValues({ unit_code: "NEW-USER" }));
  await act(async () => resolve(Response.json({ ok: true, preset: detail })));
  expect(result.current.state.selectedPresetId).toBe("other");
  expect(result.current.state.presetInputValues.unit_code).toBe("NEW-USER");
  expect(result.current.derived.currentPreset?.preset_id).toBe("other");
});

it("uses the new model defaults for an explicit model change", () => {
  const other = { ...model, key: "other", defaults: { quality: "medium" } };
  const { result } = renderHook(() => useComposer([], [model, other]));
  act(() => result.current.actions.setOptionValues({ quality: "high" }));
  act(() => result.current.actions.setModelKey("other"));
  expect(result.current.state.optionValues.quality).toBe("medium");
});

it.each([
  { name: "text fields", schema: detail.input_schema_json, slots: [], structured: true },
  { name: "image slots", schema: [], slots: detail.input_slots_json, structured: true },
  { name: "text fields and image slots", schema: detail.input_schema_json, slots: detail.input_slots_json, structured: true },
  { name: "empty input lists", schema: [], slots: [], structured: false },
  { name: "absent input lists", schema: undefined, slots: undefined, structured: false },
])("switches to a preset with $name without mixing structured and freeform inputs", ({ schema, slots, structured }) => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected fetch")));
  const next: MediaPreset = { ...detail, preset_id: "next", key: "next", prompt_template: "Next template",
    input_schema_json: schema, input_slots_json: slots };
  const selectionModels = [{ ...model, task_modes: ["text_to_image", "image_edit"],
    image_inputs: { required_min: 0, required_max: 16 } }];
  const { result } = renderHook(() => useComposer([detail, next], selectionModels));
  act(() => result.current.actions.applyPresetSelection("older"));
  act(() => {
    result.current.actions.setPrompt("Keep my prompt");
    result.current.actions.setPresetInputValues({ stale: "Previous value" });
    result.current.actions.setPresetSlotStates({ stale: { assetId: "old-slot", previewUrl: "/old.png", file: null } });
    result.current.actions.stageSourceAsset(asset);
    result.current.actions.setAttachments([{ id: "reference", kind: "images", role: "reference", file: null,
      previewUrl: "/reference.png", assetId: "reference-asset" }]);
  });
  act(() => result.current.actions.applyPresetSelection("next"));
  expect(result.current.state.selectedPresetId).toBe("next");
  expect(result.current.state.presetInputValues).toEqual(schema?.length ? { unit_code: "AX-17" } : {});
  expect(result.current.state.presetSlotStates).toEqual({});
  expect(result.current.state.prompt).toBe(structured ? "Keep my prompt" : "Next template");
  expect(result.current.state.attachments.map(attachment => attachment.assetId)).toEqual(structured ? [] : ["reference-asset"]);
  expect(result.current.derived.currentSourceAsset?.asset_id ?? null).toBe(structured ? null : "asset-1");
});

it("keeps the freeform prompt when the selected preset template is blank", () => {
  const next = { ...detail, input_schema_json: [], input_slots_json: [], prompt_template: "  " };
  const { result } = renderHook(() => useComposer([next]));
  act(() => result.current.actions.setPrompt("Keep my prompt"));
  act(() => result.current.actions.applyPresetSelection("older"));
  expect(result.current.state.prompt).toBe("Keep my prompt");
});

it("switches to a supported preferred model and applies that model's preset options", () => {
  const other = { ...model, key: "other" };
  const next = { ...detail, applies_to_models: [model.key, other.key], default_options_json: { quality: "high" } };
  const { result } = renderHook(() => useComposer([next], [model, other]));
  act(() => result.current.actions.applyPresetSelection("older", { preferredModelKey: other.key }));
  expect(result.current.state.modelKey).toBe("other");
  expect(result.current.state.selectedPresetId).toBe("older");
  expect(result.current.state.optionValues.quality).toBe("high");
});
