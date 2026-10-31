"use client";
import { ImagePlus, RefreshCcw, Wand2 } from "lucide-react";
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
      {showReviseAction ? (
        <Button
          appearance="admin"
          size="touch"
          variant="subtle"
          data-testid="studio-inspector-revise"
          onClick={onRevise}
        >
          <RefreshCcw className="size-5" />
          <span>Create Revision</span>
        </Button>
      ) : null}
      {showImageActions ? (
        <>
          <Button
            appearance="admin"
            size="touch"
            data-testid="studio-inspector-animate"
            onClick={onAnimate}
          >
            <Wand2 className="size-5" />
            <span>Animate</span>
          </Button>
          <Button
            appearance="admin"
            size="touch"
            variant="subtle"
            data-testid="studio-inspector-use-image"
            onClick={onUseImage}
          >
            <ImagePlus className="size-5" />
            <span>Use image</span>
          </Button>
        </>
      ) : null}
    </div>
  );
}
