/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    reactFlowProps.length = 0;
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
