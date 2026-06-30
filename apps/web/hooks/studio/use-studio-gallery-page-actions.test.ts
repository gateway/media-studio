import { describe, expect, it } from "vitest";

import { buildStudioGalleryAssetPageParams } from "@/hooks/studio/use-studio-gallery-page-actions";

describe("buildStudioGalleryAssetPageParams", () => {
  it("uses the lightweight summary view for Studio gallery list pages", () => {
    const params = buildStudioGalleryAssetPageParams({
      activeProjectId: "project-1",
      offset: 18,
      favorited: true,
      limit: 12,
      galleryKindFilter: "image",
      galleryModelFilter: "gpt-image-2",
    });

    expect(params.toString()).toBe(
      "limit=12&offset=18&view=summary&favorited=true&generation_kind=image&model_key=gpt-image-2&project_id=project-1",
    );
  });

  it("bounds invalid offset and limit values before fetch", () => {
    const params = buildStudioGalleryAssetPageParams({
      activeProjectId: null,
      offset: -20,
      limit: 0,
      galleryKindFilter: "all",
      galleryModelFilter: "all",
    });

    expect(params.toString()).toBe("limit=1&offset=0&view=summary");
  });
});
