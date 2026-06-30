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

  it("keeps active queue tiles before completed assets", () => {
    const tiles: GalleryTile[] = [
      {
        asset: {
          asset_id: "asset-1",
          generation_kind: "image",
          model_key: "nano-banana-2",
          prompt_summary: "Finished image",
        } as never,
        label: "Finished image",
        batch: null,
        job: null,
      },
      {
        asset: null,
        label: "Queued output",
        batch: {
          batch_id: "batch-1",
          model_key: "gpt-image-2-image-to-image",
          status: "queued",
          created_at: "2026-05-19T00:00:01Z",
        } as never,
        job: {
          job_id: "job-1",
          status: "queued",
          model_key: "gpt-image-2-image-to-image",
          created_at: "2026-05-19T00:00:01Z",
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
        onSelectFailedJob={() => undefined}
        onDragAsset={() => undefined}
        onToggleFavorite={() => undefined}
      />,
    );

    const cards = screen.getAllByTestId(/studio-gallery-(batch-)?card/);
    expect(cards[0]?.getAttribute("data-job-id")).toBe("job-1");
    expect(cards[1]?.getAttribute("data-asset-id")).toBe("asset-1");
  });

  it("favorites an asset without selecting the gallery card", () => {
    const onSelectAsset = vi.fn();
    const onToggleFavorite = vi.fn();
    const tiles: GalleryTile[] = [
      {
        asset: {
          asset_id: "asset-1",
          generation_kind: "image",
          model_key: "nano-banana-2",
          prompt_summary: "Finished image",
          favorited: false,
        } as never,
        label: "Finished image",
        batch: null,
        job: null,
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
        onSelectAsset={onSelectAsset}
        onSelectFailedJob={() => undefined}
        onDragAsset={() => undefined}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    const favoriteButtons = screen.getAllByTestId("studio-favorite-toggle");
    fireEvent.click(favoriteButtons[favoriteButtons.length - 1] as HTMLElement);

    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ asset_id: "asset-1" }));
    expect(onSelectAsset).not.toHaveBeenCalled();
  });

  it("renders current-page gallery image tags and lets the browser lazy-load offscreen media", () => {
    const tiles: GalleryTile[] = Array.from({ length: 8 }, (_, index) => ({
      asset: {
        asset_id: `asset-${index}`,
        generation_kind: "image",
        model_key: "nano-banana-2",
        prompt_summary: `Finished image ${index}`,
        hero_thumb_path: `outputs/thumb-${index}.jpg`,
      } as never,
      label: `Finished image ${index}`,
      batch: null,
      job: null,
    }));

    const { container } = render(
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
        onSelectFailedJob={() => undefined}
        onDragAsset={() => undefined}
        onToggleFavorite={() => undefined}
      />,
    );

    expect(container.querySelectorAll('[data-testid="studio-gallery-card"]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-testid="studio-gallery-card"] img')).toHaveLength(8);
    expect(container.querySelectorAll('[data-testid="studio-gallery-card"] img[loading="eager"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid="studio-gallery-card"] img[loading="lazy"]')).toHaveLength(4);
  });
});
