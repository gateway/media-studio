// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioInspectorInfo } from "@/components/studio/studio-inspector-info";
import type { MediaAsset } from "@/lib/types";

const longToken = "ultra-long-generated-preset-name-without-natural-breaks-abcdefghijklmnopqrstuvwxyz-0123456789";

function renderInspectorInfo(options: { onUsePreset?: (presetIdOrKey: string) => void } = {}) {
  const selectedAsset = {
    asset_id: "asset-1",
    created_at: "2026-06-08T12:00:00Z",
    generation_kind: "image",
    model_key: `model-${longToken}`,
    preset_key: `preset-${longToken}`,
    project_id: `project-${longToken}`,
    status: "completed",
    payload: {
      resolved_options: {
        headline_phrase: `headline-${longToken}`,
      },
    },
  } as MediaAsset;

  render(
    <StudioInspectorInfo
      selectedAsset={selectedAsset}
      favoriteAssetIdBusy={null}
      onToggleFavorite={vi.fn()}
      projectLabel={`project-label-${longToken}`}
      onOpenProject={vi.fn()}
      presetLabel={`preset-label-${longToken}`}
      presetLoadKey={`preset-id-${longToken}`}
      onUsePreset={options.onUsePreset ?? vi.fn()}
      referencePreviews={[
        {
          key: "ref-1",
          label: `reference-${longToken}`,
          url: "/reference.png",
          kind: "images",
          posterUrl: null,
        },
      ]}
      onOpenReference={vi.fn()}
    />,
  );
}

describe("StudioInspectorInfo", () => {
  afterEach(() => {
    cleanup();
  });

  it("allows long inspector values to wrap inside the information pane", () => {
    renderInspectorInfo();

    expect(screen.getByText(`model-${longToken}`).className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByText(`preset-label-${longToken}`).className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByText(`project-label-${longToken}`).className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByText(`headline-${longToken}`).className).toContain("[overflow-wrap:anywhere]");
    expect(screen.getByText(`reference-${longToken}`).className).toContain("[overflow-wrap:anywhere]");
  });

  it("loads the selected asset preset from the information pane", () => {
    const onUsePreset = vi.fn();
    renderInspectorInfo({ onUsePreset });

    screen.getByTitle("Load this preset into the Studio composer").click();

    expect(onUsePreset).toHaveBeenCalledWith(`preset-id-${longToken}`);
  });
});
