import { describe, expect, it, vi } from "vitest";

import type { GraphNodeDefinition, GraphWorkflowPayload } from "@/components/graph-studio/types";
import {
  graphDefinitionsForWorkflowHydration,
  graphWorkflowNeedsFreshDefinitions,
} from "@/components/graph-studio/utils/graph-dynamic-definitions";

function workflowWithTypes(types: string[]): GraphWorkflowPayload {
  return {
    schema_version: 1,
    workflow_id: null,
    name: "Dynamic definitions",
    nodes: types.map((type, index) => ({
      id: `node-${index}`,
      type,
      position: { x: index * 120, y: 0 },
      fields: {},
    })),
    edges: [],
    metadata: {},
  };
}

describe("graphWorkflowNeedsFreshDefinitions", () => {
  it("refreshes for saved media preset workflows because slots are data-backed", () => {
    expect(graphWorkflowNeedsFreshDefinitions(workflowWithTypes(["preset.render"]))).toBe(true);
  });

  it("refreshes for Prompt Recipe workflows because fields and image ports are data-backed", () => {
    expect(graphWorkflowNeedsFreshDefinitions(workflowWithTypes(["prompt.recipe"]))).toBe(true);
  });

  it("does not refresh for static graph nodes", () => {
    expect(graphWorkflowNeedsFreshDefinitions(workflowWithTypes(["media.load_image", "model.kie.gpt_image_2_image_to_image"]))).toBe(false);
  });

  it("uses freshly loaded data-backed ports before hydrating a saved Prompt Recipe workflow", async () => {
    const staleDefinition: GraphNodeDefinition = {
      type: "prompt.recipe",
      title: "Prompt Recipe",
      category: "Prompt",
      fields: [],
      ports: { inputs: [{ id: "image_refs", label: "Image Refs", type: "image", array: true }], outputs: [] },
    };
    const freshDefinition: GraphNodeDefinition = {
      ...staleDefinition,
      ports: {
        inputs: [
          { id: "character_ref", label: "Character Ref", type: "image" },
          { id: "environment_ref", label: "Environment Ref", type: "image" },
          { id: "additional_refs", label: "Additional Refs", type: "image", array: true },
        ],
        outputs: [],
      },
    };
    const reloadDefinitions = vi.fn().mockResolvedValue([freshDefinition]);

    const definitions = await graphDefinitionsForWorkflowHydration({
      workflow: workflowWithTypes(["prompt.recipe"]),
      definitionsByType: new Map([[staleDefinition.type, staleDefinition]]),
      reloadDefinitions,
    });

    expect(reloadDefinitions).toHaveBeenCalledWith(true);
    expect(definitions.get("prompt.recipe")?.ports.inputs.map((port) => port.id)).toEqual([
      "character_ref",
      "environment_ref",
      "additional_refs",
    ]);
  });
});
