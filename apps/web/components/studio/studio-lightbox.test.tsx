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
