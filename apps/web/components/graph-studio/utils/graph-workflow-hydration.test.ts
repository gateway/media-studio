import { describe, expect, it, vi } from "vitest";

import type { GraphNodeDefinition, GraphWorkflowPayload } from "@/components/graph-studio/types";
import { hydrateGraphWorkflowForCanvas } from "@/components/graph-studio/utils/graph-workflow-hydration";
import { workflowFromCanvas, type GraphNodeHandlers } from "@/components/graph-studio/utils/graph-serialization";

const handlers: GraphNodeHandlers = {
  onFieldChange: vi.fn(),
  onEnsureNodeHeight: vi.fn(),
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
  it("clamps stale oversized preset render node heights on load", () => {
    const presetDefinition: GraphNodeDefinition = {
      type: "preset.render",
      title: "Media Preset",
      category: "Preset",
      fields: [{ id: "preset_id", label: "Media Preset", type: "preset_picker" }],
      ports: { inputs: [], outputs: [{ id: "image", label: "Image", type: "image" }] },
      ui: {
        default_size: { width: 340, height: 520 },
        min_size: { width: 280, height: 360 },
        max_size: { width: 860, height: 1200 },
      },
    };
    const workflow: GraphWorkflowPayload = {
      schema_version: 1,
      workflow_id: "workflow-1",
      name: "Bloated preset node",
      nodes: [
        {
          id: "preset",
          type: "preset.render",
          position: { x: 0, y: 0 },
          fields: { preset_id: "preset-1" },
          metadata: { style: { width: 340, height: 6572 } },
        },
      ],
      edges: [],
      metadata: {},
    };

    const hydrated = hydrateGraphWorkflowForCanvas({
      workflow,
      definitionsByType: new Map([[presetDefinition.type, presetDefinition]]),
      handlers,
    });

    expect(hydrated.nodes[0].style?.height).toBe(520);
    expect(hydrated.nodes[0].style?.minHeight).toBeLessThan(520);
    expect(hydrated.nodes[0].data.onEnsureNodeHeight).toBe(handlers.onEnsureNodeHeight);
  });

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

  it("drops saved edges whose handles are not exposed by the current node contract", () => {
    const presetDefinition: GraphNodeDefinition = {
      type: "preset.render",
      title: "Media Preset",
      category: "Preset",
      fields: [{ id: "preset_id", label: "Preset", type: "select", default: "poster" }],
      ports: {
        inputs: [
          { id: "slot__portrait", label: "Portrait", type: "image", visible_if: { field: "preset_id", in: ["portrait"] } },
          { id: "slot__product", label: "Product", type: "image", visible_if: { field: "preset_id", in: ["product"] } },
        ],
        outputs: [{ id: "image", label: "Image", type: "image" }],
      },
    };
    const workflow: GraphWorkflowPayload = {
      schema_version: 1,
      workflow_id: "workflow-1",
      name: "Dynamic preset",
      nodes: [
        { id: "load", type: "media.load_image", position: { x: 0, y: 0 }, fields: {} },
        { id: "preset", type: "preset.render", position: { x: 500, y: 0 }, fields: { preset_id: "product" } },
      ],
      edges: [
        { id: "stale", source: "load", source_port: "image", target: "preset", target_port: "slot__portrait" },
        { id: "current", source: "load", source_port: "image", target: "preset", target_port: "slot__product" },
      ],
      metadata: {},
    };

    const hydrated = hydrateGraphWorkflowForCanvas({
      workflow,
      definitionsByType: new Map([
        [loadImageDefinition.type, loadImageDefinition],
        [presetDefinition.type, presetDefinition],
      ]),
      handlers,
    });

    expect(hydrated.edges.map((edge) => edge.id)).toEqual(["current"]);
    expect(hydrated.edges[0]).toMatchObject({
      targetHandle: "in:slot__product",
    });
  });
});
