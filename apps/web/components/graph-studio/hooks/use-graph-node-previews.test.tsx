// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import type { GraphNodeDefinition, GraphNodePricingEstimate, StudioEdge, StudioNode } from "../types";
import { inputGraphHandleId, outputGraphHandleId } from "../utils/graph-port-handles";
import { useGraphNodePreviews } from "./use-graph-node-previews";

const definition: GraphNodeDefinition = {
  type: "prompt.text",
  title: "Prompt Text",
  description: "Text node.",
  category: "Prompt",
  fields: [],
  ports: {
    inputs: [],
    outputs: [{ id: "text", label: "Text", type: "text" }],
  },
};

const handlers = {
  onFieldChange: vi.fn(),
};

const nodes: StudioNode[] = [
  {
    id: "node-1",
    type: "graphNode",
    position: { x: 0, y: 0 },
    data: {
      definition,
      fields: {},
      onFieldChange: vi.fn(),
    },
  },
];

function Harness({
  pricingByNode,
  onRendered,
  harnessNodes = nodes,
  harnessEdges = [],
}: {
  pricingByNode: Record<string, GraphNodePricingEstimate>;
  onRendered: (nodes: StudioNode[]) => void;
  harnessNodes?: StudioNode[];
  harnessEdges?: StudioEdge[];
}) {
  const renderedNodes = useGraphNodePreviews({
    nodes: harnessNodes,
    edges: harnessEdges,
    assets: [],
    references: [],
    nodeHandlers: handlers,
    activeConnection: null,
    renamingNodeId: null,
    nodeRenameDraft: "",
    pricingByNode,
  });

  useEffect(() => {
    onRendered(renderedNodes);
  }, [onRendered, renderedNodes]);

  return null;
}

describe("useGraphNodePreviews", () => {
  it("preserves rendered node array identity when equivalent derived props change reference", () => {
    const onRendered = vi.fn();
    const pricing: GraphNodePricingEstimate = {
      node_id: "node-1",
      node_type: "prompt.text",
      pricing_summary: {},
    };
    const { rerender } = render(<Harness pricingByNode={{ "node-1": pricing }} onRendered={onRendered} />);
    const firstNodes = onRendered.mock.calls.at(-1)?.[0] as StudioNode[];

    rerender(<Harness pricingByNode={{ "node-1": { ...pricing } }} onRendered={onRendered} />);
    const secondNodes = onRendered.mock.calls.at(-1)?.[0] as StudioNode[];

    expect(secondNodes).toBe(firstNodes);
    expect(secondNodes[0]).toBe(firstNodes[0]);
  });

  it("derives connected ports from edge handles without per-node edge scans", () => {
    const onRendered = vi.fn();
    const sourceNode = nodes[0];
    const targetDefinition: GraphNodeDefinition = {
      ...definition,
      type: "prompt.merge",
      title: "Prompt Merge",
      ports: {
        inputs: [{ id: "prompt", label: "Prompt", type: "text" }],
        outputs: [],
      },
    };
    const targetNode: StudioNode = {
      id: "node-2",
      type: "graphNode",
      position: { x: 300, y: 0 },
      data: {
        definition: targetDefinition,
        fields: {},
        onFieldChange: vi.fn(),
      },
    };
    const harnessEdges: StudioEdge[] = [
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        sourceHandle: outputGraphHandleId("text"),
        targetHandle: inputGraphHandleId("prompt"),
      },
    ];

    render(<Harness pricingByNode={{}} onRendered={onRendered} harnessNodes={[sourceNode, targetNode]} harnessEdges={harnessEdges} />);

    const renderedNodes = onRendered.mock.calls.at(-1)?.[0] as StudioNode[];
    expect(renderedNodes[0].data.connectedOutputPorts).toEqual(["text"]);
    expect(renderedNodes[1].data.connectedInputPorts).toEqual(["prompt"]);
  });
});
