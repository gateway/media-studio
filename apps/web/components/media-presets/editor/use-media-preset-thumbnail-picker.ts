"use client";

import { useState } from "react";

import {
  type GeneratedThumbnailPickerItem,
} from "@/components/media/generated-thumbnail-picker-dialog";
import {
  fetchGeneratedImagePickerPage,
  generatedImagePickerItem,
} from "@/components/media/media-image-picker-sources";
import { useMediaImagePickerPagination } from "@/components/media/use-media-image-picker-pagination";
import type { MediaAssetPickerItem } from "@/lib/types";

type ThumbnailUpdate = {
  thumbnailPath: string;
  thumbnailUrl: string;
};

type ShowNotice = (tone: "healthy" | "danger", text: string, durationMs?: number) => void;

export function useMediaPresetThumbnailPicker({
  presetLabel,
  showNotice,
  onThumbnailChange,
}: {
  presetLabel: string;
  showNotice: ShowNotice;
  onThumbnailChange: (update: ThumbnailUpdate) => void;
}) {
  const [isUploadingThumbnail, setIsUploadingThumbnail] = useState(false);
  const [thumbnailAssetSelectionId, setThumbnailAssetSelectionId] = useState<string | null>(null);
  const picker = useMediaImagePickerPagination<MediaAssetPickerItem>({
    fetchPage: fetchGeneratedImagePickerPage,
    getItemId: (asset) => String(asset.asset_id),
    onError: (error) => showNotice("danger", error),
  });
  const pickerItems: GeneratedThumbnailPickerItem[] = picker.items
    .map((asset) => {
      const item = generatedImagePickerItem(asset);
      return item ? { ...item, ariaLabel: `Use generated image ${item.id} as preset thumbnail` } : null;
    })
    .filter((item): item is GeneratedThumbnailPickerItem => Boolean(item));

  async function uploadThumbnail(file: File) {
    setIsUploadingThumbnail(true);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("presetLabel", presetLabel || "preset-thumbnail");

    const response = await fetch("/api/control/media-preset-thumbnail", {
      method: "POST",
      body: formData,
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      thumbnail_path?: string;
      thumbnail_url?: string;
    };

    setIsUploadingThumbnail(false);
    if (!response.ok || result.ok === false || !result.thumbnail_url || !result.thumbnail_path) {
      showNotice("danger", result.error ?? "Unable to upload the preset thumbnail.");
      return;
    }

    onThumbnailChange({
      thumbnailPath: result.thumbnail_path,
      thumbnailUrl: result.thumbnail_url,
    });
    showNotice("healthy", "Thumbnail uploaded.");
  }

  async function applyThumbnailFromAsset(assetId: string | number) {
    setThumbnailAssetSelectionId(String(assetId));
    try {
      const response = await fetch("/api/control/media-preset-thumbnail/from-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: assetId,
          presetLabel: presetLabel || "preset-thumbnail",
        }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        thumbnail_path?: string;
        thumbnail_url?: string;
      };
      if (!response.ok || result.ok === false || !result.thumbnail_path || !result.thumbnail_url) {
        showNotice("danger", result.error ?? "Unable to use that generated image as the preset thumbnail.");
        return;
      }
      onThumbnailChange({
        thumbnailPath: result.thumbnail_path,
        thumbnailUrl: result.thumbnail_url,
      });
      picker.closePicker();
      showNotice("healthy", "Thumbnail selected from generated images.");
    } catch {
      showNotice("danger", "Unable to use that generated image as the preset thumbnail right now.");
    } finally {
      setThumbnailAssetSelectionId(null);
    }
  }

  return {
    isUploadingThumbnail,
    picker,
    pickerItems,
    thumbnailAssetSelectionId,
    uploadThumbnail,
    applyThumbnailFromAsset,
  };
}
