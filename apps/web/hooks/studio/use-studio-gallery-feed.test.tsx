// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useStudioGalleryFeed } from "@/hooks/studio/use-studio-gallery-feed";
import type { MediaAsset } from "@/lib/types";

const globalAsset: MediaAsset = {
  asset_id: "global-asset",
  created_at: "2026-06-12T00:00:00Z",
  generation_kind: "image",
  model_key: "gpt-image-2",
};

const projectAsset: MediaAsset = {
  asset_id: "project-asset",
  project_id: "project-1",
  created_at: "2026-06-12T01:00:00Z",
  generation_kind: "image",
  model_key: "gpt-image-2",
};

const emptyBatches = [];
const emptyJobs = [];
const initialAssets = [globalAsset];
const handleMessage = vi.fn();

type FeedHarnessProps = {
  activeProjectId?: string | null;
  assets?: MediaAsset[];
};

function FeedHarness({ activeProjectId = null, assets = initialAssets }: FeedHarnessProps) {
  const gallery = useStudioGalleryFeed({
    batches: emptyBatches,
    jobs: emptyJobs,
    assets,
    activeProjectId,
    initialAssetLimit: 18,
    initialAssetsHasMore: false,
    initialAssetsNextOffset: null,
    latestAsset: null,
    onMessage: handleMessage,
  });

  return (
    <div>
      <div data-testid="asset-ids">{gallery.state.localAssets.map((asset) => asset.asset_id).join(",")}</div>
    </div>
  );
}

describe("useStudioGalleryFeed", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          assets: [projectAsset],
          has_more: false,
          next_offset: null,
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the page effects path for one scoped first-page fetch on project changes", async () => {
    const { rerender } = render(<FeedHarness />);

    expect(screen.getByTestId("asset-ids").textContent).toBe("global-asset");
    expect(fetch).not.toHaveBeenCalled();

    rerender(<FeedHarness activeProjectId="project-1" />);

    await waitFor(() => expect(screen.getByTestId("asset-ids").textContent).toBe("project-asset"));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/control/media-assets?limit=18&offset=0&view=summary&project_id=project-1",
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );
  });
});
