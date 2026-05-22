import { describe, expect, it, vi } from "vitest";

import type { GraphNodeDefinition, GraphWorkflowPayload } from "@/components/graph-studio/types";
import { hydrateGraphWorkflowForCanvas } from "@/components/graph-studio/utils/graph-workflow-hydration";
import { workflowFromCanvas, type GraphNodeHandlers } from "@/components/graph-studio/utils/graph-serialization";

const handlers: GraphNodeHandlers = {
  onFieldChange: vi.fn(),
};

const loadImageDefinition: GraphNodeDefinition = {
  type: "media.load_image",
  title: "Load Image",
  category: "Media",
  fields: [],
  ports: { inputs: [], outputs: [{ id: "image", label: "Image", type: "image" }] },
  ui: {
    default_size: { width: 420, height: 520 },
    min_size: { width: 360, height: 320 },
    max_size: { width: 2400, height: 3200 },
    preview: true,
  },
};

const previewDefinition: GraphNodeDefinition = {
  type: "preview.image",
  title: "Preview Image",
  category: "Preview",
  fields: [],
  ports: { inputs: [{ id: "image", label: "Image", type: "image" }], outputs: [] },
  ui: {
    default_size: { width: 460, height: 520 },
    min_size: { width: 360, height: 320 },
    max_size: { width: 2400, height: 3200 },
    preview: true,
  },
};

describe("hydrateGraphWorkflowForCanvas", () => {
  it("round-trips saved node size and keeps hydrated edges reconnectable", () => {
    const workflow: GraphWorkflowPayload = {
      schema_version: 1,
      workflow_id: "workflow-1",
      name: "Resize smoke",
      nodes: [
        {
          id: "load",
          type: "media.load_image",
          position: { x: 0, y: 0 },
          fields: {},
          metadata: { style: { width: 720, height: 840 } },
        },
        {
          id: "preview",
          type: "preview.image",
          position: { x: 900, y: 0 },
          fields: {},
          metadata: { style: { width: 520, height: 680 } },
        },
      ],
      edges: [{ id: "edge-load-preview", source: "load", source_port: "image", target: "preview", target_port: "image" }],
      metadata: {},
    };

    const hydrated = hydrateGraphWorkflowForCanvas({
      workflow,
      definitionsByType: new Map([
        [loadImageDefinition.type, loadImageDefinition],
        [previewDefinition.type, previewDefinition],
      ]),
      handlers,
    });

    expect(hydrated.nodes.find((node) => node.id === "load")?.style?.width).toBe(720);
    expect(hydrated.nodes.find((node) => node.id === "load")?.style?.height).toBe(840);
    expect(hydrated.edges[0]).toMatchObject({
      source: "load",
      target: "preview",
      sourceHandle: "out:image",
      targetHandle: "in:image",
      reconnectable: true,
      selected: false,
    });

    const resizedNodes = hydrated.nodes.map((node) =>
      node.id === "load"
        ? {
            ...node,
            width: 720,
            height: 900,
            style: { ...node.style, width: 720, height: 900 },
          }
        : node,
    );
    const savedAgain = workflowFromCanvas("workflow-1", "Resize smoke", resizedNodes, hydrated.edges);
    expect(savedAgain.nodes.find((node) => node.id === "load")?.metadata?.style).toMatchObject({ width: 720, height: 900 });
  });
});
