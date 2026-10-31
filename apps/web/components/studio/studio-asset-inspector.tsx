"use client";

import { Check, ChevronDown, Copy, X } from "lucide-react";
import { useId } from "react";
import { SelectedAssetPromptPanelContent } from "@/components/studio/selected-asset-prompt-panel-content";
import { StudioInspectorActions } from "@/components/studio/studio-inspector-actions";
import { StudioInspectorInfo } from "@/components/studio/studio-inspector-info";
import { StudioInspectorUtilities } from "@/components/studio/studio-inspector-utilities";
import { StudioInspectorMedia } from "@/components/studio/studio-inspector-media";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import type {
  StructuredPresetImageSlot,
  StructuredPresetTextField,
  StudioReferencePreview,
} from "@/lib/media-studio-helpers";
import { mediaDownloadUrl } from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";

type StudioAssetInspectorProps = {
  suspended?: boolean;
  selectedAsset: MediaAsset;
  selectedAssetDisplayVisual: string | null;
  selectedAssetPlaybackVisual: string | null;
  selectedAssetPrompt: string | null;
  selectedAssetStructuredPresetActive: boolean;
  selectedAssetPresetLabel: string | null;
  selectedAssetPresetLoadKey: string | null;
  selectedAssetPresetDescription: string | null;
  selectedAssetPresetSlots: StructuredPresetImageSlot[];
  selectedAssetPresetSlotValues: Record<string, unknown>;
  selectedAssetPresetFields: StructuredPresetTextField[];
  selectedAssetPresetInputValues: Record<string, string>;
  selectedAssetProjectLabel: string | null;
  selectedAssetReferencePreviews: StudioReferencePreview[];
  favoriteAssetIdBusy: string | number | null;
  copyPromptStatus: "idle" | "copied" | "error";
  mobileInspectorPromptOpen: boolean;
  downloadActionLabel: string;
  showReviseAction: boolean;
  onClose: () => void;
  onOpenLightbox: () => void;
  onCopyPrompt: () => void;
  onToggleFavorite: (asset: MediaAsset | null) => void;
  onUsePreset: (presetIdOrKey: string) => void;
  onOpenProject: (projectId: string | null) => void;
  onOpenReference: (reference: StudioReferencePreview | null) => void;
  onMobileInspectorPromptOpenChange: (open: boolean) => void;
  onDownload: () => void;
  onDismiss: () => void;
  onAnimate: () => void;
  onUseImage: () => void;
  onRevise: () => void;
};

export function StudioAssetInspector({
  suspended = false,
  selectedAsset,
  selectedAssetDisplayVisual,
  selectedAssetPlaybackVisual,
  selectedAssetPrompt,
  selectedAssetStructuredPresetActive,
  selectedAssetPresetLabel,
  selectedAssetPresetLoadKey,
  selectedAssetPresetDescription,
  selectedAssetPresetSlots,
  selectedAssetPresetSlotValues,
  selectedAssetPresetFields,
  selectedAssetPresetInputValues,
  selectedAssetProjectLabel,
  selectedAssetReferencePreviews,
  favoriteAssetIdBusy,
  copyPromptStatus,
  mobileInspectorPromptOpen,
  downloadActionLabel,
  showReviseAction,
  onClose,
  onOpenLightbox,
  onCopyPrompt,
  onToggleFavorite,
  onUsePreset,
  onOpenProject,
  onOpenReference,
  onMobileInspectorPromptOpenChange,
  onDownload,
  onDismiss,
  onAnimate,
  onUseImage,
  onRevise,
}: StudioAssetInspectorProps) {
  const panelRef = useDialogFocus(onClose, suspended);
  const titleId = useId();
  const promptId = useId();
  const kind =
    selectedAsset.generation_kind ?? selectedAsset.task_mode ?? "Media";
  const title = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} details`;
  return (
    <div className="admin-theme-root studio-media-inspector-backdrop scrollbar-none">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={!suspended || undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        inert={suspended || undefined}
        data-testid="studio-inspector"
        className="studio-media-inspector"
      >
        <header className="studio-media-inspector-header">
          <div className="studio-media-inspector-title">
            <h2 id={titleId}>{title}</h2>
            <p>
              {selectedAssetProjectLabel ||
                (selectedAsset.project_id
                  ? String(selectedAsset.project_id)
                  : "Global")}{" "}
              <span>/</span> {kind}
            </p>
          </div>
          <IconButton
            appearance="admin"
            size="touch"
            icon={X}
            quiet
            title="Close media details"
            aria-label="Close media details"
            onClick={onClose}
            className="studio-media-inspector-close"
          />
        </header>
        <div className="studio-media-inspector-media-column">
          <StudioInspectorMedia
            asset={selectedAsset}
            displayVisual={selectedAssetDisplayVisual}
            playbackVisual={selectedAssetPlaybackVisual}
            onOpenLightbox={onOpenLightbox}
          />
          <StudioInspectorUtilities
            selectedAsset={selectedAsset}
            favoriteAssetIdBusy={favoriteAssetIdBusy}
            onToggleFavorite={onToggleFavorite}
            canDownload={Boolean(mediaDownloadUrl(selectedAsset))}
            downloadActionLabel={downloadActionLabel}
            onDownload={onDownload}
            onDismiss={onDismiss}
          />
          <div className="studio-media-inspector-media-actions">
            <StudioInspectorActions
              showImageActions={selectedAsset.generation_kind === "image"}
              showReviseAction={showReviseAction}
              onAnimate={onAnimate}
              onUseImage={onUseImage}
              onRevise={onRevise}
            />
          </div>
        </div>
        <div className="studio-media-inspector-details scrollbar-none">
          <StudioInspectorInfo
            selectedAsset={selectedAsset}
            projectLabel={selectedAssetProjectLabel}
            onOpenProject={onOpenProject}
            presetLabel={selectedAssetPresetLabel}
            presetLoadKey={selectedAssetPresetLoadKey}
            onUsePreset={onUsePreset}
            referencePreviews={selectedAssetReferencePreviews}
            onOpenReference={onOpenReference}
          />
          <section className="studio-media-inspector-prompt">
            <div className="studio-media-inspector-section-heading">
              <h3>
                {selectedAssetStructuredPresetActive
                  ? "Preset Details"
                  : "Prompt"}
              </h3>
              <div className="flex items-center gap-1">
                {!selectedAssetStructuredPresetActive ? (
                  <Button
                    appearance="admin"
                    variant="ghost"
                    size="touch"
                    aria-label={
                      copyPromptStatus === "copied"
                        ? "Copied"
                        : copyPromptStatus === "error"
                          ? "Copy failed"
                          : "Copy"
                    }
                    onClick={onCopyPrompt}
                  >
                    {copyPromptStatus === "copied" ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    <span role="status">
                      {copyPromptStatus === "copied"
                        ? "Copied"
                        : copyPromptStatus === "error"
                          ? "Copy failed"
                          : "Copy"}
                    </span>
                  </Button>
                ) : null}
                <IconButton
                  appearance="admin"
                  size="touch"
                  icon={ChevronDown}
                  quiet
                  title={
                    mobileInspectorPromptOpen
                      ? "Collapse prompt"
                      : "Expand prompt"
                  }
                  aria-label={
                    mobileInspectorPromptOpen
                      ? "Collapse prompt"
                      : "Expand prompt"
                  }
                  aria-expanded={mobileInspectorPromptOpen}
                  aria-controls={promptId}
                  onClick={() =>
                    onMobileInspectorPromptOpenChange(
                      !mobileInspectorPromptOpen,
                    )
                  }
                  className="studio-media-inspector-disclosure"
                />
              </div>
            </div>
            <div
              id={promptId}
              data-open={mobileInspectorPromptOpen}
              className="studio-media-inspector-prompt-content"
            >
              <SelectedAssetPromptPanelContent
                structuredPresetActive={selectedAssetStructuredPresetActive}
                presetLabel={selectedAssetPresetLabel || "Preset"}
                presetDescription={selectedAssetPresetDescription}
                presetSlots={selectedAssetPresetSlots}
                presetSlotValues={selectedAssetPresetSlotValues}
                presetFields={selectedAssetPresetFields}
                presetInputValues={selectedAssetPresetInputValues}
                prompt={selectedAssetPrompt}
                promptContainerClassName="studio-media-inspector-prompt-text"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
