// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StudioGallery } from "@/components/studio/studio-gallery";
import type { GalleryTile } from "@/lib/studio-gallery";

describe("StudioGallery", () => {
  it("shows a startup state instead of a misleading empty gallery when the media backend is not ready", () => {
    render(
      <StudioGallery
        apiHealthy={false}
        immersive
        galleryTiles={[]}
        activeGalleryHasMore={false}
        activeGalleryLoadingMore={false}
        selectedAssetId={null}
        favoriteAssetIdBusy={null}
        galleryLoadMoreRef={{ current: null }}
        onLoadMore={() => undefined}
        onSelectAsset={() => undefined}
        onSelectFailedJob={() => undefined}
        onDragAsset={() => undefined}
        onToggleFavorite={() => undefined}
      />,
    );

    expect(screen.getByText("Media Studio is connecting.")).toBeTruthy();
    expect(screen.getByText("This page is up, but the media backend is still coming online. Once it is ready, your recent renders and tools will appear here.")).toBeTruthy();
    expect(screen.queryByText("Start your first render.")).toBeNull();
  });

  it("shows a clean failed summary in the gallery and keeps provider error details out of the first viewport", () => {
    const onSelectFailedJob = vi.fn();
    const tiles: GalleryTile[] = [
      {
        asset: null,
        label: "Failed output",
        batch: {
          batch_id: "batch-1",
          model_key: "gpt-image-2-image-to-image",
          status: "failed",
          created_at: "2026-05-19T00:00:00Z",
          updated_at: "2026-05-19T00:00:00Z",
          requested_outputs: 1,
          queued_count: 0,
          running_count: 0,
          completed_count: 0,
          failed_count: 1,
          cancelled_count: 0,
        } as never,
        job: {
          job_id: "job-1",
          status: "failed",
          model_key: "gpt-image-2-image-to-image",
          error: "Internal Error, Please try again later.",
        } as never,
      },
    ];

    render(
      <StudioGallery
        apiHealthy
        immersive
        galleryTiles={tiles}
        activeGalleryHasMore={false}
        activeGalleryLoadingMore={false}
        selectedAssetId={null}
        favoriteAssetIdBusy={null}
        galleryLoadMoreRef={{ current: null }}
        onLoadMore={() => undefined}
        onSelectAsset={() => undefined}
        onSelectFailedJob={onSelectFailedJob}
        onDragAsset={() => undefined}
        onToggleFavorite={() => undefined}
      />,
    );

    expect(screen.getByText("Render failed. Open this tile to review the issue and retry in Studio.")).toBeTruthy();
    expect(screen.queryByText("Internal Error, Please try again later.")).toBeNull();

    fireEvent.click(screen.getByTestId("studio-gallery-batch-card"));
    expect(onSelectFailedJob).toHaveBeenCalledWith("job-1");
  });
});
