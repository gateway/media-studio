import { describe, expect, it } from "vitest";

import {
  GRAPH_CANVAS_MULTI_SELECTION_KEYCODE,
  GRAPH_CANVAS_PAN_ON_DRAG_BUTTONS,
  GRAPH_CANVAS_SELECTION_KEYCODE,
  graphCanvasInteractionConfig,
} from "@/components/graph-studio/utils/graph-canvas-interaction";

describe("graphCanvasInteractionConfig", () => {
  it("uses left-drag panning and modifier-based marquee selection", () => {
    const config = graphCanvasInteractionConfig();

    expect(config.selectionOnDrag).toBe(false);
    expect(config.selectionKeyCode).toEqual([...GRAPH_CANVAS_SELECTION_KEYCODE]);
    expect(config.multiSelectionKeyCode).toEqual([...GRAPH_CANVAS_MULTI_SELECTION_KEYCODE]);
    expect(config.panOnDrag).toEqual([...GRAPH_CANVAS_PAN_ON_DRAG_BUTTONS]);
    expect(config.panOnDrag).toContain(0);
  });
});
