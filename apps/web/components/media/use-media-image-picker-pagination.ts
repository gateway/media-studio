"use client";

import { useCallback, useState } from "react";

import type { MediaImagePickerPage } from "./media-image-picker-types";

type UseMediaImagePickerPaginationOptions<T> = {
  fetchPage: (offset: number) => Promise<MediaImagePickerPage<T>>;
  getItemId: (item: T) => string;
  onError?: (message: string) => void;
};

export function useMediaImagePickerPagination<T>({
  fetchPage,
  getItemId,
  onError,
}: UseMediaImagePickerPaginationOptions<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [open, setOpen] = useState(false);

  const mergeItems = useCallback(
    (current: T[], next: T[]) => {
      const seen = new Set(current.map((item) => getItemId(item)));
      return current.concat(next.filter((item) => !seen.has(getItemId(item))));
    },
    [getItemId],
  );

  const loadPage = useCallback(
    async ({ append = false }: { append?: boolean } = {}) => {
      const offset = append ? nextOffset : 0;
      if (append && offset == null) return;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setNextOffset(null);
      }
      try {
        const page = await fetchPage(append ? offset ?? 0 : 0);
        setItems((current) => (append ? mergeItems(current, page.items) : page.items));
        setNextOffset(page.nextOffset);
      } catch (error) {
        onError?.(error instanceof Error ? error.message : "Unable to load images.");
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [fetchPage, mergeItems, nextOffset, onError],
  );

  const openPicker = useCallback(() => {
    setOpen(true);
    void loadPage({ append: false });
  }, [loadPage]);

  const closePicker = useCallback(() => setOpen(false), []);

  const loadNextPage = useCallback(() => loadPage({ append: true }), [loadPage]);

  const prependItems = useCallback(
    (nextItems: T[]) => {
      setItems((current) => {
        const seen = new Set(nextItems.map((item) => getItemId(item)));
        return nextItems.concat(current.filter((item) => !seen.has(getItemId(item))));
      });
    },
    [getItemId],
  );

  return {
    open,
    setOpen,
    items,
    setItems,
    loading,
    loadingMore,
    nextOffset,
    openPicker,
    closePicker,
    loadNextPage,
    refresh: () => loadPage({ append: false }),
    prependItems,
  };
}
