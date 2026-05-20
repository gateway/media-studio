import type { EdgeChange } from "@xyflow/react";

import type { StudioEdge } from "../types";

export function suppressGraphEdgeSelectionChanges(changes: EdgeChange<StudioEdge>[]): EdgeChange<StudioEdge>[] {
  return changes.filter((change) => change.type !== "select");
}
