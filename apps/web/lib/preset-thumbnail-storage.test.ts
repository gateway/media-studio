import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  readPresetThumbnailBuffer,
  resolvePresetThumbnailCandidatePaths,
} from "@/lib/preset-thumbnail-storage";

describe("preset-thumbnail-storage", () => {
  it("falls back to shipped preset thumbnails when runtime data is absent", async () => {
    const thumbnailPath = "preset-thumbnails/3d-caricature-style-1775803238496.webp";
    const candidates = resolvePresetThumbnailCandidatePaths(thumbnailPath);

    expect(candidates[0]).toContain("data/preset-thumbnails/3d-caricature-style-1775803238496.webp");
    expect(candidates[1]).toContain("apps/api/app/seed_assets/preset-thumbnails/3d-caricature-style-1775803238496.webp");

    const buffer = await readPresetThumbnailBuffer(thumbnailPath);
    expect(buffer?.subarray(0, 4).toString("ascii")).toBe("RIFF");
  });
});
