import { describe, expect, it } from "vitest";

import { toControlApiDataPreviewPath } from "./media-paths";

describe("media path helpers", () => {
  it("keeps relative data paths working", () => {
    expect(toControlApiDataPreviewPath("outputs/web/output_01.mp4")).toBe(
      "/api/control/files/outputs/web/output_01.mp4",
    );
  });

  it("normalizes Windows absolute paths stored under the data folder", () => {
    expect(
      toControlApiDataPreviewPath(
        "E:/Development/media-studio/data/reference-media/images/source.png",
      ),
    ).toBe("/api/control/files/reference-media/images/source.png");
  });
});
