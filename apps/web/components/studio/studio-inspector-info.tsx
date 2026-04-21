"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Heart, Image as ImageIcon, Play, Volume2 } from "lucide-react";

import {
  displayChoiceLabel,
  formatOptionValue,
  optionShortLabel,
  type StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import { InfoRow, SurfaceCard, SurfaceInset } from "@/components/ui/surface-primitives";
import type { MediaAsset } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type StudioInspectorInfoProps = {
  selectedAsset: MediaAsset;
  favoriteAssetIdBusy: string | number | null;
  onToggleFavorite: (asset: MediaAsset | null) => void;
  projectLabel?: string | null;
  onOpenProject?: (projectId: string) => void;
  referencePreviews?: StudioReferencePreview[];
  onOpenReference?: (reference: StudioReferencePreview) => void;
  className?: string;
};

export function StudioInspectorInfo({
  selectedAsset,
  favoriteAssetIdBusy,
  onToggleFavorite,
  projectLabel,
  onOpenProject,
  referencePreviews = [],
  onOpenReference,
  className,
}: StudioInspectorInfoProps) {
  const [copyLinkStatus, setCopyLinkStatus] = useState<"idle" | "copied" | "error">("idle");
  const optionEntries = Object.entries((selectedAsset.payload?.resolved_options as Record<string, unknown> | undefined) ?? {})
    .filter(([, value]) => value != null && value !== "")
    .slice(0, 6);
  const assetLinkParams = new URLSearchParams();
  if (selectedAsset.project_id) {
    assetLinkParams.set("project", String(selectedAsset.project_id));
  }
  assetLinkParams.set("asset", String(selectedAsset.asset_id));
  const assetLinkPath = `/studio?${assetLinkParams.toString()}`;

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
    <SurfaceCard appearance="studio" density="compact" className={cn("rounded-[22px]", className)}>
      <div className="surface-label-muted">Information</div>
      <div className="mt-3 grid gap-2">
        <InfoRow appearance="studio" label="Date" value={formatDateTime(selectedAsset.created_at)} />
        <InfoRow
          appearance="studio"
          label="Status"
          value={selectedAsset.status ?? "stored"}
          valueClassName="uppercase tracking-[0.08em]"
        />
        <InfoRow appearance="studio" label="Model" value={selectedAsset.model_key ?? "Unknown"} />
        <InfoRow appearance="studio" label="Preset" value={selectedAsset.preset_key ?? "builtin"} />
        <InfoRow appearance="studio" label="Type" value={selectedAsset.generation_kind ?? selectedAsset.task_mode ?? "asset"} />
        {selectedAsset.project_id ? (
          <button
            type="button"
            onClick={() => onOpenProject?.(String(selectedAsset.project_id))}
            className="surface-info-row text-left transition hover:bg-white/[0.05]"
          >
            <span className="text-sm text-white/56">Project</span>
            <span className="text-sm font-medium text-[rgba(255,183,107,0.96)]">
              {projectLabel?.trim() || String(selectedAsset.project_id)}
            </span>
          </button>
        ) : (
          <InfoRow appearance="studio" label="Project" value="Global" />
        )}
        <button
          type="button"
          onClick={() => void onToggleFavorite(selectedAsset)}
          disabled={favoriteAssetIdBusy === selectedAsset.asset_id}
          className="surface-info-row text-left transition hover:bg-white/[0.05] disabled:opacity-60"
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
          className="surface-info-row text-left transition hover:bg-white/[0.05]"
          title={copyLinkStatus === "copied" ? "Link copied" : copyLinkStatus === "error" ? "Copy failed" : "Copy link"}
        >
          <span className="text-sm text-white/56">Link</span>
          <span className="inline-flex items-center text-sm font-medium text-white/82">
            {copyLinkStatus === "copied" ? (
              <Check className="size-4 text-[#b8ff9f]" />
            ) : copyLinkStatus === "error" ? (
              <Copy className="size-4 text-[#ffb5a6]" />
            ) : (
              <Copy className="size-4 text-white/52" />
            )}
          </span>
        </button>
        {optionEntries.map(([key, value]) => (
          <InfoRow
            key={key}
            appearance="studio"
            label={optionShortLabel(key)}
            value={displayChoiceLabel(key, {}, value) || formatOptionValue(value)}
          />
        ))}
        {referencePreviews.length ? (
          <SurfaceInset appearance="studio" density="compact" className="rounded-[18px]">
            <div className="flex items-center gap-2 surface-label-muted">
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
                  <span className="surface-preview-frame">
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
          </SurfaceInset>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
