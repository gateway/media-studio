// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudioReferenceLibrary } from "@/components/studio/studio-reference-library";
import type { MediaReference } from "@/lib/types";

const referenceItem: MediaReference = {
  reference_id: "reference-1",
  kind: "image",
  status: "ready",
  original_filename: "reference-one.png",
  stored_path: "references/reference-one.png",
  mime_type: "image/png",
  file_size_bytes: 2048,
  sha256: "sha-reference-1",
  width: 1200,
  height: 1600,
  thumb_url: "/api/control/files/references/reference-one-thumb.png",
  stored_url: "/api/control/files/references/reference-one.png",
  usage_count: 0,
  last_used_at: null,
  created_at: "2026-06-09T00:00:00Z",
  updated_at: "2026-06-09T00:00:00Z",
};

function makeReference(index: number): MediaReference {
  return {
    ...referenceItem,
    reference_id: `reference-${index}`,
    original_filename: `reference-${index}.png`,
    stored_path: `references/reference-${index}.png`,
    sha256: `sha-reference-${index}`,
    thumb_url: `/api/control/files/references/reference-${index}-thumb.png`,
    stored_url: `/api/control/files/references/reference-${index}.png`,
  };
}

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("StudioReferenceLibrary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("preserves preview, contextual select, and delete behavior", async () => {
    const onSelect = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/control/reference-media?")) {
        return jsonResponse({ ok: true, items: [referenceItem] });
      }
      if (url === "/api/control/reference-media/reference-1" && init?.method === "DELETE") {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StudioReferenceLibrary
        title="Choose a reference"
        actionLabel="Attach image"
        onClose={vi.fn()}
        onSelect={onSelect}
      />,
    );

    await screen.findByTestId("studio-reference-library-item-reference-1");

    fireEvent.click(screen.getByRole("button", { name: "Preview reference-one.png" }));
    expect(screen.getByTestId("studio-image-lightbox")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Attach image" }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ reference_id: "reference-1" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete reference-one.png from the library" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/control/reference-media/reference-1",
        expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("studio-reference-library-item-reference-1")).toBeNull();
    });
  });

  it("preserves upload scanning and backfill summary behavior", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/control/reference-media?")) {
        const hasBackfilled = fetchMock.mock.calls.some(
          ([calledUrl, calledInit]) => String(calledUrl) === "/api/control/reference-media/backfill" && calledInit?.method === "POST",
        );
        return jsonResponse({ ok: true, items: hasBackfilled ? [referenceItem] : [] });
      }
      if (url === "/api/control/reference-media/backfill" && init?.method === "POST") {
        return jsonResponse({
          ok: true,
          scanned: 4,
          imported: 1,
          reused: 2,
          skipped: 1,
          duration_seconds: 0.123,
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StudioReferenceLibrary
        title="Choose a reference"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await screen.findByText("No reference media is available yet.");
    fireEvent.click(screen.getByTestId("studio-reference-library-scan-empty"));

    await screen.findByTestId("studio-reference-library-backfill-summary");
    expect(screen.getByText(/Scanned 4 uploads/)).toBeTruthy();
    expect(await screen.findByTestId("studio-reference-library-item-reference-1")).toBeTruthy();
  });

  it("loads additional reference pages through the hidden scroll sentinel", async () => {
    const references = Array.from({ length: 65 }, (_, index) => makeReference(index));
    let intersectionCallback: IntersectionObserverCallback | null = null;
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }

      observe = vi.fn();
      disconnect = vi.fn();
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const offset = url.includes("offset=60") ? 60 : 0;
      return jsonResponse({
        ok: true,
        items: references.slice(offset, offset + 60),
        limit: 60,
        offset,
        next_offset: offset === 0 ? 60 : null,
      });
    });
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StudioReferenceLibrary
        title="Choose a reference"
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId(/studio-reference-library-item-/)).toHaveLength(60);
      expect(intersectionCallback).not.toBeNull();
    });

    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    await waitFor(() => {
      expect(screen.getAllByTestId(/studio-reference-library-item-/)).toHaveLength(65);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/control/reference-media?limit=60&offset=60&kind=image",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(screen.getByText("Showing 65 reference items")).toBeTruthy();
  });
});
