"use client";

import Image from "next/image";
import { X } from "lucide-react";

import { AdminButton } from "@/components/admin-controls";
import { overlayBackdropClassName, overlayPanelClassName } from "@/components/ui/surfaces";
import { generatedThumbnailPreviewUrl } from "@/components/prompt-recipes/editor/prompt-recipe-thumbnail-utils";
import {
  promptRecipeMediaFallbackClassName,
  promptRecipeMediaFrameClassName,
  promptRecipeOverlayFooterClassName,
  promptRecipeOverlayHeaderClassName,
  promptRecipeOverlayPanelClassName,
} from "@/components/prompt-recipes/prompt-recipe-admin-theme";
import type { MediaAsset } from "@/lib/types";

export function PromptRecipeThumbnailPickerDialog({
  open,
  assets,
  assetsLoading,
  assetsLoadingMore,
  nextOffset,
  selectionId,
  onClose,
  onLoadMore,
  onSelectAsset,
}: {
  open: boolean;
  assets: MediaAsset[];
  assetsLoading: boolean;
  assetsLoadingMore: boolean;
  nextOffset: number | null;
  selectionId: string | null;
  onClose: () => void;
  onLoadMore: () => void;
  onSelectAsset: (assetId: string | number) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div
      className={`${overlayBackdropClassName} z-[120] flex items-center justify-center bg-[var(--surface-overlay-backdrop)] p-4`}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Generated image thumbnails"
        className={`${overlayPanelClassName} ${promptRecipeOverlayPanelClassName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={promptRecipeOverlayHeaderClassName}>
          <div className="grid gap-1">
            <div className="admin-label-accent">Generated Images</div>
            <h2 className="text-xl font-semibold text-[var(--foreground)]">Choose a prompt recipe thumbnail</h2>
            <p className="text-sm text-[var(--muted-strong)]">
              Pick from recent generated image outputs. The selected image is copied into prompt recipe thumbnail storage.
            </p>
          </div>
          <AdminButton
            variant="subtle"
            size="compact"
            onClick={onClose}
            aria-label="Close generated image picker"
          >
            <X className="size-4" />
          </AdminButton>
        </div>

        <div className="flex max-h-[calc(88vh-92px)] flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {assetsLoading ? (
              <div className="admin-surface-inset flex min-h-60 items-center justify-center p-6 text-sm text-[var(--muted-strong)]">
                Loading generated images...
              </div>
            ) : assets.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {assets.map((asset) => {
                  const previewUrl = generatedThumbnailPreviewUrl(asset);
                  const selecting = selectionId === String(asset.asset_id);
                  return (
                    <article key={String(asset.asset_id)} className="admin-surface-inset p-3">
                      <button
                        type="button"
                        className="grid w-full gap-3 text-left"
                        onClick={() => onSelectAsset(asset.asset_id)}
                        disabled={selecting}
                        aria-label={`Use generated image ${String(asset.asset_id)} as thumbnail`}
                      >
                        <div className={`${promptRecipeMediaFrameClassName} aspect-video`}>
                          {previewUrl ? (
                            <Image src={previewUrl} alt="" fill sizes="480px" className="object-cover" />
                          ) : (
                            <div className={promptRecipeMediaFallbackClassName}>No preview</div>
                          )}
                        </div>
                        <div className="grid gap-1">
                          <div className="text-sm font-semibold text-[var(--foreground)]">
                            {asset.prompt_summary?.trim() || asset.model_key || `Generated image ${String(asset.asset_id)}`}
                          </div>
                          <div className="text-xs text-[var(--muted-strong)]">
                            {asset.model_key || "Generated image"} · {new Date(asset.created_at).toLocaleString()}
                          </div>
                        </div>
                      </button>
                      <div className="mt-3 flex justify-end">
                        <AdminButton
                          variant="subtle"
                          size="compact"
                          onClick={() => onSelectAsset(asset.asset_id)}
                          disabled={selecting}
                        >
                          {selecting ? "Applying..." : "Use image"}
                        </AdminButton>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="admin-surface-inset flex min-h-60 items-center justify-center p-6 text-sm text-[var(--muted-strong)]">
                No generated images are available yet.
              </div>
            )}
          </div>

          <div className={promptRecipeOverlayFooterClassName}>
            <div className="text-sm text-[var(--muted-strong)]">
              Showing {assets.length} generated image{assets.length === 1 ? "" : "s"}.
            </div>
            <div className="flex flex-wrap gap-2">
              {nextOffset != null ? (
                <AdminButton variant="subtle" onClick={onLoadMore} disabled={assetsLoadingMore}>
                  {assetsLoadingMore ? "Loading..." : "Load More"}
                </AdminButton>
              ) : null}
              <AdminButton variant="subtle" onClick={onClose}>
                Close
              </AdminButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
