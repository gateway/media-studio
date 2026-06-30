"use client";

import { LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { StudioImageLightbox } from "@/components/studio/studio-image-lightbox";
import {
  StudioBrowserGrid,
  StudioBrowserLoadSentinel,
  StudioBrowserOverlay,
  StudioBrowserToolbar,
} from "@/components/studio/studio-browser-surface";
import { StudioReferenceLibraryItem } from "@/components/studio/studio-reference-library-item";
import { StudioStatusCallout } from "@/components/studio/studio-status-callout";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ToastBanner } from "@/components/ui/toast-banner";
import type { MediaReference } from "@/lib/types";

type StudioReferenceLibraryProps = {
  kind?: "image" | "video" | "audio" | "all";
  title: string;
  actionLabel?: string;
  onClose: () => void;
  onSelect: (reference: MediaReference) => void;
};

const REFERENCE_LIBRARY_PAGE_SIZE = 60;

type ReferenceLibraryPage = {
  items: MediaReference[];
  next_offset: number | null;
};

const fixtureReferenceItem: MediaReference = {
  reference_id: "fixture-reference-1",
  kind: "image",
  status: "ready",
  original_filename: "fixture-reference.png",
  stored_path: "references/fixture-reference.png",
  mime_type: "image/png",
  file_size_bytes: 2048,
  sha256: "fixture-reference-sha",
  width: 1200,
  height: 1600,
  thumb_url:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 320'%3E%3Crect width='320' height='320' fill='%23131614'/%3E%3Ccircle cx='224' cy='82' r='46' fill='%23d0ff48' opacity='0.72'/%3E%3Cpath d='M0 248 C70 188 116 208 172 154 C226 102 254 204 320 128 V320 H0 Z' fill='%23d88d43' opacity='0.64'/%3E%3Ctext x='32' y='58' font-family='Arial' font-size='26' fill='white'%3EFIXTURE%3C/text%3E%3C/svg%3E",
  stored_url:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 320'%3E%3Crect width='320' height='320' fill='%23131614'/%3E%3Ccircle cx='224' cy='82' r='46' fill='%23d0ff48' opacity='0.72'/%3E%3Cpath d='M0 248 C70 188 116 208 172 154 C226 102 254 204 320 128 V320 H0 Z' fill='%23d88d43' opacity='0.64'/%3E%3Ctext x='32' y='58' font-family='Arial' font-size='26' fill='white'%3EFIXTURE%3C/text%3E%3C/svg%3E",
  usage_count: 0,
  last_used_at: null,
  created_at: "2026-06-19T00:00:00Z",
  updated_at: "2026-06-19T00:00:00Z",
};

function referenceLibraryFixtureEnabled() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("studioTestHarness") !== "1" || params.get("studioFixture") !== "reference-library") return false;
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1"
  );
}

export function StudioReferenceLibrary({
  kind = "image",
  title,
  actionLabel,
  onClose,
  onSelect,
}: StudioReferenceLibraryProps) {
  const [items, setItems] = useState<MediaReference[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<MediaReference | null>(null);
  const [deletingReferenceId, setDeletingReferenceId] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillSummary, setBackfillSummary] = useState<{
    scanned: number;
    imported: number;
    reused: number;
    skipped: number;
    duration_seconds: number;
  } | null>(null);

  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const fetchItems = useCallback(async (offset: number, signal?: AbortSignal): Promise<ReferenceLibraryPage> => {
    if (referenceLibraryFixtureEnabled()) {
      return {
        items: offset === 0 ? [fixtureReferenceItem] : [],
        next_offset: null,
      };
    }
    const params = new URLSearchParams({
      limit: String(REFERENCE_LIBRARY_PAGE_SIZE),
      offset: String(offset),
    });
    if (kind !== "all") {
      params.set("kind", kind);
    }
    const response = await fetch(`/api/control/reference-media?${params.toString()}`, {
      signal,
      credentials: "same-origin",
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      items?: MediaReference[];
      offset?: number;
      next_offset?: number | null;
    };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Unable to load the reference library.");
    }
    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      next_offset: payload.next_offset ?? null,
    };
  }, [kind]);

  const loadItems = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setNextOffset(null);
    const page = await fetchItems(0, signal);
    setItems(page.items);
    setNextOffset(page.next_offset);
    setLoading(false);
  }, [fetchItems]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void loadItems(controller.signal).catch((loadError) => {
      if (!active || controller.signal.aborted) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "Unable to load the reference library.");
      setNextOffset(null);
      setLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [loadItems]);

  const loadMoreItems = useCallback(async () => {
    if (nextOffset == null || loading || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchItems(nextOffset);
      setItems((current) => [...current, ...page.items]);
      setNextOffset(page.next_offset);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load more reference media.");
    } finally {
      setLoadingMore(false);
    }
  }, [fetchItems, loading, loadingMore, nextOffset]);

  useEffect(() => {
    if (nextOffset == null || loading || loadingMore || typeof IntersectionObserver === "undefined") return;
    const element = loadMoreRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreItems();
        }
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [loadMoreItems, loading, loadingMore, nextOffset]);

  async function triggerBackfill() {
    setBackfilling(true);
    setError(null);
    try {
      const response = await fetch("/api/control/reference-media/backfill", {
        method: "POST",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
        scanned?: number;
        imported?: number;
        reused?: number;
        skipped?: number;
        duration_seconds?: number;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to scan existing uploads.");
      }
      setBackfillSummary({
        scanned: Number(payload.scanned ?? 0),
        imported: Number(payload.imported ?? 0),
        reused: Number(payload.reused ?? 0),
        skipped: Number(payload.skipped ?? 0),
        duration_seconds: Number(payload.duration_seconds ?? 0),
      });
      await loadItems();
    } catch (backfillError) {
      setError(backfillError instanceof Error ? backfillError.message : "Unable to scan existing uploads.");
    } finally {
      setBackfilling(false);
    }
  }

  async function deleteItem(referenceId: string) {
    setDeletingReferenceId(referenceId);
    setError(null);
    try {
      const response = await fetch(`/api/control/reference-media/${referenceId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to remove the library item.");
      }
      setItems((current) => current.filter((item) => item.reference_id !== referenceId));
      setPreviewItem((current) => (current?.reference_id === referenceId ? null : current));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to remove the library item.");
    } finally {
      setDeletingReferenceId(null);
    }
  }

  return (
    <>
      <StudioBrowserOverlay
        testId="studio-reference-library"
        zIndexClassName="z-[119]"
        eyebrow="Reference Library"
        title="Reference Library"
        description={title}
        actions={(
          <div className="flex items-center gap-2">
            <Button
              data-testid="studio-reference-library-scan"
              onClick={() => void triggerBackfill()}
              disabled={backfilling}
              variant="subtle"
              size="compact"
              className="h-10 gap-2 rounded-full text-[0.68rem] tracking-[0.14em]"
            >
              {backfilling ? (
                <>
                  <LoaderCircle className="mr-2 size-3.5 animate-spin" />
                  Scanning
                </>
              ) : (
                "Scan uploads"
              )}
            </Button>
            <IconButton
              icon={X}
              onClick={onClose}
              aria-label="Close reference library"
              className="h-10 w-10"
            />
          </div>
        )}
      >
        <StudioBrowserToolbar countLabel={`Showing ${items.length} reference ${items.length === 1 ? "item" : "items"}`} />
        {backfillSummary ? (
          <ToastBanner
            data-testid="studio-reference-library-backfill-summary"
            tone="healthy"
            title="Scan complete"
            message={`Scanned ${backfillSummary.scanned} upload${backfillSummary.scanned === 1 ? "" : "s"} · imported ${backfillSummary.imported} · reused ${backfillSummary.reused} · skipped ${backfillSummary.skipped} · ${backfillSummary.duration_seconds.toFixed(3)}s`}
            className="mb-4"
          />
        ) : null}
        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center text-white/62">
            <LoaderCircle className="mr-3 size-5 animate-spin text-[rgba(208,255,72,0.88)]" />
            Loading reference media...
          </div>
        ) : error ? (
          <ToastBanner tone="danger" title="Library error" message={error} className="rounded-[26px] px-5 py-5" />
        ) : items.length ? (
          <>
            <StudioBrowserGrid>
              {items.map((item) => (
                <StudioReferenceLibraryItem
                  key={item.reference_id}
                  item={item}
                  kind={kind}
                  actionLabel={actionLabel}
                  deleting={deletingReferenceId === item.reference_id}
                  onPreview={setPreviewItem}
                  onSelect={onSelect}
                  onDelete={(referenceId) => void deleteItem(referenceId)}
                />
              ))}
            </StudioBrowserGrid>
            {nextOffset != null ? (
              <StudioBrowserLoadSentinel
                ref={loadMoreRef}
                loading={loadingMore}
                label="Loading more reference media..."
              />
            ) : null}
          </>
        ) : (
          <StudioStatusCallout
            tone="muted"
            title="No reference media is available yet."
            description="Upload and run an image first, or scan your existing uploads to populate the library."
            action={(
              <Button
                data-testid="studio-reference-library-scan-empty"
                onClick={() => void triggerBackfill()}
                disabled={backfilling}
                variant="primary"
                size="compact"
                className="h-10 rounded-full text-[0.68rem] tracking-[0.12em] text-[#172200]"
              >
                {backfilling ? (
                  <>
                    <LoaderCircle className="mr-2 size-3.5 animate-spin" />
                    Scanning uploads
                  </>
                ) : (
                  "Scan existing uploads"
                )}
              </Button>
            )}
            className="rounded-[26px] py-8"
          />
        )}
      </StudioBrowserOverlay>
      {previewItem ? (
        <StudioImageLightbox
          src={previewItem.stored_url ?? previewItem.thumb_url ?? ""}
          alt={previewItem.original_filename ?? previewItem.reference_id}
          kind={previewItem.kind === "video" ? "videos" : previewItem.kind === "audio" ? "audios" : "images"}
          posterSrc={previewItem.poster_url}
          onClose={() => setPreviewItem(null)}
        />
      ) : null}
    </>
  );
}
