import { beforeEach, describe, expect, it, vi } from "vitest";

const getControlApiJson = vi.fn();
const sendControlApiJson = vi.fn();

function pickerDimensions(asset: Record<string, unknown>) {
  if (asset.width && asset.height) {
    return {
      width: Number(asset.width),
      height: Number(asset.height),
    };
  }
  const payload = asset.payload_json as
    | { outputs?: Array<{ width?: number; height?: number }> }
    | undefined;
  const output = payload?.outputs?.[0];
  return {
    width: output?.width ?? null,
    height: output?.height ?? null,
  };
}

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  sendControlApiJson,
  mapAssetRecord: (asset: Record<string, unknown>) => ({
    ...asset,
    payload: asset.payload_json ?? {},
  }),
  mapAssetPickerRecord: (asset: Record<string, unknown>) => {
    const dimensions = pickerDimensions(asset);
    return {
      asset_id: asset.asset_id,
      project_id: asset.project_id ?? null,
      generation_kind: asset.generation_kind ?? null,
      created_at: String(asset.created_at),
      model_key: asset.model_key ?? null,
      status: asset.status ?? null,
      task_mode: asset.task_mode ?? null,
      prompt_summary: asset.prompt_summary ?? null,
      hero_original_path: asset.hero_original_path ?? null,
      hero_web_path: asset.hero_web_path ?? null,
      hero_thumb_path: asset.hero_thumb_path ?? null,
      hero_poster_path: asset.hero_poster_path ?? null,
      hero_original_url: asset.hero_original_path
        ? `/api/control/media/files/${asset.hero_original_path}`
        : null,
      hero_web_url: asset.hero_web_path
        ? `/api/control/media/files/${asset.hero_web_path}`
        : null,
      hero_thumb_url: asset.hero_thumb_path
        ? `/api/control/media/files/${asset.hero_thumb_path}`
        : null,
      hero_poster_url: asset.hero_poster_path
        ? `/api/control/media/files/${asset.hero_poster_path}`
        : null,
      width: dimensions.width,
      height: dimensions.height,
      duration_seconds: asset.duration_seconds ?? null,
    };
  },
  mapAssetSummaryRecord: (asset: Record<string, unknown>) => {
    const dimensions = pickerDimensions(asset);
    return {
      asset_id: asset.asset_id,
      job_id: asset.job_id ?? null,
      project_id: asset.project_id ?? null,
      provider_task_id: asset.provider_task_id ?? null,
      run_id: asset.run_id ?? null,
      source_asset_id: asset.source_asset_id ?? null,
      generation_kind: asset.generation_kind ?? null,
      hidden_from_dashboard: false,
      dismissed_at: asset.dismissed ? asset.created_at : null,
      favorited: Boolean(asset.favorited),
      favorited_at: asset.favorited_at ?? null,
      created_at: String(asset.created_at),
      model_key: asset.model_key ?? null,
      status: asset.status ?? null,
      task_mode: asset.task_mode ?? null,
      prompt_summary: asset.prompt_summary ?? null,
      hero_original_path: asset.hero_original_path ?? null,
      hero_web_path: asset.hero_web_path ?? null,
      hero_thumb_path: asset.hero_thumb_path ?? null,
      hero_poster_path: asset.hero_poster_path ?? null,
      hero_original_url: asset.hero_original_path
        ? `/api/control/media/files/${asset.hero_original_path}`
        : null,
      hero_web_url: asset.hero_web_path
        ? `/api/control/media/files/${asset.hero_web_path}`
        : null,
      hero_thumb_url: asset.hero_thumb_path
        ? `/api/control/media/files/${asset.hero_thumb_path}`
        : null,
      hero_poster_url: asset.hero_poster_path
        ? `/api/control/media/files/${asset.hero_poster_path}`
        : null,
      width: dimensions.width,
      height: dimensions.height,
      remote_output_url: asset.remote_output_url ?? null,
      preset_key: asset.preset_key ?? null,
      preset_source: asset.preset_source ?? null,
      tags: asset.tags_json ?? [],
    };
  },
}));

function buildAsset(index: number) {
  return {
    asset_id: `asset-${index}`,
    job_id: `job-${index}`,
    model_key: "nano-banana-2",
    status: "completed",
    created_at: `2026-04-04T00:${String(index).padStart(2, "0")}:00.000Z`,
  };
}

describe("control media-assets route", () => {
  beforeEach(() => {
    getControlApiJson.mockReset();
    sendControlApiJson.mockReset();
  });

  it("uses backend cursor pagination for high offsets without exceeding the API limit", async () => {
    getControlApiJson
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: Array.from({ length: 100 }, (_, index) => buildAsset(index)),
          next_cursor: "cursor-100",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: Array.from({ length: 100 }, (_, index) =>
            buildAsset(index + 100),
          ),
          next_cursor: "cursor-200",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: Array.from({ length: 50 }, (_, index) =>
            buildAsset(index + 200),
          ),
          next_cursor: null,
        },
      });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=12&offset=190",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.assets).toHaveLength(12);
    expect(payload.assets[0].asset_id).toBe("asset-190");
    expect(payload.assets[11].asset_id).toBe("asset-201");
    expect(payload.has_more).toBe(true);
    expect(payload.next_offset).toBe(202);

    const requestedEndpoints = getControlApiJson.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(requestedEndpoints).toEqual([
      "/media/assets?limit=112",
      "/media/assets?limit=102&cursor=cursor-100",
      "/media/assets?limit=100&cursor=cursor-200",
    ]);
  });

  it("returns a 502 when the upstream control API page fetch fails", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: "Control API returned 422 for /media/assets?limit=226.",
    });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=12&offset=190",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      ok: false,
      error: "Control API returned 422 for /media/assets?limit=226.",
    });
  });

  it("forwards project filtering to the control API", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [buildAsset(1)],
        next_cursor: null,
      },
    });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=12&offset=0&project_id=project-1",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/assets?project_id=project-1&limit=100",
      "read",
    );
  });

  it("bounds oversized media asset page requests before proxying", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [buildAsset(1)],
        next_cursor: null,
      },
    });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=999999&offset=-50",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.limit).toBe(200);
    expect(payload.offset).toBe(0);
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/assets?limit=200",
      "read",
    );
  });

  it("returns a lightweight picker contract when view=picker is requested", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            ...buildAsset(1),
            generation_kind: "image",
            task_mode: "text_to_image",
            prompt_summary: "Picker prompt",
            hero_original_path: "runs/asset-1/original.png",
            hero_web_path: "runs/asset-1/web.webp",
            hero_thumb_path: "runs/asset-1/thumb.webp",
            payload_json: { outputs: [{ width: 1024, height: 1024 }] },
            artifact_run_dir: "/absolute/run/dir",
            diagnostics_json: { trace: "large" },
            provider_payload_json: { request: "large" },
          },
        ],
        next_cursor: null,
      },
    });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=12&offset=0&generation_kind=image&view=picker",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.assets).toHaveLength(1);
    expect(payload.assets[0]).toEqual({
      asset_id: "asset-1",
      project_id: null,
      generation_kind: "image",
      created_at: "2026-04-04T00:01:00.000Z",
      model_key: "nano-banana-2",
      status: "completed",
      task_mode: "text_to_image",
      prompt_summary: "Picker prompt",
      hero_original_path: "runs/asset-1/original.png",
      hero_web_path: "runs/asset-1/web.webp",
      hero_thumb_path: "runs/asset-1/thumb.webp",
      hero_poster_path: null,
      hero_original_url: "/api/control/media/files/runs/asset-1/original.png",
      hero_web_url: "/api/control/media/files/runs/asset-1/web.webp",
      hero_thumb_url: "/api/control/media/files/runs/asset-1/thumb.webp",
      hero_poster_url: null,
      width: 1024,
      height: 1024,
      duration_seconds: null,
    });
    expect(payload.assets[0]).not.toHaveProperty("payload");
    expect(payload.assets[0]).not.toHaveProperty("payload_json");
    expect(payload.assets[0]).not.toHaveProperty("artifact_run_dir");
    expect(payload.assets[0]).not.toHaveProperty("diagnostics_json");
    expect(payload.assets[0]).not.toHaveProperty("provider_payload_json");
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/assets?media_type=image&compact=true&limit=100",
      "read",
    );
  });

  it("forwards source search to the lightweight picker contract", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            ...buildAsset(6),
            asset_id: "asset-sadie",
            generation_kind: "image",
            prompt_summary: "Sadie portrait storyboard",
            hero_thumb_path: "runs/asset-sadie/thumb.webp",
          },
        ],
        next_cursor: null,
      },
    });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=12&offset=0&generation_kind=image&view=picker&q=Sadie",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.assets[0]).toMatchObject({
      asset_id: "asset-sadie",
      prompt_summary: "Sadie portrait storyboard",
    });
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/assets?media_type=image&q=Sadie&compact=true&limit=100",
      "read",
    );
  });

  it("forwards audio generation kind to the lightweight picker contract", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            ...buildAsset(7),
            asset_id: "asset-audio",
            generation_kind: "audio",
            prompt_summary: "Generated voice line",
            hero_original_path: "runs/asset-audio/original.wav",
          },
        ],
        next_cursor: null,
      },
    });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=12&offset=0&generation_kind=audio&view=picker&q=voice",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.assets[0]).toMatchObject({
      asset_id: "asset-audio",
      generation_kind: "audio",
      prompt_summary: "Generated voice line",
    });
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/assets?media_type=audio&q=voice&compact=true&limit=100",
      "read",
    );
  });

  it("keeps the default media-assets response backward compatible", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            ...buildAsset(2),
            payload_json: { outputs: [{ width: 1024, height: 1024 }] },
            artifact_run_dir: "/absolute/run/dir",
          },
        ],
        next_cursor: null,
      },
    });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=12&offset=0",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.assets[0]).toMatchObject({
      asset_id: "asset-2",
      payload_json: { outputs: [{ width: 1024, height: 1024 }] },
      artifact_run_dir: "/absolute/run/dir",
    });
  });

  it("returns a lightweight summary contract when view=summary is requested", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            ...buildAsset(3),
            project_id: "project-1",
            generation_kind: "image",
            task_mode: "text_to_image",
            prompt_summary: "Summary prompt",
            hero_original_path: "runs/asset-3/original.png",
            hero_thumb_path: "runs/asset-3/thumb.webp",
            width: 1536,
            height: 1024,
            preset_key: "preset-summary",
            tags_json: ["gallery"],
            favorited: true,
            payload_json: { outputs: [{ width: 1536, height: 1024 }] },
            artifact_run_dir: "/absolute/run/dir",
            diagnostics_json: { trace: "large" },
            provider_payload_json: { request: "large" },
          },
        ],
        next_cursor: null,
      },
    });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=12&offset=0&generation_kind=image&view=summary",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.assets[0]).toMatchObject({
      asset_id: "asset-3",
      job_id: "job-3",
      project_id: "project-1",
      generation_kind: "image",
      prompt_summary: "Summary prompt",
      favorited: true,
      preset_key: "preset-summary",
      tags: ["gallery"],
      hero_thumb_url: "/api/control/media/files/runs/asset-3/thumb.webp",
      width: 1536,
      height: 1024,
    });
    expect(payload.assets[0]).not.toHaveProperty("payload");
    expect(payload.assets[0]).not.toHaveProperty("payload_json");
    expect(payload.assets[0]).not.toHaveProperty("artifact_run_dir");
    expect(payload.assets[0]).not.toHaveProperty("diagnostics_json");
    expect(payload.assets[0]).not.toHaveProperty("provider_payload_json");
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/assets?media_type=image&compact=true&limit=100",
      "read",
    );
  });

  it("requests lightweight summaries when project filtering is applied", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [
          {
            ...buildAsset(4),
            project_id: "project-1",
            generation_kind: "image",
            task_mode: "text_to_image",
            prompt_summary: "Project summary prompt",
            hero_thumb_path: "runs/asset-4/thumb.webp",
            width: 768,
            height: 1344,
            payload_json: { outputs: [{ width: 768, height: 1344 }] },
            artifact_run_dir: "/absolute/run/dir",
            diagnostics_json: { trace: "large" },
            provider_payload_json: { request: "large" },
          },
        ],
        next_cursor: null,
      },
    });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/media-assets?limit=12&offset=0&project_id=project-1&view=summary",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.assets[0]).toMatchObject({
      asset_id: "asset-4",
      project_id: "project-1",
      prompt_summary: "Project summary prompt",
      width: 768,
      height: 1344,
      hero_thumb_url: "/api/control/media/files/runs/asset-4/thumb.webp",
    });
    expect(payload.assets[0]).not.toHaveProperty("payload");
    expect(payload.assets[0]).not.toHaveProperty("payload_json");
    expect(payload.assets[0]).not.toHaveProperty("artifact_run_dir");
    expect(payload.assets[0]).not.toHaveProperty("diagnostics_json");
    expect(payload.assets[0]).not.toHaveProperty("provider_payload_json");
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/assets?project_id=project-1&compact=true&limit=100",
      "read",
    );
  });

  it("hydrates full asset detail without requesting the compact contract", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        ...buildAsset(5),
        project_id: "project-1",
        generation_kind: "image",
        prompt_summary: "Full detail prompt",
        width: 1536,
        height: 1024,
        payload_json: { outputs: [{ width: 1536, height: 1024 }] },
        artifact_run_dir: "/absolute/run/dir",
        diagnostics_json: { trace: "detail" },
        provider_payload_json: { request: "detail" },
      },
    });

    const { GET } = await import("@/app/api/control/media-assets/[assetId]/route");
    const response = await GET(
      new Request("http://localhost/api/control/media-assets/asset-5"),
      { params: Promise.resolve({ assetId: "asset-5" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      asset: {
        asset_id: "asset-5",
        project_id: "project-1",
        width: 1536,
        height: 1024,
        payload: { outputs: [{ width: 1536, height: 1024 }] },
        payload_json: { outputs: [{ width: 1536, height: 1024 }] },
        artifact_run_dir: "/absolute/run/dir",
        diagnostics_json: { trace: "detail" },
        provider_payload_json: { request: "detail" },
      },
    });
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/media/assets/asset-5",
      "admin",
    );
  });
});
