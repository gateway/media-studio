// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGraphMediaLibrary } from "./use-graph-media-library";

const { jsonFetch } = vi.hoisted(() => ({
  jsonFetch: vi.fn(),
}));

vi.mock("../utils/graph-api", () => ({
  creditBalanceFromPayload: vi.fn(() => null),
  jsonFetch,
}));

function Harness() {
  const { refreshImageAssets, refreshMediaLibrary, refreshReferenceMedia, assets, references } = useGraphMediaLibrary();

  useEffect(() => {
    void refreshMediaLibrary();
    void refreshImageAssets();
    void refreshReferenceMedia();
  }, [refreshImageAssets, refreshMediaLibrary, refreshReferenceMedia]);

  return (
    <div>
      <div data-testid="asset-count">{assets.length}</div>
      <div data-testid="reference-count">{references.length}</div>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("useGraphMediaLibrary", () => {
  it("deduplicates overlapping asset and reference refreshes", async () => {
    jsonFetch.mockImplementation(async (url: string) => {
      if (url.includes("/media-assets")) {
        return { assets: [{ asset_id: "asset_1", created_at: "2026-05-19T00:00:00.000Z" }] };
      }
      if (url.includes("/reference-media")) {
        return { items: [{ reference_id: "ref_1", file: "image.png" }] };
      }
      return {};
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId("asset-count").textContent).toBe("1"));
    await waitFor(() => expect(screen.getByTestId("reference-count").textContent).toBe("1"));
    expect(jsonFetch.mock.calls.filter(([url]: [string]) => url.includes("/media-assets"))).toHaveLength(1);
    expect(jsonFetch.mock.calls.filter(([url]: [string]) => url.includes("/reference-media"))).toHaveLength(1);
  });
});
