import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

import { createPortablePromptRecipeBundleManifest } from "@/lib/prompt-recipe-sharing";
import type { PromptRecipe } from "@/lib/types";

const getControlApiJson = vi.fn();
const postControlApiJson = vi.fn();
const mapPromptRecipeRecord = vi.fn((recipe: Record<string, unknown>) => recipe);
const readPromptRecipeThumbnailBuffer = vi.fn();
const storePromptRecipeThumbnailBuffer = vi.fn();

vi.mock("@/lib/control-api", () => ({
  getControlApiJson,
  postControlApiJson,
  mapPromptRecipeRecord,
}));

vi.mock("@/lib/prompt-recipe-thumbnail-storage", () => ({
  readPromptRecipeThumbnailBuffer,
  storePromptRecipeThumbnailBuffer,
}));

function buildRecipe(overrides: Partial<PromptRecipe> = {}): PromptRecipe {
  return {
    recipe_id: overrides.recipe_id ?? "recipe-1",
    key: overrides.key ?? "video_director",
    label: overrides.label ?? "Video Director",
    description: overrides.description ?? "Creates video prompts.",
    category: overrides.category ?? "video",
    status: overrides.status ?? "active",
    system_prompt_template: overrides.system_prompt_template ?? "USER:\n{{user_prompt}}\nReturn JSON.",
    image_analysis_prompt: overrides.image_analysis_prompt ?? "",
    user_prompt_placeholder: overrides.user_prompt_placeholder ?? "{{user_prompt}}",
    output_format: overrides.output_format ?? "structured_shot_sequence",
    output_contract_json: overrides.output_contract_json ?? {},
    input_variables_json:
      overrides.input_variables_json ??
      [{ key: "user_prompt", token: "{{user_prompt}}", label: "User Prompt", enabled: true, required: true }],
    custom_fields_json: overrides.custom_fields_json ?? [],
    image_input_json:
      overrides.image_input_json ??
      { enabled: false, required: false, mode: "none", analysis_variable: "image_analysis", max_files: 0 },
    validation_warnings_json: overrides.validation_warnings_json ?? [],
    default_options_json: overrides.default_options_json ?? { temperature: 0.4 },
    rules_json: overrides.rules_json ?? { allow_external_variables: true },
    thumbnail_path: overrides.thumbnail_path ?? null,
    thumbnail_url: overrides.thumbnail_url ?? null,
    notes: overrides.notes ?? null,
    source_kind: overrides.source_kind ?? "custom",
    version: overrides.version ?? "1",
    priority: overrides.priority ?? 0,
    created_at: overrides.created_at ?? null,
    updated_at: overrides.updated_at ?? null,
  };
}

async function buildBundle({
  recipe,
  thumbnailFileName,
}: {
  recipe: PromptRecipe;
  thumbnailFileName?: string | null;
}) {
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify(
      createPortablePromptRecipeBundleManifest({
        ...recipe,
        thumbnail: thumbnailFileName ? { file_name: thumbnailFileName } : null,
      }),
      null,
      2,
    ),
  );
  if (thumbnailFileName) {
    zip.file(thumbnailFileName, Buffer.from("thumb"));
  }
  return new File([await zip.generateAsync({ type: "nodebuffer" })], "prompt-recipe.zip", {
    type: "application/zip",
  });
}

describe("prompt recipe sharing routes", () => {
  beforeEach(() => {
    vi.resetModules();
    getControlApiJson.mockReset();
    postControlApiJson.mockReset();
    mapPromptRecipeRecord.mockImplementation((recipe: Record<string, unknown>) => recipe);
    readPromptRecipeThumbnailBuffer.mockReset();
    storePromptRecipeThumbnailBuffer.mockReset();
  });

  it("exports a prompt recipe bundle with manifest and thumbnail", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: [buildRecipe({ thumbnail_path: "prompt-recipe-thumbnails/video.webp" })],
    });
    readPromptRecipeThumbnailBuffer.mockResolvedValueOnce(Buffer.from("thumbnail"));

    const { GET } = await import("@/app/api/control/prompt-recipes/export/[recipeId]/route");
    const response = await GET(new Request("http://localhost/api/control/prompt-recipes/export/recipe-1"), {
      params: Promise.resolve({ recipeId: "recipe-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("text")) as {
      kind: string;
      recipe: { thumbnail?: { file_name?: string } | null };
    };
    expect(manifest.kind).toBe("media_studio_prompt_recipe_bundle");
    expect(manifest.recipe.thumbnail?.file_name).toBe("assets/video.webp");
    expect(await zip.file("assets/video.webp")?.async("text")).toBe("thumbnail");
  });

  it("imports a prompt recipe bundle and stores thumbnail assets", async () => {
    getControlApiJson.mockResolvedValueOnce({ ok: true, data: [] });
    storePromptRecipeThumbnailBuffer.mockResolvedValueOnce({
      thumbnail_path: "prompt-recipe-thumbnails/imported.webp",
      thumbnail_url: "/api/prompt-recipe-thumbnails/imported.webp",
    });
    postControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: { ...buildRecipe(), recipe_id: "recipe-imported" },
    });

    const formData = new FormData();
    formData.set("file", await buildBundle({ recipe: buildRecipe(), thumbnailFileName: "assets/thumb.webp" }));

    const { POST } = await import("@/app/api/control/prompt-recipes/import/route");
    const response = await POST(new Request("http://localhost/api/control/prompt-recipes/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("created");
    expect(storePromptRecipeThumbnailBuffer).toHaveBeenCalled();
    expect(postControlApiJson).toHaveBeenCalledWith(
      "/prompt-recipes",
      expect.objectContaining({
        key: "video_director",
        source_kind: "imported",
        thumbnail_path: "prompt-recipe-thumbnails/imported.webp",
      }),
      "admin",
    );
  });

  it("skips exact duplicate custom recipe imports", async () => {
    getControlApiJson.mockResolvedValueOnce({ ok: true, data: [buildRecipe()] });

    const formData = new FormData();
    formData.set("file", await buildBundle({ recipe: buildRecipe() }));

    const { POST } = await import("@/app/api/control/prompt-recipes/import/route");
    const response = await POST(new Request("http://localhost/api/control/prompt-recipes/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("skipped");
    expect(postControlApiJson).not.toHaveBeenCalled();
  });

  it("imports built-in recipe conflicts as copies", async () => {
    getControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: [buildRecipe({ source_kind: "builtin" })],
    });
    postControlApiJson.mockResolvedValueOnce({
      ok: true,
      data: buildRecipe({ recipe_id: "recipe-copy", key: "video_director_copy", label: "Video Director Copy" }),
    });

    const formData = new FormData();
    formData.set("file", await buildBundle({ recipe: buildRecipe() }));

    const { POST } = await import("@/app/api/control/prompt-recipes/import/route");
    const response = await POST(new Request("http://localhost/api/control/prompt-recipes/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("copied");
    expect(postControlApiJson).toHaveBeenCalledWith(
      "/prompt-recipes",
      expect.objectContaining({
        key: "video_director_copy",
        label: "Video Director Copy",
      }),
      "admin",
    );
  });

  it("rejects invalid prompt recipe bundles", async () => {
    const formData = new FormData();
    formData.set("file", new File([Buffer.from("not-a-zip")], "invalid.zip", { type: "application/zip" }));

    const { POST } = await import("@/app/api/control/prompt-recipes/import/route");
    const response = await POST(new Request("http://localhost/api/control/prompt-recipes/import", {
      method: "POST",
      body: formData,
    }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/valid ZIP bundles/i);
  });
});
