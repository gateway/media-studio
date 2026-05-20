export const GRAPH_CANVAS_SELECTION_KEYCODE = ["Control", "Meta"] as const;
export const GRAPH_CANVAS_MULTI_SELECTION_KEYCODE = ["Control", "Meta"] as const;
export const GRAPH_CANVAS_PAN_ON_DRAG_BUTTONS = [0, 1, 2] as const;

export function graphCanvasInteractionConfig() {
  return {
    selectionKeyCode: [...GRAPH_CANVAS_SELECTION_KEYCODE],
    multiSelectionKeyCode: [...GRAPH_CANVAS_MULTI_SELECTION_KEYCODE],
    selectionOnDrag: false,
    panOnDrag: [...GRAPH_CANVAS_PAN_ON_DRAG_BUTTONS],
  };
}
