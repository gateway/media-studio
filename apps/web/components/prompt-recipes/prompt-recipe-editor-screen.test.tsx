// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptRecipeEditorScreen } from "@/components/prompt-recipes/prompt-recipe-editor-screen";
import type { PromptRecipeDraftPayload, PromptRecipeDraftingConfig } from "@/lib/types";

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, ...rest } = props;
    return <img alt="" {...rest} />;
  },
}));

vi.mock("@/lib/graph-node-definitions-sync", () => ({
  invalidateGraphNodeDefinitions: vi.fn().mockResolvedValue({
    changedAt: "2026-05-18T00:00:00.000Z",
    reason: "prompt-recipe-created",
  }),
}));

function makeDraftingConfig(overrides: Partial<PromptRecipeDraftingConfig> = {}): PromptRecipeDraftingConfig {
  return {
    config_key: "prompt_recipe_drafting",
    enabled: true,
    provider_kind: "openrouter",
    provider_label: "Qwen Draft",
    provider_model_id: "qwen/default",
    provider_base_url_configured: false,
    provider_credential_source: "env",
    provider_supports_images: false,
    provider_status: "connected",
    provider_last_tested_at: null,
    provider_capabilities_json: {},
    temperature: 0.2,
    max_tokens: 1800,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

function makeDraftPayload(overrides: Partial<PromptRecipeDraftPayload> = {}): PromptRecipeDraftPayload {
  return {
    key: "generated_director",
    label: "Generated Director",
    description: "Creates a cinematic direction prompt.",
    category: "video",
    status: "inactive",
    system_prompt_template: "USER:\n{{user_prompt}}\nSTYLE:\n{{style_direction}}\nReturn only the final prompt.",
    image_analysis_prompt: "",
    user_prompt_placeholder: "{{user_prompt}}",
    output_format: "single_prompt",
    output_contract_json: {},
    input_variables_json: [
      { key: "user_prompt", label: "User Prompt", enabled: true, required: true },
      { key: "style_direction", label: "Style Direction", enabled: true, required: false },
    ],
    custom_fields_json: [],
    image_input_json: {
      enabled: false,
      required: false,
      mode: "none",
      analysis_variable: "image_analysis",
      max_files: 0,
    },
    default_options_json: {},
    rules_json: {
      allow_external_variables: false,
      return_only_final_output: true,
    },
    validation_warnings_json: [],
    notes: "",
    source_kind: "custom",
    priority: 0,
    ...overrides,
  };
}

function buildEditorFetchMock(overrides?: {
  draftResponse?: Record<string, unknown>;
  handle?: (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }> | null;
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const handled = await overrides?.handle?.(url);
    if (handled) {
      return handled;
    }
    if (url.includes("/api/control/prompt-recipe-drafting-config/probe")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          credential_source: "env",
          selected_model: null,
          available_models: [
            {
              id: "qwen/default",
              label: "Qwen Default",
              provider: "openrouter",
              supports_images: false,
              input_modalities: ["text"],
            },
          ],
        }),
      };
    }
    if (url.includes("/api/control/prompt-recipes/draft")) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          draft: makeDraftPayload(),
          validation_warnings: ["Template uses external variables that future graph nodes must provide: scene_id."],
          drafting_model: { provider_kind: "openrouter", provider_model_id: "qwen/director" },
          ...(overrides?.draftResponse ?? {}),
        }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

describe("PromptRecipeEditorScreen", () => {
  beforeEach(() => {
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("generates a draft and renders server review warnings", async () => {
    const fetchMock = buildEditorFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PromptRecipeEditorScreen
        recipes={[]}
        initialDraftingConfig={makeDraftingConfig()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Recipe idea"), {
      target: { value: "Create a director recipe for cinematic video prompts." },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate draft/i }));

    expect(await screen.findByText("Draft generated. Review the fields and save when ready.")).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByLabelText("Recipe Name") as HTMLInputElement).value).toBe("Generated Director");
    });
    expect(screen.getByText("Server draft review")).toBeTruthy();
    expect(screen.getByText(/future graph nodes must provide: scene_id/i)).toBeTruthy();
    expect(screen.getByText(/Last draft model:/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/prompt-recipes/draft",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("saves a new recipe and navigates back to the prompt recipes list", async () => {
    const fetchMock = buildEditorFetchMock({
      handle: async (url) =>
        url.includes("/api/control/prompt-recipes")
          ? {
          ok: true,
          json: async () => ({
            ok: true,
            recipe: {
              recipe_id: "recipe-1",
              ...makeDraftPayload({
                key: "my_recipe",
                label: "My Recipe",
                category: "image",
              }),
            },
          }),
        }
          : null,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PromptRecipeEditorScreen recipes={[]} />);

    fireEvent.change(screen.getByLabelText("Recipe Name"), {
      target: { value: "My Recipe" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save prompt recipe/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/presets?tab=prompt-recipes");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/prompt-recipes",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("keeps variables and contracts collapsed by default and allows expanding them", () => {
    render(<PromptRecipeEditorScreen recipes={[]} />);

    const draftAssistantDisclosure = screen.getByText("Generate from an idea").closest("details");
    const variablesDisclosure = screen.getByText("Reserved inputs and custom fields").closest("details");
    const contractsDisclosure = screen.getByText("Output contract and runtime defaults").closest("details");

    expect(draftAssistantDisclosure?.hasAttribute("open")).toBe(false);
    expect(variablesDisclosure?.hasAttribute("open")).toBe(false);
    expect(contractsDisclosure?.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByText("Generate from an idea"));
    fireEvent.click(screen.getByText("Reserved inputs and custom fields"));
    fireEvent.click(screen.getByText("Output contract and runtime defaults"));

    expect(draftAssistantDisclosure?.hasAttribute("open")).toBe(true);
    expect(variablesDisclosure?.hasAttribute("open")).toBe(true);
    expect(contractsDisclosure?.hasAttribute("open")).toBe(true);
  });

  it("opens the generated image picker and applies an asset as the thumbnail", async () => {
    const fetchMock = buildEditorFetchMock({
      handle: async (url) => {
        if (url.includes("/api/control/media-assets?")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              assets: [
                {
                  asset_id: "asset-1",
                  generation_kind: "image",
                  created_at: "2026-05-17T02:10:00Z",
                  model_key: "nano-banana-pro",
                  prompt_summary: "Storyboard heroine in a control room",
                  hero_thumb_url: "/api/control/files/outputs/thumb.webp",
                  hero_web_url: "/api/control/files/outputs/web.webp",
                },
              ],
              next_offset: null,
            }),
          };
        }
        if (url === "/api/control/prompt-recipe-thumbnail") {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              thumbnail_path: "prompt-recipe-thumbnails/uploaded.webp",
              thumbnail_url: "/api/prompt-recipe-thumbnails/uploaded.webp",
            }),
          };
        }
        if (url === "/api/control/prompt-recipe-thumbnail/from-asset") {
          return {
          ok: true,
          json: async () => ({
            ok: true,
            thumbnail_path: "prompt-recipe-thumbnails/storyboard.webp",
            thumbnail_url: "/api/prompt-recipe-thumbnails/storyboard.webp",
          }),
          };
        }
        return null;
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PromptRecipeEditorScreen recipes={[]} />);

    expect(screen.getByRole("button", { name: /upload thumbnail/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /browse generated images/i })).toBeTruthy();
    expect(screen.queryByText("Generated Images")).toBeNull();
    expect(screen.queryByText("Remove")).toBeNull();

    const chooseThumbnailButton = screen.getByRole("button", { name: /choose from generated images/i });
    fireEvent.drop(chooseThumbnailButton, {
      dataTransfer: {
        files: [new File(["thumbnail"], "thumbnail.webp", { type: "image/webp" })],
      },
    });

    expect(await screen.findByText("Thumbnail uploaded.")).toBeTruthy();

    fireEvent.click(chooseThumbnailButton);

    expect(await screen.findByRole("dialog", { name: /generated image thumbnails/i })).toBeTruthy();
    expect(screen.queryByText(/storyboard heroine in a control room/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /use generated image asset-1 as thumbnail/i }));

    expect(await screen.findByText("Thumbnail selected from generated images.")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/control/prompt-recipe-thumbnail/from-asset",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  it("uses a provider-backed override model picker instead of a raw model id input", async () => {
    const fetchMock = buildEditorFetchMock({
      handle: async (url) =>
        url.includes("/api/control/prompt-recipe-drafting-config/probe")
          ? {
          ok: true,
          json: async () => ({
            ok: true,
            credential_source: "codex_local_login",
            selected_model: null,
            available_models: [
              {
                id: "gpt-5.4",
                label: "GPT-5.4",
                provider: "codex_local",
                supports_images: true,
                input_modalities: ["text", "image"],
              },
            ],
          }),
        }
          : null,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PromptRecipeEditorScreen recipes={[]} initialDraftingConfig={makeDraftingConfig()} />);

    fireEvent.click(screen.getByText("Generate from an idea"));
    fireEvent.change(screen.getByLabelText("Override provider"), { target: { value: "codex_local" } });

    await waitFor(() => {
      expect(screen.getByLabelText("Override model")).toBeTruthy();
    });
    expect(screen.queryByLabelText("Override model id")).toBeNull();
  });

  it("shows a settings link instead of drafting controls when recipe drafts are off", () => {
    render(
      <PromptRecipeEditorScreen
        recipes={[]}
        initialDraftingConfig={makeDraftingConfig({ enabled: false })}
      />,
    );

    fireEvent.click(screen.getByText("Generate from an idea"));

    expect(screen.getByText(/Recipe drafts are turned off in AI Settings/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open AI Settings" }).getAttribute("href")).toBe("/settings/llms");
    expect(screen.queryByLabelText("Recipe idea")).toBeNull();
  });
});
