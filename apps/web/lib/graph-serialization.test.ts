import { afterEach, describe, expect, it, vi } from "vitest";

import { workflowFromCanvas } from "@/components/graph-studio/utils/graph-serialization";
import { hydrateGraphWorkflowForCanvas } from "@/components/graph-studio/utils/graph-workflow-hydration";
import { inputGraphHandleId, outputGraphHandleId } from "@/components/graph-studio/utils/graph-port-handles";
import { buildWorkflowBundle, parseWorkflowImportFile, sanitizeWorkflowForExport } from "@/components/graph-studio/utils/graph-workflow-transfer";
import type { GraphNodeDefinition, StudioNode } from "@/components/graph-studio/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("graph workflow serialization", () => {
  it("preserves pinned cached-output metadata for muted nodes", () => {
    const node = {
      id: "model",
      position: { x: 0, y: 0 },
      data: {
        definition: { type: "model.kie.test" },
        fields: {},
        executionMode: "frozen",
        executionCache: {
          cachedRunId: "run-1",
          cachedArtifactIds: { image: ["artifact-1"] },
        },
      },
    } as StudioNode;
    const workflow = workflowFromCanvas("workflow-1", "Pinned", [node], []);
    expect(workflow.nodes[0].metadata?.execution).toMatchObject({
      mode: "frozen",
      cached_run_id: "run-1",
      cached_artifact_ids: { image: ["artifact-1"] },
    });
  });

  it("serializes internal directional handle ids back to backend port ids", () => {
    const source = {
      id: "load",
      position: { x: 0, y: 0 },
      data: { definition: { type: "media.load_image" }, fields: {} },
    } as StudioNode;
    const target = {
      id: "preview",
      position: { x: 300, y: 0 },
      data: { definition: { type: "preview.image" }, fields: {} },
    } as StudioNode;
    const workflow = workflowFromCanvas("workflow-1", "Handles", [source, target], [
      {
        id: "edge-load-preview",
        source: "load",
        sourceHandle: outputGraphHandleId("image"),
        target: "preview",
        targetHandle: inputGraphHandleId("image"),
      },
    ]);
    expect(workflow.edges[0]).toMatchObject({
      source_port: "image",
      target_port: "image",
    });
  });

  it("hydrates saved workflows through one canvas restore path", () => {
    const loadDefinition: GraphNodeDefinition = {
      type: "media.load_image",
      title: "Load Image",
      category: "Media",
      fields: [],
      ports: { inputs: [], outputs: [{ id: "image", label: "Image", type: "image" }] },
    };
    const previewDefinition: GraphNodeDefinition = {
      type: "preview.image",
      title: "Preview Image",
      category: "Preview",
      fields: [],
      ports: { inputs: [{ id: "image", label: "Image", type: "image" }], outputs: [] },
    };
    const hydrated = hydrateGraphWorkflowForCanvas({
      workflow: {
        schema_version: 1,
        workflow_id: "workflow-1",
        name: "Hydrate",
        nodes: [
          {
            id: "load",
            type: "media.load_image",
            position: { x: 10, y: 20 },
            fields: { reference_id: "ref-1" },
            metadata: { ui: { collapsed: true, customTitle: "Source" }, execution: { mode: "frozen", cached_run_id: "run-1" } },
          },
          { id: "preview", type: "preview.image", position: { x: 300, y: 20 }, fields: {} },
        ],
        edges: [{ id: "edge-load-preview", source: "load", source_port: "image", target: "preview", target_port: "image" }],
      },
      definitionsByType: new Map([
        [loadDefinition.type, loadDefinition],
        [previewDefinition.type, previewDefinition],
      ]),
      handlers: { onFieldChange: vi.fn() },
      run: {
        run_id: "run-1",
        workflow_id: "workflow-1",
        status: "completed",
        nodes: [{ node_id: "preview", node_type: "preview.image", status: "completed", output_snapshot_json: { image: "asset-1" } }],
      },
    });
    expect(hydrated.nodes).toHaveLength(2);
    expect(hydrated.nodes[0].data).toMatchObject({
      fields: { reference_id: "ref-1" },
      collapsed: true,
      customTitle: "Source",
      executionMode: "frozen",
      executionCache: { cachedRunId: "run-1" },
    });
    expect(hydrated.nodes[1].data).toMatchObject({
      status: "completed",
      outputSnapshot: { image: "asset-1" },
    });
    expect(hydrated.edges[0]).toMatchObject({
      sourceHandle: outputGraphHandleId("image"),
      targetHandle: inputGraphHandleId("image"),
      selected: false,
    });
  });

  it("drops stale provider-backed model metadata when the saved provider no longer matches", () => {
    const promptRecipeDefinition: GraphNodeDefinition = {
      type: "prompt.recipe",
      title: "Prompt Recipe",
      category: "Prompt",
      fields: [],
      ports: { inputs: [], outputs: [] },
    };
    const hydrated = hydrateGraphWorkflowForCanvas({
      workflow: {
        schema_version: 1,
        workflow_id: "workflow-1",
        name: "Hydrate prompt provider",
        nodes: [
          {
            id: "recipe",
            type: "prompt.recipe",
            position: { x: 10, y: 20 },
            fields: {
              provider: "codex_local",
              model_id: "qwen/qwen3.6",
              provider_model_label: "Qwen 3.6",
              provider_capabilities_json: { provider: "openrouter", model_id: "qwen/qwen3.6", model_label: "Qwen 3.6" },
            },
          },
        ],
        edges: [],
      },
      definitionsByType: new Map([[promptRecipeDefinition.type, promptRecipeDefinition]]),
      handlers: { onFieldChange: vi.fn() },
    });
    expect(hydrated.nodes[0].data.fields).toMatchObject({
      provider: "codex_local",
      model_id: "",
      provider_model_label: "",
      provider_capabilities_json: {},
    });
  });

  it("does not persist auto-grown display node heights back into workflow metadata", () => {
    const node = {
      id: "display-1",
      position: { x: 0, y: 0 },
      data: {
        definition: { type: "display.any" },
        fields: {},
        autoSizedHeight: 1765,
      },
      style: {
        width: 360,
        height: 1765,
        minHeight: 1765,
      },
    } as StudioNode;

    const workflow = workflowFromCanvas("workflow-1", "Display", [node], []);
    expect(workflow.nodes[0].metadata?.style).toMatchObject({
      width: 360,
    });
    expect(workflow.nodes[0].metadata?.style?.height).toBeUndefined();
  });

  it("persists manual media node size and restores it without inflating min height", () => {
    const loadDefinition: GraphNodeDefinition = {
      type: "media.load_image",
      title: "Load Image",
      category: "Media",
      fields: [],
      ports: { inputs: [], outputs: [{ id: "image", label: "Image", type: "image" }] },
      ui: {
        preview: true,
      },
    };

    const node = {
      id: "load-1",
      position: { x: 120, y: 80 },
      data: {
        definition: loadDefinition,
        fields: {},
        autoSizedHeight: 404,
      },
      style: {
        width: 520,
        height: 680,
        minHeight: 404,
      },
    } as StudioNode;

    const workflow = workflowFromCanvas("workflow-1", "Media resize", [node], []);
    expect(workflow.nodes[0].metadata?.style).toMatchObject({
      width: 520,
      height: 680,
    });

    const hydrated = hydrateGraphWorkflowForCanvas({
      workflow,
      definitionsByType: new Map([[loadDefinition.type, loadDefinition]]),
      handlers: { onFieldChange: vi.fn() },
    });

    expect(hydrated.nodes[0].style).toMatchObject({
      width: 520,
      height: 680,
    });
    expect(Number(hydrated.nodes[0].style?.minHeight)).toBeLessThan(680);
  });

  it("bundles referenced media and remaps reference ids on import", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["image-bytes"], { type: "image/png" }), { status: 200 })),
    );
    const exportPayload = sanitizeWorkflowForExport(
      {
        schema_version: 1,
        workflow_id: "workflow-1",
        name: "Portable",
        nodes: [{ id: "load", type: "media.load_image", position: { x: 0, y: 0 }, fields: { reference_id: "ref-old" } }],
        edges: [],
      },
      [
        {
          type: "media.load_image",
          title: "Load Image",
          category: "Media",
          ports: { inputs: [], outputs: [] },
          fields: [],
        },
      ],
    );
    const bundle = await buildWorkflowBundle(exportPayload, [
      {
        reference_id: "ref-old",
        kind: "image",
        stored_url: "http://127.0.0.1/reference.png",
        original_filename: "reference.png",
        mime_type: "image/png",
      },
    ] as any);
    const imported = await parseWorkflowImportFile(new File([bundle], "portable.media-studio-graph.zip"), async () => ({
      reference_id: "ref-new",
    }) as any);
    expect(imported.workflow.name).toBe("Imported: Portable");
    expect(imported.workflow.nodes[0].fields.reference_id).toBe("ref-new");
  });
});
