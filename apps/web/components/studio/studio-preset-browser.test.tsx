// @vitest-environment jsdom

import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              presets,
              total: presets.length,
              limit: 60,
              offset: 0,
              next_offset: null,
            }),
          ),
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
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              presets: manyPresets.slice(0, 60),
              total: manyPresets.length,
              limit: 60,
              offset: 0,
              next_offset: 60,
            }),
          ),
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

    expect(screen.getAllByTestId(/studio-preset-browser-card-/)).toHaveLength(
      60,
    );
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
      return new Response(
        JSON.stringify({
          ok: true,
          presets: [summaryPreset],
          total: 1,
          limit: 60,
          offset: 0,
          next_offset: null,
        }),
      );
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
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/control/media-presets?limit=60&offset=0&status=active&view=summary",
      );
    });

    fireEvent.click(
      await screen.findByTestId("studio-preset-browser-item-preset-1"),
    );

    await waitFor(() =>
      expect(onSelectPreset).toHaveBeenCalledWith(fullPreset),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/media-presets/preset-1",
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );
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
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: true,
              presets: manyPresets,
              total: 83,
              limit: 60,
              offset: 0,
              next_offset: null,
            }),
          ),
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
      expect(screen.getAllByTestId(/studio-preset-browser-card-/)).toHaveLength(
        83,
      );
    });
    expect(screen.getByText("Showing 83 of 83")).toBeTruthy();
    expect(screen.queryByText("Load more presets")).toBeNull();
  });

  it("falls back to the local initial page when the remote preset summary fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: false, error: "Summary route unavailable." }),
            { status: 500 },
          ),
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
    expect(
      screen.getByText(/Showing the first matching local presets instead\./),
    ).toBeTruthy();
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
      return new Response(
        JSON.stringify({
          ok: true,
          presets: manyPresets.slice(offset, offset + 60),
          total: manyPresets.length,
          limit: 60,
          offset,
          next_offset: offset === 0 ? 60 : null,
        }),
      );
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
      expect(screen.getAllByTestId(/studio-preset-browser-card-/)).toHaveLength(
        60,
      );
      expect(intersectionCallback).not.toBeNull();
    });

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => {
      expect(screen.getAllByTestId(/studio-preset-browser-card-/)).toHaveLength(
        75,
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/media-presets?limit=60&offset=60&status=active&view=summary",
    );
    expect(screen.getByText("Showing 75 of 75")).toBeTruthy();
    expect(screen.queryByText("Load more presets")).toBeNull();
  });
});

describe("Studio preset request ownership", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const renderBrowser = () =>
    render(
      <StrictMode>
        <StudioPresetBrowser
          presets={presets}
          models={models}
          onClose={vi.fn()}
          onSelectPreset={vi.fn()}
        />
      </StrictMode>,
    );

  it("shares the initial summary read through Strict Mode effect replay", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, presets, total: 1, next_offset: null }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderBrowser();
    await screen.findByText("Showing 1 of 1");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("treats successful empty remote results as authoritative and retries failed reads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: "Read failed" }), {
          status: 500,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            presets: [],
            total: 0,
            next_offset: null,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderBrowser();
    fireEvent.click(
      await screen.findByRole("button", { name: "Retry loading presets" }),
    );
    await screen.findByText("Showing 0 of 0");
    expect(
      screen.queryByTestId("studio-preset-browser-card-preset-1"),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("discards an old initial query response", async () => {
    let resolveOld!: (response: Response) => void;
    const old = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const fetchMock = vi.fn((url: string) =>
      url.includes("q=old")
        ? old
        : Promise.resolve(
            new Response(
              JSON.stringify({
                ok: true,
                presets: [],
                total: 0,
                next_offset: null,
              }),
            ),
          ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderBrowser();
    await screen.findByText("Showing 0 of 0");
    fireEvent.change(screen.getByLabelText("Search presets"), {
      target: { value: "old" },
    });
    fireEvent.change(screen.getByLabelText("Search presets"), {
      target: { value: "latest" },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/control/media-presets?limit=60&offset=0&status=active&view=summary&q=latest",
      ),
    );
    await act(async () =>
      resolveOld(
        new Response(
          JSON.stringify({ ok: true, presets, total: 1, next_offset: null }),
        ),
      ),
    );
    expect(
      screen.queryByTestId("studio-preset-browser-card-preset-1"),
    ).toBeNull();
  });
});

it("preserves summary/category/page scope and rejects an old load-more completion", async () => {
  let resolveMore!: (response: Response) => void;
  const more = new Promise<Response>((resolve) => {
    resolveMore = resolve;
  });
  let intersect!: IntersectionObserverCallback;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  const fetchMock = vi.fn((url: string) => {
    if (url.includes("offset=60")) return more;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          presets: url.includes("category=portrait") ? [] : presets,
          total: 2,
          next_offset: url.includes("category=portrait") ? null : 60,
        }),
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <StudioPresetBrowser
      presets={presets}
      models={models}
      onClose={vi.fn()}
      onSelectPreset={vi.fn()}
    />,
  );
  await screen.findByText("Showing 1 of 2");
  act(() =>
    intersect(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  act(() =>
    intersect(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "All categories" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Portraits", exact: true }),
  );
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/media-presets?limit=60&offset=0&status=active&view=summary&category=portrait",
    ),
  );
  await act(async () =>
    resolveMore(
      new Response(
        JSON.stringify({ ok: true, presets, total: 2, next_offset: null }),
      ),
    ),
  );
  expect(
    screen.queryByTestId("studio-preset-browser-card-preset-1"),
  ).toBeNull();
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).includes("offset=60")),
  ).toHaveLength(1);
  cleanup();
  vi.unstubAllGlobals();
});

it("uses the same category query from the visible shortcut and keeps detail selection separate", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ ok: true, presets: [], total: 0, next_offset: null }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const onSelectPreset = vi.fn();
  render(
    <StudioPresetBrowser
      presets={presets}
      models={models}
      onClose={vi.fn()}
      onSelectPreset={onSelectPreset}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Filter presets: Portraits" }),
  );
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/media-presets?limit=60&offset=0&status=active&view=summary&category=portrait",
    ),
  );
  expect(
    screen.getByRole("button", {
      name: "Filter presets: Portraits",
      pressed: true,
    }),
  ).toBeTruthy();
  expect(onSelectPreset).not.toHaveBeenCalled();
  cleanup();
  vi.unstubAllGlobals();
});
