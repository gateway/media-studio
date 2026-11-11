import { useEffect, useRef, useState } from "react";
import { useHorizontalSplitter } from "@/components/ui/use-horizontal-splitter";

export type AssistantPlacement = "right" | "floating";
const STORAGE_KEY = "media-studio:graph-studio:assistant-layout";
const MIN_WIDTH = 320;
const GRAPH_MIN_WIDTH = 480;

function readPreference(): { placement: AssistantPlacement; width: number } {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "null",
    );
    return {
      placement: value?.placement === "floating" ? "floating" : "right",
      width:
        typeof value?.width === "number" && Number.isFinite(value.width)
          ? Math.max(MIN_WIDTH, value.width)
          : 420,
    };
  } catch {
    return { placement: "right", width: 420 };
  }
}

/** Layout preferences never enter the workflow or assistant session state. */
export function useAssistantDock(open: boolean) {
  const containerRef = useRef<HTMLElement>(null);
  const [preference, setPreference] = useState<{
    placement: AssistantPlacement;
    width: number;
  }>({ placement: "right", width: 420 });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setPreference(readPreference());
    setLoaded(true);
  }, []);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const maxWidth = Math.max(
    MIN_WIDTH,
    Math.floor(availableWidth - GRAPH_MIN_WIDTH),
  );
  const width = Math.min(preference.width, maxWidth);
  const docked =
    open &&
    !minimized &&
    preference.placement === "right" &&
    availableWidth >= MIN_WIDTH + GRAPH_MIN_WIDTH;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailableWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    } catch {
      /* Layout remains usable when browser storage is unavailable. */
    }
  }, [preference, loaded]);
  const splitterProps = useHorizontalSplitter({
    label: "Resize Media Assistant",
    width,
    minWidth: MIN_WIDTH,
    maxWidth,
    growTowards: "left",
    enabled: docked,
    onResize: (width) => setPreference((current) => ({ ...current, width })),
  });
  return {
    containerRef,
    width,
    docked,
    placement: preference.placement,
    setMinimized,
    splitterProps,
    setPlacement: (placement: AssistantPlacement) =>
      setPreference((current) => ({ ...current, placement })),
  };
}
