// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphStudioDialogs } from "./graph-studio-dialogs";

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function mockImageSelectorFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const parsedUrl = new URL(url, "http://localhost");
    const generationKind =
      parsedUrl.searchParams.get("generation_kind") ?? "image";
    const referenceKind = parsedUrl.searchParams.get("kind") ?? "image";
    if (url.includes("/api/control/media/projects")) {
      return jsonResponse({
        ok: true,
        projects: [
          {
            project_id: "project-sadi",
            name: "Sadi",
            status: "active",
            hidden_from_global_gallery: true,
          },
        ],
      });
    }
    if (url.includes("/api/control/media-assets")) {
      if (generationKind === "video") {
        return jsonResponse({
          ok: true,
          assets: [
            {
              asset_id: "asset-dialog-video",
              generation_kind: "video",
              created_at: "2026-06-22T12:00:00Z",
              prompt_summary: "Motion test clip",
              hero_poster_url: "/generated-dialog-video-poster.webp",
              hero_web_url: "/generated-dialog-video.mp4",
              width: 720,
              height: 1280,
              duration_seconds: 5,
            },
          ],
          next_offset: null,
        });
      }
      if (generationKind === "audio") {
        return jsonResponse({
          ok: true,
          assets: [
            {
              asset_id: "asset-dialog-audio",
              generation_kind: "audio",
              created_at: "2026-06-22T12:00:00Z",
              prompt_summary: "Dialog line",
              hero_original_url: "/generated-dialog-audio.wav",
              duration_seconds: 2,
            },
          ],
          next_offset: null,
        });
      }
      return jsonResponse({
        ok: true,
        assets: [
          {
            asset_id: "asset-dialog-1",
            generation_kind: "image",
            created_at: "2026-06-22T12:00:00Z",
            prompt_summary: "Sadie neon skyline",
            hero_thumb_url: "/generated-dialog-thumb.webp",
            hero_web_url: "/generated-dialog.webp",
            width: 1344,
            height: 768,
          },
        ],
        next_offset: null,
      });
    }
    if (url.includes("/api/control/reference-media")) {
      if (referenceKind === "audio") {
        return jsonResponse({
          ok: true,
          items: [
            {
              reference_id: "reference-dialog-audio",
              kind: "audio",
              original_filename: "dialog-line.wav",
              stored_url: "/references/dialog-line.wav",
              mime_type: "audio/wav",
              duration_seconds: 2,
              created_at: "2026-06-22T12:00:00Z",
              metadata: { format_name: "wav" },
            },
          ],
          next_offset: null,
        });
      }
      return jsonResponse({
        ok: true,
        items: [
          {
            reference_id: "reference-dialog-1",
            kind: "image",
            original_filename: "sadi-reference.png",
            stored_url: "/references/sadi-reference.png",
            thumb_url: "/references/sadi-reference-thumb.png",
            width: 1024,
            height: 1024,
            created_at: "2026-06-22T12:00:00Z",
          },
        ],
        next_offset: null,
      });
    }
    return jsonResponse({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDialogs(
  overrides: Partial<Parameters<typeof GraphStudioDialogs>[0]> = {},
) {
  const props: Parameters<typeof GraphStudioDialogs>[0] = {
    sidebarDialog: "images",
    definitions: [],
    definitionsByCategory: {},
    workflows: [],
    templates: [],
    workflowId: null,
    runHistory: [],
    selectedHistoryRunId: null,
    selectedRunArtifacts: [],
    nodeSearch: null,
    nodeContextMenu: null,
    groupContextMenu: null,
    groups: [],
    nodes: [],
    groupTitleDraft: "",
    imageLibraryNodeId: null,
    onCloseSidebar: vi.fn(),
    onLoadStarterTemplate: vi.fn(),
    onLoadWorkflow: vi.fn(),
    onInstantiateTemplate: vi.fn(),
    onDeleteWorkflow: vi.fn(),
    onDeleteTemplate: vi.fn(),
    onImportWorkflow: vi.fn(),
    onAddDefinitionNode: vi.fn(),
    onAddLoadImageNode: vi.fn(),
    onRefreshRunHistory: vi.fn(),
    onInspectRun: vi.fn(),
    onRestoreRun: vi.fn(),
    onPinArtifact: vi.fn(),
    onNodeSearchQueryChange: vi.fn(),
    onNodeSearchSelect: vi.fn(),
    onNodeSearchClose: vi.fn(),
    onSetNodeExecutionMode: vi.fn(),
    onSetNodeColor: vi.fn(),
    onClearNodes: vi.fn(),
    onCreateGroup: vi.fn(),
    onRenameNode: vi.fn(),
    onGroupTitleDraftChange: vi.fn(),
    onRenameGroup: vi.fn(),
    onSetGroupColor: vi.fn(),
    onSetGroupExecutionMode: vi.fn(),
    onDeleteGroup: vi.fn(),
    onCloseGroupContext: vi.fn(),
    onCloseImageLibrary: vi.fn(),
    onAttachReference: vi.fn(),
    onAttachAsset: vi.fn(),
    ...overrides,
  };

  return { ...render(<GraphStudioDialogs {...props} />), props };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GraphStudioDialogs image selector", () => {
  it("uses the shared source-backed selector for left-rail add-node mode", async () => {
    mockImageSelectorFetch();
    const { props } = renderDialogs();

    const generatedButton = await screen.findByRole("button", {
      name: "Use generated image asset-dialog-1",
    });

    expect(screen.getByRole("dialog", { name: "Image Assets" })).toBeTruthy();
    expect(screen.queryByTestId("graph-image-library-modal")).toBeNull();
    expect(screen.queryByTestId("graph-reference-list")).toBeNull();
    expect(screen.queryByTestId("graph-asset-list")).toBeNull();

    fireEvent.click(generatedButton);

    expect(props.onAddLoadImageNode).toHaveBeenCalledWith({
      asset_id: "asset-dialog-1",
    });
    expect(props.onAttachAsset).not.toHaveBeenCalled();
  });

  it("preserves graph media drag payloads in add-node mode", async () => {
    mockImageSelectorFetch();
    renderDialogs();
    const generatedButton = await screen.findByRole("button", {
      name: "Use generated image asset-dialog-1",
    });
    const dataTransfer = { setData: vi.fn() };

    fireEvent.dragStart(generatedButton, { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith(
      "application/x-media-studio-graph-media",
      JSON.stringify({
        source: "asset",
        id: "asset-dialog-1",
        mediaType: "image",
      }),
    );
  });

  it("uses the shared selector for Load Image attach-node mode", async () => {
    mockImageSelectorFetch();
    const { props } = renderDialogs({
      sidebarDialog: null,
      imageLibraryNodeId: "node-load-image-1",
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Use generated image asset-dialog-1",
      }),
    );

    expect(props.onAttachAsset).toHaveBeenCalledWith(
      "node-load-image-1",
      "asset-dialog-1",
    );
    expect(props.onAddLoadImageNode).not.toHaveBeenCalled();
    expect(screen.queryByTestId("graph-image-library-modal")).toBeNull();
  });

  it("routes Load Video through the media-type-aware selector", async () => {
    const fetchMock = mockImageSelectorFetch();
    const { props } = renderDialogs({
      sidebarDialog: null,
      imageLibraryNodeId: "node-load-video-1",
      imageLibraryMediaType: "video",
    });

    expect(await screen.findByRole("dialog", { name: "Video Assets" })).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Use generated video asset-dialog-video",
      }),
    );

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("generation_kind=video"),
      ),
    ).toBe(true);
    expect(props.onAttachAsset).toHaveBeenCalledWith(
      "node-load-video-1",
      "asset-dialog-video",
    );
    expect(props.onAddLoadImageNode).not.toHaveBeenCalled();
  });

  it("routes Load Audio through the media-type-aware selector", async () => {
    const fetchMock = mockImageSelectorFetch();
    const { props } = renderDialogs({
      sidebarDialog: null,
      imageLibraryNodeId: "node-load-audio-1",
      imageLibraryMediaType: "audio",
    });

    expect(await screen.findByRole("dialog", { name: "Audio Assets" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Imported" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Use dialog-line.wav",
      }),
    );

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("kind=audio")),
    ).toBe(true);
    expect(props.onAttachReference).toHaveBeenCalledWith(
      "node-load-audio-1",
      "reference-dialog-audio",
    );
    expect(props.onAddLoadImageNode).not.toHaveBeenCalled();
  });

  it("passes search and project selection through source-backed requests", async () => {
    const fetchMock = mockImageSelectorFetch();
    renderDialogs();

    await screen.findByRole("button", {
      name: "Use generated image asset-dialog-1",
    });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search image assets" }), {
      target: { value: "Sadie" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Image asset project" }), {
      target: { value: "project-sadi" },
    });

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("q=Sadie"),
        ),
      ).toBe(true);
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("project_id=project-sadi"),
        ),
      ).toBe(true);
    });
  });
});
