import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const sendControlApiJson = vi.fn();
const createPresetThumbnailFromAsset = vi.fn();
vi.mock("@/lib/control-api", () => ({
  CONTROL_API_BASE_URL: "http://api.test",
  buildControlApiHeaders: () => ({ "content-type": "application/json" }),
  sendControlApiJson,
}));
vi.mock("@/lib/preset-thumbnail-from-asset", () => ({ createPresetThumbnailFromAsset }));

function savedPreset() {
  return {
    capability: "save_media_preset", artifact_kind: "media_preset", created: true,
    record: { preset_id: "preset-1", label: "Paper Journey", thumbnail_path: null, thumbnail_url: null },
    message: "Media Preset saved.",
    assistant_session: {
      assistant_session_id: "session-1",
      summary_json: {
        kernel_preset_proposal: {
          save_mode: "verified", consumed: true,
          draft: {
            key: "paper_journey", model_key: "sunburst", prompt_template: "Travel to {{destination}}",
            default_options_json: { resolution: "1K", aspect_ratio: "2:3" },
            input_schema_json: [{ key: "destination", type: "text" }],
          },
        },
        kernel_preset_quality: { output_asset_id: "approved-output" },
        kernel_preset_run_evidence: { assistant_session_id: "session-1", output_asset_ids: ["approved-output"] },
      },
    },
  };
}

async function save(saved = savedPreset()) {
  fetchMock.mockResolvedValueOnce(Response.json(saved));
  const { POST } = await import("@/app/api/control/media/assistant/sessions/[sessionId]/preset-saves/route");
  return POST(new Request("http://web.test/api/control/media/assistant/sessions/session-1/preset-saves", {
    method: "POST", body: JSON.stringify({ proposal_id: "proposal-1", confirmation_token: "confirmed" }),
  }), { params: Promise.resolve({ sessionId: "session-1" }) });
}

describe("Assistant preset save thumbnail", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    sendControlApiJson.mockReset();
    createPresetThumbnailFromAsset.mockReset();
    createPresetThumbnailFromAsset.mockResolvedValue({
      ok: true, thumbnail_path: "preset-thumbnails/approved.webp", thumbnail_url: "/api/preset-thumbnails/approved.webp",
    });
    sendControlApiJson.mockResolvedValue({ ok: true, data: { ...savedPreset().record, thumbnail_url: "/api/preset-thumbnails/approved.webp" } });
  });

  it("saves the confirmed owned output as thumbnail while preserving the generation contract", async () => {
    const saved = savedPreset();
    const response = await save(saved);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.record.thumbnail_url).toBe("/api/preset-thumbnails/approved.webp");
    expect(body.warning).toBeUndefined();
    expect(createPresetThumbnailFromAsset).toHaveBeenCalledWith("approved-output", "Paper Journey");
    expect(sendControlApiJson).toHaveBeenCalledWith("/media/presets/preset-1", {
      method: "PATCH", authMode: "admin", payload: {
        ...saved.assistant_session.summary_json.kernel_preset_proposal.draft,
        thumbnail_path: "preset-thumbnails/approved.webp", thumbnail_url: "/api/preset-thumbnails/approved.webp",
      },
    });
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(createPresetThumbnailFromAsset.mock.invocationCallOrder[0]);
  });

  it("preserves an explicit thumbnail", async () => {
    const saved = savedPreset();
    Object.assign(saved.record, { thumbnail_url: "/chosen-thumbnail.webp" });
    expect((await (await save(saved)).json()).record.thumbnail_url).toBe("/chosen-thumbnail.webp");
    expect(createPresetThumbnailFromAsset).not.toHaveBeenCalled();
    expect(sendControlApiJson).not.toHaveBeenCalled();
  });

  it("leaves unverified saves without a thumbnail", async () => {
    const saved = savedPreset();
    saved.assistant_session.summary_json.kernel_preset_proposal.save_mode = "unverified";
    await save(saved);
    expect(createPresetThumbnailFromAsset).not.toHaveBeenCalled();
  });

  it("does not use an output outside the confirmed session evidence", async () => {
    const saved = savedPreset();
    saved.assistant_session.summary_json.kernel_preset_run_evidence.output_asset_ids = ["different-output"];
    const response = await save(saved);
    const body = await response.json();
    expect(body.message).toMatch(/saved, but.*could not be verified/i);
    expect(body.warning).toBe(body.message);
    expect(createPresetThumbnailFromAsset).not.toHaveBeenCalled();
  });

  it("reports a saved preset when the approved output file is missing", async () => {
    createPresetThumbnailFromAsset.mockResolvedValue({ ok: false, status: 502, error: "Output file missing." });
    const response = await save();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.record.preset_id).toBe("preset-1");
    expect(body.message).toMatch(/saved, but its thumbnail could not be saved/i);
    expect(body.warning).toBe(body.message);
    expect(sendControlApiJson).not.toHaveBeenCalled();
  });

  it("reports a saved preset if persisting the generated thumbnail fails", async () => {
    sendControlApiJson.mockResolvedValue({ ok: false, error: "Update failed." });
    const response = await save();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.message).toMatch(/saved, but its thumbnail could not be saved/i);
    expect(body.warning).toBe(body.message);
  });

  it("preserves rejected confirmation status and performs no thumbnail work", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ detail: "Confirmation is stale." }, { status: 400 }));
    const response = await save();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ detail: "Confirmation is stale." });
    expect(createPresetThumbnailFromAsset).not.toHaveBeenCalled();
    expect(sendControlApiJson).not.toHaveBeenCalled();
  });
});
