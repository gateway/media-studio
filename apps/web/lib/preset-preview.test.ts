import { afterEach, expect, it, vi } from "vitest";
import { resolvePresetPreviewOriginal } from "./preset-preview";

const thumbPath =
  "outputs/2026-05-23/run_job_abc123_output_1/thumb/output_01.webp";
const src = `/api/control/files/${thumbPath}`;
const originalPath =
  "outputs/2026-05-23/run_job_abc123_output_1/original/output_01.png";

afterEach(() => vi.unstubAllGlobals());

it("resolves only the exact output recorded in the saved run manifest", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          outputs: [
            {
              kind: "image",
              thumb_path: "thumb/output_02.webp",
              original_path: "original/output_02.png",
            },
            {
              kind: "image",
              thumb_path: "thumb/output_01.webp",
              original_path: "original/output_01.png",
            },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await resolvePresetPreviewOriginal(src)).toBe(
    `/api/control/files/${originalPath}?inline=1`,
  );
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    "/api/control/files/outputs/2026-05-23/run_job_abc123_output_1/run.json",
  );
});

it("does not substitute a different output or an unrelated file path", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          outputs: [
            {
              kind: "image",
              thumb_path: "thumb/output_02.webp",
              original_path: "original/output_02.png",
            },
          ],
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          outputs: [
            {
              kind: "image",
              thumb_path: "thumb/output_01.webp",
              original_path: "../../private.png",
            },
          ],
        }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  expect(await resolvePresetPreviewOriginal(src)).toBeNull();
  expect(await resolvePresetPreviewOriginal(src)).toBeNull();
});

it("uses saved custom thumbnails without guessing original paths or making metadata requests", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await resolvePresetPreviewOriginal("/api/preset-thumbnails/saved.webp"),
  ).toBeNull();
  expect(
    await resolvePresetPreviewOriginal(`https://elsewhere.example${src}`),
  ).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps the available image when metadata is unavailable or no original is recorded", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          outputs: [{ kind: "image", thumb_path: "thumb/output_01.webp" }],
        }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  expect(await resolvePresetPreviewOriginal(src)).toBeNull();
  expect(await resolvePresetPreviewOriginal(src)).toBeNull();
});
