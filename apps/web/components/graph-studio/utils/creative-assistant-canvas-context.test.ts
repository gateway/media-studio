import { describe, expect, it } from "vitest";

import { buildCreativeAssistantCanvasContext } from "@/components/graph-studio/utils/creative-assistant-canvas-context";
import type { GraphWorkflowPayload } from "@/components/graph-studio/types";

describe("buildCreativeAssistantCanvasContext", () => {
  it("summarizes graph titles, layout, prompts, groups, and media references without raw secrets", () => {
    const workflow: GraphWorkflowPayload = {
      schema_version: 1,
      workflow_id: "workflow-story",
      name: "Sadis Adventures",
      nodes: [
        {
          id: "character",
          type: "media.load_image",
          position: { x: 100, y: 50 },
          fields: {
            image: { reference_id: "ref-character", kind: "image", width: 1088, height: 1920 },
            api_key: "do-not-send",
          },
          metadata: { ui: { customTitle: "Character Sheet Ref" } },
        },
        {
          id: "recipe",
          type: "prompt.recipe",
          position: { x: 520, y: 50 },
          fields: {
            story_brief: "A half-cyborg hero checks her upgrades at a destroyed spaceport before leaving for another mission.".repeat(4),
          },
          metadata: { ui: { customTitle: "Storyboard 1 Recipe" } },
        },
      ],
      edges: [{ id: "edge-character-recipe", source: "character", source_port: "image", target: "recipe", target_port: "reference_image" }],
      metadata: {
        groups: [
          {
            id: "group-storyboard-1",
            title: "Storyboard 1",
            color: "blue",
            node_ids: ["character", "recipe"],
            bounds: { x: 60, y: 0, width: 840, height: 420 },
          },
        ],
      },
    };

    const context = buildCreativeAssistantCanvasContext(workflow);

    expect(context.workflow_name).toBe("Sadis Adventures");
    expect(context.node_count).toBe(2);
    expect(context.nodes.map((node) => node.title)).toEqual(["Character Sheet Ref", "Storyboard 1 Recipe"]);
    expect(context.nodes[0].field_keys).toEqual(["image"]);
    expect(context.nodes[0].media_refs[0]).toMatchObject({ field: "image", reference_id: "ref-character", kind: "image" });
    expect(context.nodes[1].prompt_summaries[0].preview).toContain("half-cyborg hero");
    expect(context.nodes[1].prompt_summaries[0].preview.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(context)).not.toContain("do-not-send");
    expect(context.groups[0].title).toBe("Storyboard 1");
    expect(context.layout.bounds).toMatchObject({ x: 60, y: 0, width: 840, height: 420 });
    expect(context.layout.next_section_hint?.x).toBeGreaterThan(900);
    expect(context.selection_available).toBe(false);
    expect(context.selected_node_ids).toEqual([]);
  });

  it("includes only selected node and group ids that exist in the workflow snapshot", () => {
    const workflow: GraphWorkflowPayload = {
      schema_version: 1,
      workflow_id: "workflow-selection",
      name: "Selected node workflow",
      nodes: [
        {
          id: "recipe",
          type: "prompt.recipe",
          position: { x: 100, y: 50 },
          fields: { user_prompt: "Old prompt" },
        },
      ],
      edges: [],
      metadata: {
        groups: [
          {
            id: "group-character-sheet",
            title: "Character Sheet",
            color: "blue",
            node_ids: ["recipe"],
            bounds: { x: 80, y: 20, width: 420, height: 300 },
          },
        ],
      },
    };

    const context = buildCreativeAssistantCanvasContext(workflow, {
      selectedNodeIds: ["recipe", "missing-node", "recipe"],
      selectedGroupIds: ["group-character-sheet", "missing-group"],
    });

    expect(context.selection_available).toBe(true);
    expect(context.selected_node_ids).toEqual(["recipe"]);
    expect(context.selected_group_ids).toEqual(["group-character-sheet"]);
  });

  it("summarizes scalar media asset ids on load image nodes", () => {
    const workflow: GraphWorkflowPayload = {
      schema_version: 1,
      workflow_id: "workflow-scalar-media-ref",
      name: "Scalar media ref workflow",
      nodes: [
        {
          id: "character-sheet-ref",
          type: "media.load_image",
          position: { x: 100, y: 50 },
          fields: { asset_id: "asset-character-sheet" },
        },
      ],
      edges: [],
      metadata: {},
    };

    const context = buildCreativeAssistantCanvasContext(workflow);

    expect(context.nodes[0].media_refs[0]).toMatchObject({
      field: "asset_id",
      asset_id: "asset-character-sheet",
      kind: "image",
    });
  });
});
