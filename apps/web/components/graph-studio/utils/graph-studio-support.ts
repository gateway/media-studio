export const GRAPH_STUDIO_MIN_DESKTOP_WIDTH = 560;
export const GRAPH_STUDIO_MIN_TOUCH_WIDTH = 1024;

export type GraphStudioSupportState = {
  supported: boolean;
  width: number;
  height: number;
  coarsePointer: boolean;
  reason: "small_window" | "small_touch";
};

export function graphStudioSupportForViewport({
  width,
  height,
  coarsePointer,
}: {
  width: number;
  height: number;
  coarsePointer: boolean;
}): GraphStudioSupportState {
  if (width < GRAPH_STUDIO_MIN_DESKTOP_WIDTH) {
    return { supported: false, width, height, coarsePointer, reason: "small_window" };
  }
  if (coarsePointer && width < GRAPH_STUDIO_MIN_TOUCH_WIDTH) {
    return { supported: false, width, height, coarsePointer, reason: "small_touch" };
  }
  return { supported: true, width, height, coarsePointer, reason: "small_window" };
}
