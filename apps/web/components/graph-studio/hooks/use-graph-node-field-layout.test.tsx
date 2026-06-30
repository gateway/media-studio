// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { GraphNodeDefinition, StudioNode } from "../types";
import { GRAPH_NODE_AUTO_HEIGHT_HARD_MAX, GRAPH_NODE_COLLAPSED_HEIGHT } from "../utils/graph-node-layout";
import { useGraphNodeFieldLayout } from "./use-graph-node-field-layout";

const definition: GraphNodeDefinition = {
  type: "preset.render",
  title: "Media Preset",
  category: "Preset",
  fields: [
    { id: "preset_id", label: "Media Preset", type: "preset_picker" },
    { id: "text__style", label: "Style", type: "text" },
    {
      id: "text__details",
      label: "Details",
      type: "textarea",
      visible_if: { field: "preset_id", equals: "preset-large" },
    },
    { id: "advanced_seed", label: "Seed", type: "text", advanced: true },
  ],
  ports: {
    inputs: [{ id: "slot__subject", label: "Subject", type: "image" }],
    outputs: [{ id: "image", label: "Image", type: "image" }],
  },
  ui: {
    min_size: { width: 320, height: 220 },
    max_size: { width: 700, height: 900 },
  },
};

const lazyPresetDefinition: GraphNodeDefinition = {
  type: "preset.render",
  title: "Media Preset",
  category: "Preset",
  fields: [
    { id: "preset_id", label: "Media Preset", type: "preset_picker" },
    { id: "preset_model_key", label: "Model", type: "select" },
  ],
  ports: {
    inputs: [{ id: "slot__subject", label: "Subject", type: "image" }],
    outputs: [{ id: "image", label: "Image", type: "image" }],
  },
  ui: {
    min_size: { width: 320, height: 220 },
    max_size: { width: 700, height: 900 },
  },
};

function node(overrides: Partial<StudioNode> = {}): StudioNode {
  return {
    id: "node-1",
    type: "preset.render",
    position: { x: 0, y: 0 },
    style: { width: 360, height: 260, minHeight: 220 },
    data: {
      definition,
      fields: { preset_id: "" },
      connectedInputPorts: [],
      autoSizedHeight: 260,
    },
    ...overrides,
  } as StudioNode;
}

function setup(initialNode = node()) {
  return renderHook(() => {
    const [nodes, setNodes] = useState<StudioNode[]>([initialNode]);
    return {
      nodes,
      ...useGraphNodeFieldLayout({ nodes, setNodes }),
    };
  });
}

describe("useGraphNodeFieldLayout", () => {
  it("updates fields and grows the wrapper to match newly visible fields", async () => {
    const { result } = setup();

    act(() => {
      result.current.onFieldChange("node-1", "preset_id", "preset-large");
    });

    await waitFor(() =>
      expect(result.current.nodes[0].data.fields.preset_id).toBe("preset-large"),
    );
    expect(result.current.nodes[0].style?.height).toBeGreaterThan(260);
    expect(result.current.nodes[0].data.autoSizedHeight).toBe(
      result.current.nodes[0].style?.height,
    );
  });

  it("merges hydrated field batches through the same measured layout path", async () => {
    const { result } = setup();

    act(() => {
      result.current.setNodeFields("node-1", {
        preset_id: "preset-large",
        text__style: "cinematic",
      });
    });

    await waitFor(() =>
      expect(result.current.nodes[0].data.fields).toMatchObject({
        preset_id: "preset-large",
        text__style: "cinematic",
      }),
    );
    expect(result.current.nodes[0].style?.height).toBeGreaterThan(260);
  });

  it("sizes against dynamically selected Media Preset fields instead of the base node definition", async () => {
    const { result } = setup(
      node({
        style: { width: 360, height: 260, minHeight: 220 },
        data: {
          definition: lazyPresetDefinition,
          fields: { preset_id: "" },
          connectedInputPorts: [],
          autoSizedHeight: 260,
        },
      }),
    );

    act(() => {
      result.current.setNodeFields("node-1", {
        preset_id: "weathered-preset",
        __preset_catalog_item_json: {
          preset_id: "weathered-preset",
          key: "weathered-preset",
          label: "Weathered Retro-Futurist Mech Portrait",
          description: "Dynamic preset with runtime fields.",
          model_key: "gpt-image-2-image-to-image",
          input_schema_json: [
            { key: "scene_setting", label: "Scene / Setting", required: true },
            { key: "role_loadout", label: "Role / Loadout" },
            { key: "lighting_direction", label: "Lighting Direction" },
            { key: "surface_wear", label: "Surface Wear" },
          ],
          input_slots_json: [{ key: "subject", label: "Subject", required: true }],
        },
      });
    });

    await waitFor(() =>
      expect(result.current.nodes[0].data.fields.preset_id).toBe(
        "weathered-preset",
      ),
    );
    expect(result.current.nodes[0].style?.height).toBeGreaterThan(420);
    expect(result.current.nodes[0].style?.minHeight).toBeGreaterThan(420);
    expect(result.current.nodes[0].data.autoSizedHeight).toBe(
      result.current.nodes[0].style?.height,
    );
  });

  it("expands advanced fields without losing the current wrapper width", async () => {
    const { result } = setup(
      node({ style: { width: 512, height: 260, minHeight: 220 } }),
    );

    act(() => {
      result.current.toggleNodeAdvancedExpanded("node-1");
    });

    await waitFor(() =>
      expect(result.current.nodes[0].data.advancedExpanded).toBe(true),
    );
    expect(result.current.nodes[0].style?.width).toBe(512);
    expect(result.current.nodes[0].style?.height).toBeGreaterThan(260);
  });

  it("restores the last content-safe height when advanced fields open after a manual shrink", async () => {
    const { result } = setup(
      node({
        style: { width: 512, height: 934, minHeight: 720 },
        data: {
          definition,
          fields: { preset_id: "" },
          connectedInputPorts: [],
          autoSizedHeight: 1531,
        },
      }),
    );

    act(() => {
      result.current.toggleNodeAdvancedExpanded("node-1");
    });

    await waitFor(() =>
      expect(result.current.nodes[0].data.advancedExpanded).toBe(true),
    );
    expect(result.current.nodes[0].style?.width).toBe(512);
    expect(result.current.nodes[0].style?.height).toBe(1531);
    expect(result.current.nodes[0].style?.minHeight).toBeLessThan(1531);
    expect(result.current.nodes[0].data.autoSizedHeight).toBe(1531);
  });

  it("keeps the last content-safe auto-height when advanced fields collapse", async () => {
    const { result } = setup(
      node({
        style: { width: 512, height: 1531, minHeight: 1120 },
        data: {
          definition,
          fields: { preset_id: "" },
          connectedInputPorts: [],
          advancedExpanded: true,
          autoSizedHeight: 1531,
        },
      }),
    );

    act(() => {
      result.current.toggleNodeAdvancedExpanded("node-1");
    });

    await waitFor(() =>
      expect(result.current.nodes[0].data.advancedExpanded).toBe(false),
    );
    expect(result.current.nodes[0].style?.height).toBeLessThan(1531);
    expect(result.current.nodes[0].data.autoSizedHeight).toBe(1531);
  });

  it("shrinks stale oversize auto-height values back inside the current layout bounds", async () => {
    const { result } = setup(
      node({
        style: { width: 360, height: 5152, minHeight: 5152 },
        data: {
          definition,
          fields: { preset_id: "" },
          connectedInputPorts: [],
          autoSizedHeight: 5152,
        },
      }),
    );

    await waitFor(() =>
      expect(result.current.nodes[0].style?.height).toBeLessThan(1000),
    );
    expect(result.current.nodes[0].style?.minHeight).toBeLessThan(1000);
  });

  it("keeps legitimate expanded auto-height values while unlocking resize min-height", async () => {
    const { result } = setup(
      node({
        style: { width: 360, height: 1600, minHeight: 1600 },
        data: {
          definition,
          fields: { preset_id: "" },
          connectedInputPorts: [],
          autoSizedHeight: 1600,
        },
      }),
    );

    await waitFor(() =>
      expect(result.current.nodes[0].style?.height).toBe(1600),
    );
    await waitFor(() =>
      expect(result.current.nodes[0].style?.minHeight).toBeLessThan(900),
    );
    expect(result.current.nodes[0].style?.minHeight).toBeLessThan(result.current.nodes[0].style?.height as number);
    expect(result.current.nodes[0].style?.height).toBeLessThan(GRAPH_NODE_AUTO_HEIGHT_HARD_MAX);
  });

  it("auto-grows measured content without locking out manual height resize", async () => {
    const { result } = setup(
      node({
        style: { width: 360, height: 900, minHeight: 900 },
        data: {
          definition,
          fields: { preset_id: "" },
          connectedInputPorts: [],
          autoSizedHeight: 900,
        },
      }),
    );

    act(() => {
      result.current.ensureNodeHeight("node-1", 1600);
    });

    await waitFor(() =>
      expect(result.current.nodes[0].style?.height).toBe(1600),
    );
    expect(result.current.nodes[0].style?.minHeight).toBeLessThan(900);
    expect(result.current.nodes[0].style?.minHeight).toBeLessThan(result.current.nodes[0].style?.height as number);
    expect(result.current.nodes[0].data.autoSizedHeight).toBe(1600);
  });

  it("keeps collapse and expand wrapper heights aligned to measured content", async () => {
    const { result } = setup();

    act(() => {
      result.current.toggleNodeCollapsed("node-1");
    });

    await waitFor(() =>
      expect(result.current.nodes[0].style?.height).toBe(
        GRAPH_NODE_COLLAPSED_HEIGHT,
      ),
    );

    act(() => {
      result.current.toggleNodeCollapsed("node-1");
    });

    await waitFor(() =>
      expect(result.current.nodes[0].style?.height).toBeGreaterThan(
        GRAPH_NODE_COLLAPSED_HEIGHT,
      ),
    );
  });
});
