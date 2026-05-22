import { describe, expect, it } from "vitest";

import {
  graphHistoryCanRedo,
  graphHistoryCanUndo,
  graphHistoryCommitPending,
  graphHistoryEntryForSnapshot,
  graphHistoryRedo,
  graphHistoryStageSnapshot,
  graphHistoryUndo,
  type GraphHistorySnapshot,
} from "@/components/graph-studio/utils/graph-history";

function snapshot(name: string, nodeCount = 1): GraphHistorySnapshot {
  return {
    workflowId: `${name}-workflow`,
    workflowName: name,
    workflowUpdatedAt: null,
    workflow: {
      schema_version: 1,
      workflow_id: `${name}-workflow`,
      name,
      nodes: Array.from({ length: nodeCount }, (_, index) => ({
        id: `node-${index}`,
        type: "prompt.text",
        position: { x: index * 20, y: index * 10 },
        fields: { text: `${name}-${index}` },
      })),
      edges: [],
      metadata: {},
    },
  };
}

describe("graph history", () => {
  it("stages and commits a changed snapshot", () => {
    const base = snapshot("Base");
    const changed = snapshot("Changed");
    const entry = graphHistoryCommitPending(
      graphHistoryStageSnapshot(graphHistoryEntryForSnapshot(base), changed),
    );
    expect(entry.past).toHaveLength(1);
    expect(entry.present?.workflow.name).toBe("Changed");
    expect(entry.pending).toBeNull();
    expect(graphHistoryCanUndo(entry)).toBe(true);
  });

  it("undoes pending edits without consuming committed history", () => {
    const base = snapshot("Base");
    const changed = snapshot("Changed");
    const staged = graphHistoryStageSnapshot(graphHistoryEntryForSnapshot(base), changed);
    const result = graphHistoryUndo(staged);
    expect(result.snapshot?.workflow.name).toBe("Base");
    expect(result.entry.past).toHaveLength(0);
    expect(result.entry.pending).toBeNull();
    expect(graphHistoryCanUndo(result.entry)).toBe(false);
    expect(graphHistoryCanRedo(result.entry)).toBe(true);
  });

  it("undos and redoes committed history", () => {
    const base = snapshot("Base");
    const changed = snapshot("Changed");
    const committed = graphHistoryCommitPending(
      graphHistoryStageSnapshot(graphHistoryEntryForSnapshot(base), changed),
    );
    const undone = graphHistoryUndo(committed);
    expect(undone.snapshot?.workflow.name).toBe("Base");
    expect(graphHistoryCanRedo(undone.entry)).toBe(true);

    const redone = graphHistoryRedo(undone.entry);
    expect(redone.snapshot?.workflow.name).toBe("Changed");
    expect(redone.entry.future).toHaveLength(0);
  });
});
