// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { StudioImageLightbox } from "@/components/studio/studio-image-lightbox";
import { StudioAssetInspector } from "@/components/studio/studio-asset-inspector";
import type { MediaAsset } from "@/lib/types";

afterEach(cleanup);
function inspector(
  overrides: Partial<ComponentProps<typeof StudioAssetInspector>> = {},
) {
  const props = {
    selectedAsset: {
      asset_id: "one",
      generation_kind: "image",
      model_key: "raw-model-key",
      created_at: "2026-10-14T15:12:00Z",
      status: "completed",
      hero_original_path: "one.png",
    } as MediaAsset,
    selectedAssetDisplayVisual: "/one.png",
    selectedAssetPlaybackVisual: null,
    selectedAssetPrompt: "Complete saved prompt\nSecond paragraph",
    selectedAssetStructuredPresetActive: false,
    selectedAssetPresetLabel: "Saved preset",
    selectedAssetPresetLoadKey: "preset-1",
    selectedAssetPresetDescription: null,
    selectedAssetPresetSlots: [],
    selectedAssetPresetSlotValues: {},
    selectedAssetPresetFields: [],
    selectedAssetPresetInputValues: {},
    selectedAssetProjectLabel: null,
    selectedAssetReferencePreviews: [],
    favoriteAssetIdBusy: null,
    copyPromptStatus: "idle" as const,
    mobileInspectorPromptOpen: true,
    downloadActionLabel: "Save",
    showReviseAction: true,
    onClose: vi.fn(),
    onOpenLightbox: vi.fn(),
    onCopyPrompt: vi.fn(),
    onToggleFavorite: vi.fn(),
    onUsePreset: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenReference: vi.fn(),
    onMobileInspectorPromptOpenChange: vi.fn(),
    onDownload: vi.fn(),
    onDismiss: vi.fn(),
    onAnimate: vi.fn(),
    onUseImage: vi.fn(),
    onRevise: vi.fn(),
    ...overrides,
  };
  const view = render(<StudioAssetInspector {...props} />);
  return { ...props, view };
}
it("offers each utility and creative action once and dispatches only the selected action", () => {
  const props = inspector();
  expect(
    screen.getAllByRole("button", { name: "Remove", exact: true }),
  ).toHaveLength(1);
  for (const [name, callback] of [
    ["Save", props.onDownload],
    ["Remove", props.onDismiss],
    ["Create Revision", props.onRevise],
    ["Animate", props.onAnimate],
    ["Use image", props.onUseImage],
    ["Close media details", props.onClose],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name, exact: true }));
    expect(callback).toHaveBeenCalledTimes(1);
  }
  expect(props.onOpenLightbox).not.toHaveBeenCalled();
  expect(
    screen.getAllByText(/Complete saved prompt.*Second paragraph/s),
  ).toHaveLength(1);
});

it("keeps keyboard focus out of CSS-hidden controls", () => {
  inspector();
  const hidden = screen.getByRole("button", { name: "Collapse prompt" });
  hidden.style.display = "none";
  const first = screen.getByRole("button", { name: "Favorite" });
  const last = screen.getByRole("button", { name: "Copy", exact: true });
  first.focus();
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
});

it("keeps video-only revision capability independent from image actions", () => {
  const props = inspector({
    selectedAsset: {
      asset_id: "video",
      generation_kind: "video",
    } as MediaAsset,
    selectedAssetPlaybackVisual: "/movie.mp4",
  });
  expect(screen.queryByRole("button", { name: "Animate" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Use image" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Create Revision" }));
  expect(props.onRevise).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Open selected video" }));
  expect(props.onOpenLightbox).toHaveBeenCalledTimes(1);
});

it("retains direct video controls and audio without artwork", () => {
  const props = inspector({
    selectedAsset: {
      asset_id: "video",
      generation_kind: "video",
    } as MediaAsset,
    selectedAssetDisplayVisual: null,
    selectedAssetPlaybackVisual: "/movie.mp4",
    showReviseAction: false,
  });
  const video = document.querySelector("video");
  expect(video?.getAttribute("controls")).toBe("");
  expect(video?.getAttribute("playsinline")).toBe("");
  expect(
    screen.queryByRole("button", { name: "Open selected video" }),
  ).toBeNull();
  props.view.rerender(
    <StudioAssetInspector
      {...props}
      selectedAsset={
        { asset_id: "audio", generation_kind: "audio" } as MediaAsset
      }
      selectedAssetPlaybackVisual="/audio.mp3"
    />,
  );
  expect(document.querySelector("audio")?.getAttribute("controls")).toBe("");
  expect(document.querySelector("audio")?.getAttribute("src")).toBe(
    "/audio.mp3",
  );
});

it("retains structured preset descriptions, saved inputs and source references", () => {
  const ref = {
    key: "ref",
    label: "Saved source",
    kind: "images" as const,
    url: "/source.png",
    posterUrl: null,
  };
  const props = inspector({
    selectedAssetStructuredPresetActive: true,
    selectedAssetPresetDescription: "Saved description",
    selectedAssetPresetFields: [
      { key: "subject", label: "Subject", defaultValue: "Default" },
    ],
    selectedAssetPresetInputValues: { subject: "Saved input" },
    selectedAssetReferencePreviews: [ref],
  });
  expect(screen.getByRole("heading", { name: "Preset Details" })).toBeTruthy();
  expect(screen.getByText("Saved description")).toBeTruthy();
  expect(screen.getByText("Saved input")).toBeTruthy();
  expect(screen.queryByText(/Complete saved prompt/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Copy", exact: true }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Saved source/ }));
  expect(props.onOpenReference).toHaveBeenCalledWith(ref);
});

it("suspends dismissal for nested references and returns focus to their opener", () => {
  const props = inspector();
  const opener = screen.getByRole("button", { name: "Open full size" });
  opener.focus();
  const closePreview = vi.fn();
  props.view.rerender(
    <>
      <StudioAssetInspector {...props} suspended />
      <StudioImageLightbox
        src="/reference.png"
        alt="Saved reference"
        onClose={closePreview}
      />
    </>,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(closePreview).toHaveBeenCalledTimes(1);
  expect(props.onClose).not.toHaveBeenCalled();
  props.view.rerender(<StudioAssetInspector {...props} />);
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Open full size" }),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(props.onClose).toHaveBeenCalledTimes(1);
});

it("copies project-scoped links with feedback and preserves favorite busy state", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const props = inspector({
    selectedAsset: {
      asset_id: "one",
      generation_kind: "image",
      project_id: "project one",
      favorited: true,
    } as MediaAsset,
    favoriteAssetIdBusy: "one",
  });
  expect(
    screen.getByRole("button", { name: "Saved" }).getAttribute("disabled"),
  ).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findByRole("button", { name: "Link copied" });
  expect(writeText).toHaveBeenCalledWith(
    "http://localhost:3000/studio?project=project+one&asset=one",
  );
  expect(props.onToggleFavorite).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("reports clipboard failure and retains prompt-copy failure feedback", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  inspector({ copyPromptStatus: "error" });
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  await screen.findAllByRole("button", { name: "Copy failed" });
  expect(screen.getAllByText("Copy failed")).toHaveLength(2);
  vi.unstubAllGlobals();
});
