// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MediaPresetEditorScreen } from "@/components/media-preset-editor-screen";
import { PromptRecipeEditorScreen } from "@/components/prompt-recipes/prompt-recipe-editor-screen";
import { useMediaPresetThumbnailPicker } from "@/components/media-presets/editor/use-media-preset-thumbnail-picker";
import { writeAssistantReviewDraft } from "@/lib/assistant-review-drafts";
import type { MediaModelSummary, MediaPreset, PromptRecipeDraftingConfig } from "@/lib/types";
import { useCreativeAssistant } from "./hooks/use-creative-assistant";
import { CreativeAssistantPanel } from "./creative-assistant-panel";
import { assistantTestWorkflow, assistantTestSession, assistantIdleProgress } from "./creative-assistant-test-fixtures";
import type { AssistantAttachment } from "./types";
import { __resetGraphStartupReadsForTests } from "./utils/graph-startup-reads";

afterEach(() => { cleanup(); __resetGraphStartupReadsForTests(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const models: MediaModelSummary[] = [{
  key: "nano-banana-2", label: "Nano Banana 2", provider_model: "nano-banana-2",
  task_modes: ["text_to_image"], image_inputs: { required_min: 0, required_max: 0 },
  input_patterns: ["prompt_only"], generation_kind: "image",
}];
const preset = {
  preset_id: "existing-preset", key: "review_portrait", label: "Review portrait",
  description: "Portrait", status: "active", model_key: "nano-banana-2", source_kind: "custom",
  base_builtin_key: null, applies_to_models: ["nano-banana-2"], applies_to_task_modes: [],
  applies_to_input_patterns: [], prompt_template: "Create {{subject}}",
  input_schema_json: [{ key: "subject", label: "Subject", required: true }], input_slots_json: [],
  thumbnail_path: null, thumbnail_url: null, notes: null,
} as MediaPreset;
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
const session = { ...assistantTestSession, messages: [] };
const ok = (body: unknown) => Promise.resolve(Response.json(body));
const assistantProps = {
  workspaceKey: "A", workflowId: "workflow-1", workflowName: "Graph", workflow: assistantTestWorkflow,
  initialAssistantSessionId: "session-1", enabled: true, importImageFile: vi.fn(), onApplyWorkflow: vi.fn(),
};

it.each(["preset", "recipe"])("retains the %s draft and offers list recovery for a JSON502 save", async (kind) => {
  vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/prompt-recipes") || url.includes("/media-presets")
    ? Promise.resolve(Response.json({ ok: false, error: "The Control API is unavailable right now." }, { status: 502 }))
    : ok({ ok: true, available_models: [] })));
  if (kind === "preset") {
    const id = writeAssistantReviewDraft({ kind: "media_preset", draft: { ...preset, preset_id: undefined }, validationWarnings: [], mediaSummary: [] });
    render(<AppRouterContext.Provider value={router}><MediaPresetEditorScreen models={models} presets={[]} initialAssistantDraftId={id}/></AppRouterContext.Provider>);
    await screen.findByText("Assistant Media Preset draft loaded. Review the fields and save when ready.");
  } else {
    render(<AppRouterContext.Provider value={router}><PromptRecipeEditorScreen recipes={[]}/></AppRouterContext.Provider>);
    fireEvent.change(screen.getByLabelText("Recipe Name"), { target: { value: "Review recipe" } });
  }
  fireEvent.click(screen.getByRole("button", { name: kind === "preset" ? "Create preset" : "Save Prompt Recipe", exact: true }));
  expect(await screen.findByText(/Couldn’t confirm whether.*saved/)).toBeTruthy();
  expect(screen.queryByText("The Control API is unavailable right now.")).toBeNull();
  expect(screen.getByDisplayValue(kind === "preset" ? "Review portrait" : "Review recipe")).toBeTruthy();
});

it("reports unknown readiness on disconnect and retries only the health read", async () => {
  let healthReads = 0;
  const fetcher = vi.fn((url: string, _init?: RequestInit) => url.endsWith("/health")
    ? ++healthReads === 1 ? Promise.reject(new TypeError("Failed to fetch"))
      : ok({ codex_local_ready: true, codex_local_command_available: true, codex_local_login_configured: true })
    : ok(url.endsWith("/progress") ? assistantIdleProgress : session));
  vi.stubGlobal("fetch", fetcher);
  render(<CreativeAssistantPanel {...assistantProps} open references={[]} onClose={vi.fn()}/>);
  expect(await screen.findByText(/Couldn’t check Codex Local readiness/)).toBeTruthy();
  expect(screen.queryByText("Codex Local needs setup for native chat.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry readiness check" }));
  await waitFor(() => expect(screen.queryByText(/Couldn’t check Codex Local readiness/)).toBeNull());
  expect(healthReads).toBe(2);
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

function attachmentBoundary({ offline = false }: { offline?: boolean } = {}) {
  const stored: AssistantAttachment[] = [];
  let posts = 0;
  let failReads = false;
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/attachments") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { reference_id: string };
      posts++;
      stored.push({ assistant_attachment_id: "saved-attachment", reference_id: body.reference_id, kind: "image" } as AssistantAttachment);
      failReads = offline;
      return Promise.reject(new TypeError("Lost attachment response"));
    }
    if (url.endsWith("/session-1") && failReads) return Promise.reject(new TypeError("Session read offline"));
    return ok(url.endsWith("/progress") ? assistantIdleProgress
      : url.endsWith("/session-1") ? { ...session, attachments: [...stored] }
        : { codex_local_ready: true, codex_local_command_available: true, codex_local_login_configured: true });
  });
  return { fetcher, stored, posts: () => posts, reconnect: () => { failReads = false; } };
}
const reference = { reference_id: "existing-ref", kind: "image", original_filename: "reference.png" } as Parameters<ReturnType<typeof useCreativeAssistant>["attachReference"]>[0];

it("reconciles a committed attachment after a lost reply and prevents duplicate replay", async () => {
  const boundary = attachmentBoundary();
  vi.stubGlobal("fetch", boundary.fetcher);
  const { result } = renderHook(() => useCreativeAssistant(assistantProps));
  await waitFor(() => expect(result.current.session?.assistant_session_id).toBe("session-1"));
  await act(async () => { await result.current.attachReference(reference); });
  expect(result.current.session?.attachments).toHaveLength(1);
  await act(async () => { await result.current.attachReference(reference); });
  expect(boundary.posts()).toBe(1);
  expect(result.current.referenceRecovery).toBeNull();
  expect(result.current.busy).toBe(false);
});

it("blocks attachment replay while offline, then retries a session read without another POST", async () => {
  const boundary = attachmentBoundary({ offline: true });
  vi.stubGlobal("fetch", boundary.fetcher);
  const { result } = renderHook(() => useCreativeAssistant(assistantProps));
  await waitFor(() => expect(result.current.session?.assistant_session_id).toBe("session-1"));
  await act(async () => { await result.current.attachReference(reference); });
  expect(result.current.referenceRecovery).toBeTruthy();
  expect(result.current.busy).toBe(true);
  await act(async () => { await result.current.attachReference(reference); });
  expect(boundary.posts()).toBe(1);
  boundary.reconnect();
  await act(async () => { await result.current.retryReferenceRecovery(); });
  expect(result.current.session?.attachments).toHaveLength(1);
  expect(result.current.referenceRecovery).toBeNull();
  expect(boundary.posts()).toBe(1);
});

it.each(["transport", "non-json"])("releases thumbnail upload after %s failure and allows a successful retry", async (kind) => {
  const notice = vi.fn(), change = vi.fn();
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(() => ++calls === 1
    ? kind === "transport" ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(new Response("Internal Server Error", { status: 500 }))
    : ok({ ok: true, thumbnail_path: "thumbnail.png", thumbnail_url: "/thumbnail.png" })));
  const { result } = renderHook(() => useMediaPresetThumbnailPicker({ presetLabel: "Review preset", showNotice: notice, onThumbnailChange: change }));
  const file = new File(["image"], "thumbnail.png", { type: "image/png" });
  await act(async () => { await result.current.uploadThumbnail(file); });
  expect(result.current.isUploadingThumbnail).toBe(false);
  expect(notice).toHaveBeenCalledWith("danger", "Couldn’t upload your thumbnail. Check your connection and try again.");
  expect(change).not.toHaveBeenCalled();
  await act(async () => { await result.current.uploadThumbnail(file); });
  expect(change).toHaveBeenCalledWith({ thumbnailPath: "thumbnail.png", thumbnailUrl: "/thumbnail.png" });
});

it.each(["preset", "recipe"])("shows a truthful thumbnail error and read retry in the actual %s editor modal", async (kind) => {
  let imageReads = 0;
  const fetcher = vi.fn((url: string) => url.includes("/media-assets")
    ? ++imageReads === 1 ? Promise.reject(new TypeError("Failed to fetch")) : ok({ ok: true, items: [], next_offset: null })
    : ok({ ok: true, available_models: [] }));
  vi.stubGlobal("fetch", fetcher);
  render(<AppRouterContext.Provider value={router}>{kind === "preset"
    ? <MediaPresetEditorScreen models={models} presets={[]}/>
    : <PromptRecipeEditorScreen recipes={[]}/>}</AppRouterContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Browse generated images", exact: true }));
  const dialog = await screen.findByRole("dialog", { name: "Generated image thumbnails" });
  expect(await within(dialog).findByText("Couldn’t load thumbnail images. Retry loading the image list.")).toBeTruthy();
  expect(within(dialog).queryByText("No generated images are available yet.")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Retry loading images" }));
  await waitFor(() => expect(within(dialog).queryByText("Couldn’t load thumbnail images. Retry loading the image list.")).toBeNull());
  expect(imageReads).toBe(2);
});

it("finalizes an uncertain archive and preserves editable preset fields", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Archive disconnect")));
  render(<AppRouterContext.Provider value={router}><MediaPresetEditorScreen models={models} presets={[preset]} initialPresetId="existing-preset"/></AppRouterContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Archive", exact: true }));
  expect(await screen.findByText("Couldn’t confirm whether your preset was archived. Check the preset list before trying again.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save preset", exact: true }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByDisplayValue("Review portrait")).toBeTruthy();
});

it("keeps a confirmed archive after catalog refresh failure and prevents another DELETE", async () => {
  vi.stubGlobal("localStorage", { setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); } });
  const fetcher = vi.fn((url: string, init?: RequestInit) => init?.method === "DELETE"
    ? ok({ ok: true }) : Promise.reject(new TypeError("Refresh offline")));
  vi.stubGlobal("fetch", fetcher);
  render(<AppRouterContext.Provider value={router}><MediaPresetEditorScreen models={models} presets={[preset]} initialPresetId="existing-preset"/></AppRouterContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Archive", exact: true }));
  expect(await screen.findByText("Preset archived. Reload the page to refresh the Graph node list.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Archive", exact: true }));
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
  expect((screen.getByRole("button", { name: "Archive", exact: true }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(["Codex Local App Server returned invalid JSON.", "Codex Local returned an empty response."])("keeps known recipe provider failure optional and retains the idea: %s", async (error) => {
  vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/draft")
    ? Promise.resolve(Response.json({ ok: false, error, draft: null }, { status: 502 }))
    : ok({ ok: true, available_models: [] })));
  render(<AppRouterContext.Provider value={router}><PromptRecipeEditorScreen recipes={[]} initialDraftingConfig={{
    enabled: true, provider_kind: "codex_local", provider_model_id: "configured", provider_label: "Configured",
  } as PromptRecipeDraftingConfig}/></AppRouterContext.Provider>);
  fireEvent.change(screen.getByLabelText("Recipe idea"), { target: { value: "Preserve warm amber light." } });
  fireEvent.click(screen.getByRole("button", { name: /generate draft/i }));
  const raw = await screen.findByText(error);
  expect(raw.closest("details")).toBeTruthy();
  expect(screen.getByText("Couldn’t prepare a usable Prompt Recipe draft. Try again, or check the recipe draft model in AI Models.")).toBeTruthy();
  expect(screen.getByDisplayValue("Preserve warm amber light.")).toBeTruthy();
});


it("ignores a late attachment reconciliation after leaving and returning to its workspace", async () => {
  let reconcile = false;
  let release!: (response: Response) => void;
  const pendingRead = new Promise<Response>(resolve => { release = resolve; });
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") { reconcile = true; return Promise.reject(new TypeError("Lost reply")); }
    if (url.endsWith("/session-1") && reconcile) { reconcile = false; return pendingRead; }
    return ok(url.endsWith("/progress") ? assistantIdleProgress : url.endsWith("/session-1") ? session
      : url.endsWith("/session-2") ? { ...session, assistant_session_id: "session-2", owner_id: "workflow-2" }
      : { codex_local_ready: true, codex_local_command_available: true, codex_local_login_configured: true });
  }));
  const { result, rerender } = renderHook(({ workspaceKey }) => useCreativeAssistant({ ...assistantProps, workspaceKey, workflowId: workspaceKey === "A" ? "workflow-1" : "workflow-2", initialAssistantSessionId: workspaceKey === "A" ? "session-1" : "session-2" }), { initialProps: { workspaceKey: "A" } });
  await waitFor(() => expect(result.current.session?.assistant_session_id).toBe("session-1"));
  let attach!: Promise<unknown>;
  act(() => { attach = result.current.attachReference(reference); });
  await waitFor(() => expect(result.current.referenceRecovery).toBeTruthy());
  rerender({ workspaceKey: "B" });
  await waitFor(() => expect(result.current.session?.assistant_session_id).toBe("session-2"));
  rerender({ workspaceKey: "A" });
  await waitFor(() => expect(result.current.session?.assistant_session_id).toBe("session-1"));
  await act(async () => { release(Response.json({ ...session, attachments: [{ assistant_attachment_id: "late", reference_id: "existing-ref", kind: "image" }] })); await attach; });
  expect(result.current.session?.attachments).toEqual([]);
  expect(result.current.referenceRecovery).toBeNull();
  expect(result.current.busy).toBe(false);
});
