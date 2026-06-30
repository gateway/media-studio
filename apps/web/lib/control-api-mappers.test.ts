import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  mapAssetRecord,
  mapAssetSummaryRecord,
  mapBatchRecord,
  mapJobRecord,
  mapPricingResponseRecord,
  mapProjectRecord,
} from "@/lib/control-api";

describe("control-api domain mappers", () => {
  it("maps full media assets with payload, tags, and proxied media URLs", () => {
    const asset = mapAssetRecord({
      asset_id: "asset-1",
      project_id: "project-1",
      dismissed: true,
      created_at: "2026-06-12T00:00:00.000Z",
      tags_json: ["portrait", "reference"],
      payload_json: { outputs: [{ width: 1536, height: 1024 }] },
      hero_original_path: "runs/asset-1/original.png",
      hero_web_path: "runs/asset-1/web.webp",
      hero_thumb_path: "runs/asset-1/thumb.webp",
      hero_poster_path: "runs/asset-1/poster.webp",
    });

    expect(asset).toMatchObject({
      asset_id: "asset-1",
      project_id: "project-1",
      hidden_from_dashboard: false,
      dismissed_at: "2026-06-12T00:00:00.000Z",
      tags: ["portrait", "reference"],
      payload: { outputs: [{ width: 1536, height: 1024 }] },
      source_asset: null,
      hero_original_url: "/api/control/files/runs/asset-1/original.png",
      hero_web_url: "/api/control/files/runs/asset-1/web.webp",
      hero_thumb_url: "/api/control/files/runs/asset-1/thumb.webp",
      hero_poster_url: "/api/control/files/runs/asset-1/poster.webp",
    });
  });

  it("maps compact media asset summaries with dimensions and no heavy payload fields", () => {
    const asset = mapAssetSummaryRecord({
      asset_id: "asset-2",
      job_id: "job-2",
      project_id: "project-1",
      provider_task_id: "provider-task-2",
      run_id: "run-2",
      source_asset_id: "asset-source",
      generation_kind: "image",
      created_at: "2026-06-12T00:00:00.000Z",
      model_key: "gpt-image-2",
      status: "completed",
      task_mode: "text_to_image",
      prompt_summary: "Summary prompt",
      hero_thumb_path: "runs/asset-2/thumb.webp",
      width: "768",
      height: "1344",
      favorited: true,
      favorited_at: "2026-06-12T00:01:00.000Z",
      remote_output_url: "https://example.test/output.png",
      preset_key: "preset-key",
      preset_source: "custom",
      tags_json: ["gallery"],
      payload_json: { outputs: [{ width: 768, height: 1344 }] },
      artifact_run_dir: "/absolute/run/dir",
      provider_payload_json: { request: "large" },
    });

    expect(asset).toMatchObject({
      asset_id: "asset-2",
      job_id: "job-2",
      project_id: "project-1",
      width: 768,
      height: 1344,
      favorited: true,
      preset_key: "preset-key",
      tags: ["gallery"],
      hero_thumb_url: "/api/control/files/runs/asset-2/thumb.webp",
    });
    expect(asset).not.toHaveProperty("payload");
    expect(asset).not.toHaveProperty("payload_json");
    expect(asset).not.toHaveProperty("artifact_run_dir");
    expect(asset).not.toHaveProperty("provider_payload_json");
  });

  it("maps project records with status defaults and proxied covers", () => {
    const project = mapProjectRecord({
      project_id: "project-1",
      name: "Sadi",
      description: "Character project",
      hidden_from_global_gallery: 1,
      cover_asset_id: "asset-cover",
      cover_reference_id: "reference-cover",
      cover_image_url: "references/project-1/original.png",
      cover_thumb_url: "references/project-1/thumb.webp",
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:01:00.000Z",
    });

    expect(project).toEqual({
      project_id: "project-1",
      name: "Sadi",
      description: "Character project",
      status: "active",
      hidden_from_global_gallery: true,
      cover_asset_id: "asset-cover",
      cover_reference_id: "reference-cover",
      cover_image_url: "/api/control/files/references/project-1/original.png",
      cover_thumb_url: "/api/control/files/references/project-1/thumb.webp",
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:01:00.000Z",
    });
  });

  it("maps jobs and batches with artifact summaries and matching batch jobs", () => {
    const job = mapJobRecord({
      job_id: "job-1",
      batch_id: "batch-1",
      project_id: "project-1",
      status: "completed",
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:01:00.000Z",
      artifact_json: { run_id: "run-1", run_dir: "/runs/run-1" },
      hero_original_path: "runs/run-1/original.png",
      selected_system_prompt_ids_json: ["system-1"],
      resolved_options_json: { aspect_ratio: "16:9" },
    });
    const otherJob = mapJobRecord({
      job_id: "job-other",
      batch_id: "batch-other",
      status: "queued",
      created_at: "2026-06-12T00:00:00.000Z",
      updated_at: "2026-06-12T00:00:00.000Z",
    });
    const batch = mapBatchRecord(
      {
        batch_id: "batch-1",
        status: "completed",
        project_id: "project-1",
        model_key: "gpt-image-2",
        requested_outputs: 2,
        request_summary_json: { prompt: "Batch prompt" },
        created_at: "2026-06-12T00:00:00.000Z",
        updated_at: "2026-06-12T00:02:00.000Z",
      },
      [job, otherJob],
    );

    expect(job).toMatchObject({
      job_id: "job-1",
      batch_id: "batch-1",
      project_id: "project-1",
      status: "completed",
      selected_system_prompt_ids: ["system-1"],
      resolved_options: { aspect_ratio: "16:9" },
      artifact: {
        run_id: "run-1",
        run_dir: "/runs/run-1",
        hero_original_path: "runs/run-1/original.png",
      },
    });
    expect(batch).toMatchObject({
      batch_id: "batch-1",
      status: "completed",
      project_id: "project-1",
      requested_outputs: 2,
      request_summary: {
        prompt: "Batch prompt",
        prompt_summary: "Batch prompt",
      },
      jobs: [expect.objectContaining({ job_id: "job-1" })],
    });
  });

  it("maps pricing responses with defaults, stringified model keys, and a snapshot", () => {
    const pricing = mapPricingResponseRecord({
      version: "2026-06",
      label: "June pricing",
      source: "kie",
      source_kind: "provider",
      currency: "USD",
      notes: ["observed"],
      rules: [{ model_key: "gpt-image-2" }],
      is_stale: 0,
      is_authoritative: 1,
      pricing_status: "observed_site_pricing",
      priced_model_keys: ["gpt-image-2", 123],
      missing_model_keys: [null, "unknown-model"],
      unmapped_source_rows: [{ model: "x" }, null, "skip"],
    });

    expect(pricing).toMatchObject({
      ok: true,
      version: "2026-06",
      label: "June pricing",
      source: "kie",
      source_kind: "provider",
      currency: "USD",
      notes: ["observed"],
      rules: [{ model_key: "gpt-image-2" }],
      is_stale: false,
      is_authoritative: true,
      pricing_status: "observed_site_pricing",
      priced_model_keys: ["gpt-image-2", "123"],
      missing_model_keys: ["null", "unknown-model"],
      unmapped_source_rows: [{ model: "x" }],
    });
    expect(pricing.snapshot).toMatchObject({ version: "2026-06" });
  });
});
