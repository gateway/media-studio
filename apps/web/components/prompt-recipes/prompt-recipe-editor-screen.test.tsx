// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptRecipeEditorScreen } from "@/components/prompt-recipes/prompt-recipe-editor-screen";
import { writeAssistantReviewDraft } from "@/lib/assistant-review-drafts";
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
    vi.stubGlobal("localStorage", window.sessionStorage);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("loads an assistant Prompt Recipe draft for review without saving it", async () => {
    vi.stubGlobal("fetch", buildEditorFetchMock());
    const assistantDraftId = writeAssistantReviewDraft({
      kind: "prompt_recipe",
      draft: makeDraftPayload({
        key: "assistant_character_director",
        label: "Assistant Character Director",
        description: "Drafted from the Media Assistant.",
        system_prompt_template: "Create a character prompt for {{user_prompt}}.",
      }),
      validationWarnings: ["Review the assistant draft before saving."],
      mediaSummary: [],
    });

    render(
      <PromptRecipeEditorScreen
        recipes={[]}
        initialDraftingConfig={makeDraftingConfig()}
        initialAssistantDraftId={assistantDraftId}
      />,
    );

    expect(await screen.findByText("Assistant Prompt Recipe draft loaded. Review the fields and save when ready.")).toBeTruthy();
    expect(screen.getByDisplayValue("Assistant Character Director")).toBeTruthy();
    expect(screen.getByDisplayValue("assistant_character_director")).toBeTruthy();
    expect(screen.getByDisplayValue("Create a character prompt for {{user_prompt}}.")).toBeTruthy();
    expect(screen.getByText("Review the assistant draft before saving.")).toBeTruthy();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("loads an assistant Prompt Recipe draft from a persisted review message", async () => {
    const assistantDraft = makeDraftPayload({
      key: "persisted_character_director",
      label: "Persisted Character Director",
      system_prompt_template: "Describe {{subject}} as a reusable character prompt.",
    });
    const fetchMock = buildEditorFetchMock({
      handle: async (url) => {
        if (url.includes("/api/control/media/assistant/sessions/session-1")) {
          return {
            ok: true,
            json: async () => ({
              messages: [
                {
                  assistant_message_id: "message-1",
                  content_json: {
                    review_draft: {
                      kind: "prompt_recipe",
                      draft: assistantDraft,
                      validation_warnings: ["Review persisted draft before saving."],
                      media_summary: [],
                    },
                  },
                },
              ],
            }),
          };
        }
        return null;
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PromptRecipeEditorScreen
        recipes={[]}
        initialDraftingConfig={makeDraftingConfig()}
        initialAssistantSessionId="session-1"
        initialAssistantMessageId="message-1"
      />,
    );

    expect(await screen.findByText("Assistant Prompt Recipe draft loaded. Review the fields and save when ready.")).toBeTruthy();
    expect(screen.getByDisplayValue("Persisted Character Director")).toBeTruthy();
    expect(screen.getByDisplayValue("persisted_character_director")).toBeTruthy();
    expect(screen.getByDisplayValue("Describe {{subject}} as a reusable character prompt.")).toBeTruthy();
    expect(screen.getByText("Review persisted draft before saving.")).toBeTruthy();
  });

  it("asks for a fresh Prompt Recipe draft when its saved assistant session is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ detail: "Assistant session not found." }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StrictMode><PromptRecipeEditorScreen recipes={[]} initialDraftingConfig={makeDraftingConfig()} initialAssistantSessionId="missing-session" initialAssistantMessageId="message-1" /></StrictMode>);
    expect(await screen.findByText("The assistant Prompt Recipe draft is no longer available. Ask the assistant to create it again.")).toBeTruthy();
    expect(screen.queryByText(/Check your connection and reload this page/)).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media/assistant/sessions/missing-session", { cache: "no-store" });
  });

  it("offers reload recovery when the assistant draft could not be reached", async () => {
    vi.stubGlobal("fetch", buildEditorFetchMock({ handle: async (url) => {
      if (url.includes("/api/control/media/assistant/sessions/")) throw new TypeError("Failed to fetch");
      return null;
    } }));
    render(<PromptRecipeEditorScreen recipes={[]} initialAssistantSessionId="session-1" initialAssistantMessageId="message-1" />);
    expect(await screen.findByText("Couldn’t load your assistant Prompt Recipe draft. Check your connection and reload this page.")).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
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

  it.each([
    ["Prompt recipe drafting provider returned invalid JSON.", "Couldn’t prepare a usable Prompt Recipe draft. Try again, or check the recipe draft model in AI Models."],
    ["Drafting model returned an invalid recipe draft: System prompt template is required.", "Couldn’t prepare a usable Prompt Recipe draft. Try again, or check the recipe draft model in AI Models."],
    ["Control API returned 503 for /prompt-recipes/draft.", "Couldn’t prepare a usable Prompt Recipe draft. Try again, or check the recipe draft model in AI Models."],
    ["The Control API is unavailable right now.", "Couldn’t prepare your Prompt Recipe draft. Check your connection and try again."],
    ["openrouter recipe draft failed with 503.", "Couldn’t prepare a usable Prompt Recipe draft. Try again, or check the recipe draft model in AI Models."],
    ["local_openai_compatible recipe draft failed with 502.", "Couldn’t prepare a usable Prompt Recipe draft. Try again, or check the recipe draft model in AI Models."],
    ["codex_local recipe draft failed with 503.", "Couldn’t prepare a usable Prompt Recipe draft. Try again, or check the recipe draft model in AI Models."],
    ["Save a recipe draft model in AI Models before drafting.", "Save a recipe draft model in AI Models before drafting."],
  ])("preserves draft failure guidance and optional diagnostics: %s", async (error, expected) => {
    vi.stubGlobal("fetch", buildEditorFetchMock({ draftResponse: { ok: false, error, draft: null } }));
    render(<PromptRecipeEditorScreen recipes={[]} initialDraftingConfig={makeDraftingConfig()} />);
    fireEvent.change(screen.getByLabelText("Recipe idea"), { target: { value: "Preserve warm amber light." } });
    fireEvent.click(screen.getByRole("button", { name: /generate draft/i }));
    expect(await screen.findByText(expected)).toBeTruthy();
    if (error !== expected) {
      const details = screen.getByText("Draft failure details").closest("details");
      expect(details?.hasAttribute("open")).toBe(false);
      expect(details?.textContent).toContain(error);
    } else {
      expect(screen.queryByText("Draft failure details")).toBeNull();
    }
    expect(screen.getByDisplayValue("Preserve warm amber light.")).toBeTruthy();
    expect(screen.queryByText("Draft generated. Review the fields and save when ready.")).toBeNull();
  });

  it("keeps the idea and draft after a drafting connection failure and recovers on retry", async () => {
    let failed = false;
    const fetchMock = buildEditorFetchMock({ handle: async (url) => {
      if (url === "/api/control/prompt-recipes/draft" && !failed) {
        failed = true;
        throw new TypeError("Failed to fetch");
      }
      return null;
    } });
    vi.stubGlobal("fetch", fetchMock);
    render(<PromptRecipeEditorScreen recipes={[]} initialDraftingConfig={makeDraftingConfig()} />);
    fireEvent.change(screen.getByLabelText("Recipe Name"), { target: { value: "Keep this draft" } });
    fireEvent.change(screen.getByLabelText("Recipe idea"), { target: { value: "Keep warm amber light and 4:3 framing." } });
    fireEvent.click(screen.getByRole("button", { name: /generate draft/i }));
    expect(await screen.findByText("Couldn’t prepare your Prompt Recipe draft. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByDisplayValue("Keep this draft")).toBeTruthy();
    expect(screen.getByDisplayValue("Keep warm amber light and 4:3 framing.")).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /generate draft/i }));
    expect(await screen.findByText("Draft generated. Review the fields and save when ready.")).toBeTruthy();
    expect(screen.getByDisplayValue("Generated Director")).toBeTruthy();
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

  it("keeps an unsaved recipe after an uncertain save and recovers without claiming completion", async () => {
    let failed = false;
    vi.stubGlobal("fetch", buildEditorFetchMock({ handle: async (url) => {
      if (url === "/api/control/prompt-recipes") {
        if (!failed) { failed = true; throw new TypeError("Failed to fetch"); }
        return { ok: true, json: async () => ({ ok: true, recipe: { recipe_id: "saved-recipe", ...makeDraftPayload() } }) };
      }
      return null;
    } }));
    const id = writeAssistantReviewDraft({ kind: "prompt_recipe", draft: makeDraftPayload(), validationWarnings: [], mediaSummary: [] });
    render(<PromptRecipeEditorScreen recipes={[]} initialAssistantDraftId={id} />);
    await screen.findByText("Assistant Prompt Recipe draft loaded. Review the fields and save when ready.");
    fireEvent.click(screen.getByRole("button", { name: /save prompt recipe/i }));
    expect(await screen.findByText("Couldn’t confirm whether your Prompt Recipe was saved. Check the recipe list before trying again.")).toBeTruthy();
    expect(screen.getByDisplayValue("Generated Director")).toBeTruthy();
    expect(screen.getByDisplayValue(/USER:/)).toBeTruthy();
    expect(screen.queryByText("Prompt recipe created.")).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /save prompt recipe/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Prompt recipe created.")).toBeTruthy();
  });

  it("reports a confirmed save truthfully when local Graph refresh fails", async () => {
    vi.stubGlobal("fetch", buildEditorFetchMock({ handle: async (url) => url === "/api/control/prompt-recipes" ? {
      ok: true, json: async () => ({ ok: true, recipe: { recipe_id: "saved-recipe", ...makeDraftPayload() } }),
    } : null }));
    render(<PromptRecipeEditorScreen recipes={[]} />);
    fireEvent.change(screen.getByLabelText("Recipe Name"), { target: { value: "Generated Director" } });
    vi.stubGlobal("localStorage", { setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); } });
    fireEvent.click(screen.getByRole("button", { name: /save prompt recipe/i }));
    expect(await screen.findByText("Prompt Recipe saved. Reload the page to refresh the Graph node list.")).toBeTruthy();
    expect(screen.queryByText(/Couldn’t confirm/)).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("keeps advanced graph inputs and contracts collapsed by default and allows expanding them", () => {
    render(<PromptRecipeEditorScreen recipes={[]} />);

    const draftAssistantDisclosure = screen.getByText("Generate from an idea").closest("details");
    const variablesDisclosure = screen.getByText("Advanced graph inputs").closest("details");
    const contractsDisclosure = screen.getByText("Output contract and runtime defaults").closest("details");

    expect(draftAssistantDisclosure?.hasAttribute("open")).toBe(false);
    expect(variablesDisclosure?.hasAttribute("open")).toBe(false);
    expect(contractsDisclosure?.hasAttribute("open")).toBe(false);

    fireEvent.click(screen.getByText("Generate from an idea"));
    fireEvent.click(screen.getByText("Advanced graph inputs"));
    fireEvent.click(screen.getByText("Output contract and runtime defaults"));

    expect(draftAssistantDisclosure?.hasAttribute("open")).toBe(true);
    expect(variablesDisclosure?.hasAttribute("open")).toBe(true);
    expect(contractsDisclosure?.hasAttribute("open")).toBe(true);
  });

  it("opens the generated image picker and applies an asset as the thumbnail", async () => {
    let releaseImages!: () => void;
    const imagesReady = new Promise<void>((resolve) => {
      releaseImages = resolve;
    });
    const fetchMock = buildEditorFetchMock({
      handle: async (url) => {
        if (url.includes("/api/control/media-assets?")) {
          await imagesReady;
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

    expect(screen.queryByRole("button", { name: /use generated image asset-1 as thumbnail/i })).toBeNull();
    releaseImages();
    fireEvent.click(await screen.findByRole("button", { name: /use generated image asset-1 as thumbnail/i }));

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

    expect(screen.getByText(/Recipe drafts are turned off in AI Models/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open AI Models" }).getAttribute("href")).toBe("/settings/llms");
    expect(screen.queryByLabelText("Recipe idea")).toBeNull();
  });
});
