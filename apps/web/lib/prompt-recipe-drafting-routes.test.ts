import { beforeEach, describe, expect, it, vi } from "vitest";

const getControlApiJson = vi.fn();
const postControlApiJson = vi.fn();
const sendControlApiJson = vi.fn();
const mapPromptRecipeDraftPayload = vi.fn((value: Record<string, unknown>) => value);
const mapPromptRecipeDraftingConfigRecord = vi.fn((value: Record<string, unknown>) => value);

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  postControlApiJson,
  sendControlApiJson,
  mapPromptRecipeDraftPayload,
  mapPromptRecipeDraftingConfigRecord,
}));

describe("prompt recipe drafting routes", () => {
  beforeEach(() => {
    vi.resetModules();
    getControlApiJson.mockReset();
    postControlApiJson.mockReset();
    sendControlApiJson.mockReset();
    mapPromptRecipeDraftPayload.mockImplementation((value: Record<string, unknown>) => value);
    mapPromptRecipeDraftingConfigRecord.mockImplementation((value: Record<string, unknown>) => value);
  });

  it("loads the drafting config through the control route", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: { config_key: "prompt_recipe_drafting", provider_kind: "openrouter" },
    });

    const { GET } = await import("@/app/api/control/prompt-recipe-drafting-config/route");
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.config).toMatchObject({ config_key: "prompt_recipe_drafting", provider_kind: "openrouter" });
  });

  it("saves the drafting config through the control route", async () => {
    sendControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: { config_key: "prompt_recipe_drafting", provider_model_id: "qwen/model" },
    });

    const { PATCH } = await import("@/app/api/control/prompt-recipe-drafting-config/route");
    const response = await PATCH(
      new Request("http://localhost/api/control/prompt-recipe-drafting-config", {
        method: "PATCH",
        body: JSON.stringify({ provider_model_id: "qwen/model" }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.config.provider_model_id).toBe("qwen/model");
    expect(sendControlApiJson).toHaveBeenCalledWith("/media/prompt-recipe-drafting-config", {
      method: "PATCH",
      payload: { provider_model_id: "qwen/model" },
      authMode: "admin",
    });
  });

  it("proxies provider probe requests for drafting config", async () => {
    postControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: { credential_source: "env", available_models: [{ id: "qwen" }] },
    });

    const { POST } = await import("@/app/api/control/prompt-recipe-drafting-config/probe/route");
    const response = await POST(
      new Request("http://localhost/api/control/prompt-recipe-drafting-config/probe", {
        method: "POST",
        body: JSON.stringify({
          provider_kind: "openrouter",
          provider_model_id: "qwen",
          provider_base_url: null,
          require_images: false,
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.credential_source).toBe("env");
    expect(postControlApiJson).toHaveBeenCalledWith(
      "/media/prompt-recipe-drafting-config/probe",
      {
        provider_kind: "openrouter",
        selected_model_id: "qwen",
        base_url: null,
        require_images: false,
      },
      "admin",
    );
  });

  it("proxies prompt recipe draft generation through the control route", async () => {
    postControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        draft: { key: "recipe_key", label: "Recipe Key", category: "image", system_prompt_template: "USER: {{user_prompt}}", output_format: "single_prompt" },
        validation_warnings: ["warning"],
        drafting_model: { provider_kind: "openrouter", provider_model_id: "qwen" },
      },
    });

    const { POST } = await import("@/app/api/control/prompt-recipes/draft/route");
    const response = await POST(
      new Request("http://localhost/api/control/prompt-recipes/draft", {
        method: "POST",
        body: JSON.stringify({ idea: "Create a recipe." }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.draft.key).toBe("recipe_key");
    expect(payload.validation_warnings).toEqual(["warning"]);
    expect(postControlApiJson).toHaveBeenCalledWith("/prompt-recipes/draft", { idea: "Create a recipe." }, "admin");
  });
});
