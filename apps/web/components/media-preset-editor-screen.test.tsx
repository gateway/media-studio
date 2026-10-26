// @vitest-environment jsdom

import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaPresetEditorScreen } from "@/components/media-preset-editor-screen";
import { writeAssistantReviewDraft } from "@/lib/assistant-review-drafts";
import type { MediaModelSummary, MediaPreset } from "@/lib/types";

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

const models: MediaModelSummary[] = [
  {
    key: "nano-banana-2",
    label: "Nano Banana 2",
    provider_model: "nano-banana-2",
    task_modes: ["text_to_image"],
    image_inputs: { required_min: 0, required_max: 0 },
    input_patterns: ["prompt_only"],
    generation_kind: "image",
  },
];

const presets: MediaPreset[] = [
  {
    preset_id: "preset-1",
    key: "test_preset",
    label: "Test Preset",
    description: "A test preset",
    status: "active",
    model_key: "nano-banana-2",
    source_kind: "custom",
    base_builtin_key: null,
    applies_to_models: ["nano-banana-2"],
    applies_to_task_modes: [],
    applies_to_input_patterns: [],
    prompt_template: "Create {{subject}}",
    input_schema_json: [{ key: "subject", label: "Subject", required: true }],
    input_slots_json: [],
    thumbnail_path: null,
    thumbnail_url: null,
    notes: null,
  },
];

describe("MediaPresetEditorScreen", () => {
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

  it("loads an assistant Media Preset draft for review without saving it", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("The assistant review draft should not save on load.");
    });
    vi.stubGlobal("fetch", fetchMock);
    const assistantDraftId = writeAssistantReviewDraft({
      kind: "media_preset",
      draft: {
        key: "assistant_editorial_portrait",
        label: "Assistant Editorial Portrait",
        description: "Drafted from the Media Assistant.",
        status: "active",
        source_kind: "custom",
        applies_to_models: ["nano-banana-2"],
        prompt_template: "Create an editorial portrait of {{subject}}.",
        input_schema_json: [{ key: "subject", label: "Subject", placeholder: "Woman in a red jacket", default_value: "", required: true }],
        input_slots_json: [],
        notes: "Review this assistant draft before saving.",
      },
      validationWarnings: ["Choose a subject image before testing this preset."],
      mediaSummary: [],
    });

    render(
      <MediaPresetEditorScreen
        models={models}
        presets={[]}
        initialAssistantDraftId={assistantDraftId}
      />,
    );

    expect(await screen.findByText("Assistant Media Preset draft loaded. Review the fields and save when ready.")).toBeTruthy();
    expect(screen.getByDisplayValue("Assistant Editorial Portrait")).toBeTruthy();
    expect(screen.getByDisplayValue("Create an editorial portrait of {{subject}}.")).toBeTruthy();
    expect(screen.getByDisplayValue("Subject")).toBeTruthy();
    expect(screen.getByText("Choose a subject image before testing this preset.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("saves a fixed-prompt assistant draft with zero text fields and reopens it unchanged", async () => {
    const fixed: MediaPreset = { ...presets[0], preset_id: "fixed-1", key: "fixed_teapot", label: "Fixed Teapot",
      prompt_template: "A red teapot in soft window light.", input_schema_json: [], input_slots_json: [] };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, preset: fixed }));
    vi.stubGlobal("fetch", fetchMock);
    const id = writeAssistantReviewDraft({ kind: "media_preset", draft: { ...fixed, preset_id: undefined }, validationWarnings: [], mediaSummary: [] });
    const view = render(<MediaPresetEditorScreen models={models} presets={[]} initialAssistantDraftId={id} />);
    await screen.findByText("Assistant Media Preset draft loaded. Review the fields and save when ready.");
    expect(screen.getByText("No text fields configured yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create preset", exact: true }));
    await screen.findByText("Preset created.");
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({ prompt_template: fixed.prompt_template, input_schema_json: [], input_slots_json: [] });
    view.unmount();
    render(<MediaPresetEditorScreen models={models} presets={[fixed]} initialPresetId="fixed-1" />);
    expect(screen.getByDisplayValue(fixed.prompt_template!)).toBeTruthy();
    expect(screen.getByText("No text fields configured yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save preset", exact: true })).toBeTruthy();
  });

  it("loads an assistant Media Preset draft from a persisted review message", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/control/media/assistant/sessions/session-1")) {
        return {
          ok: true,
          json: async () => ({
            messages: [
              {
                assistant_message_id: "message-1",
                content_json: {
                  review_draft: {
                    kind: "media_preset",
                    draft: {
                      key: "persisted_editorial_portrait",
                      label: "Persisted Editorial Portrait",
                      description: "Drafted from the Media Assistant.",
                      status: "active",
                      source_kind: "custom",
                      applies_to_models: ["nano-banana-2"],
                      prompt_template: "Create a cinematic portrait of {{subject}}.",
                      input_schema_json: [
                        { key: "subject", label: "Subject", placeholder: "Woman in a red jacket", default_value: "", required: true },
                      ],
                      input_slots_json: [],
                    },
                    validation_warnings: [],
                    media_summary: [],
                  },
                },
              },
            ],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MediaPresetEditorScreen
        models={models}
        presets={[]}
        initialAssistantSessionId="session-1"
        initialAssistantMessageId="message-1"
      />,
    );

    expect(await screen.findByText("Assistant Media Preset draft loaded. Review the fields and save when ready.")).toBeTruthy();
    expect(screen.getByDisplayValue("Persisted Editorial Portrait")).toBeTruthy();
    expect(screen.getByDisplayValue("Create a cinematic portrait of {{subject}}.")).toBeTruthy();
    expect(screen.getByDisplayValue("Subject")).toBeTruthy();
  });

  it("asks for a fresh Media Preset draft when its saved assistant session is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ detail: "Assistant session not found." }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StrictMode><MediaPresetEditorScreen models={models} presets={[]} initialAssistantSessionId="missing-session" initialAssistantMessageId="message-1" /></StrictMode>);
    expect(await screen.findByText("The assistant Media Preset draft is no longer available. Ask the assistant to create it again.")).toBeTruthy();
    expect(screen.queryByText(/Check your connection and reload this page/)).toBeNull();
    expect(pushMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/control/media/assistant/sessions/missing-session", { cache: "no-store" });
  });

  it("offers reload recovery when the assistant draft could not be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<MediaPresetEditorScreen models={models} presets={[]} initialAssistantSessionId="session-1" initialAssistantMessageId="message-1" />);
    expect(await screen.findByText("Couldn’t load your assistant Media Preset draft. Check your connection and reload this page.")).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("reports an uncertain save, retains the draft and allows recovery after checking saved presets", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ ok: true, preset: { ...presets[0], preset_id: "new-preset", label: "New review preset" } }));
    vi.stubGlobal("fetch", fetchMock);
    const id = writeAssistantReviewDraft({ kind: "media_preset", draft: { ...presets[0], preset_id: undefined, label: "New review preset" }, validationWarnings: [], mediaSummary: [] });
    render(<MediaPresetEditorScreen models={models} presets={[]} initialAssistantDraftId={id} />);
    await screen.findByText("Assistant Media Preset draft loaded. Review the fields and save when ready.");
    fireEvent.click(screen.getByRole("button", { name: "Create preset", exact: true }));
    expect(await screen.findByText("Couldn’t confirm whether your Media Preset was saved. Check the preset list before trying again.")).toBeTruthy();
    expect(screen.getByDisplayValue("New review preset")).toBeTruthy();
    expect(screen.getByDisplayValue("Create {{subject}}")).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Create preset", exact: true }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Create preset", exact: true }));
    expect(await screen.findByText("Preset created.")).toBeTruthy();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it("uses the shared thumbnail field for upload, generated image selection, and removal", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/control/media-preset-thumbnail") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            thumbnail_path: "preset-thumbnails/uploaded.webp",
            thumbnail_url: "/api/preset-thumbnails/uploaded.webp",
          }),
        };
      }
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
                prompt_summary: "Generated preset thumbnail",
                hero_thumb_url: "/api/control/files/outputs/thumb.webp",
                hero_web_url: "/api/control/files/outputs/web.webp",
              },
            ],
            next_offset: null,
          }),
        };
      }
      if (url === "/api/control/media-preset-thumbnail/from-asset") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            thumbnail_path: "preset-thumbnails/generated.webp",
            thumbnail_url: "/api/preset-thumbnails/generated.webp",
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MediaPresetEditorScreen models={models} presets={presets} initialPresetId="preset-1" />);

    expect(screen.getByRole("button", { name: /upload thumbnail/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /browse generated images/i })).toBeTruthy();
    expect(screen.queryByText(/drag in a thumbnail image/i)).toBeNull();

    const chooseThumbnailButton = screen.getByRole("button", { name: /choose from generated images/i });
    fireEvent.drop(chooseThumbnailButton, {
      dataTransfer: {
        files: [new File(["thumbnail"], "thumbnail.webp", { type: "image/webp" })],
      },
    });

    expect(await screen.findByText("Thumbnail uploaded.")).toBeTruthy();

    fireEvent.click(chooseThumbnailButton);

    expect(await screen.findByRole("dialog", { name: /generated image thumbnails/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /use generated image asset-1 as preset thumbnail/i }));

    expect(await screen.findByText("Thumbnail selected from generated images.")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/control/media-preset-thumbnail/from-asset",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });
});
