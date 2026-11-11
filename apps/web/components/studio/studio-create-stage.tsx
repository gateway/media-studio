"use client";

import {
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useHorizontalSplitter } from "@/components/ui/use-horizontal-splitter";

type StudioCreateStageProps = {
  immersive: boolean;
  composerCollapsed: boolean;
  inspectorOpen?: boolean;
  children: ReactNode;
};

const COMPOSER_MIN_WIDTH = 266;
const GALLERY_MIN_WIDTH = 480;
const COMPOSER_MAX_WIDTH = 600;

function subscribeToViewport(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

function viewportWidth() {
  return window.innerWidth;
}

function initialComposerWidth(viewport: number) {
  return viewport < 1024
    ? Math.max(COMPOSER_MIN_WIDTH, Math.min(304, Math.round(viewport * 0.33)))
    : Math.max(328, Math.min(400, Math.round(viewport * 0.28)));
}

export function StudioCreateStage({
  immersive,
  composerCollapsed,
  inspectorOpen,
  children,
}: StudioCreateStageProps) {
  const viewport = useSyncExternalStore(
    subscribeToViewport,
    viewportWidth,
    () => 0,
  );
  const [preferredWidth, setPreferredWidth] = useState<number>();
  const desktop = immersive && viewport >= 768;
  const canResize = desktop && !composerCollapsed && !inspectorOpen;
  const maxWidth = Math.max(
    COMPOSER_MIN_WIDTH,
    Math.min(COMPOSER_MAX_WIDTH, viewport - GALLERY_MIN_WIDTH),
  );
  const width = Math.min(
    preferredWidth ?? initialComposerWidth(viewport),
    maxWidth,
  );
  const splitterProps = useHorizontalSplitter({
    label: "Resize Studio composer",
    width,
    minWidth: COMPOSER_MIN_WIDTH,
    maxWidth,
    growTowards: "right",
    enabled: canResize,
    onResize: setPreferredWidth,
  });
  const layout = immersive ? "immersive" : "framed";

  return (
    <div
      id="create"
      style={
        desktop
          ? ({ "--studio-rail-size": `${width}px` } as CSSProperties)
          : undefined
      }
      className={`studio-create-stage studio-create-stage-${layout}`}
    >
      <div
        className={`studio-create-stage-body studio-create-stage-body-${layout}`}
      >
        <div className="studio-create-stage-atmosphere" />
        <div className="studio-create-stage-vignette" />
        {canResize && (
          <div
            {...splitterProps}
            aria-controls="studio-composer-shell"
            className="studio-composer-divider"
          />
        )}
        {children}
      </div>
    </div>
  );
}
