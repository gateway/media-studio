// @vitest-environment jsdom

import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaAsset, MediaPreset } from "@/lib/types";
import { useStudioSelection } from "@/hooks/studio/use-studio-selection";

function Harness({ asset }: { asset: MediaAsset }) {
  const selection = useStudioSelection({
    initialSelectedAssetId: String(asset.asset_id),
    localAssets: [asset],
    favoriteAssets: null,
    localJobs: [],
    presets: [{ key: "preset-1", label: "Preset 1" } as MediaPreset],
  });

  return (
    <div>
      <div data-testid="selected-asset-id">{String(selection.derived.selectedAsset?.asset_id ?? "")}</div>
      <div data-testid="preset-input-subject">{selection.derived.selectedAssetPresetInputValues.subject ?? ""}</div>
      <div data-testid="preset-slot-count">
        {Array.isArray(selection.derived.selectedAssetPresetSlotValues.reference)
          ? selection.derived.selectedAssetPresetSlotValues.reference.length
          : 0}
      </div>
      <div data-testid="payload-state">{selection.derived.selectedAsset?.payload ? "hydrated" : "summary"}</div>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useStudioSelection", () => {
  it("retains preset mode when inspecting a saved fixed-prompt preset", () => {
    const asset = { asset_id: "fixed-asset", preset_key: "fixed", payload: {} } as MediaAsset;
    const preset = { preset_id: "fixed-1", key: "fixed", label: "Fixed", applies_to_models: [],
      prompt_template: "A red teapot.", input_schema_json: [], input_slots_json: [] } as MediaPreset;
    const { result } = renderHook(() => useStudioSelection({ initialSelectedAssetId: "fixed-asset", localAssets: [asset], favoriteAssets: null, localJobs: [], presets: [preset] }));
    expect(result.current.derived.selectedAssetStructuredPresetActive).toBe(true);
    expect(result.current.derived.selectedAssetPresetFields).toEqual([]);
  });
  it("hydrates a selected asset's preset schema to retain inspector fields", async () => {
    const asset = { asset_id: "asset-older", preset_key: "older", payload: { preset_text_values: { unit: "Saved unit" } } } as MediaAsset;
    const preset = { preset_id: "preset-older", key: "older", label: "Older", applies_to_models: [] } as unknown as MediaPreset;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, preset: { ...preset, input_schema_json: [{ key: "unit", label: "Unit", default_value: "AX-17" }], input_slots_json: [] } })));
    const { result } = renderHook(() => useStudioSelection({ initialSelectedAssetId: "asset-older", localAssets: [asset], favoriteAssets: null, localJobs: [], presets: [preset] }));
    await waitFor(() => expect(result.current.derived.selectedAssetPresetFields[0]?.label).toBe("Unit"));
    expect(result.current.derived.selectedAssetPresetInputValues.unit).toBe("Saved unit");
  });
  it("hydrates selected summary assets before reading payload-derived preset values", async () => {
    const summaryAsset = {
      asset_id: "asset_1",
      created_at: "2026-06-09T00:00:00.000Z",
      generation_kind: "image",
      prompt_summary: "Summary asset",
      preset_key: "preset-1",
      hero_thumb_url: "/thumb.webp",
    } as MediaAsset;
    const hydratedAsset = {
      ...summaryAsset,
      payload: {
        preset_text_values: { subject: "Hydrated subject" },
        preset_slot_values: { reference: [{ asset_id: "source_1" }] },
      },
    } as MediaAsset;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, asset: hydratedAsset }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<Harness asset={summaryAsset} />);

    expect(screen.getByTestId("selected-asset-id").textContent).toBe("asset_1");
    expect(screen.getByTestId("payload-state").textContent).toBe("summary");

    await waitFor(() => expect(screen.getByTestId("preset-input-subject").textContent).toBe("Hydrated subject"));
    expect(screen.getByTestId("preset-slot-count").textContent).toBe("1");
    expect(screen.getByTestId("payload-state").textContent).toBe("hydrated");
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media-assets/asset_1", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  });
});
