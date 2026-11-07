// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StudioLightbox } from "./studio-lightbox";
import type { MediaAsset } from "@/lib/types";
afterEach(cleanup);
it("allows keyboard entry into native playback controls and contains focus after them", () => {
  const outside = document.createElement("button");
  document.body.append(outside);
  render(
    <StudioLightbox
      selectedAsset={
        { asset_id: "video", generation_kind: "video" } as MediaAsset
      }
      selectedAssetDisplayVisual={null}
      selectedAssetPlaybackVisual="/video.mp4"
      selectedAssetLightboxVisual="/video.mp4"
      lightboxVideoRef={{ current: null }}
      onNavigate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const close = screen.getByRole("button", { name: "Close media lightbox" });
  close.focus();
  fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(document.querySelector("video"));
  expect(fireEvent.keyDown(document.activeElement!, { key: "Tab" })).toBe(true);
  outside.focus();
  expect(document.activeElement).toBe(close);
  outside.remove();
});

it("retains swipe navigation and audio playback without artwork", () => {
  const onNavigate = vi.fn();
  const onClose = vi.fn();
  render(
    <StudioLightbox
      selectedAsset={
        { asset_id: "audio", generation_kind: "audio" } as MediaAsset
      }
      selectedAssetDisplayVisual={null}
      selectedAssetPlaybackVisual="/audio.mp3"
      selectedAssetLightboxVisual="/audio.mp3"
      lightboxVideoRef={{ current: null }}
      onNavigate={onNavigate}
      onClose={onClose}
    />,
  );
  const surface = screen.getByTestId("studio-lightbox-swipe-surface");
  expect(document.querySelector("audio")?.getAttribute("controls")).toBe("");
  fireEvent.touchStart(surface, { touches: [{ clientX: 180, clientY: 80 }] });
  fireEvent.touchEnd(surface, {
    changedTouches: [{ clientX: 40, clientY: 85 }],
  });
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  onClose.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Close media lightbox" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("reports an unavailable original instead of an empty canvas", () => {
  render(
    <StudioLightbox
      selectedAsset={
        { asset_id: "missing", generation_kind: "image" } as MediaAsset
      }
      selectedAssetDisplayVisual={null}
      selectedAssetPlaybackVisual={null}
      selectedAssetLightboxVisual={null}
      lightboxVideoRef={{ current: null }}
      onNavigate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "Media preview unavailable",
  );
});
