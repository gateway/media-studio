// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioPresetBrowser } from "./studio-preset-browser";
import type { MediaModelSummary, MediaPreset } from "@/lib/types";

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

const presets: MediaPreset[] = [
  {
    preset_id: "preset-1",
    key: "car-magazine",
    label: "Car Magazine",
    description: "Preset for car imagery",
    status: "active",
    model_key: "gpt-image-1",
    source_kind: "custom",
    base_builtin_key: null,
    applies_to_models: ["gpt-image-1"],
    applies_to_task_modes: [],
    applies_to_input_patterns: [],
    prompt_template: "Create {{car_name}}.",
    input_schema_json: [{ key: "car_name", label: "Car name", required: true }],
    input_slots_json: [],
    thumbnail_path: null,
    thumbnail_url: null,
    notes: null,
  },
];

const models: MediaModelSummary[] = [
  {
    key: "gpt-image-1",
    label: "GPT Image 1",
    provider_model: "gpt-image-1",
    task_modes: ["text_to_image"],
    image_inputs: { required_min: 0, required_max: 0 },
    input_patterns: ["prompt_only"],
    generation_kind: "image",
  },
];

describe("StudioPresetBrowser", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, presets, total: presets.length, limit: 60, offset: 0, next_offset: null })),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("preserves the current Studio return target when opening preset editors", () => {
    render(
      <StudioPresetBrowser
        presets={presets}
        models={models}
        returnToHref="/studio?graphTab=tab-42"
        onClose={vi.fn()}
        onSelectPreset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Edit Car Magazine"));

    expect(pushMock).toHaveBeenCalledWith(
      "/presets/preset-1?returnTo=%2Fstudio%3FgraphTab%3Dtab-42",
    );
  });

  it("renders a bounded initial preset page for large catalogs", () => {
    const manyPresets = Array.from({ length: 500 }, (_, index) => ({
      ...presets[0],
      preset_id: `preset-${index}`,
      key: `preset-${index}`,
      label: `Preset ${index}`,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, presets: manyPresets.slice(0, 60), total: manyPresets.length, limit: 60, offset: 0, next_offset: 60 })),
      ),
    );

    render(
      <StudioPresetBrowser
        presets={manyPresets}
        models={models}
        returnToHref="/studio"
        onClose={vi.fn()}
        onSelectPreset={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId(/studio-preset-browser-card-/)).toHaveLength(60);
  });

  it("loads exact preset detail before selecting a summary row", async () => {
    const summaryPreset = {
      preset_id: "preset-1",
      key: "car-magazine",
      label: "Car Magazine",
      description: "Preset for car imagery",
      status: "active",
      model_key: "gpt-image-1",
      source_kind: "custom",
      base_builtin_key: null,
      applies_to_models: ["gpt-image-1"],
      applies_to_task_modes: [],
      applies_to_input_patterns: [],
      input_schema_count: 1,
      input_slots_count: 0,
      thumbnail_path: null,
      thumbnail_url: null,
    };
    const fullPreset = {
      ...presets[0],
      prompt_template: "Create {{car_name}} with full detail.",
      default_options_json: { size: "1024x1024" },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/control/media-presets/preset-1")) {
        return new Response(JSON.stringify({ ok: true, preset: fullPreset }));
      }
      return new Response(JSON.stringify({ ok: true, presets: [summaryPreset], total: 1, limit: 60, offset: 0, next_offset: null }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSelectPreset = vi.fn();

    render(
      <StudioPresetBrowser
        presets={presets}
        models={models}
        returnToHref="/studio"
        onClose={vi.fn()}
        onSelectPreset={onSelectPreset}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/control/media-presets?limit=60&offset=0&status=active&view=summary");
    });

    fireEvent.click(await screen.findByTestId("studio-preset-browser-item-preset-1"));

    await waitFor(() => expect(onSelectPreset).toHaveBeenCalledWith(fullPreset));
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media-presets/preset-1", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  });

  it("does not keep offering load-more after the remote catalog reaches total", async () => {
    const manyPresets = Array.from({ length: 83 }, (_, index) => ({
      ...presets[0],
      preset_id: `preset-${index}`,
      key: `preset-${index}`,
      label: `Preset ${index}`,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, presets: manyPresets, total: 83, limit: 60, offset: 0, next_offset: null })),
      ),
    );

    render(
      <StudioPresetBrowser
        presets={manyPresets}
        models={models}
        returnToHref="/studio"
        onClose={vi.fn()}
        onSelectPreset={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId(/studio-preset-browser-card-/)).toHaveLength(83);
    });
    expect(screen.getByText("Showing 83 of 83")).toBeTruthy();
    expect(screen.queryByText("Load more presets")).toBeNull();
  });

  it("falls back to the local initial page when the remote preset summary fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: "Summary route unavailable." }), { status: 500 }),
      ),
    );

    render(
      <StudioPresetBrowser
        presets={presets}
        models={models}
        returnToHref="/studio"
        onClose={vi.fn()}
        onSelectPreset={vi.fn()}
      />,
    );

    await screen.findByTestId("studio-preset-browser-card-preset-1");
    expect(screen.getByText(/Summary route unavailable\./)).toBeTruthy();
    expect(screen.getByText(/Showing the first matching local presets instead\./)).toBeTruthy();
    expect(screen.queryByText("Load more presets")).toBeNull();
  });

  it("loads additional preset summary pages through the hidden scroll sentinel", async () => {
    const manyPresets = Array.from({ length: 75 }, (_, index) => ({
      ...presets[0],
      preset_id: `preset-${index}`,
      key: `preset-${index}`,
      label: `Preset ${index}`,
    }));
    let intersectionCallback: IntersectionObserverCallback | null = null;
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe = vi.fn();
      disconnect = vi.fn();
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const offset = url.includes("offset=60") ? 60 : 0;
      return new Response(JSON.stringify({
        ok: true,
        presets: manyPresets.slice(offset, offset + 60),
        total: manyPresets.length,
        limit: 60,
        offset,
        next_offset: offset === 0 ? 60 : null,
      }));
    });
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StudioPresetBrowser
        presets={manyPresets}
        models={models}
        returnToHref="/studio"
        onClose={vi.fn()}
        onSelectPreset={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId(/studio-preset-browser-card-/)).toHaveLength(60);
      expect(intersectionCallback).not.toBeNull();
    });

    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    await waitFor(() => {
      expect(screen.getAllByTestId(/studio-preset-browser-card-/)).toHaveLength(75);
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media-presets?limit=60&offset=60&status=active&view=summary");
    expect(screen.getByText("Showing 75 of 75")).toBeTruthy();
    expect(screen.queryByText("Load more presets")).toBeNull();
  });
});
