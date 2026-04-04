"use client";

import { Heart } from "lucide-react";

import { displayChoiceLabel, formatOptionValue, optionShortLabel } from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";
import { cn } from "@/lib/utils";

type StudioInspectorInfoProps = {
  selectedAsset: MediaAsset;
  favoriteAssetIdBusy: string | number | null;
  onToggleFavorite: (asset: MediaAsset | null) => void;
  className?: string;
};

export function StudioInspectorInfo({
  selectedAsset,
  favoriteAssetIdBusy,
  onToggleFavorite,
  className,
}: StudioInspectorInfoProps) {
  const optionEntries = Object.entries((selectedAsset.payload?.resolved_options as Record<string, unknown> | undefined) ?? {})
    .filter(([, value]) => value != null && value !== "")
    .slice(0, 6);

  return (
    <div className={cn("rounded-[22px] border border-white/8 bg-white/[0.03] p-4", className)}>
      <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
        Information
      </div>
      <div className="mt-3 grid gap-2">
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
        {optionEntries.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3 rounded-[16px] bg-white/[0.03] px-3 py-3">
            <span className="text-sm text-white/56">{optionShortLabel(key)}</span>
            <span className="text-sm font-medium text-white/92">
              {displayChoiceLabel(key, {}, value) || formatOptionValue(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
