/* @vitest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GraphCanvas } from "./graph-canvas";

const reactFlowProps: Array<Record<string, unknown>> = [];

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  ViewportPortal: ({ children }: { children: ReactNode }) => children,
  ReactFlow: (props: Record<string, unknown> & { children?: ReactNode }) => {
    reactFlowProps.push(props);
    return <div data-testid="mock-reactflow">{props.children}</div>;
  },
  ConnectionMode: { Loose: "Loose" },
  SelectionMode: { Partial: "Partial" },
}));

describe("GraphCanvas", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    reactFlowProps.length = 0;
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => []),
    });
  });

  it("opens node search from an empty-canvas right-click even when a node is selected", () => {
    const setNodeContextMenu = vi.fn();
    const openNodeSearch = vi.fn();

    const { getByTestId } = render(
      <GraphCanvas
        nodes={[{ id: "node-1", position: { x: 0, y: 0 }, selected: true, data: {} }] as any}
        edges={[] as any}
        showMiniMap={false}
        groups={[] as any[]}
        activeConnection={null}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onConnect={vi.fn()}
        onConnectStart={vi.fn()}
        onConnectEnd={vi.fn()}
        onReconnect={vi.fn()}
        onReconnectEnd={vi.fn()}
        isValidConnection={vi.fn().mockReturnValue(true)}
        setNodes={vi.fn()}
        setEdges={vi.fn()}
        setNodeSearch={vi.fn()}
        setWorkflowMenuOpen={vi.fn()}
        setNodeContextMenu={setNodeContextMenu}
        setGroupContextMenu={vi.fn()}
        openNodeSearch={openNodeSearch}
      />,
    );

    fireEvent.contextMenu(getByTestId("graph-canvas"), { clientX: 120, clientY: 180 });

    expect(openNodeSearch).toHaveBeenCalledWith(120, 180);
    expect(setNodeContextMenu).toHaveBeenCalledWith(null);
    expect(setNodeContextMenu).not.toHaveBeenCalledWith(
      expect.objectContaining({
        anchorNodeId: "node-1",
      }),
    );
  });

  it("opens the selected-node context menu through the React Flow multi-selection overlay", () => {
    const setNodeContextMenu = vi.fn();
    const setNodes = vi.fn();
    const openNodeSearch = vi.fn();
    const selectionOverlay = document.createElement("div");
    selectionOverlay.className = "react-flow__nodesselection-rect";
    const selectedNodeElement = document.createElement("div");
    selectedNodeElement.className = "react-flow__node";
    selectedNodeElement.setAttribute("data-id", "node-2");
    vi.mocked(document.elementsFromPoint).mockReturnValue([selectionOverlay, selectedNodeElement]);

    const { getByTestId } = render(
      <GraphCanvas
        nodes={[
          { id: "node-1", position: { x: 0, y: 0 }, selected: true, data: {} },
          { id: "node-2", position: { x: 100, y: 100 }, selected: true, data: {} },
        ] as any}
        edges={[] as any}
        showMiniMap={false}
        groups={[] as any[]}
        activeConnection={null}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onConnect={vi.fn()}
        onConnectStart={vi.fn()}
        onConnectEnd={vi.fn()}
        onReconnect={vi.fn()}
        onReconnectEnd={vi.fn()}
        isValidConnection={vi.fn().mockReturnValue(true)}
        setNodes={setNodes}
        setEdges={vi.fn()}
        setNodeSearch={vi.fn()}
        setWorkflowMenuOpen={vi.fn()}
        setNodeContextMenu={setNodeContextMenu}
        setGroupContextMenu={vi.fn()}
        openNodeSearch={openNodeSearch}
      />,
    );

    fireEvent.contextMenu(getByTestId("graph-canvas"), { clientX: 220, clientY: 260 });

    expect(openNodeSearch).not.toHaveBeenCalled();
    expect(setNodes).not.toHaveBeenCalled();
    expect(setNodeContextMenu).toHaveBeenCalledWith({
      nodeIds: ["node-1", "node-2"],
      anchorNodeId: "node-2",
      x: 220,
      y: 260,
    });
  });

  it("keeps tracked React Flow props stable across identical rerenders", () => {
    const baseProps = {
      nodes: [{ id: "node-1", position: { x: 0, y: 0 }, selected: false, data: {} }] as any,
      edges: [{ id: "edge-1", source: "node-1", target: "node-2", data: {} }] as any,
      showMiniMap: false,
      groups: [] as any[],
      activeConnection: { portType: "text" } as any,
      onNodesChange: vi.fn(),
      onEdgesChange: vi.fn(),
      onConnect: vi.fn(),
      onConnectStart: vi.fn(),
      onConnectEnd: vi.fn(),
      onReconnect: vi.fn(),
      onReconnectEnd: vi.fn(),
      isValidConnection: vi.fn().mockReturnValue(true),
      setNodes: vi.fn(),
      setEdges: vi.fn(),
      setNodeSearch: vi.fn(),
      setWorkflowMenuOpen: vi.fn(),
      setNodeContextMenu: vi.fn(),
      setGroupContextMenu: vi.fn(),
      openNodeSearch: vi.fn(),
    };

    const { rerender } = render(<GraphCanvas {...baseProps} />);
    const firstProps = reactFlowProps.at(-1);

    rerender(<GraphCanvas {...baseProps} />);
    const secondProps = reactFlowProps.at(-1);

    expect(firstProps).toBeTruthy();
    expect(secondProps).toBeTruthy();
    expect(secondProps?.defaultEdgeOptions).toBe(firstProps?.defaultEdgeOptions);
    expect(secondProps?.proOptions).toBe(firstProps?.proOptions);
    expect(secondProps?.connectionLineStyle).toBe(firstProps?.connectionLineStyle);
    expect(secondProps?.onNodeClick).toBe(firstProps?.onNodeClick);
    expect(secondProps?.onNodeContextMenu).toBe(firstProps?.onNodeContextMenu);
    expect(secondProps?.onEdgeClick).toBe(firstProps?.onEdgeClick);
    expect(secondProps?.onPaneClick).toBe(firstProps?.onPaneClick);
  });
});
