"use client";

import { Image as ImageIcon, LoaderCircle, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { StudioImageLightbox } from "@/components/studio/studio-image-lightbox";
import type { MediaReference } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

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

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/control/reference-media?kind=${kind}&limit=120&offset=0`, {
          signal: controller.signal,
          credentials: "same-origin",
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string; items?: MediaReference[] };
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Unable to load the reference library.");
        }
        if (active) {
          setItems(Array.isArray(payload.items) ? payload.items : []);
        }
      } catch (loadError) {
        if (!active || controller.signal.aborted) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Unable to load the reference library.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [kind]);

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
    <div data-testid="studio-reference-library" className="fixed inset-0 z-[119] overflow-y-auto overscroll-contain bg-[rgba(6,8,7,0.78)] backdrop-blur-md [webkit-overflow-scrolling:touch]">
      <div className="min-h-dvh p-0 lg:p-6">
        <div className="flex min-h-dvh min-w-0 flex-col bg-[linear-gradient(180deg,rgba(16,20,18,0.98),rgba(10,13,12,0.98))] shadow-[0_40px_100px_rgba(0,0,0,0.5)] lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[34px] lg:border lg:border-white/8">
          <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-4 md:px-6">
            <div>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[rgba(208,255,72,0.94)]">
                Reference Library
              </div>
              <div className="mt-1 text-sm text-white/68">{title}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/78 transition hover:border-[rgba(216,141,67,0.28)] hover:text-white"
              aria-label="Close reference library"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6 md:py-6">
            {loading ? (
              <div className="flex min-h-[240px] items-center justify-center text-white/62">
                <LoaderCircle className="mr-3 size-5 animate-spin text-[rgba(208,255,72,0.88)]" />
                Loading reference media...
              </div>
            ) : error ? (
              <div className="rounded-[26px] border border-[rgba(201,102,82,0.18)] bg-[rgba(40,16,14,0.56)] px-5 py-8 text-sm leading-7 text-[#ffc8bd]">
                {error}
              </div>
            ) : items.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {items.map((item) => (
                  <div
                    key={item.reference_id}
                    data-testid={`studio-reference-library-item-${item.reference_id}`}
                    className="grid gap-2 rounded-[18px] border border-white/10 bg-[rgba(18,22,20,0.92)] p-2 text-left shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
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
                      <button
                        type="button"
                        onClick={() => onSelect(item)}
                        className="inline-flex h-8 min-w-0 items-center justify-center rounded-full border border-[rgba(208,255,72,0.18)] bg-[rgba(208,255,72,0.12)] px-3 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-[#dcff88] transition hover:border-[rgba(208,255,72,0.28)] hover:bg-[rgba(208,255,72,0.18)]"
                      >
                        Use image
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteItem(item.reference_id)}
                        disabled={deletingReferenceId === item.reference_id}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(201,102,82,0.24)] bg-[rgba(40,16,14,0.68)] text-[#ffb5a6] transition hover:border-[rgba(201,102,82,0.4)] hover:text-white disabled:opacity-60"
                        aria-label={`Delete ${item.original_filename ?? item.reference_id} from the library`}
                        title="Delete from library"
                      >
                        {deletingReferenceId === item.reference_id ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="px-0.5 text-[0.62rem] leading-4 text-white/42">
                      Last used {item.last_used_at ? formatDateTime(item.last_used_at) : "never"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[26px] border border-dashed border-white/10 bg-[rgba(18,22,20,0.92)] px-5 py-8 text-sm leading-7 text-white/62">
                No reference media is available yet. Upload and run an image first, then it will appear here for reuse.
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
