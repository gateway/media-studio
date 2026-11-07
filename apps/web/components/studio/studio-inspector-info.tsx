"use client";
import { Box, Folder, Image as ImageIcon, Play, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  studioCaptionClassName,
  studioPreviewFallbackClassName,
  studioPreviewOverlayClassName,
} from "@/components/studio/studio-theme";
import {
  displayChoiceLabel,
  formatOptionValue,
  optionShortLabel,
  toneForStatus,
  type StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type StudioInspectorInfoProps = {
  selectedAsset: MediaAsset;
  modelLabel?: string | null;
  projectLabel?: string | null;
  onOpenProject?: (projectId: string) => void;
  presetLabel?: string | null;
  presetLoadKey?: string | null;
  onUsePreset?: (presetIdOrKey: string) => void;
  referencePreviews?: StudioReferencePreview[];
  onOpenReference?: (reference: StudioReferencePreview) => void;
  children?: ReactNode;
};
export function StudioInspectorInfo({
  selectedAsset,
  modelLabel,
  projectLabel,
  onOpenProject,
  presetLabel,
  presetLoadKey,
  onUsePreset,
  referencePreviews = [],
  onOpenReference,
  children,
}: StudioInspectorInfoProps) {
  const optionEntries = Object.entries(
    (selectedAsset.payload?.resolved_options as
      Record<string, unknown> | undefined) ?? {},
  )
    .filter(([, value]) => value != null && value !== "")
    .slice(0, 6);
  return (
    <section className="studio-media-inspector-info">
      <dl className="studio-media-inspector-metadata studio-media-inspector-summary">
        <div className="studio-media-inspector-model">
          <dt>
            <Box aria-hidden="true" className="size-4" />
            Model
          </dt>
          <dd className="[overflow-wrap:anywhere]">
            {modelLabel ?? selectedAsset.model_key ?? "Unknown"}
          </dd>
        </div>
        <div className="studio-media-inspector-project">
          <dt>
            <Folder aria-hidden="true" className="size-4" />
            Project
          </dt>
          <dd>
            {selectedAsset.project_id ? (
              <Button
                appearance="admin"
                size="inline"
                variant="ghost"
                onClick={() =>
                  onOpenProject?.(String(selectedAsset.project_id))
                }
              >
                <span className="[overflow-wrap:anywhere]">
                  {projectLabel?.trim() || String(selectedAsset.project_id)}
                </span>
              </Button>
            ) : (
              "Global"
            )}
          </dd>
        </div>
      </dl>
      {children}
      {referencePreviews.length ? (
        <section
          className="studio-media-inspector-references"
          aria-label="References"
        >
          <h3 className="studio-media-inspector-reference-heading">
            <ImageIcon aria-hidden="true" className="size-4" />
            References
          </h3>
          <div className="studio-media-inspector-reference-list">
            {referencePreviews.map((reference) => (
              <button
                key={reference.key}
                type="button"
                onClick={() => onOpenReference?.(reference)}
                className="studio-media-inspector-reference"
                title={reference.label}
              >
                <span className="surface-preview-frame">
                  {reference.kind === "videos" ? (
                    reference.posterUrl ? (
                      <span className="relative block">
                        <img
                          src={reference.posterUrl}
                          alt={reference.label}
                          className="h-[5.25rem] w-[5.25rem] object-contain"
                          loading="lazy"
                          decoding="async"
                        />
                        <span className={studioPreviewOverlayClassName()}>
                          <Play className="size-4 text-[var(--foreground)]" />
                        </span>
                      </span>
                    ) : (
                      <span
                        className={studioPreviewFallbackClassName({
                          className: "h-[5.25rem] w-[5.25rem]",
                        })}
                      >
                        <Play className="size-4.5" />
                      </span>
                    )
                  ) : reference.kind === "audios" ? (
                    <span
                      className={studioPreviewFallbackClassName({
                        className: "h-[5.25rem] w-[5.25rem] flex-col gap-1",
                      })}
                    >
                      <Volume2 className="size-4.5" />
                      <span className="text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
                        Audio
                      </span>
                    </span>
                  ) : (
                    <img
                      src={reference.url}
                      alt={reference.label}
                      className="h-[5.25rem] w-[5.25rem] object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </span>
                <span
                  className={studioCaptionClassName({
                    className:
                      "line-clamp-2 break-words text-xs leading-5 [overflow-wrap:anywhere]",
                  })}
                >
                  {reference.label}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section
        className="studio-media-inspector-extra-details"
        aria-label="Asset metadata"
      >
        <div className="studio-media-inspector-section-heading">
          <h3>Details</h3>
          <StatusPill
            label={selectedAsset.status ?? "stored"}
            tone={toneForStatus(selectedAsset.status)}
          />
        </div>
        <dl className="studio-media-inspector-metadata">
          {modelLabel ? (
            <div>
              <dt>Model key</dt>
              <dd className="[overflow-wrap:anywhere]">
                {selectedAsset.model_key ?? "Unknown"}
              </dd>
            </div>
          ) : null}
          <div className="studio-media-inspector-created">
            <dt>Created</dt>
            <dd>{formatDateTime(selectedAsset.created_at)}</dd>
          </div>
          <div className="studio-media-inspector-type">
            <dt>Type</dt>
            <dd>
              {selectedAsset.generation_kind ??
                selectedAsset.task_mode ??
                "asset"}
            </dd>
          </div>
          <div className="studio-media-inspector-preset">
            <dt>Preset</dt>
            <dd>
              {presetLoadKey ? (
                <Button
                  appearance="admin"
                  size="inline"
                  variant="ghost"
                  title="Load this preset into the Studio composer"
                  onClick={() => onUsePreset?.(presetLoadKey)}
                >
                  <span className="[overflow-wrap:anywhere]">
                    {presetLabel ?? selectedAsset.preset_key ?? "Preset"}
                  </span>
                </Button>
              ) : (
                (presetLabel ?? selectedAsset.preset_key ?? "builtin")
              )}
            </dd>
          </div>
          {optionEntries.map(([key, value]) => (
            <div key={key} className="studio-media-inspector-option">
              <dt>{optionShortLabel(key)}</dt>
              <dd className="[overflow-wrap:anywhere]">
                {displayChoiceLabel(key, {}, value) || formatOptionValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </section>
  );
}
