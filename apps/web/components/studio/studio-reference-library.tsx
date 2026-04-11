"use client";

import { Image as ImageIcon, LoaderCircle, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { StudioImageLightbox } from "@/components/studio/studio-image-lightbox";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { overlayBackdropClassName, overlayPanelClassName, softPanelClassName } from "@/components/ui/surfaces";
import { ToastBanner } from "@/components/ui/toast-banner";
import type { MediaReference } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type StudioReferenceLibraryProps = {
  kind?: "image" | "video" | "audio";
  title: string;
  onClose: () => void;
  onSelect: (reference: MediaReference) => void;
};

export function StudioReferenceLibrary({
  kind = "image",
  title,
  onClose,
  onSelect,
}: StudioReferenceLibraryProps) {
  const [items, setItems] = useState<MediaReference[]>([]);
  const [loading, setLoading] = useState(true);
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

  async function loadItems(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    const response = await fetch(`/api/control/reference-media?kind=${kind}&limit=120&offset=0`, {
      signal,
      credentials: "same-origin",
    });
    const payload = (await response.json()) as { ok?: boolean; error?: string; items?: MediaReference[] };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Unable to load the reference library.");
    }
    setItems(Array.isArray(payload.items) ? payload.items : []);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void loadItems(controller.signal).catch((loadError) => {
      if (!active || controller.signal.aborted) {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "Unable to load the reference library.");
      setLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [kind]);

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
    <div data-testid="studio-reference-library" className={cn(overlayBackdropClassName, "z-[119]")}>
      <div className="min-h-dvh p-0 lg:p-6">
        <div className={cn("flex min-h-dvh min-w-0 flex-col lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[34px]", overlayPanelClassName)}>
          <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-4 md:px-6">
            <div>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[rgba(208,255,72,0.94)]">
                Reference Library
              </div>
              <div className="mt-1 text-sm text-white/68">{title}</div>
            </div>
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
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6 md:py-6">
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {items.map((item) => (
                  <div
                    key={item.reference_id}
                    data-testid={`studio-reference-library-item-${item.reference_id}`}
                    className={cn(softPanelClassName, "grid gap-2 rounded-[18px] p-2 text-left shadow-[0_18px_40px_rgba(0,0,0,0.24)]")}
                  >
                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="group relative aspect-square overflow-hidden rounded-[14px] border border-white/10 bg-white/[0.05] text-left transition hover:border-[rgba(216,141,67,0.28)]"
                    >
                      {item.thumb_url ?? item.stored_url ? (
                        <img
                          src={item.thumb_url ?? item.stored_url ?? undefined}
                          alt={item.original_filename ?? item.reference_id}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/58">
                          <ImageIcon className="size-4" />
                        </div>
                      )}
                    </button>
                    <div className="min-w-0 px-0.5">
                      <div className="truncate text-[0.72rem] font-semibold tracking-[-0.01em] text-white/92">
                        {item.original_filename ?? item.reference_id}
                      </div>
                      <div className="mt-0.5 text-[0.64rem] leading-4 text-white/48">
                        {item.width && item.height ? `${item.width}×${item.height}` : "Unknown size"} · {Math.max(1, Math.round(item.file_size_bytes / 1024))} KB
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        onClick={() => onSelect(item)}
                        variant="primary"
                        size="compact"
                        className="h-8 min-w-0 rounded-full px-3 text-[0.62rem] tracking-[0.12em] text-[#172200]"
                      >
                        Use image
                      </Button>
                      <IconButton
                        icon={deletingReferenceId === item.reference_id ? LoaderCircle : Trash2}
                        onClick={() => void deleteItem(item.reference_id)}
                        disabled={deletingReferenceId === item.reference_id}
                        tone="danger"
                        iconClassName={deletingReferenceId === item.reference_id ? "animate-spin" : undefined}
                        className="h-8 w-8 rounded-full bg-[rgba(40,16,14,0.68)] text-[#ffb5a6]"
                        aria-label={`Delete ${item.original_filename ?? item.reference_id} from the library`}
                        title="Delete from library"
                      />
                    </div>
                    <div className="px-0.5 text-[0.62rem] leading-4 text-white/42">
                      Last used {item.last_used_at ? formatDateTime(item.last_used_at) : "never"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[26px] border border-dashed border-white/10 bg-[rgba(18,22,20,0.92)] px-5 py-8 text-sm leading-7 text-white/62">
                <div>No reference media is available yet.</div>
                <div className="mt-2">Upload and run an image first, or scan your existing uploads to populate the library.</div>
                <Button
                  data-testid="studio-reference-library-scan-empty"
                  onClick={() => void triggerBackfill()}
                  disabled={backfilling}
                  variant="primary"
                  size="compact"
                  className="mt-4 h-10 rounded-full text-[0.68rem] tracking-[0.12em] text-[#172200]"
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
              </div>
            )}
          </div>
        </div>
      </div>
      {previewItem ? (
        <StudioImageLightbox
          src={previewItem.stored_url ?? previewItem.thumb_url ?? ""}
          alt={previewItem.original_filename ?? previewItem.reference_id}
          kind={previewItem.kind === "video" ? "videos" : previewItem.kind === "audio" ? "audios" : "images"}
          posterSrc={previewItem.poster_url}
          onClose={() => setPreviewItem(null)}
        />
      ) : null}
    </div>
  );
}
