import { describe, expect, it } from "vitest";

import {
  buildGalleryTiles,
  createOptimisticBatch,
  findMediaAssetById,
  mediaAssetPrompt,
  presetRequirementMessage,
} from "@/lib/studio-gallery";

describe("studio-gallery", () => {
  it("finds assets across multiple collections", () => {
    const asset = { asset_id: "2", prompt_summary: "Hero image" } as never;
    expect(findMediaAssetById("2", [], [asset])).toBe(asset);
    expect(findMediaAssetById("missing", [asset])).toBeNull();
  });

  it("prefers job prompt detail over asset prompt summary", () => {
    expect(
      mediaAssetPrompt(
        { prompt_summary: "Asset summary" } as never,
        { final_prompt_used: "Final prompt", enhanced_prompt: "Enhanced", raw_prompt: "Raw" } as never,
      ),
    ).toBe("Final prompt");
  });

  it("builds optimistic batches with running and queued jobs", () => {
    const batch = createOptimisticBatch({
      modelKey: "nano-banana-2",
      taskMode: "text_to_image",
      requestedOutputs: 3,
      sourceAssetId: null,
      requestedPresetKey: "preset-a",
      promptSummary: "Studio portrait",
      runningSlotsAvailable: 1,
    });

    expect(batch.running_count).toBe(1);
    expect(batch.queued_count).toBe(2);
    expect(batch.jobs).toHaveLength(3);
    expect(batch.jobs?.[0]?.status).toBe("processing");
    expect(batch.jobs?.[1]?.status).toBe("queued");
  });

  it("returns no placeholder tiles when there are no assets or batches", () => {
    const tiles = buildGalleryTiles([], null, [], [], false, false);
    expect(tiles).toHaveLength(0);
  });

  it("does not duplicate an asset that is already being shown as a pending batch preview", () => {
    const sharedAsset = {
      asset_id: "asset-1",
      job_id: "job-1",
      created_at: "2026-04-03T00:00:00Z",
    } as never;

    const tiles = buildGalleryTiles(
      [sharedAsset],
      null,
      [
        {
          batch_id: "batch-1",
          status: "processing",
          requested_outputs: 1,
          queued_count: 0,
          running_count: 1,
          completed_count: 0,
          failed_count: 0,
          cancelled_count: 0,
          created_at: "2026-04-03T00:00:00Z",
          updated_at: "2026-04-03T00:00:00Z",
          jobs: [{ job_id: "job-1", status: "running" }],
        } as never,
      ],
      [sharedAsset],
      false,
      false,
    );

    expect(tiles.filter((tile) => tile.asset?.asset_id === "asset-1")).toHaveLength(1);
  });

  it("keeps a publishing tile visible after a batch completes until the asset is available", () => {
    const tiles = buildGalleryTiles(
      [],
      null,
      [
        {
          batch_id: "batch-1",
          status: "completed",
          requested_outputs: 1,
          queued_count: 0,
          running_count: 0,
          completed_count: 1,
          failed_count: 0,
          cancelled_count: 0,
          created_at: "2026-04-04T00:00:00Z",
          updated_at: "2026-04-04T00:00:00Z",
          jobs: [
            {
              job_id: "job-2",
              status: "completed",
              final_status: { state: "succeeded" },
            },
          ],
        } as never,
      ],
      [],
      false,
      false,
    );

    expect(tiles[0]?.job?.job_id).toBe("job-2");
    expect(tiles[0]?.label).toBe("Publishing output");
  });

  it("keeps a failed tile visible when the provider returns an error and no asset is published", () => {
    const tiles = buildGalleryTiles(
      [],
      null,
      [
        {
          batch_id: "batch-2",
          status: "failed",
          requested_outputs: 1,
          queued_count: 0,
          running_count: 0,
          completed_count: 0,
          failed_count: 1,
          cancelled_count: 0,
          created_at: "2026-04-06T00:00:00Z",
          updated_at: "2026-04-06T00:00:00Z",
          jobs: [
            {
              job_id: "job-3",
              status: "failed",
              error: "Provider policy rejected the generation.",
              final_status: { state: "failed" },
            },
          ],
        } as never,
      ],
      [],
      false,
      false,
    );

    expect(tiles[0]?.job?.job_id).toBe("job-3");
    expect(tiles[0]?.label).toBe("Failed output");
  });

  it("does not show queued image jobs in the videos filter", () => {
    const tiles = buildGalleryTiles(
      [],
      null,
      [
        {
          batch_id: "batch-image-1",
          model_key: "nano-banana-2",
          status: "processing",
          requested_outputs: 1,
          queued_count: 0,
          running_count: 1,
          completed_count: 0,
          failed_count: 0,
          cancelled_count: 0,
          created_at: "2026-04-06T00:00:00Z",
          updated_at: "2026-04-06T00:00:00Z",
          jobs: [
            {
              job_id: "job-image-1",
              model_key: "nano-banana-2",
              status: "running",
            },
          ],
        } as never,
      ],
      [],
      false,
      false,
      { generationKind: "video" },
    );

    expect(tiles).toHaveLength(0);
  });

  it("does not pad real assets with placeholder tiles once gallery content exists", () => {
    const tiles = buildGalleryTiles(
      [
        {
          asset_id: "asset-2",
          job_id: "job-2",
          model_key: "nano-banana-2",
          created_at: "2026-04-06T00:00:00Z",
        } as never,
      ],
      null,
      [],
      [],
      false,
      false,
    );

    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.asset?.asset_id).toBe("asset-2");
  });

  it("reports missing preset attachments by media kind", () => {
    expect(
      presetRequirementMessage(
        { label: "Preset", requires_image: true, requires_video: false, requires_audio: false } as never,
        [],
        null,
      ),
    ).toContain("requires at least one image");
  });
});
