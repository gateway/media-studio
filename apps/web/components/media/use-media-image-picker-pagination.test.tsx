// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMediaImagePickerPagination } from "./use-media-image-picker-pagination";

type TestItem = { id: string; label: string };

function PaginationHarness({
  fetchPage,
  onError,
}: {
  fetchPage: (offset: number) => Promise<{ items: TestItem[]; nextOffset: number | null }>;
  onError?: (message: string) => void;
}) {
  const picker = useMediaImagePickerPagination<TestItem>({
    fetchPage,
    getItemId: (item) => item.id,
    onError,
  });

  return (
    <div>
      <button type="button" onClick={picker.openPicker}>
        Open
      </button>
      <button type="button" onClick={picker.loadNextPage}>
        Next
      </button>
      <button type="button" onClick={() => picker.prependItems([{ id: "local", label: "Local" }, { id: "a", label: "A Local Duplicate" }])}>
        Prepend
      </button>
      <button type="button" onClick={() => void picker.refresh()}>
        Refresh
      </button>
      <div data-testid="items">{picker.items.map((item) => item.label).join(",")}</div>
      <div data-testid="next-offset">{String(picker.nextOffset)}</div>
      <div data-testid="loading">{String(picker.loading)}</div>
      <div data-testid="loading-more">{String(picker.loadingMore)}</div>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("useMediaImagePickerPagination", () => {
  it("merges paged results by id and stops at null offsets", async () => {
    const fetchPage = vi.fn(async (offset: number) => {
      if (offset === 0) {
        return { items: [{ id: "a", label: "A" }, { id: "b", label: "B" }], nextOffset: 2 };
      }
      return { items: [{ id: "b", label: "B Duplicate" }, { id: "c", label: "C" }], nextOffset: null };
    });

    render(<PaginationHarness fetchPage={fetchPage} />);
    screen.getByRole("button", { name: "Open" }).click();

    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("A,B"));
    screen.getByRole("button", { name: "Next" }).click();

    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("A,B,C"));
    expect(screen.getByTestId("next-offset").textContent).toBe("null");

    screen.getByRole("button", { name: "Next" }).click();
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
  });

  it("prepends uploaded/local items without duplicating existing ids", async () => {
    const fetchPage = vi.fn(async () => ({
      items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      nextOffset: null,
    }));

    render(<PaginationHarness fetchPage={fetchPage} />);
    screen.getByRole("button", { name: "Open" }).click();
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("A,B"));

    screen.getByRole("button", { name: "Prepend" }).click();

    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("Local,A Local Duplicate,B"));
  });

  it("refreshes from offset zero and reports load errors", async () => {
    const onError = vi.fn();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "old", label: "Old" }], nextOffset: 1 })
      .mockResolvedValueOnce({ items: [{ id: "new", label: "New" }], nextOffset: null })
      .mockRejectedValueOnce(new Error("Picker failed"));

    render(<PaginationHarness fetchPage={fetchPage} onError={onError} />);
    screen.getByRole("button", { name: "Open" }).click();
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("Old"));

    screen.getByRole("button", { name: "Refresh" }).click();
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("New"));
    expect(fetchPage).toHaveBeenLastCalledWith(0);
    expect(screen.getByTestId("next-offset").textContent).toBe("null");

    screen.getByRole("button", { name: "Refresh" }).click();
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Picker failed"));
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });
});
