"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Heart, Image as ImageIcon, Play, Volume2 } from "lucide-react";

import {
  displayChoiceLabel,
  formatOptionValue,
  optionShortLabel,
  type StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type StudioInspectorInfoProps = {
  selectedAsset: MediaAsset;
  favoriteAssetIdBusy: string | number | null;
  onToggleFavorite: (asset: MediaAsset | null) => void;
  referencePreviews?: StudioReferencePreview[];
  onOpenReference?: (reference: StudioReferencePreview) => void;
  className?: string;
};

export function StudioInspectorInfo({
  selectedAsset,
  favoriteAssetIdBusy,
  onToggleFavorite,
  referencePreviews = [],
  onOpenReference,
  className,
}: StudioInspectorInfoProps) {
  const [copyLinkStatus, setCopyLinkStatus] = useState<"idle" | "copied" | "error">("idle");
  const optionEntries = Object.entries((selectedAsset.payload?.resolved_options as Record<string, unknown> | undefined) ?? {})
    .filter(([, value]) => value != null && value !== "")
    .slice(0, 6);
  const assetLinkPath = `/studio?asset=${encodeURIComponent(String(selectedAsset.asset_id))}`;

  useEffect(() => {
    if (copyLinkStatus === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setCopyLinkStatus("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [copyLinkStatus]);

  async function copyAssetLink() {
    try {
      const link = new URL(assetLinkPath, window.location.origin).toString();
      await navigator.clipboard.writeText(link);
      setCopyLinkStatus("copied");
    } catch {
      setCopyLinkStatus("error");
    }
  }

  return (
    <div className={cn("rounded-[22px] border border-white/8 bg-white/[0.03] p-4", className)}>
      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
        Information
      </div>
      <div className="mt-3 grid gap-2">
        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
          <span className="text-sm text-white/56">Date</span>
          <span className="text-sm font-medium text-white/92">{formatDateTime(selectedAsset.created_at)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
          <span className="text-sm text-white/56">Status</span>
          <span className="text-sm font-medium uppercase tracking-[0.08em] text-white/92">
            {selectedAsset.status ?? "stored"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
          <span className="text-sm text-white/56">Model</span>
          <span className="text-sm font-medium text-white/92">{selectedAsset.model_key ?? "Unknown"}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
          <span className="text-sm text-white/56">Preset</span>
          <span className="text-sm font-medium text-white/92">{selectedAsset.preset_key ?? "builtin"}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
          <span className="text-sm text-white/56">Type</span>
          <span className="text-sm font-medium text-white/92">
            {selectedAsset.generation_kind ?? selectedAsset.task_mode ?? "asset"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void onToggleFavorite(selectedAsset)}
          disabled={favoriteAssetIdBusy === selectedAsset.asset_id}
          className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.05] disabled:opacity-60"
        >
          <span className="text-sm text-white/56">Favorite</span>
          <span
            className={cn(
              "inline-flex items-center gap-2 text-sm font-medium",
              selectedAsset.favorited ? "text-[#ff9abc]" : "text-white/72",
            )}
          >
            <Heart className={cn("size-4", selectedAsset.favorited ? "fill-current" : "")} />
            {selectedAsset.favorited ? "Saved" : "Off"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void copyAssetLink()}
          data-testid="studio-inspector-copy-link"
          className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3 text-left transition hover:bg-white/[0.05]"
        >
          <span className="text-sm text-white/56">Link</span>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-white/82">
            {copyLinkStatus === "copied" ? (
              <>
                <Check className="size-4 text-[#b8ff9f]" />
                <span className="text-[#b8ff9f]">Copied</span>
              </>
            ) : copyLinkStatus === "error" ? (
              <>
                <Copy className="size-4 text-[#ffb5a6]" />
                <span className="text-[#ffb5a6]">Copy failed</span>
              </>
            ) : (
              <>
                <Copy className="size-4 text-white/52" />
                <span className="max-w-[10rem] truncate text-white/60">{assetLinkPath}</span>
              </>
            )}
          </span>
        </button>
        {optionEntries.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
            <span className="text-sm text-white/56">{optionShortLabel(key)}</span>
            <span className="text-sm font-medium text-white/92">
              {displayChoiceLabel(key, {}, value) || formatOptionValue(value)}
            </span>
          </div>
        ))}
        {referencePreviews.length ? (
          <div className="rounded-[18px] bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
              <ImageIcon className="size-3.5 text-[rgba(208,255,72,0.88)]" />
              References
            </div>
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {referencePreviews.map((reference) => (
                <button
                  key={reference.key}
                  type="button"
                  onClick={() => onOpenReference?.(reference)}
                  className="grid w-[5.25rem] shrink-0 gap-2 text-left transition hover:opacity-95"
                >
                  <span className="overflow-hidden rounded-[16px] border border-white/10 bg-black/18">
                    {reference.kind === "videos" ? (
                      reference.posterUrl ? (
                        <span className="relative block">
                          <img
                            src={reference.posterUrl}
                            alt={reference.label}
                            className="h-[5.25rem] w-[5.25rem] object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/28">
                            <Play className="size-4 text-white" />
                          </span>
                        </span>
                      ) : (
                        <span className="flex h-[5.25rem] w-[5.25rem] items-center justify-center bg-white/[0.05] text-white/72">
                          <Play className="size-4.5" />
                        </span>
                      )
                    ) : reference.kind === "audios" ? (
                      <span className="flex h-[5.25rem] w-[5.25rem] flex-col items-center justify-center gap-1 bg-white/[0.05] text-white/72">
                        <Volume2 className="size-4.5" />
                        <span className="text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-white/58">Audio</span>
                      </span>
                    ) : (
                      <img
                        src={reference.url}
                        alt={reference.label}
                        className="h-[5.25rem] w-[5.25rem] object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-white/70">{reference.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
