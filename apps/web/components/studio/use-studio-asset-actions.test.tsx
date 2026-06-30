// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useStudioAssetActions } from "@/hooks/studio/use-studio-asset-actions";
import type { MediaAsset } from "@/lib/types";

type DownloadHarnessProps = {
  asset: MediaAsset;
  onActivity?: Parameters<typeof useStudioAssetActions>[0]["showActivity"];
  onMessage?: Parameters<typeof useStudioAssetActions>[0]["onMessage"];
};

function DownloadHarness({ asset, onActivity = vi.fn(), onMessage = vi.fn() }: DownloadHarnessProps) {
  const { downloadAsset } = useStudioAssetActions({
    hasMounted: true,
    onMessage,
    showActivity: onActivity,
  });

  useEffect(() => {
    void downloadAsset(asset);
  }, [asset, downloadAsset]);

  return <div data-testid="download-harness">ready</div>;
}

const defaultUserAgent = window.navigator.userAgent;
const defaultMaxTouchPoints = window.navigator.maxTouchPoints;
const originalFetch = globalThis.fetch;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

function mockNavigatorProperty<T>(name: keyof Navigator, value: T) {
  Object.defineProperty(window.navigator, name, {
    configurable: true,
    value,
  });
}

function mockDesktopDevice() {
  mockNavigatorProperty("userAgent", defaultUserAgent);
  mockNavigatorProperty("maxTouchPoints", defaultMaxTouchPoints);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
}

function mockMobileDevice() {
  mockNavigatorProperty("userAgent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148");
  mockNavigatorProperty("maxTouchPoints", 5);
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
}

function mockFetchBlob(blob: Blob) {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    blob: async () => blob,
  })) as unknown as typeof fetch;
}

function makeImageAsset(overrides: Partial<MediaAsset> = {}) {
  return {
    asset_id: "asset-1",
    job_id: "job_bec8bef43dae",
    model_key: "nano-banana-2",
    created_at: "2026-06-09T00:00:00.000Z",
    generation_kind: "image",
    hero_original_path: "outputs/2026-04-09/original/output_01.png",
    hero_thumb_path: "outputs/2026-04-09/thumb/output_01.webp",
    payload: {
      outputs: [{ original_filename: "job_bec8bef43dae.png" }],
      options: { resolution: "2K", aspect_ratio: "4:3" },
    },
    ...overrides,
  } as MediaAsset;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockNavigatorProperty("userAgent", defaultUserAgent);
  mockNavigatorProperty("maxTouchPoints", defaultMaxTouchPoints);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
  delete (window.navigator as Navigator & { share?: unknown }).share;
  delete (window.navigator as Navigator & { canShare?: unknown }).canShare;
});

describe("useStudioAssetActions", () => {
  it("downloads the full original asset URL with the generated download name", async () => {
    mockDesktopDevice();
    let clickedAnchor: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function mockClick(this: HTMLAnchorElement) {
      clickedAnchor = this;
    });
    const asset = makeImageAsset();

    render(<DownloadHarness asset={asset} />);

    await waitFor(() => expect(clickedAnchor).not.toBeNull());
    expect(screen.getByTestId("download-harness").textContent).toBe("ready");
    expect(clickedAnchor?.getAttribute("href")).toBe(
      "/api/control/files/outputs/2026-04-09/original/output_01.png?download=1&filename=ms-bec8bef43dae_nano-banana-2_2k_4-3.png",
    );
    expect(clickedAnchor?.getAttribute("download")).toBe("ms-bec8bef43dae_nano-banana-2_2k_4-3.png");
  });

  it("opens the native file share flow on mobile devices when available", async () => {
    mockMobileDevice();
    mockFetchBlob(new Blob(["png"], { type: "image/png" }));
    const share = vi.fn(async () => undefined);
    const canShare = vi.fn(() => true);
    mockNavigatorProperty("share", share);
    mockNavigatorProperty("canShare", canShare);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const showActivity = vi.fn();

    render(<DownloadHarness asset={makeImageAsset()} onActivity={showActivity} />);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/control/files/outputs/2026-04-09/original/output_01.png?download=1&filename=ms-bec8bef43dae_nano-banana-2_2k_4-3.png",
      { credentials: "same-origin" },
    );
    const payload = share.mock.calls[0][0] as ShareData;
    expect(payload.title).toBe("ms-bec8bef43dae_nano-banana-2_2k_4-3.png");
    expect(payload.files).toHaveLength(1);
    expect(payload.files?.[0].name).toBe("ms-bec8bef43dae_nano-banana-2_2k_4-3.png");
    expect(payload.files?.[0].type).toBe("image/png");
    expect(canShare).toHaveBeenCalledWith(expect.objectContaining({ files: expect.any(Array) }));
    expect(showActivity).toHaveBeenCalledWith(
      { tone: "healthy", message: "Opened your device share sheet." },
      { autoHideMs: 2200 },
    );
    expect(click).not.toHaveBeenCalled();
  });

  it("falls back to URL sharing when mobile file sharing is not supported", async () => {
    mockMobileDevice();
    mockFetchBlob(new Blob(["movie"], { type: "video/mp4" }));
    const share = vi.fn(async () => undefined);
    const canShare = vi.fn((data: ShareData) => !data.files);
    mockNavigatorProperty("share", share);
    mockNavigatorProperty("canShare", canShare);
    const showActivity = vi.fn();

    render(
      <DownloadHarness
        asset={makeImageAsset({
          generation_kind: "video",
          hero_original_path: "outputs/2026-04-09/original/output_01.mp4",
          payload: {
            outputs: [{ original_filename: "job_bec8bef43dae.mp4" }],
            options: { resolution: "2K", aspect_ratio: "16:9" },
          },
        })}
        onActivity={showActivity}
      />,
    );

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = share.mock.calls[0][0] as ShareData;
    expect(payload.files).toBeUndefined();
    expect(payload.title).toBe("ms-bec8bef43dae_nano-banana-2_2k_16-9.mp4");
    expect(payload.url).toBe(
      "http://localhost:3000/api/control/files/outputs/2026-04-09/original/output_01.mp4?download=1&filename=ms-bec8bef43dae_nano-banana-2_2k_16-9.mp4",
    );
    expect(showActivity).toHaveBeenCalledWith(
      { tone: "healthy", message: "Opened your device share sheet." },
      { autoHideMs: 2200 },
    );
  });

  it("does not force a fallback when the mobile share sheet is cancelled", async () => {
    mockMobileDevice();
    mockFetchBlob(new Blob(["png"], { type: "image/png" }));
    const share = vi.fn(async () => {
      throw new DOMException("Share cancelled", "AbortError");
    });
    mockNavigatorProperty("share", share);
    mockNavigatorProperty("canShare", vi.fn(() => true));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const showActivity = vi.fn();

    render(<DownloadHarness asset={makeImageAsset()} onActivity={showActivity} />);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(click).not.toHaveBeenCalled();
    expect(showActivity).not.toHaveBeenCalled();
  });
});
