import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const listReferenceMedia = vi.fn();
const getReferenceMedia = vi.fn();
const deleteReferenceMedia = vi.fn();
const markReferenceMediaUsed = vi.fn();
const registerReferenceMediaFile = vi.fn();
const backfillReferenceMedia = vi.fn();

vi.mock("@/lib/control-api", () => ({
  listReferenceMedia,
  getReferenceMedia,
  deleteReferenceMedia,
  markReferenceMediaUsed,
  backfillReferenceMedia,
}));

vi.mock("@/lib/reference-media-storage", () => ({
  registerReferenceMediaFile,
}));

describe("reference media web routes", () => {
  beforeEach(() => {
    vi.resetModules();
    listReferenceMedia.mockReset();
    getReferenceMedia.mockReset();
    deleteReferenceMedia.mockReset();
    markReferenceMediaUsed.mockReset();
    registerReferenceMediaFile.mockReset();
    backfillReferenceMedia.mockReset();
  });

  it("lists reference media through the control proxy", async () => {
    listReferenceMedia.mockResolvedValueOnce({
      ok: true,
      data: {
        items: [{ reference_id: "ref-1", kind: "image" }],
        limit: 40,
        offset: 20,
      },
    });

    const { GET } = await import("@/app/api/control/reference-media/route");
    const response = await GET(new NextRequest("http://localhost/api/control/reference-media?kind=image&limit=40&offset=20"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listReferenceMedia).toHaveBeenCalledWith({ kind: "image", projectId: null, limit: 40, offset: 20 });
    expect(payload).toEqual({
      ok: true,
      items: [{ reference_id: "ref-1", kind: "image" }],
      limit: 40,
      offset: 20,
    });
  });

  it("fetches one reference media record", async () => {
    getReferenceMedia.mockResolvedValueOnce({
      ok: true,
      data: { item: { reference_id: "ref-1", kind: "image" } },
    });

    const { GET } = await import("@/app/api/control/reference-media/[referenceId]/route");
    const response = await GET(new Request("http://localhost/api/control/reference-media/ref-1"), {
      params: Promise.resolve({ referenceId: "ref-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, item: { reference_id: "ref-1", kind: "image" } });
  });

  it("deletes one reference media record", async () => {
    deleteReferenceMedia.mockResolvedValueOnce({
      ok: true,
      data: { item: { reference_id: "ref-1", status: "hidden" } },
    });

    const { DELETE } = await import("@/app/api/control/reference-media/[referenceId]/route");
    const response = await DELETE(new Request("http://localhost/api/control/reference-media/ref-1", { method: "DELETE" }), {
      params: Promise.resolve({ referenceId: "ref-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, item: { reference_id: "ref-1", status: "hidden" } });
  });

  it("marks a reference as used", async () => {
    markReferenceMediaUsed.mockResolvedValueOnce({
      ok: true,
      data: { item: { reference_id: "ref-1", usage_count: 3 } },
    });

    const { POST } = await import("@/app/api/control/reference-media/[referenceId]/use/route");
    const response = await POST(new Request("http://localhost/api/control/reference-media/ref-1/use", { method: "POST" }), {
      params: Promise.resolve({ referenceId: "ref-1" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true, item: { reference_id: "ref-1", usage_count: 3 } });
  });

  it("imports a reference file", async () => {
    registerReferenceMediaFile.mockResolvedValueOnce({
      reference_id: "ref-1",
      kind: "image",
      stored_path: "reference-media/images/ref-1.png",
    });

    const formData = new FormData();
    formData.set("file", new File(["abc"], "portrait.png", { type: "image/png" }));

    const { POST } = await import("@/app/api/control/reference-media/import/route");
    const response = await POST(new Request("http://localhost/api/control/reference-media/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      item: {
        reference_id: "ref-1",
        kind: "image",
        stored_path: "reference-media/images/ref-1.png",
      },
    });
  });

  it("triggers explicit reference-media backfill", async () => {
    backfillReferenceMedia.mockResolvedValueOnce({
      ok: true,
      data: {
        scanned: 3,
        imported: 2,
        reused: 1,
        skipped: 0,
        errors: [],
        duration_seconds: 0.42,
      },
    });

    const { POST } = await import("@/app/api/control/reference-media/backfill/route");
    const response = await POST(new Request("http://localhost/api/control/reference-media/backfill", { method: "POST" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      scanned: 3,
      imported: 2,
      reused: 1,
      skipped: 0,
      errors: [],
      duration_seconds: 0.42,
    });
  });
});
