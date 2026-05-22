// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaModelsConsole } from "@/components/media-models-console";
import type {
  MediaEnhancementConfig,
  MediaModelSummary,
  MediaPreset,
  MediaQueueSettings,
} from "@/lib/types";

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
          enhancementProvider: false,
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
          enhancementProvider: false,
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
});
