"use client";
import { useEffect, useState } from "react";
import { Check, Download, Heart, Link, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
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
      <IconButton
        icon={Heart}
        appearance="admin"
        quiet
        title={selectedAsset.favorited ? "Saved" : "Favorite"}
        aria-label={selectedAsset.favorited ? "Saved" : "Favorite"}
        iconClassName={
          selectedAsset.favorited ? "size-4 fill-current" : "size-4"
        }
        aria-pressed={Boolean(selectedAsset.favorited)}
        disabled={favoriteAssetIdBusy === selectedAsset.asset_id}
        onClick={() => onToggleFavorite(selectedAsset)}
      />
      <CopyAssetLinkButton selectedAsset={selectedAsset} />
      {canDownload ? (
        <IconButton
          icon={Download}
          appearance="admin"
          quiet
          title={downloadActionLabel}
          aria-label={downloadActionLabel}
          iconClassName="size-4"
          data-testid="studio-inspector-download"
          onClick={onDownload}
        />
      ) : null}
      <IconButton
        icon={Trash2}
        appearance="admin"
        quiet
        tone="danger"
        title="Remove"
        iconClassName="size-4"
        aria-label="Remove"
        data-testid="studio-inspector-remove"
        onClick={onDismiss}
      />
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
  const label =
    copyLinkStatus === "copied"
      ? "Link copied"
      : copyLinkStatus === "error"
        ? "Copy failed"
        : "Copy link";
  return (
    <>
      <IconButton
        icon={copyLinkStatus === "copied" ? Check : Link}
        appearance="admin"
        quiet
        title={label}
        aria-label={label}
        iconClassName="size-4"
        data-testid="studio-inspector-copy-link"
        onClick={() => {
          copyAssetLink().catch(console.error);
        }}
      />
      <span role="status" className="sr-only">
        {copyLinkStatus === "idle" ? "" : label}
      </span>
    </>
  );
}
