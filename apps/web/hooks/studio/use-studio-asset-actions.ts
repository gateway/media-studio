"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ComposerStatusMessage } from "@/lib/media-studio-contract";
import {
  getMobileShareBlob,
  inferBlobMimeType,
  isImageMimeType,
  isLikelyMobileSaveDevice,
  mediaDownloadName,
  mediaDownloadUrl,
  mediaInlineUrl,
  mobileSaveActionLabel,
  replaceFileExtension,
} from "@/lib/media-studio-helpers";
import type { MediaAsset } from "@/lib/types";

type StudioActivityPayload = {
  tone: "healthy" | "warning" | "danger" | "working";
  message: string;
  progress?: number | null;
  spinning?: boolean;
};

type UseStudioAssetActionsOptions = {
  hasMounted: boolean;
  onMessage: (message: ComposerStatusMessage | null) => void;
  showActivity: (activity: StudioActivityPayload, options?: { autoHideMs?: number }) => void;
};

function fallbackCopyTextToClipboard(text: string) {
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export function useStudioAssetActions({
  hasMounted,
  onMessage,
  showActivity,
}: UseStudioAssetActionsOptions) {
  const [copyPromptStatus, setCopyPromptStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyPromptStatusTimerRef = useRef<number | null>(null);
  const downloadActionLabel = useMemo(() => (hasMounted ? mobileSaveActionLabel() : "Download"), [hasMounted]);

  useEffect(() => {
    return () => {
      if (copyPromptStatusTimerRef.current != null) {
        window.clearTimeout(copyPromptStatusTimerRef.current);
      }
    };
  }, []);

  const showCopyPromptStatus = useCallback((status: "copied" | "error") => {
    setCopyPromptStatus(status);
    if (copyPromptStatusTimerRef.current != null) {
      window.clearTimeout(copyPromptStatusTimerRef.current);
    }
    copyPromptStatusTimerRef.current = window.setTimeout(() => {
      setCopyPromptStatus("idle");
      copyPromptStatusTimerRef.current = null;
    }, 1800);
  }, []);

  const copyPromptFromAsset = useCallback(
    async (promptText: string | null) => {
      if (!promptText) {
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(promptText);
        } else if (!fallbackCopyTextToClipboard(promptText)) {
          throw new Error("Clipboard copy is not available in this browser.");
        }
        showCopyPromptStatus("copied");
        onMessage({ tone: "healthy", text: "Copied the selected asset prompt." });
      } catch {
        if (fallbackCopyTextToClipboard(promptText)) {
          showCopyPromptStatus("copied");
          onMessage({ tone: "healthy", text: "Copied the selected asset prompt." });
          return;
        }
        showCopyPromptStatus("error");
        onMessage({ tone: "danger", text: "Studio could not copy the prompt on this device." });
      }
    },
    [onMessage, showCopyPromptStatus],
  );

  const downloadAsset = useCallback(
    async (asset: MediaAsset | null) => {
      if (!asset) {
        return;
      }

      const inlineUrl = mediaInlineUrl(asset);
      const downloadUrl = mediaDownloadUrl(asset) ?? inlineUrl;
      if (!downloadUrl) {
        return;
      }

      if (isLikelyMobileSaveDevice()) {
        const sourceUrl = new URL(inlineUrl ?? downloadUrl, window.location.origin).toString();
        const attachmentUrl = new URL(downloadUrl, window.location.origin).toString();
        try {
          const response = await fetch(attachmentUrl, { credentials: "same-origin" });
          if (!response.ok) {
            throw new Error("Download failed");
          }
          const originalBlob = await response.blob();
          const mimeType = inferBlobMimeType(asset, originalBlob);
          if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
            const shareFileName = mediaDownloadName(asset);
            try {
              const shareBlob = await getMobileShareBlob(new Blob([originalBlob], { type: mimeType }));
              const normalizedShareFileName =
                shareBlob.type === "image/jpeg" ? replaceFileExtension(shareFileName, "jpg") : shareFileName;
              const file = new File([shareBlob], normalizedShareFileName, {
                type: shareBlob.type || mimeType || "application/octet-stream",
              });
              const shareData: ShareData = { files: [file], title: normalizedShareFileName };
              if (typeof navigator.canShare !== "function" || navigator.canShare(shareData)) {
                await navigator.share(shareData);
                showActivity({ tone: "healthy", message: "Opened your device share sheet." }, { autoHideMs: 2200 });
                return;
              }
            } catch (error) {
              if (error instanceof DOMException && error.name === "AbortError") {
                return;
              }
            }
          }

          try {
            if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
              const urlShareData: ShareData = {
                title: mediaDownloadName(asset),
                url: isImageMimeType(mimeType) ? sourceUrl : attachmentUrl,
              };
              if (typeof navigator.canShare !== "function" || navigator.canShare(urlShareData)) {
                await navigator.share(urlShareData);
                showActivity({ tone: "healthy", message: "Opened your device share sheet." }, { autoHideMs: 2200 });
                return;
              }
            }
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
          }

          const objectUrl = URL.createObjectURL(new Blob([originalBlob], { type: mimeType }));
          try {
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = mediaDownloadName(asset);
            anchor.rel = "noopener";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            showActivity(
              { tone: "healthy", message: "Opened the media save flow for your device." },
              { autoHideMs: 2600 },
            );
            return;
          } finally {
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
          }
        } catch {
          // Fall through to the generic mobile open behavior below.
        }

        const fallbackLooksLikeImage = /\.(png|jpe?g|webp|gif)$/i.test(mediaDownloadName(asset));
        const opened = window.open(fallbackLooksLikeImage ? sourceUrl : attachmentUrl, "_blank", "noopener,noreferrer");
        if (!opened) {
          window.location.assign(attachmentUrl);
        }
        showActivity(
          { tone: "healthy", message: "Opened the original media so your device can save or share it." },
          { autoHideMs: 2600 },
        );
        return;
      }

      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = mediaDownloadName(asset);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    [showActivity],
  );

  return {
    copyPromptStatus,
    downloadActionLabel,
    copyPromptFromAsset,
    downloadAsset,
  };
}
