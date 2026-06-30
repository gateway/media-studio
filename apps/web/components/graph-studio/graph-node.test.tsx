// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphNode, graphNodeContentHeightTargets, measureGraphNodeContentHeight } from "./graph-node";
import type { GraphNodeData, GraphNodeDefinition } from "./types";

vi.mock("@xyflow/react", () => ({
  Handle: () => <div data-testid="graph-handle" />,
  NodeResizer: (props: { minHeight?: number; maxHeight?: number }) => (
    <div data-testid="node-resizer" data-min-height={props.minHeight} data-max-height={props.maxHeight} />
  ),
  Position: { Left: "left", Right: "right" },
  useUpdateNodeInternals: () => vi.fn(),
}));

describe("measureGraphNodeContentHeight", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("measures child content instead of feeding back from a flexed body scroll height", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        getComputedStyle: () => ({ paddingBottom: "12px" }),
      },
    });
    const header = { offsetHeight: 64 } as HTMLElement;
    const body = {
      children: [
        { offsetTop: 12, offsetHeight: 28 },
        { offsetTop: 96, offsetHeight: 52 },
      ],
      scrollHeight: 5000,
    } as unknown as HTMLElement;

    expect(measureGraphNodeContentHeight(header, body)).toBe(226);
  });

  it("uses small body scroll deltas so auto-height nodes do not hide trailing content", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        getComputedStyle: () => ({ paddingBottom: "12px" }),
      },
    });
    const header = { offsetHeight: 64 } as HTMLElement;
    const body = {
      children: [
        { offsetTop: 12, offsetHeight: 28 },
        { offsetTop: 96, offsetHeight: 52 },
      ],
      scrollHeight: 179,
    } as unknown as HTMLElement;

    expect(measureGraphNodeContentHeight(header, body)).toBe(245);
  });

  it("measures nested advanced content so expanded fields stay inside the wrapper", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        getComputedStyle: () => ({ display: "block", paddingBottom: "12px", position: "static" }),
      },
    });
    const header = { offsetHeight: 64 } as HTMLElement;
    const advanced = {
      offsetTop: 40,
      offsetHeight: 48,
      getBoundingClientRect: () => ({ top: 140, bottom: 188, height: 48, width: 200 }),
    } as unknown as HTMLElement;
    const nestedField = {
      offsetTop: 0,
      offsetHeight: 0,
      getBoundingClientRect: () => ({ top: 260, bottom: 420, height: 160, width: 200 }),
    } as unknown as HTMLElement;
    const body = {
      children: [advanced],
      querySelectorAll: () => [advanced, nestedField],
      scrollHeight: 108,
      getBoundingClientRect: () => ({ top: 100, bottom: 208, height: 108, width: 240 }),
    } as unknown as HTMLElement;

    expect(measureGraphNodeContentHeight(header, body)).toBe(398);
  });

  it("measures flex-stretched textarea fields by their content height", () => {
    const flexField = {
      offsetTop: 20,
      offsetHeight: 1200,
      scrollHeight: 180,
      getBoundingClientRect: () => ({ top: 100, bottom: 1300, height: 1200, width: 200 }),
    } as unknown as HTMLElement;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        getComputedStyle: (element: HTMLElement) =>
          element === flexField
            ? { display: "flex", flexGrow: "1", height: "100%", paddingBottom: "0", position: "static" }
            : { display: "block", flexGrow: "0", height: "auto", paddingBottom: "10px", position: "static" },
      },
    });
    const header = { offsetHeight: 60 } as HTMLElement;
    const body = {
      children: [flexField],
      querySelectorAll: () => [flexField],
      scrollHeight: 1300,
      getBoundingClientRect: () => ({ top: 80, bottom: 1380, height: 1300, width: 240 }),
    } as unknown as HTMLElement;

    expect(measureGraphNodeContentHeight(header, body)).toBe(272);
  });

  it("does not feed manual wrapper height back from flex-stretched textarea fields", () => {
    const textarea = {
      tagName: "TEXTAREA",
      offsetTop: 42,
      offsetHeight: 1100,
      scrollHeight: 1100,
      classList: { contains: () => false },
      getBoundingClientRect: () => ({ top: 142, bottom: 1242, height: 1100, width: 220 }),
    } as unknown as HTMLElement;
    const flexField = {
      tagName: "LABEL",
      offsetTop: 20,
      offsetHeight: 1180,
      scrollHeight: 1180,
      classList: { contains: () => false },
      querySelector: (selector: string) => (selector.includes("textarea") ? textarea : null),
      getBoundingClientRect: () => ({ top: 120, bottom: 1300, height: 1180, width: 240 }),
    } as unknown as HTMLElement;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        getComputedStyle: (element: HTMLElement) =>
          element === flexField || element === textarea
            ? { display: "flex", flexGrow: "1", height: "100%", minHeight: "110px", paddingBottom: "0", position: "static" }
            : { display: "block", flexGrow: "0", height: "auto", minHeight: "0", paddingBottom: "10px", position: "static" },
      },
    });
    const header = { offsetHeight: 60 } as HTMLElement;
    const body = {
      children: [flexField],
      querySelectorAll: () => [flexField, textarea],
      scrollHeight: 1300,
      getBoundingClientRect: () => ({ top: 100, bottom: 1400, height: 1300, width: 260 }),
    } as unknown as HTMLElement;

    expect(measureGraphNodeContentHeight(header, body)).toBe(224);
  });

  it("observes body children so expanded picker content can grow the wrapper", () => {
    const firstField = {} as HTMLElement;
    const secondField = {} as HTMLElement;
    const header = {} as HTMLElement;
    const body = {
      children: [firstField, secondField],
    } as unknown as HTMLElement;

    expect(graphNodeContentHeightTargets(header, body)).toEqual([header, body, firstField, secondField]);
  });

  it("observes nested body descendants so advanced field growth can resize the wrapper", () => {
    const advanced = {} as HTMLElement;
    const nestedField = {} as HTMLElement;
    const header = {} as HTMLElement;
    const body = {
      children: [advanced],
      querySelectorAll: () => [advanced, nestedField],
    } as unknown as HTMLElement;

    expect(graphNodeContentHeightTargets(header, body)).toEqual([header, body, advanced, nestedField]);
  });

  it("renders pricing as a floating node badge instead of a header action chip", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const definition: GraphNodeDefinition = {
      type: "preset.render",
      title: "Media Preset",
      description: "Render a saved preset.",
      category: "Presets",
      source: { kind: "media_preset" },
      execution: {},
      limits: {},
      ui: {},
      fields: [],
      ports: { inputs: [], outputs: [] },
    };
    const data: GraphNodeData = {
      definition,
      fields: {},
      pricingEstimate: {
        node_id: "preset-1",
        node_type: "preset.render",
        pricing_summary: { total: { estimated_credits: 6, estimated_cost_usd: 0.03 }, has_numeric_estimate: true },
      },
      onFieldChange: vi.fn(),
    };

    const { container } = render(<GraphNode id="preset-1" data={data} selected={false} type="graphNode" dragging={false} zIndex={1} isConnectable={true} positionAbsoluteX={0} positionAbsoluteY={0} /> as never);

    expect(container.querySelector(".graph-node-price-badges .graph-node-price-floating-badge")?.textContent).toBe("≈6 cr · $0.03");
    expect(container.querySelector(".graph-node-reference-badges .graph-node-price-floating-badge")).toBeNull();
    expect(container.querySelector(".graph-node-header-actions .graph-node-price-chip")).toBeNull();
  });

  it("lets content auto-height nodes resize above their configured max height", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    const definition: GraphNodeDefinition = {
      type: "prompt.recipe",
      title: "Prompt Recipe",
      description: "Run a prompt recipe.",
      category: "Prompt",
      source: {},
      execution: {},
      limits: {},
      ui: {
        min_size: { width: 360, height: 560 },
        max_size: { width: 700, height: 1240 },
      },
      fields: [],
      ports: { inputs: [], outputs: [] },
    };
    const data: GraphNodeData = {
      definition,
      fields: {},
      autoSizedHeight: 1600,
      onFieldChange: vi.fn(),
    };

    const { getByTestId } = render(<GraphNode id="recipe-1" data={data} selected={false} type="graphNode" dragging={false} zIndex={1} isConnectable={true} positionAbsoluteX={0} positionAbsoluteY={0} /> as never);

    expect(getByTestId("node-resizer").getAttribute("data-min-height")).toBe("560");
    expect(Number(getByTestId("node-resizer").getAttribute("data-max-height"))).toBeGreaterThan(1600);
  });
});
