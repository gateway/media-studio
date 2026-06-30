// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
