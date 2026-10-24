import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));

import { storePresetThumbnailBuffer } from "@/lib/preset-thumbnail-storage";
import { storePromptRecipeThumbnailBuffer } from "@/lib/prompt-recipe-thumbnail-storage";

const stores = [
  ["preset", (sourceBuffer: Buffer) => storePresetThumbnailBuffer({ sourceBuffer, presetLabel: "Native proof" })],
  ["recipe", (sourceBuffer: Buffer) => storePromptRecipeThumbnailBuffer({ sourceBuffer, recipeLabel: "Native proof" })],
] as const;

describe.each(stores)("native %s thumbnails", (_kind, store) => {
  beforeEach(() => {
    vi.mocked(mkdir).mockReset();
    vi.mocked(writeFile).mockReset();
  });

  it("decodes SVG and writes a bounded WebP with the existing thumbnail contract", async () => {
    const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512"><rect width="1024" height="512" fill="#123456"/></svg>');
    const result = await store(source);
    expect(mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(writeFile).toHaveBeenCalledOnce();
    const [outputPath, buffer] = vi.mocked(writeFile).mock.calls[0];
    expect(outputPath).toBe(result.outputPath);
    expect(result.thumbnail_url).toBe(`/api/${result.thumbnail_path}`);
    expect(result.fileName).toMatch(/^native-proof-\d+\.webp$/);
    expect(await sharp(buffer as Buffer).metadata()).toMatchObject({ format: "webp", width: 512, height: 256 });
  });

  it("applies EXIF rotation without enlarging small images", async () => {
    const source = await sharp({ create: { width: 4, height: 2, channels: 3, background: "#123456" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    await store(source);
    const [, buffer] = vi.mocked(writeFile).mock.calls[0];
    const metadata = await sharp(buffer as Buffer).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 2, height: 4 });
    expect(metadata.orientation).toBeUndefined();
  });
});
