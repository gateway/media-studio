import { beforeEach, describe, expect, it, vi } from "vitest";

const getControlApiJson = vi.fn();
const getControlApiFile = vi.fn();
const mapAssetRecord = vi.fn((asset: Record<string, unknown>) => asset);
const storePromptRecipeThumbnailBuffer = vi.fn();

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  getControlApiFile,
  mapAssetRecord,
}));

vi.mock("@/lib/prompt-recipe-thumbnail-storage", () => ({
  storePromptRecipeThumbnailBuffer,
}));

describe("prompt recipe thumbnail routes", () => {
  beforeEach(() => {
    vi.resetModules();
    getControlApiJson.mockReset();
    getControlApiFile.mockReset();
    mapAssetRecord.mockImplementation((asset: Record<string, unknown>) => asset);
    storePromptRecipeThumbnailBuffer.mockReset();
  });

  it("stores a prompt recipe thumbnail from a generated image asset", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        asset_id: "asset-1",
        hero_original_path: "outputs/generated/asset-1.png",
        prompt_summary: "Storyboard heroine",
      },
    });
    getControlApiFile.mockResolvedValueOnce({
      ok: true,
      response: new Response(Buffer.from("image-bytes"), {
        headers: { "content-type": "image/png" },
      }),
      error: null,
    });
    storePromptRecipeThumbnailBuffer.mockResolvedValueOnce({
      thumbnail_path: "prompt-recipe-thumbnails/storyboard.webp",
      thumbnail_url: "/api/prompt-recipe-thumbnails/storyboard.webp",
    });

    const { POST } = await import("@/app/api/control/prompt-recipe-thumbnail/from-asset/route");
    const response = await POST(
      new Request("http://localhost/api/control/prompt-recipe-thumbnail/from-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_id: "asset-1", recipeLabel: "Storyboard Director" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.thumbnail_path).toBe("prompt-recipe-thumbnails/storyboard.webp");
    expect(getControlApiJson).toHaveBeenCalledWith("/media/assets/asset-1", "admin");
    expect(getControlApiFile).toHaveBeenCalledWith(["outputs", "generated", "asset-1.png"]);
    expect(storePromptRecipeThumbnailBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        recipeLabel: "Storyboard Director",
      }),
    );
  });

  it("rejects assets without a usable image file path", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        asset_id: "asset-2",
        hero_original_path: null,
        hero_web_path: null,
        hero_thumb_path: null,
        hero_poster_path: null,
      },
    });

    const { POST } = await import("@/app/api/control/prompt-recipe-thumbnail/from-asset/route");
    const response = await POST(
      new Request("http://localhost/api/control/prompt-recipe-thumbnail/from-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_id: "asset-2" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/usable local file/i);
    expect(getControlApiFile).not.toHaveBeenCalled();
  });
});
