import { describe, expect, it } from "vitest";

import {
  buildGalleryTiles,
  createOptimisticBatch,
  findMediaAssetById,
  mediaAssetPrompt,
  presetRequirementMessage,
  structuredPresetInputValues,
  structuredPresetInputValuesFromAsset,
  structuredPresetSlotValues,
  upsertBatchCollection,
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

  it("falls back to normalized request metadata for structured preset slot values", () => {
    expect(
      structuredPresetSlotValues({
        normalized_request: {
          metadata: {
            preset_image_slots: {
              person: [{ path: "/tmp/source.png", filename: "source.png", mime_type: "image/png" }],
            },
          },
        },
      } as never),
    ).toEqual({
      person: [{ path: "/tmp/source.png", filename: "source.png", mime_type: "image/png" }],
    });
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

  it("keeps an existing batch in place when a poll refresh updates it", () => {
    const olderBatch = {
      batch_id: "batch-older",
      status: "processing",
      created_at: "2026-04-11T01:00:00Z",
      updated_at: "2026-04-11T01:00:00Z",
    } as never;
    const newerBatch = {
      batch_id: "batch-newer",
      status: "processing",
      created_at: "2026-04-11T01:05:00Z",
      updated_at: "2026-04-11T01:05:00Z",
    } as never;

    const refreshed = upsertBatchCollection([newerBatch, olderBatch], {
      ...olderBatch,
      updated_at: "2026-04-11T01:06:00Z",
      running_count: 2,
    } as never);

    expect(refreshed.map((batch) => batch.batch_id)).toEqual(["batch-newer", "batch-older"]);
    expect(refreshed[1]?.running_count).toBe(2);
  });

  it("returns no placeholder tiles when there are no assets or batches", () => {
    const tiles = buildGalleryTiles([], null, [], [], [], false, false);
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
      [],
      false,
      false,
    );

    expect(tiles.filter((tile) => tile.asset?.asset_id === "asset-1")).toHaveLength(1);
  });

  it("prefers a published asset tile over a lingering batch spinner for the same job", () => {
    const publishedAsset = {
      asset_id: "asset-published-1",
      job_id: "job-published-1",
      model_key: "nano-banana-2",
      created_at: "2026-04-03T00:00:00Z",
    } as never;

    const tiles = buildGalleryTiles(
      [publishedAsset],
      null,
      [
        {
          batch_id: "batch-published-1",
          status: "processing",
          requested_outputs: 2,
          queued_count: 0,
          running_count: 1,
          completed_count: 1,
          failed_count: 0,
          cancelled_count: 0,
          created_at: "2026-04-03T00:00:00Z",
          updated_at: "2026-04-03T00:00:00Z",
          jobs: [
            { job_id: "job-published-1", status: "running", final_status: { state: "succeeded" } },
            { job_id: "job-published-2", status: "running" },
          ],
        } as never,
      ],
      [publishedAsset],
      [],
      false,
      false,
    );

    expect(tiles.some((tile) => tile.batch?.batch_id === "batch-published-1" && tile.job?.job_id === "job-published-1")).toBe(false);
    expect(tiles.some((tile) => tile.asset?.asset_id === "asset-published-1" && tile.batch == null)).toBe(true);
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
      [],
      false,
      false,
    );

    expect(tiles[0]?.job?.job_id).toBe("job-3");
    expect(tiles[0]?.label).toBe("Failed output");
  });

  it("orders failed cards by creation time instead of pinning them before newer assets", () => {
    const newerAsset = {
      asset_id: "asset-newer",
      job_id: "job-newer",
      model_key: "gpt-image-2-text-to-image",
      created_at: "2026-04-06T00:10:00Z",
    } as never;

    const tiles = buildGalleryTiles(
      [newerAsset],
      null,
      [
        {
          batch_id: "batch-failed-old",
          status: "failed",
          model_key: "gpt-image-2-text-to-image",
          requested_outputs: 1,
          queued_count: 0,
          running_count: 0,
          completed_count: 0,
          failed_count: 1,
          cancelled_count: 0,
          created_at: "2026-04-06T00:00:00Z",
          updated_at: "2026-04-06T00:05:00Z",
          jobs: [
            {
              job_id: "job-failed-old",
              batch_id: "batch-failed-old",
              model_key: "gpt-image-2-text-to-image",
              status: "failed",
              error: "Provider policy rejected the generation.",
              created_at: "2026-04-06T00:00:00Z",
            },
          ],
        } as never,
      ],
      [newerAsset],
      [],
      false,
      false,
    );

    expect(tiles.map((tile) => tile.asset?.asset_id ?? tile.job?.job_id)).toEqual(["asset-newer", "job-failed-old"]);
  });

  it("keeps a failed sibling tile visible after refresh when batch jobs are only present in the jobs feed", () => {
    const publishedAsset = {
      asset_id: "asset-batch-1",
      job_id: "job-batch-completed",
      model_key: "nano-banana-2",
      created_at: "2026-04-06T00:00:00Z",
    } as never;

    const tiles = buildGalleryTiles(
      [publishedAsset],
      null,
      [
        {
          batch_id: "batch-partial-1",
          status: "partial_failure",
          model_key: "nano-banana-2",
          requested_outputs: 2,
          queued_count: 0,
          running_count: 0,
          completed_count: 1,
          failed_count: 1,
          cancelled_count: 0,
          created_at: "2026-04-06T00:00:00Z",
          updated_at: "2026-04-06T00:00:00Z",
          jobs: [],
        } as never,
      ],
      [publishedAsset],
      [
        {
          job_id: "job-batch-failed",
          batch_id: "batch-partial-1",
          model_key: "nano-banana-2",
          status: "failed",
          error: "Provider policy rejected the generation.",
          created_at: "2026-04-06T00:00:01Z",
        },
        {
          job_id: "job-batch-completed",
          batch_id: "batch-partial-1",
          model_key: "nano-banana-2",
          status: "completed",
          created_at: "2026-04-06T00:00:00Z",
        },
      ] as never,
      false,
      false,
    );

    expect(tiles.some((tile) => tile.job?.job_id === "job-batch-failed" && tile.label === "Failed output")).toBe(true);
    expect(tiles.some((tile) => tile.asset?.asset_id === "asset-batch-1" && tile.batch == null)).toBe(true);
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
      [],
      false,
      false,
      { generationKind: "video" },
    );

    expect(tiles).toHaveLength(0);
  });

  it("does not show queued jobs in the favorites filter", () => {
    const tiles = buildGalleryTiles(
      [],
      null,
      [
        {
          batch_id: "batch-favorite-leak",
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
              job_id: "job-favorite-leak",
              model_key: "nano-banana-2",
              status: "running",
            },
          ],
        } as never,
      ],
      [],
      [],
      false,
      false,
      { favoritesOnly: true },
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

  it("reads preset text values from normalized request metadata", () => {
    expect(
      structuredPresetInputValues({
        normalized_request: {
          metadata: {
            preset_text_values: {
              direction: "Cluster the communication elements above the pilot.",
              position: "Standing",
            },
          },
        },
      } as never),
    ).toEqual({
      direction: "Cluster the communication elements above the pilot.",
      position: "Standing",
    });
  });

  it("reads preset text values from asset payload fallback", () => {
    expect(
      structuredPresetInputValuesFromAsset({
        payload: {
          preset_text_values: {
            direction: "Use a fragmented workflow cluster.",
          },
        },
      } as never),
    ).toEqual({
      direction: "Use a fragmented workflow cluster.",
    });
  });
});
