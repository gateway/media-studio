import { beforeEach, describe, expect, it, vi } from "vitest";

const getControlApiJson = vi.fn();
const postControlApiJson = vi.fn();
const sendControlApiJson = vi.fn();
const mapPromptRecipeRecord = vi.fn((value: Record<string, unknown>) => value);

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  postControlApiJson,
  sendControlApiJson,
  mapPromptRecipeRecord,
}));

describe("prompt recipe control routes", () => {
  beforeEach(() => {
    vi.resetModules();
    getControlApiJson.mockReset();
    postControlApiJson.mockReset();
    sendControlApiJson.mockReset();
    mapPromptRecipeRecord.mockImplementation(
      (value: Record<string, unknown>) => value,
    );
  });

  it("forwards list filters and maps prompt recipe rows", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: [{ recipe_id: "recipe-1", key: "recipe_one" }],
    });

    const { GET } = await import("@/app/api/control/prompt-recipes/route");
    const response = await GET(
      new Request(
        "http://localhost/api/control/prompt-recipes?status=all&category=image",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(getControlApiJson).toHaveBeenCalledWith(
      "/prompt-recipes?status=all&category=image",
    );
    expect(payload).toEqual({
      ok: true,
      recipes: [{ recipe_id: "recipe-1", key: "recipe_one" }],
    });
  });

  it("returns the shared error payload for prompt recipe list failures", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: false,
      data: null,
      error: "Control API returned 500.",
    });

    const { GET } = await import("@/app/api/control/prompt-recipes/route");
    const response = await GET(
      new Request("http://localhost/api/control/prompt-recipes"),
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      ok: false,
      error: "Control API returned 500.",
    });
  });

  it("uses fallback error text for prompt recipe mutation failures", async () => {
    postControlApiJson.mockResolvedValueOnce({ ok: false, data: null });
    sendControlApiJson.mockResolvedValueOnce({ ok: false, data: null });

    const listRoute = await import("@/app/api/control/prompt-recipes/route");
    const itemRoute =
      await import("@/app/api/control/prompt-recipes/[recipeId]/route");

    const createResponse = await listRoute.POST(
      new Request("http://localhost/api/control/prompt-recipes", {
        method: "POST",
        body: JSON.stringify({ key: "recipe_one" }),
      }),
    );
    const createPayload = await createResponse.json();

    const updateResponse = await itemRoute.PATCH(
      new Request("http://localhost/api/control/prompt-recipes/recipe-1", {
        method: "PATCH",
        body: JSON.stringify({ label: "Recipe One" }),
      }),
      { params: Promise.resolve({ recipeId: "recipe-1" }) },
    );
    const updatePayload = await updateResponse.json();

    expect(createResponse.status).toBe(502);
    expect(createPayload).toEqual({
      ok: false,
      error: "Unable to create the prompt recipe.",
    });
    expect(updateResponse.status).toBe(502);
    expect(updatePayload).toEqual({
      ok: false,
      error: "Unable to update the prompt recipe.",
    });
  });
});
