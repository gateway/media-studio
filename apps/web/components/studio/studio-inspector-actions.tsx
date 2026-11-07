"use client";
import { Image as ImageIcon, Play, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type StudioInspectorActionsProps = {
  showImageActions: boolean;
  showReviseAction: boolean;
  onAnimate: () => void;
  onUseImage: () => void;
  onRevise: () => void;
};
export function StudioInspectorActions({
  showImageActions,
  showReviseAction,
  onAnimate,
  onUseImage,
  onRevise,
}: StudioInspectorActionsProps) {
  if (!showImageActions && !showReviseAction) return null;
  return (
    <div className="studio-media-inspector-creative-actions">
      {showImageActions ? (
        <>
          <Button
            appearance="admin"
            size="default"
            variant="subtle"
            data-testid="studio-inspector-animate"
            onClick={onAnimate}
          >
            <Play className="size-4" />
            <span>Animate</span>
          </Button>
          <Button
            appearance="admin"
            size="default"
            variant="subtle"
            data-testid="studio-inspector-use-image"
            onClick={onUseImage}
          >
            <ImageIcon className="size-4" />
            <span>Use image</span>
          </Button>
        </>
      ) : null}
      {showReviseAction ? (
        <Button
          appearance="admin"
          size="default"
          variant="subtle"
          data-testid="studio-inspector-revise"
          onClick={onRevise}
        >
          <RefreshCcw className="size-4" />
          <span>Create Revision</span>
        </Button>
      ) : null}
    </div>
  );
}
