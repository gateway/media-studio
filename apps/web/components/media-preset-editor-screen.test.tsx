// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaPresetEditorScreen } from "@/components/media-preset-editor-screen";
import type { MediaModelSummary, MediaPreset } from "@/lib/types";

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, ...rest } = props;
    return <img alt="" {...rest} />;
  },
}));

vi.mock("@/lib/graph-node-definitions-sync", () => ({
  invalidateGraphNodeDefinitions: vi.fn().mockResolvedValue({
    changedAt: "2026-05-18T00:00:00.000Z",
    reason: "media-preset-updated",
  }),
}));

const models: MediaModelSummary[] = [
  {
    key: "nano-banana-2",
    label: "Nano Banana 2",
    provider_model: "nano-banana-2",
    task_modes: ["text_to_image"],
    image_inputs: { required_min: 0, required_max: 0 },
    input_patterns: ["prompt_only"],
    generation_kind: "image",
  },
];

const presets: MediaPreset[] = [
  {
    preset_id: "preset-1",
    key: "test_preset",
    label: "Test Preset",
    description: "A test preset",
    status: "active",
    model_key: "nano-banana-2",
    source_kind: "custom",
    base_builtin_key: null,
    applies_to_models: ["nano-banana-2"],
    applies_to_task_modes: [],
    applies_to_input_patterns: [],
    prompt_template: "Create {{subject}}",
    input_schema_json: [{ key: "subject", label: "Subject", required: true }],
    input_slots_json: [],
    choice_groups_json: [],
    thumbnail_path: null,
    thumbnail_url: null,
    notes: null,
  },
];

describe("MediaPresetEditorScreen", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the shared thumbnail field for upload, generated image selection, and removal", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/control/media-preset-thumbnail") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            thumbnail_path: "preset-thumbnails/uploaded.webp",
            thumbnail_url: "/api/preset-thumbnails/uploaded.webp",
          }),
        };
      }
      if (url.includes("/api/control/media-assets?")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            assets: [
              {
                asset_id: "asset-1",
                generation_kind: "image",
                created_at: "2026-05-17T02:10:00Z",
                model_key: "nano-banana-pro",
                prompt_summary: "Generated preset thumbnail",
                hero_thumb_url: "/api/control/files/outputs/thumb.webp",
                hero_web_url: "/api/control/files/outputs/web.webp",
              },
            ],
            next_offset: null,
          }),
        };
      }
      if (url === "/api/control/media-preset-thumbnail/from-asset") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            thumbnail_path: "preset-thumbnails/generated.webp",
            thumbnail_url: "/api/preset-thumbnails/generated.webp",
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MediaPresetEditorScreen models={models} presets={presets} initialPresetId="preset-1" />);

    expect(screen.getByRole("button", { name: /upload thumbnail/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /browse generated images/i })).toBeTruthy();
    expect(screen.queryByText(/drag in a thumbnail image/i)).toBeNull();

    const chooseThumbnailButton = screen.getByRole("button", { name: /choose from generated images/i });
    fireEvent.drop(chooseThumbnailButton, {
      dataTransfer: {
        files: [new File(["thumbnail"], "thumbnail.webp", { type: "image/webp" })],
      },
    });

    expect(await screen.findByText("Thumbnail uploaded.")).toBeTruthy();

    fireEvent.click(chooseThumbnailButton);

    expect(await screen.findByRole("dialog", { name: /generated image thumbnails/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /use generated image asset-1 as preset thumbnail/i }));

    expect(await screen.findByText("Thumbnail selected from generated images.")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/control/media-preset-thumbnail/from-asset",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });
});
