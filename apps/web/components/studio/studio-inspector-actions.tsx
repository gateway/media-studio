"use client";

import { Download, ImagePlus, Trash2, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";

type StudioInspectorActionsProps = {
  canDownload: boolean;
  downloadActionLabel: string;
  showImageActions: boolean;
  onDownload: () => void;
  onDismiss: () => void;
  onAnimate: () => void;
  onUseImage: () => void;
};

export function StudioInspectorActions({
  canDownload,
  downloadActionLabel,
  showImageActions,
  onDownload,
  onDismiss,
  onAnimate,
  onUseImage,
}: StudioInspectorActionsProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-2">
          {canDownload ? (
            <IconButton
              icon={Download}
              aria-label={downloadActionLabel}
              title={downloadActionLabel}
              onClick={onDownload}
              data-testid="studio-inspector-download"
              className="h-11 w-11 rounded-full border-white/12 bg-[rgba(8,10,9,0.72)] text-white/82 shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl"
            />
          ) : null}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <IconButton
            icon={Trash2}
            aria-label="Remove"
            title="Remove"
            onClick={onDismiss}
            tone="danger"
            data-testid="studio-inspector-remove"
            className="h-11 w-11 rounded-full border-[rgba(201,102,82,0.28)] bg-[rgba(40,16,14,0.76)] text-[#ffb5a6] shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl"
          />
        </div>
      </div>

      <div className="grid gap-3 rounded-[24px] border border-white/10 bg-[rgba(16,19,18,0.98)] p-3 shadow-[0_18px_38px_rgba(0,0,0,0.22)] lg:hidden">
        {showImageActions ? (
          <>
            <Button
              data-testid="studio-inspector-animate"
              onClick={onAnimate}
              variant="primary"
              className="h-11 w-full gap-2 shadow-[0_18px_38px_rgba(176,235,44,0.2)]"
            >
              <Wand2 className="size-4" />
              Animate
            </Button>
            <Button
              data-testid="studio-inspector-use-image"
              onClick={onUseImage}
              variant="subtle"
              className="h-11 w-full gap-2"
            >
              <ImagePlus className="size-4" />
              Use image
            </Button>
          </>
        ) : null}
      </div>

      <div className="hidden gap-3 lg:grid">
        {showImageActions ? (
          <>
            <Button
              data-testid="studio-inspector-animate-desktop"
              onClick={onAnimate}
              variant="primary"
              className="h-11 w-full gap-2 shadow-[0_18px_38px_rgba(176,235,44,0.2)]"
            >
              <Wand2 className="size-4" />
              Animate
            </Button>
            <Button
              data-testid="studio-inspector-use-image-desktop"
              onClick={onUseImage}
              variant="subtle"
              className="h-11 w-full gap-2"
            >
              <ImagePlus className="size-4" />
              Use image
            </Button>
          </>
        ) : null}
      </div>
    </>
  );
}
