import { describe, expect, it } from "vitest";

import { applyAttachmentInsertOrReplace, buildStagedAttachments } from "./studio-attachment-staging";

describe("studio-attachment-staging", () => {
  it("uses the same attachment materialization shape for live add and restore add", () => {
    const file = new File(["image"], "source.png", { type: "image/png" });
    const live = buildStagedAttachments(
      [{ file, kind: "images", role: null, previewUrl: "live://preview" }],
      () => "shared-id",
    );
    const restored = buildStagedAttachments(
      [{ file, kind: "images", role: null, previewUrl: "live://preview" }],
      () => "shared-id",
    );

    expect(restored).toEqual(live);
  });

  it("replaces a filled ordered image slot without disturbing later attachments", () => {
    const current = buildStagedAttachments(
      [
        { file: new File(["one"], "one.png"), kind: "images", role: null, previewUrl: "one" },
        { file: new File(["two"], "two.png"), kind: "images", role: null, previewUrl: "two" },
        { file: new File(["video"], "clip.mp4"), kind: "videos", role: null, previewUrl: "clip" },
      ],
      () => "fixed-id",
    );
    const replacement = buildStagedAttachments(
      [{ file: new File(["replacement"], "replacement.png"), kind: "images", role: null, previewUrl: "replacement" }],
      () => "replacement-id",
    );

    const next = applyAttachmentInsertOrReplace(current, replacement, { replaceImageIndex: 0 });

    expect(next.map((attachment) => attachment.previewUrl)).toEqual(["two", "clip", "replacement"]);
  });

  it("inserts a staged image at the requested ordered slot index", () => {
    const current = buildStagedAttachments(
      [
        { file: new File(["one"], "one.png"), kind: "images", role: null, previewUrl: "one" },
        { file: new File(["video"], "clip.mp4"), kind: "videos", role: null, previewUrl: "clip" },
        { file: new File(["two"], "two.png"), kind: "images", role: null, previewUrl: "two" },
      ],
      () => "fixed-id",
    );
    const inserted = buildStagedAttachments(
      [{ file: new File(["middle"], "middle.png"), kind: "images", role: null, previewUrl: "middle" }],
      () => "middle-id",
    );

    const next = applyAttachmentInsertOrReplace(current, inserted, { insertImageIndex: 1 });

    expect(next.map((attachment) => attachment.previewUrl)).toEqual(["one", "clip", "middle", "two"]);
  });
});
