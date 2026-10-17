// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaModelsConsole } from "@/components/media-models-console";
import type {
  MediaEnhancementConfig,
  MediaModelSummary,
  MediaPreset,
  MediaQueueSettings,
} from "@/lib/types";

vi.mock("@/lib/graph-node-definitions-sync", () => ({ invalidateGraphNodeDefinitions: vi.fn(async () => undefined) }));

const refreshMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: pushMock,
  }),
}));

function makeModel(overrides: Partial<MediaModelSummary> = {}): MediaModelSummary {
  return {
    key: "nano-banana-2",
    label: "Nano Banana 2",
    provider_model: "nano-banana-2",
    task_modes: ["image_generation"],
    generation_kind: "image",
    input_patterns: ["prompt_only"],
    defaults: {},
    capability_summary: [],
    spend_notes: [],
    studio_support_status: "supported",
    studio_exposed: true,
    kie_spec_version: "2026-05-18",
    ...overrides,
  } as MediaModelSummary;
}

function makeEnhancementConfig(overrides: Partial<MediaEnhancementConfig> = {}): MediaEnhancementConfig {
  return {
    config_id: "cfg_1",
    model_key: "nano-banana-2",
    label: "Nano Banana 2 enhancement",
    status: "active",
    helper_profile: "midctx-64k-no-thinking-q3-prefill",
    provider_kind: "builtin",
    provider_label: null,
    provider_model_id: null,
    provider_api_key_configured: false,
    provider_base_url_configured: false,
    provider_credential_source: "none",
    provider_supports_images: false,
    provider_status: null,
    provider_last_tested_at: null,
    provider_capabilities_json: {},
    system_prompt: "",
    image_analysis_prompt: "",
    supports_text_enhancement: true,
    supports_image_analysis: false,
    notes: "",
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function makePreset(overrides: Partial<MediaPreset> = {}): MediaPreset {
  return {
    preset_id: "preset_1",
    key: "portrait_grid",
    label: "Portrait Grid",
    description: "Reusable preset",
    status: "active",
    source_kind: "custom",
    input_schema_json: [],
    input_slots_json: [],
    applies_to_models: ["nano-banana-2"],
    thumbnail_url: null,
    ...overrides,
  } as MediaPreset;
}

describe("MediaModelsConsole", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    pushMock.mockReset();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the queue and output-folder settings slices with the existing admin copy", () => {
    const queueSettings: MediaQueueSettings = {
      max_concurrent_jobs: 2,
      queue_enabled: true,
      default_poll_seconds: 8,
      max_retry_attempts: 3,
      created_at: null,
      updated_at: null,
    };

    render(
      <MediaModelsConsole
        models={[makeModel()]}
        presets={[makePreset()]}
        enhancementConfigs={[makeEnhancementConfig()]}
        queueSettings={queueSettings}
        queuePolicies={[]}
        sections={{
          queue: true,
          modelHelper: false,
          studioSettings: true,
          modelPanel: false,
          presets: false,
        }}
      />,
    );

    expect(screen.getByText("Queue Settings")).toBeTruthy();
    expect(screen.getByText("Media Output Folder")).toBeTruthy();
    expect(screen.getByDisplayValue("data/outputs")).toBeTruthy();
    expect(screen.getByText("Enable Or Disable Models")).toBeTruthy();
  });

  it("renders the model setup, helper, and preset slices after decomposition", () => {
    render(
      <MediaModelsConsole
        models={[makeModel()]}
        presets={[makePreset()]}
        enhancementConfigs={[makeEnhancementConfig()]}
        queueSettings={null}
        queuePolicies={[]}
        sections={{
          queue: false,
          modelHelper: true,
          studioSettings: false,
          modelPanel: true,
          presets: true,
        }}
      />,
    );

    expect(screen.getByText("Model Setup")).toBeTruthy();
    expect(screen.getAllByText("System Prompt").length).toBeGreaterThan(0);
    expect(screen.getByText("Structured Presets")).toBeTruthy();
    expect(screen.getByText("Prompt placeholder rules")).toBeTruthy();
  });

  it("preserves queue saves and availability toggles without hidden catalogs", async () => {
    const queueSettings: MediaQueueSettings = {
      max_concurrent_jobs: 15, queue_enabled: true, default_poll_seconds: 6, max_retry_attempts: 3,
      max_concurrent_jobs_min: 1, max_concurrent_jobs_max: 20,
      default_poll_seconds_min: 1, default_poll_seconds_max: 60,
      max_retry_attempts_min: 1, max_retry_attempts_max: 10,
      created_at: null, updated_at: null,
    };
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => Response.json({
      ok: true,
      ...(url.includes("queue-settings") ? { settings: JSON.parse(String(options.body)) } : {
        policy: { model_key: "nano-banana-2", enabled: true, max_outputs_per_run: 4 },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<MediaModelsConsole
      models={[makeModel()]} queueSettings={queueSettings}
      queuePolicies={[{ model_key: "nano-banana-2", enabled: false, max_outputs_per_run: 4, created_at: null, updated_at: null }]}
      sections={{ queue: true, modelHelper: false, studioSettings: true, modelPanel: false, presets: false }}
    />);
    expect(screen.queryByText("Structured Presets")).toBeNull();
    fireEvent.click(screen.getByText("Job Runner").closest("summary")!);
    fireEvent.click(screen.getByText("Model Availability", { selector: "h3" }).closest("summary")!);
    expect(screen.getByDisplayValue("15").getAttribute("max")).toBe("20");
    expect(screen.getByDisplayValue("6").getAttribute("max")).toBe("60");
    expect(screen.getByDisplayValue("3").getAttribute("max")).toBe("10");
    expect(screen.getByDisplayValue("data/outputs").hasAttribute("readonly")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getAllByText("Queue settings saved.").length).toBeGreaterThan(0));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/control/media-queue-settings");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ max_concurrent_jobs: 15, queue_enabled: true, default_poll_seconds: 6, max_retry_attempts: 3 });
    fireEvent.click(screen.getByRole("switch", { name: "Enable Nano Banana 2" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Disable Nano Banana 2" })).toBeTruthy());
    expect(fetchMock.mock.calls[1][0]).toBe("/api/control/media-queue-policies/nano-banana-2");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({ enabled: true, max_outputs_per_run: 4 });
  });

  it.each([false, true])("reuses valid refreshed server pages before child effects (changed rows: %s)", async (changed) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const initial = [makePreset()];
    const props = { models: [makeModel()], presets: initial, presetsTotal: 1, presetsNextOffset: null, presetsSeedValid: true,
      sections: { queue: false, modelHelper: false, studioSettings: false, modelPanel: false, presets: true } };
    const view = render(<MediaModelsConsole {...props} />);
    expect(screen.getByRole("heading", { name: "Portrait Grid" })).toBeTruthy();
    const refreshed = [makePreset(changed ? { label: "Refreshed preset" } : {})];
    view.rerender(<MediaModelsConsole {...props} presets={refreshed} />);
    await screen.findByRole("heading", { name: changed ? "Refreshed preset" : "Portrait Grid" });
    expect(fetchMock).not.toHaveBeenCalled();
  });


  it("refreshes the current search after a mocked import and reuses the new server page when cleared", async () => {
    vi.stubGlobal("FormData", window.FormData);
    const imported = makePreset({ preset_id: "imported", key: "imported", label: "Imported preset" });
    let available = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/import")) { available = true; return Response.json({ ok: true, preset: imported }); }
      return Response.json({ ok: true, presets: available ? [imported] : [], total: available ? 1 : 0, next_offset: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const props = { models: [makeModel()], presets: [makePreset()], presetsTotal: 1, presetsNextOffset: null, presetsSeedValid: true,
      sections: { queue: false, modelHelper: false, studioSettings: false, modelPanel: false, presets: true } };
    const view = render(<MediaModelsConsole {...props} />);
    fireEvent.change(screen.getByLabelText("Search media presets"), { target: { value: "imported" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(["mock zip"], "preset.zip", { type: "application/zip" })] } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/import"))).toBe(true));
    await screen.findByRole("heading", { name: "Imported preset" });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("q=imported"))).toHaveLength(2);
    view.rerender(<MediaModelsConsole {...props} presets={[imported, makePreset()]} presetsTotal={2} />);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url.includes("q=imported"))).toHaveLength(3));
    fireEvent.change(screen.getByLabelText("Search media presets"), { target: { value: "" } });
    await screen.findByRole("heading", { name: "Portrait Grid" });
    expect(screen.getByRole("heading", { name: "Imported preset" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

});
