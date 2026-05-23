// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioProjectBrowser } from "@/components/studio/studio-project-browser";
import type { MediaAsset, MediaProject } from "@/lib/types";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill: _fill, sizes: _sizes, ...rest } = props;
    return <img alt="" {...rest} />;
  },
}));

const generatedAsset: MediaAsset = {
  asset_id: "asset-1",
  generation_kind: "image",
  created_at: "2026-05-22T11:00:00Z",
  model_key: "nano-banana-pro",
  prompt_summary: "Project cover candidate",
  hero_thumb_url: "/api/control/files/outputs/project-cover-thumb.webp",
  hero_web_url: "/api/control/files/outputs/project-cover.webp",
};

const existingProject: MediaProject = {
  project_id: "project-1",
  name: "Existing Project",
  description: "Saved project",
  status: "active",
  hidden_from_global_gallery: false,
  cover_reference_id: "reference-existing",
  cover_thumb_url: "/api/control/files/references/project-thumb.webp",
  updated_at: "2026-05-22T11:00:00Z",
};

function makeProps(overrides: Partial<Parameters<typeof StudioProjectBrowser>[0]> = {}) {
  return {
    projects: [existingProject],
    selectedProjectId: null,
    onClose: vi.fn(),
    onSelectProject: vi.fn(),
    onCreateProject: vi.fn().mockResolvedValue(undefined),
    onUpdateProject: vi.fn().mockResolvedValue(undefined),
    onArchiveProject: vi.fn().mockResolvedValue(undefined),
    onUnarchiveProject: vi.fn().mockResolvedValue(undefined),
    onDeleteProject: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("StudioProjectBrowser project images", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:project-cover"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses the shared thumbnail field for create project upload and drag-drop", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/control/reference-media/import") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            item: { reference_id: "reference-uploaded" },
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const props = makeProps({ projects: [] });
    render(<StudioProjectBrowser {...props} />);

    fireEvent.click(screen.getByTestId("studio-project-create-button"));

    expect(screen.getByRole("button", { name: "Choose from generated images" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Browse generated images" })).toBeTruthy();

    fireEvent.change(screen.getByTestId("studio-project-name-input"), {
      target: { value: "Launch Assets" },
    });
    fireEvent.drop(screen.getByRole("button", { name: "Choose from generated images" }), {
      dataTransfer: {
        files: [new File(["cover"], "cover.webp", { type: "image/webp" })],
      },
    });
    fireEvent.click(screen.getByTestId("studio-project-submit-create"));

    await waitFor(() => {
      expect(props.onCreateProject).toHaveBeenCalledWith(expect.objectContaining({
        name: "Launch Assets",
        coverAssetId: null,
        coverReferenceId: "reference-uploaded",
      }));
    });
  });

  it("uses the same generated image picker when editing a project", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/control/media-assets?")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            assets: [generatedAsset],
            next_offset: null,
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const props = makeProps();
    render(<StudioProjectBrowser {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Existing Project" }));

    expect(screen.getByRole("button", { name: "Choose from generated images" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Browse generated images" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Browse generated images" }));

    const pickerDialog = await screen.findByRole("dialog", { name: "Generated image project covers" });
    expect(pickerDialog.parentElement?.className).toContain("z-[130]");
    fireEvent.click(screen.getByRole("button", { name: "Use generated image asset-1 as project image" }));
    fireEvent.click(screen.getByTestId("studio-project-submit-save"));

    await waitFor(() => {
      expect(props.onUpdateProject).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({
          name: "Existing Project",
          coverAssetId: "asset-1",
          coverReferenceId: null,
        }),
      );
    });
  });
});
