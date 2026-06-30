// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";

import { useGraphUndoHistory } from "@/components/graph-studio/hooks/use-graph-undo-history";
import type { GraphHistorySnapshot } from "@/components/graph-studio/utils/graph-history";

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

function AssistantApplyHistoryHarness() {
  const base = snapshot("Base");
  const changed = snapshot("Changed", 2);
  const [currentSnapshot, setCurrentSnapshot] = useState<GraphHistorySnapshot>(base);
  const history = useGraphUndoHistory({
    enabled: true,
    activeTabId: "tab-1",
    snapshot: currentSnapshot,
    applySnapshot: setCurrentSnapshot,
  });
  return (
    <div>
      <p data-testid="workflow-name">{currentSnapshot.workflow.name}</p>
      <p data-testid="can-undo">{String(history.canUndo)}</p>
      <p data-testid="can-redo">{String(history.canRedo)}</p>
      <button
        type="button"
        onClick={() => {
          history.commitSnapshot(changed);
          setCurrentSnapshot(changed);
        }}
      >
        Apply assistant plan
      </button>
      <button type="button" onClick={() => history.undo()}>
        Undo
      </button>
      <button type="button" onClick={() => history.redo()}>
        Redo
      </button>
    </div>
  );
}

function BlankTabAssistantHistoryHarness() {
  const blank = snapshot("New workflow", 0);
  const changed = snapshot("Assistant workflow", 5);
  const [activeTabId, setActiveTabId] = useState("tab-old");
  const [currentSnapshot, setCurrentSnapshot] = useState<GraphHistorySnapshot>(snapshot("Old workflow", 3));
  const history = useGraphUndoHistory({
    enabled: true,
    activeTabId,
    snapshot: currentSnapshot,
    applySnapshot: setCurrentSnapshot,
  });
  return (
    <div>
      <p data-testid="workflow-name">{currentSnapshot.workflow.name}</p>
      <p data-testid="node-count">{String(currentSnapshot.workflow.nodes.length)}</p>
      <p data-testid="can-undo">{String(history.canUndo)}</p>
      <p data-testid="can-redo">{String(history.canRedo)}</p>
      <button
        type="button"
        onClick={() => {
          setActiveTabId("tab-new");
          history.replaceHistoryForTab("tab-new", blank);
          setCurrentSnapshot(blank);
        }}
      >
        New blank tab
      </button>
      <button
        type="button"
        onClick={() => {
          history.commitSnapshot(changed, { baseSnapshot: blank });
          setCurrentSnapshot(changed);
        }}
      >
        Apply assistant plan
      </button>
      <button type="button" onClick={() => history.undo()}>
        Undo
      </button>
      <button type="button" onClick={() => history.redo()}>
        Redo
      </button>
    </div>
  );
}

afterEach(() => cleanup());

describe("useGraphUndoHistory", () => {
  it("commits assistant-applied workflows as one undoable and redoable snapshot", async () => {
    render(<AssistantApplyHistoryHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Apply assistant plan" }));

    await waitFor(() => expect(screen.getByTestId("workflow-name").textContent).toBe("Changed"));
    await waitFor(() => expect(screen.getByTestId("can-undo").textContent).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.getByTestId("workflow-name").textContent).toBe("Base"));
    await waitFor(() => expect(screen.getByTestId("can-redo").textContent).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Redo" }));

    await waitFor(() => expect(screen.getByTestId("workflow-name").textContent).toBe("Changed"));
    await waitFor(() => expect(screen.getByTestId("can-redo").textContent).toBe("false"));
  });

  it("undoes assistant plans on a newly opened blank tab back to blank", async () => {
    render(<BlankTabAssistantHistoryHarness />);

    fireEvent.click(screen.getByRole("button", { name: "New blank tab" }));
    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("0"));

    fireEvent.click(screen.getByRole("button", { name: "Apply assistant plan" }));
    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("5"));
    await waitFor(() => expect(screen.getByTestId("can-undo").textContent).toBe("true"));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(screen.getByTestId("workflow-name").textContent).toBe("New workflow"));
    await waitFor(() => expect(screen.getByTestId("node-count").textContent).toBe("0"));
    await waitFor(() => expect(screen.getByTestId("can-redo").textContent).toBe("true"));
  });
});
