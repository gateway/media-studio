import { beforeEach, describe, expect, it, vi } from "vitest";

const getControlApiJson = vi.fn();

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  mapAssetRecord: (asset: Record<string, unknown>) => asset,
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
          items: Array.from({ length: 100 }, (_, index) => buildAsset(index + 100)),
          next_cursor: "cursor-200",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: Array.from({ length: 50 }, (_, index) => buildAsset(index + 200)),
          next_cursor: null,
        },
      });

    const { GET } = await import("@/app/api/control/media-assets/route");
    const response = await GET(new Request("http://localhost/api/control/media-assets?limit=12&offset=190"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.assets).toHaveLength(12);
    expect(payload.assets[0].asset_id).toBe("asset-190");
    expect(payload.assets[11].asset_id).toBe("asset-201");
    expect(payload.has_more).toBe(true);
    expect(payload.next_offset).toBe(202);

    const requestedEndpoints = getControlApiJson.mock.calls.map((call) => call[0] as string);
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
    const response = await GET(new Request("http://localhost/api/control/media-assets?limit=12&offset=190"));
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
      new Request("http://localhost/api/control/media-assets?limit=12&offset=0&project_id=project-1"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(getControlApiJson).toHaveBeenCalledWith("/media/assets?project_id=project-1&limit=100", "read");
  });
});
