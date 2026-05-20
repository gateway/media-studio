import { describe, expect, it } from "vitest";

import { isDefaultStudioGalleryQuery } from "@/hooks/studio/use-studio-gallery-feed";

describe("isDefaultStudioGalleryQuery", () => {
  it("recognizes the server-backed default gallery query", () => {
    expect(
      isDefaultStudioGalleryQuery({
        favoritesOnly: false,
        galleryKindFilter: "all",
        galleryModelFilter: "all",
      }),
    ).toBe(true);
  });

  it("treats favorites and client-side filters as non-default queries", () => {
    expect(
      isDefaultStudioGalleryQuery({
        favoritesOnly: true,
        galleryKindFilter: "all",
        galleryModelFilter: "all",
      }),
    ).toBe(false);
    expect(
      isDefaultStudioGalleryQuery({
        favoritesOnly: false,
        galleryKindFilter: "images",
        galleryModelFilter: "all",
      }),
    ).toBe(false);
    expect(
      isDefaultStudioGalleryQuery({
        favoritesOnly: false,
        galleryKindFilter: "all",
        galleryModelFilter: "nano-banana-pro",
      }),
    ).toBe(false);
  });
});
