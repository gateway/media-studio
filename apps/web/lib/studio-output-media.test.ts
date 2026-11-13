import { expect, it, vi } from "vitest";

import { GET } from "@/app/api/control/files/[...path]/route";
import { getControlApiFile } from "@/lib/control-api";
import {
  mediaDisplayUrl, mediaDownloadName, mediaDownloadUrl, mediaInlineUrl, mediaThumbnailUrl,
} from "@/lib/studio-media-urls";
import type { MediaAsset } from "@/lib/types";

vi.mock("@/lib/control-api", () => ({ getControlApiFile: vi.fn() }));

it("uses the animated GIF for the inspector and keeps the static gallery thumbnail", () => {
  const gif: MediaAsset = {
    asset_id: "gif",
    created_at: "2026-11-13",
    generation_kind: "image",
    model_key: "example",
    hero_original_path: "outputs/original/output_01.gif",
    hero_web_path: "outputs/web/output_01.webp",
    hero_thumb_path: "outputs/thumb/output_01.webp",
    payload: { outputs: [{ original_filename: "provider.bin" }] },
  };
  expect(mediaThumbnailUrl(gif)).toBe("/api/control/files/outputs/thumb/output_01.webp");
  expect(mediaDisplayUrl(gif)).toBe("/api/control/files/outputs/original/output_01.gif");
  expect(mediaDownloadName(gif)).toBe("example.gif");
});

it("exposes the SVG as an original download and keeps inline requests attachment-only", async () => {
  const asset: MediaAsset = {
    asset_id: "svg", created_at: "2026-11-13", generation_kind: "image", hero_original_path: "outputs/output.svg",
  };
  expect(mediaDisplayUrl(asset)).toBeNull();
  expect(mediaInlineUrl(asset)).toBeNull();
  expect(mediaDownloadUrl(asset)).toBe("/api/control/files/outputs/output.svg?download=1&filename=output.svg");

  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  vi.mocked(getControlApiFile).mockResolvedValueOnce({
    ok: true,
    error: null,
    response: new Response(svg, { headers: { "content-type": "image/svg+xml" } }),
  });
  const response = await GET(
    new Request("http://studio.local/api/control/files/outputs/output.svg?inline=1"),
    { params: Promise.resolve({ path: ["outputs", "output.svg"] }) },
  );
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(response.headers.get("content-disposition")).toBe('attachment; filename="output.svg"');
  expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'");
  expect(await response.text()).toBe(svg);
});
