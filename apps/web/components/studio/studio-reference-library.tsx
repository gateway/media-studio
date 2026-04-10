"use client";

import { Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

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
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <button
                    key={item.reference_id}
                    type="button"
                    data-testid={`studio-reference-library-item-${item.reference_id}`}
                    onClick={() => onSelect(item)}
                    className="grid gap-3 rounded-[24px] border border-white/10 bg-[rgba(18,22,20,0.92)] p-3 text-left shadow-[0_22px_54px_rgba(0,0,0,0.28)] transition hover:-translate-y-0.5 hover:border-[rgba(216,141,67,0.28)] hover:bg-[rgba(22,26,24,0.98)]"
                  >
                    <div className="aspect-[1/1] overflow-hidden rounded-[18px] border border-white/10 bg-white/[0.05]">
                      {item.thumb_url ?? item.stored_url ? (
                        <img
                          src={item.thumb_url ?? item.stored_url ?? undefined}
                          alt={item.original_filename ?? item.reference_id}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/58">
                          <ImageIcon className="size-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold tracking-[-0.02em] text-white/94">
                        {item.original_filename ?? item.reference_id}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-white/52">
                        {item.width && item.height ? `${item.width}×${item.height}` : "Unknown size"} · {Math.max(1, Math.round(item.file_size_bytes / 1024))} KB
                      </div>
                      <div className="mt-1 text-xs leading-5 text-white/46">
                        Last used {item.last_used_at ? formatDateTime(item.last_used_at) : "never"}
                      </div>
                    </div>
                  </button>
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
    </div>
  );
}
