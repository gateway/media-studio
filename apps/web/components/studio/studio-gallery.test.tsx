// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StudioGallery } from "@/components/studio/studio-gallery";
import { StudioGalleryTile } from "@/components/studio/studio-gallery-tile";
import type { GalleryTile } from "@/lib/studio-gallery";

afterEach(cleanup);

describe("StudioGallery", () => {
  it("offers a manual first-page retry even when no gallery cards could load", () => {
    const onLoadMore = vi.fn();
    render(
      <StudioGallery
        apiHealthy
        immersive
        galleryTiles={[]}
        activeGalleryHasMore={false}
        activeGalleryLoadingMore={false}
        firstGalleryPageFailed
        selectedAssetId={null}
        favoriteAssetIdBusy={null}
        galleryLoadMoreRef={{ current: null }}
        onLoadMore={onLoadMore}
        onSelectAsset={() => undefined}
        onSelectFailedJob={() => undefined}
        onDragAsset={() => undefined}
        onToggleFavorite={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading gallery" }),
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("No media yet")).toBeNull();
  });

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
    expect(
      screen.getByText(
        "This page is up, but the media backend is still coming online. Once it is ready, your recent renders and tools will appear here.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No media yet")).toBeNull();
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

    expect(
      screen.getByText(
        "Render failed. Open this tile to review the issue and retry in Studio.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText("Internal Error, Please try again later."),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /View details for failed/ }),
    );
    expect(onSelectFailedJob).toHaveBeenCalledWith("job-1");
  });

  it("preserves the active-queue-first tile order supplied by the gallery feed", () => {
    const tiles: GalleryTile[] = [
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

    expect(onToggleFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ asset_id: "asset-1" }),
    );
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

    expect(
      container.querySelectorAll('[data-testid="studio-gallery-card"]'),
    ).toHaveLength(8);
    expect(
      container.querySelectorAll('[data-testid="studio-gallery-card"] img'),
    ).toHaveLength(8);
    expect(
      container.querySelectorAll(
        '[data-testid="studio-gallery-card"] img[loading="eager"]',
      ),
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(
        '[data-testid="studio-gallery-card"] img[loading="lazy"]',
      ),
    ).toHaveLength(4);
  });
});

it("keeps inspect, favorite and drag actions independent on a selected gallery asset", () => {
  const asset = {
    asset_id: "selected",
    generation_kind: "image",
    prompt_summary: "Saved image",
    favorited: true,
  } as NonNullable<GalleryTile["asset"]>;
  const onSelectAsset = vi.fn();
  const onToggleFavorite = vi.fn();
  const onDragAsset = vi.fn();
  render(
    <StudioGalleryTile
      tile={{ asset, label: "Saved image", batch: null, job: null }}
      index={0}
      selectedAssetId="selected"
      favoriteAssetIdBusy="selected"
      onSelectAsset={onSelectAsset}
      onSelectFailedJob={vi.fn()}
      onDragAsset={onDragAsset}
      onToggleFavorite={onToggleFavorite}
    />,
  );
  const inspect = screen.getByRole("button", {
    name: "Inspect image: Saved image",
  });
  inspect.focus();
  expect(document.activeElement).toBe(inspect);
  expect(inspect.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(inspect);
  expect(onSelectAsset).toHaveBeenCalledExactlyOnceWith("selected");
  const favorite = screen.getByRole("button", {
    name: "Unfavorite media asset",
  });
  expect(favorite.getAttribute("disabled")).toBe("");
  fireEvent.click(favorite);
  expect(onToggleFavorite).not.toHaveBeenCalled();
  fireEvent.dragStart(screen.getByTestId("studio-gallery-card"));
  expect(onDragAsset).toHaveBeenCalledExactlyOnceWith(expect.anything(), asset);
});

it.each(["queued", "running", "submitted", "processing"])(
  "shows the actual %s job state without an inspect action",
  (status) => {
    render(
      <StudioGalleryTile
        tile={{
          asset: null,
          label: "Pending",
          batch: { batch_id: "pending", status } as GalleryTile["batch"],
          job: { job_id: "pending-job", status } as GalleryTile["job"],
        }}
        index={0}
        selectedAssetId={null}
        favoriteAssetIdBusy={null}
        onSelectAsset={vi.fn()}
        onSelectFailedJob={vi.fn()}
        onDragAsset={vi.fn()}
        onToggleFavorite={vi.fn()}
      />,
    );
    expect(
      screen.getByText(status === "queued" ? "Queued" : "Running"),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  },
);
