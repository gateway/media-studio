"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Heart, Image as ImageIcon, Play, Volume2 } from "lucide-react";

import {
  studioCaptionClassName,
  studioMetaLabelClassName,
  studioMetaValueClassName,
  studioPreviewFallbackClassName,
  studioPreviewOverlayClassName,
} from "@/components/studio/studio-theme";
import {
  displayChoiceLabel,
  formatOptionValue,
  optionShortLabel,
  type StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import { InfoRow, SurfaceCard, SurfaceInset, infoRowClassName } from "@/components/ui/surface-primitives";
import type { MediaAsset } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type StudioInspectorInfoProps = {
  selectedAsset: MediaAsset;
  favoriteAssetIdBusy: string | number | null;
  onToggleFavorite: (asset: MediaAsset | null) => void;
  projectLabel?: string | null;
  onOpenProject?: (projectId: string) => void;
  presetLabel?: string | null;
  presetLoadKey?: string | null;
  onUsePreset?: (presetIdOrKey: string) => void;
  referencePreviews?: StudioReferencePreview[];
  onOpenReference?: (reference: StudioReferencePreview) => void;
  className?: string;
};

const inspectorInfoRowClassName = "min-w-0 items-start";
const inspectorInfoValueClassName = "min-w-0 max-w-full flex-1 break-words text-right [overflow-wrap:anywhere]";

export function StudioInspectorInfo({
  selectedAsset,
  favoriteAssetIdBusy,
  onToggleFavorite,
  projectLabel,
  onOpenProject,
  presetLabel,
  presetLoadKey,
  onUsePreset,
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
    <SurfaceCard appearance="studio" density="compact" className={cn("min-w-0 rounded-[22px]", className)}>
      <div className="surface-label-muted">Information</div>
      <div className="mt-3 grid gap-2">
        <InfoRow
          appearance="studio"
          label="Date"
          value={formatDateTime(selectedAsset.created_at)}
          className={inspectorInfoRowClassName}
          valueClassName={inspectorInfoValueClassName}
        />
        <InfoRow
          appearance="studio"
          label="Status"
          value={selectedAsset.status ?? "stored"}
          className={inspectorInfoRowClassName}
          valueClassName={cn(inspectorInfoValueClassName, "uppercase tracking-[0.08em]")}
        />
        <InfoRow
          appearance="studio"
          label="Model"
          value={selectedAsset.model_key ?? "Unknown"}
          className={inspectorInfoRowClassName}
          valueClassName={inspectorInfoValueClassName}
        />
        {presetLoadKey ? (
          <button
            type="button"
            onClick={() => onUsePreset?.(presetLoadKey)}
            className={infoRowClassName({ interactive: true, className: "min-w-0 items-start text-left" })}
            title="Load this preset into the Studio composer"
          >
            <span className={studioMetaLabelClassName({ className: "shrink-0" })}>Preset</span>
            <span className={studioMetaValueClassName({ tone: "accent", className: "min-w-0 flex-1 break-words text-right text-sm [overflow-wrap:anywhere]" })}>
              {presetLabel ?? selectedAsset.preset_key ?? "Preset"}
            </span>
          </button>
        ) : (
          <InfoRow
            appearance="studio"
            label="Preset"
            value={presetLabel ?? selectedAsset.preset_key ?? "builtin"}
            className={inspectorInfoRowClassName}
            valueClassName={inspectorInfoValueClassName}
          />
        )}
        <InfoRow
          appearance="studio"
          label="Type"
          value={selectedAsset.generation_kind ?? selectedAsset.task_mode ?? "asset"}
          className={inspectorInfoRowClassName}
          valueClassName={inspectorInfoValueClassName}
        />
        {selectedAsset.project_id ? (
          <button
            type="button"
            onClick={() => onOpenProject?.(String(selectedAsset.project_id))}
            className={infoRowClassName({ interactive: true, className: "min-w-0 items-start text-left" })}
          >
            <span className={studioMetaLabelClassName({ className: "shrink-0" })}>Project</span>
            <span className={studioMetaValueClassName({ tone: "accent", className: "min-w-0 flex-1 break-words text-right text-sm [overflow-wrap:anywhere]" })}>
              {projectLabel?.trim() || String(selectedAsset.project_id)}
            </span>
          </button>
        ) : (
          <InfoRow
            appearance="studio"
            label="Project"
            value="Global"
            className={inspectorInfoRowClassName}
            valueClassName={inspectorInfoValueClassName}
          />
        )}
        <button
          type="button"
          onClick={() => void onToggleFavorite(selectedAsset)}
          disabled={favoriteAssetIdBusy === selectedAsset.asset_id}
          className={infoRowClassName({ interactive: true, className: "text-left disabled:opacity-60" })}
        >
          <span className={studioMetaLabelClassName()}>Favorite</span>
          <span
            className={cn(
              "inline-flex items-center gap-2 text-sm font-medium",
              selectedAsset.favorited ? "text-[var(--action-danger-text)]" : "text-[var(--text-muted)]",
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
          className={infoRowClassName({ interactive: true, className: "text-left" })}
          title={copyLinkStatus === "copied" ? "Link copied" : copyLinkStatus === "error" ? "Copy failed" : "Copy link"}
        >
          <span className={studioMetaLabelClassName()}>Link</span>
          <span className={studioMetaValueClassName({ className: "inline-flex items-center text-sm" })}>
            {copyLinkStatus === "copied" ? (
              <Check className="size-4 text-[var(--feedback-healthy-text)]" />
            ) : copyLinkStatus === "error" ? (
              <Copy className="size-4 text-[var(--action-danger-text)]" />
            ) : (
              <Copy className="size-4 text-[var(--text-dim)]" />
            )}
          </span>
        </button>
        {optionEntries.map(([key, value]) => (
          <InfoRow
            key={key}
            appearance="studio"
            label={optionShortLabel(key)}
            value={displayChoiceLabel(key, {}, value) || formatOptionValue(value)}
            className={inspectorInfoRowClassName}
            valueClassName={inspectorInfoValueClassName}
          />
        ))}
        {referencePreviews.length ? (
          <SurfaceInset appearance="studio" density="compact" className="min-w-0 overflow-hidden rounded-[18px]">
            <div className="flex items-center gap-2 surface-label-muted">
              <ImageIcon className="size-3.5 text-[var(--accent-strong)]" />
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
                          <span className={studioPreviewOverlayClassName()}>
                            <Play className="size-4 text-white" />
                          </span>
                        </span>
                      ) : (
                        <span className={studioPreviewFallbackClassName({ className: "h-[5.25rem] w-[5.25rem]" })}>
                          <Play className="size-4.5" />
                        </span>
                      )
                    ) : reference.kind === "audios" ? (
                      <span className={studioPreviewFallbackClassName({ className: "h-[5.25rem] w-[5.25rem] flex-col gap-1" })}>
                        <Volume2 className="size-4.5" />
                        <span className="text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">Audio</span>
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
                  <span className={studioCaptionClassName({ className: "line-clamp-2 break-words text-xs leading-5 [overflow-wrap:anywhere]" })}>{reference.label}</span>
                </button>
              ))}
            </div>
          </SurfaceInset>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
