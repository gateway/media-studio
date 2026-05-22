import type { MediaReference } from "@/lib/types";

import type { GraphNodeDefinition, GraphWorkflowPayload } from "../types";

export type GraphWorkflowExport = {
  kind: "media-studio.graph.workflow";
  schema_version: 1;
  exported_at: string;
  workflow: GraphWorkflowPayload;
  node_definitions: Array<{
    type: string;
    title: string;
    category: string;
    source?: Record<string, unknown>;
    fingerprint?: string | null;
  }>;
  warnings: string[];
};

export type GraphWorkflowBundleManifest = {
  kind: "media-studio.graph.bundle";
  schema_version: 1;
  exported_at: string;
  workflow_export: GraphWorkflowExport;
  references: Array<{
    reference_id: string;
    kind: string;
    file: string;
    mime_type?: string | null;
    original_filename?: string | null;
  }>;
};

export type GraphWorkflowImportResult = {
  workflow: GraphWorkflowPayload;
  warnings: string[];
};

const EXPORT_KIND = "media-studio.graph.workflow";
const BUNDLE_KIND = "media-studio.graph.bundle";
const UNSAFE_KEY_PATTERN = /(api[_-]?key|secret|token|password|authorization|cookie)/i;
const ABSOLUTE_PATH_PATTERN = /^(?:[a-zA-Z]:\\|\/Users\/|\/home\/|\/var\/|file:\/\/)/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizeValue(value: unknown, warnings: string[], path: string): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:")) {
      warnings.push(`Removed base64/data URL value at ${path}.`);
      return "";
    }
    if (ABSOLUTE_PATH_PATTERN.test(value)) {
      warnings.push(`Removed absolute local path value at ${path}.`);
      return "";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, warnings, `${path}[${index}]`));
  }
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) => {
      if (UNSAFE_KEY_PATTERN.test(key)) {
        warnings.push(`Removed unsafe field ${path}.${key}.`);
        return [];
      }
      return [[key, sanitizeValue(item, warnings, `${path}.${key}`)]];
    }),
  );
}

export function sanitizeWorkflowForExport(workflow: GraphWorkflowPayload, definitions: GraphNodeDefinition[]): GraphWorkflowExport {
  const warnings: string[] = [];
  const clonedWorkflow = sanitizeValue(cloneJson(workflow), warnings, "workflow") as GraphWorkflowPayload;
  const definitionMap = new Map(definitions.map((definition) => [definition.type, definition]));
  const nodeDefinitions = clonedWorkflow.nodes.map((node) => {
    const definition = definitionMap.get(node.type);
    const source = definition?.source ? sanitizeValue(definition.source, warnings, `node_definitions.${node.type}.source`) : undefined;
    const fingerprint =
      typeof definition?.source?.kie_spec_version === "string"
        ? definition.source.kie_spec_version
        : typeof definition?.source?.fingerprint === "string"
          ? definition.source.fingerprint
          : null;
    return {
      type: node.type,
      title: definition?.title ?? node.type,
      category: definition?.category ?? "Unknown",
      source: source as Record<string, unknown> | undefined,
      fingerprint,
    };
  });
  return {
    kind: EXPORT_KIND,
    schema_version: 1,
    exported_at: new Date().toISOString(),
    workflow: clonedWorkflow,
    node_definitions: nodeDefinitions,
    warnings,
  };
}

function assertWorkflowPayload(value: unknown): GraphWorkflowPayload {
  const record = asRecord(value);
  if (!record || record.schema_version !== 1 || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    throw new Error("Invalid Graph Studio workflow schema.");
  }
  return record as GraphWorkflowPayload;
}

export function parseWorkflowImportText(text: string): GraphWorkflowImportResult {
  const parsed = JSON.parse(text) as unknown;
  const record = asRecord(parsed);
  const workflow = record?.kind === EXPORT_KIND ? assertWorkflowPayload(record.workflow) : assertWorkflowPayload(parsed);
  return {
    workflow: {
      ...workflow,
      workflow_id: null,
      name: `Imported: ${workflow.name || "Untitled workflow"}`,
    },
    warnings: Array.isArray(record?.warnings) ? record.warnings.map(String) : [],
  };
}

function collectReferenceIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferenceIds(item, ids));
    return ids;
  }
  const record = asRecord(value);
  if (!record) return ids;
  if (typeof record.reference_id === "string" && record.reference_id) {
    ids.add(record.reference_id);
  }
  Object.values(record).forEach((item) => collectReferenceIds(item, ids));
  return ids;
}

function remapReferenceIds(value: unknown, referenceIdMap: Map<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => remapReferenceIds(item, referenceIdMap));
  }
  const record = asRecord(value);
  if (!record) {
    return typeof value === "string" && referenceIdMap.has(value) ? referenceIdMap.get(value) : value;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, key === "reference_id" && typeof item === "string" ? referenceIdMap.get(item) ?? item : remapReferenceIds(item, referenceIdMap)]),
  );
}

function safeBundleFilename(reference: MediaReference): string {
  const base = (reference.original_filename ?? reference.reference_id).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "reference";
  return `media/${reference.reference_id}-${base}`;
}

export async function buildWorkflowBundle(exportPayload: GraphWorkflowExport, references: MediaReference[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const usedReferenceIds = collectReferenceIds(exportPayload.workflow);
  const includedReferences: GraphWorkflowBundleManifest["references"] = [];
  for (const reference of references) {
    if (!usedReferenceIds.has(reference.reference_id) || !reference.stored_url) continue;
    const response = await fetch(reference.stored_url);
    if (!response.ok) continue;
    const filePath = safeBundleFilename(reference);
    zip.file(filePath, await response.arrayBuffer());
    includedReferences.push({
      reference_id: reference.reference_id,
      kind: reference.kind,
      file: filePath,
      mime_type: reference.mime_type,
      original_filename: reference.original_filename,
    });
  }
  const manifest: GraphWorkflowBundleManifest = {
    kind: BUNDLE_KIND,
    schema_version: 1,
    exported_at: new Date().toISOString(),
    workflow_export: exportPayload,
    references: includedReferences,
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function parseWorkflowImportFile(
  file: File,
  importReferenceFile: (file: File) => Promise<MediaReference>,
): Promise<GraphWorkflowImportResult> {
  if (file.name.endsWith(".zip") || file.name.endsWith(".media-studio-graph.zip")) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("Workflow bundle is missing manifest.json.");
    const manifest = JSON.parse(await manifestFile.async("text")) as GraphWorkflowBundleManifest;
    if (manifest.kind !== BUNDLE_KIND || manifest.schema_version !== 1) {
      throw new Error("Invalid Graph Studio workflow bundle.");
    }
    const referenceIdMap = new Map<string, string>();
    for (const reference of manifest.references ?? []) {
      const zipEntry = zip.file(reference.file);
      if (!zipEntry) continue;
      const blob = await zipEntry.async("blob");
      const imported = await importReferenceFile(
        new File([blob], reference.original_filename || reference.file.split("/").pop() || "reference-media", {
          type: reference.mime_type || blob.type || "application/octet-stream",
        }),
      );
      referenceIdMap.set(reference.reference_id, imported.reference_id);
    }
    const workflow = remapReferenceIds(manifest.workflow_export.workflow, referenceIdMap) as GraphWorkflowPayload;
    return {
      workflow: {
        ...workflow,
        workflow_id: null,
        name: `Imported: ${workflow.name || "Untitled workflow"}`,
      },
      warnings: [
        ...(manifest.workflow_export.warnings ?? []),
        ...((manifest.references ?? []).length > 0 && referenceIdMap.size === 0 ? ["Bundle imported without remapped reference media."] : []),
      ],
    };
  }
  return parseWorkflowImportText(await file.text());
}

export function downloadGraphBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
