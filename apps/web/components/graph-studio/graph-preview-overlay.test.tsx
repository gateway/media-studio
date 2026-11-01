// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { GraphPreviewOverlay } from "./graph-preview-overlay";
import type { GraphMediaPreview } from "./types";

afterEach(cleanup);

it.each(["image", "video"] as const)("downloads the original %s without closing its preview", (mediaType) => {
  const onClose = vi.fn();
  const original = `/api/control/files/original/output.${mediaType === "image" ? "png" : "mp4"}`;
  render(<GraphPreviewOverlay previews={[{ mediaType, url: "/thumbnail.jpg", fullUrl: original }]} index={0} onClose={onClose} onNavigate={vi.fn()} />);

  const download = screen.getByRole("link", { name: `Download original ${mediaType}` });
  expect(download.getAttribute("href")).toBe(original);
  expect(download.hasAttribute("download")).toBe(true);
  // Suppress jsdom navigation, while still exercising the overlay click handler.
  download.addEventListener("click", (event) => event.preventDefault());
  fireEvent.click(download);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
  expect(onClose).toHaveBeenCalled();
});

it("downloads the currently selected item and supports previews with only one media URL", () => {
  const previews: GraphMediaPreview[] = [
    { mediaType: "image", url: "/thumb.jpg", fullUrl: "/original.png" },
    { mediaType: "video", url: "/original.mp4" },
  ];
  const props = { previews, onClose: vi.fn(), onNavigate: vi.fn() };
  const { rerender } = render(<GraphPreviewOverlay {...props} index={0} />);
  rerender(<GraphPreviewOverlay {...props} index={1} />);
  expect(screen.getByRole("link", { name: "Download original video" }).getAttribute("href")).toBe("/original.mp4");
});
