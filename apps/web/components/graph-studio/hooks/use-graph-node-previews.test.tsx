// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import type { GraphNodeDefinition, GraphNodePricingEstimate, StudioEdge, StudioNode } from "../types";
import type { MediaAsset } from "@/lib/types";
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
  harnessHandlers = handlers,
  harnessAssets = [],
}: {
  pricingByNode: Record<string, GraphNodePricingEstimate>;
  onRendered: (nodes: StudioNode[]) => void;
  harnessNodes?: StudioNode[];
  harnessEdges?: StudioEdge[];
  harnessHandlers?: typeof handlers;
  harnessAssets?: MediaAsset[];
}) {
  const renderedNodes = useGraphNodePreviews({
    nodes: harnessNodes,
    edges: harnessEdges,
    assets: harnessAssets,
    references: [],
    nodeHandlers: harnessHandlers,
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

  it("keeps rendered nodes stable when handler bindings change while calling the latest handler", () => {
    const onRendered = vi.fn();
    const firstHandlers = { onFieldChange: vi.fn() };
    const secondHandlers = { onFieldChange: vi.fn() };
    const { rerender } = render(<Harness pricingByNode={{}} onRendered={onRendered} harnessHandlers={firstHandlers} />);
    const firstNodes = onRendered.mock.calls.at(-1)?.[0] as StudioNode[];

    rerender(<Harness pricingByNode={{}} onRendered={onRendered} harnessHandlers={secondHandlers} />);
    const secondNodes = onRendered.mock.calls.at(-1)?.[0] as StudioNode[];

    expect(secondNodes).toBe(firstNodes);
    expect(secondNodes[0]).toBe(firstNodes[0]);

    secondNodes[0].data.onFieldChange("node-1", "prompt", "updated");

    expect(firstHandlers.onFieldChange).not.toHaveBeenCalled();
    expect(secondHandlers.onFieldChange).toHaveBeenCalledWith("node-1", "prompt", "updated");
  });

  it("refreshes media previews when hydrated asset detail adds dimensions", () => {
    const onRendered = vi.fn();
    const assetNode: StudioNode = {
      ...nodes[0],
      data: {
        ...nodes[0].data,
        fields: { asset_id: "asset_1" },
      },
    };
    const summaryAsset = {
      asset_id: "asset_1",
      created_at: "2026-05-19T00:00:00.000Z",
      generation_kind: "image",
      hero_thumb_url: "/thumb.webp",
      prompt_summary: "Graph asset",
    } as MediaAsset;
    const hydratedAsset = {
      ...summaryAsset,
      payload: { outputs: [{ width: 1536, height: 1024 }] },
    } as MediaAsset;

    const { rerender } = render(
      <Harness pricingByNode={{}} onRendered={onRendered} harnessNodes={[assetNode]} harnessAssets={[summaryAsset]} />,
    );
    const firstNodes = onRendered.mock.calls.at(-1)?.[0] as StudioNode[];
    expect(firstNodes[0].data.mediaPreview?.resolutionLabel).toBeNull();

    rerender(<Harness pricingByNode={{}} onRendered={onRendered} harnessNodes={[assetNode]} harnessAssets={[hydratedAsset]} />);
    const secondNodes = onRendered.mock.calls.at(-1)?.[0] as StudioNode[];

    expect(secondNodes[0]).not.toBe(firstNodes[0]);
    expect(secondNodes[0].data.mediaPreview?.resolutionLabel).toBe("1536x1024");
    expect(secondNodes[0].data.mediaPreview?.aspectLabel).toBe("3:2");
  });
});
