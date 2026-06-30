import { describe, expect, it } from "vitest";

import { buildAttachmentPreview } from "@/lib/studio-reference-previews";
import type { AttachmentRecord } from "@/lib/media-studio-contract";

describe("studio reference previews", () => {
  it("adds compact metadata labels for staged video attachments", () => {
    const preview = buildAttachmentPreview(
      {
        id: "video-1",
        file: null,
        kind: "videos",
        role: null,
        previewUrl: "/video.mp4",
        durationSeconds: 20.083333,
        width: 720,
        height: 1280,
      } satisfies AttachmentRecord,
      "Driving video",
    );

    expect(preview).toMatchObject({
      kind: "videos",
      metadataLabel: "20.1s · 720x1280",
    });
  });

  it("uses reference metadata when an attachment was selected from the library", () => {
    const preview = buildAttachmentPreview(
      {
        id: "reference-video-1",
        file: null,
        kind: "videos",
        role: null,
        previewUrl: "/poster.webp",
        referenceRecord: {
          reference_id: "ref-1",
          kind: "video",
          status: "ready",
          attached_project_ids: [],
          original_filename: "reference.mp4",
          stored_path: "reference.mp4",
          mime_type: "video/mp4",
          file_size_bytes: 1,
          sha256: "abc",
          width: 720,
          height: 1280,
          duration_seconds: 20.083333,
          stored_url: "/reference.mp4",
          thumb_url: "/poster.webp",
          poster_url: "/poster.webp",
          usage_count: 0,
          last_used_at: null,
          metadata: {},
          created_at: "2026-06-19T00:00:00.000Z",
          updated_at: "2026-06-19T00:00:00.000Z",
        },
      } satisfies AttachmentRecord,
      "Driving video",
    );

    expect(preview?.metadataLabel).toBe("20.1s · 720x1280");
  });
});
