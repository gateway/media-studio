"use client";
import { useEffect, useState } from "react";
import { Check, Download, Heart, Link, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaAsset } from "@/lib/types";

export function StudioInspectorUtilities({
  selectedAsset,
  favoriteAssetIdBusy,
  onToggleFavorite,
  canDownload,
  downloadActionLabel,
  onDownload,
  onDismiss,
}: {
  selectedAsset: MediaAsset;
  favoriteAssetIdBusy: string | number | null;
  onToggleFavorite: (asset: MediaAsset | null) => void;
  canDownload: boolean;
  downloadActionLabel: string;
  onDownload: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="studio-media-inspector-utilities">
      <Button
        appearance="admin"
        variant="ghost"
        size="touch-compact"
        aria-pressed={Boolean(selectedAsset.favorited)}
        disabled={favoriteAssetIdBusy === selectedAsset.asset_id}
        onClick={() => onToggleFavorite(selectedAsset)}
      >
        <Heart
          className={selectedAsset.favorited ? "size-5 fill-current" : "size-5"}
        />
        <span>{selectedAsset.favorited ? "Saved" : "Favorite"}</span>
      </Button>
      <CopyAssetLinkButton selectedAsset={selectedAsset} />
      {canDownload ? (
        <Button
          appearance="admin"
          variant="utility"
          size="touch-compact"
          data-testid="studio-inspector-download"
          onClick={onDownload}
        >
          <Download className="size-5" />
          <span>{downloadActionLabel}</span>
        </Button>
      ) : null}
      <Button
        appearance="admin"
        size="touch-compact"
        variant="danger-ghost"
        className="admin-action-separated"
        aria-label="Remove"
        data-testid="studio-inspector-remove"
        onClick={onDismiss}
      >
        <Trash2 className="size-5" />
        <span className="studio-media-inspector-remove-label">Remove</span>
      </Button>
    </div>
  );
}

function CopyAssetLinkButton({ selectedAsset }: { selectedAsset: MediaAsset }) {
  const [copyLinkStatus, setCopyLinkStatus] = useState<
    "idle" | "copied" | "error"
  >("idle");
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
      await navigator.clipboard.writeText(
        new URL(assetLinkPath, window.location.origin).toString(),
      );
      setCopyLinkStatus("copied");
    } catch {
      setCopyLinkStatus("error");
    }
  }
  return (
    <Button
      appearance="admin"
      variant="ghost"
      size="touch-compact"
      aria-label={
        copyLinkStatus === "copied"
          ? "Link copied"
          : copyLinkStatus === "error"
            ? "Copy failed"
            : "Copy link"
      }
      data-testid="studio-inspector-copy-link"
      onClick={() => {
        copyAssetLink().catch(console.error);
      }}
    >
      {copyLinkStatus === "copied" ? (
        <Check className="size-5" />
      ) : (
        <Link className="size-5" />
      )}
      <span role="status">
        {copyLinkStatus === "copied"
          ? "Link copied"
          : copyLinkStatus === "error"
            ? "Copy failed"
            : "Copy link"}
      </span>
    </Button>
  );
}
