import type { GraphGroup, GraphWorkflowPayload } from "../types";

export type CreativeAssistantCanvasContext = {
  version: 1;
  workflow_id?: string | null;
  workflow_name: string;
  node_count: number;
  edge_count: number;
  selection_available: boolean;
  selected_node_ids: string[];
  selected_group_ids: string[];
  viewport?: Record<string, unknown>;
  nodes: Array<{
    id: string;
    type: string;
    title: string;
    position: { x: number; y: number };
    field_keys: string[];
    prompt_summaries: Array<{ field: string; preview: string }>;
    media_refs: Array<Record<string, unknown>>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    source_port: string;
    target: string;
    target_port: string;
  }>;
  groups: GraphGroup[];
  layout: {
    bounds: { x: number; y: number; width: number; height: number } | null;
    next_section_hint: { x: number; y: number } | null;
  };
};

type BuildCreativeAssistantCanvasContextOptions = {
  selectedNodeIds?: string[];
  selectedGroupIds?: string[];
};

const PROMPT_FIELD_KEYS = new Set(["prompt", "text", "scene", "scene_brief", "story_brief", "style", "style_direction", "previous_output"]);
const SENSITIVE_KEY_PARTS = ["api", "key", "secret", "token", "password", "authorization", "cookie"];
const MEDIA_REF_FIELD_KEYS = new Set(["asset_id", "media_asset_id", "reference_id"]);
const MAX_PROMPT_PREVIEW_CHARS = 240;
const SECTION_GAP = 360;

function titleForNode(node: GraphWorkflowPayload["nodes"][number]) {
  const ui = node.metadata?.ui;
  const customTitle = ui && typeof ui === "object" && typeof (ui as Record<string, unknown>).customTitle === "string"
    ? String((ui as Record<string, unknown>).customTitle).trim()
    : "";
  return customTitle || node.type;
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replaceAll("-", "_");
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function compactText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_PROMPT_PREVIEW_CHARS) return normalized;
  return `${normalized.slice(0, MAX_PROMPT_PREVIEW_CHARS - 3).trim()}...`;
}

function fieldLooksPromptLike(key: string) {
  const normalized = key.toLowerCase();
  if (PROMPT_FIELD_KEYS.has(normalized)) return true;
  return normalized.includes("prompt") || normalized.includes("brief") || normalized.includes("style");
}

function collectMediaRefs(value: unknown, field: string, results: Array<Record<string, unknown>>, depth = 0) {
  if (depth > 3 || results.length >= 12) return;
  if ((typeof value === "string" || typeof value === "number") && MEDIA_REF_FIELD_KEYS.has(field)) {
    const normalized = String(value).trim();
    if (normalized) {
      results.push({ field, [field]: normalized, kind: "image" });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.slice(0, 12).forEach((item) => collectMediaRefs(item, field, results, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  const payload = value as Record<string, unknown>;
  const mediaRef: Record<string, unknown> = { field };
  for (const key of ["asset_id", "media_asset_id", "reference_id", "kind", "media_type", "mime_type", "width", "height", "duration_seconds", "label", "name"]) {
    const item = payload[key];
    if (item !== undefined && item !== null && String(item).trim()) {
      mediaRef[key] = item;
    }
  }
  if (Object.keys(mediaRef).length > 1) {
    results.push(mediaRef);
    return;
  }
  Object.values(payload).forEach((item) => collectMediaRefs(item, field, results, depth + 1));
}

function summarizeNodeFields(fields: Record<string, unknown>) {
  const prompt_summaries: Array<{ field: string; preview: string }> = [];
  const media_refs: Array<Record<string, unknown>> = [];
  for (const [key, value] of Object.entries(fields)) {
    if (isSensitiveKey(key)) continue;
    if (typeof value === "string" && fieldLooksPromptLike(key)) {
      const preview = compactText(value);
      if (preview) prompt_summaries.push({ field: key, preview });
      continue;
    }
    collectMediaRefs(value, key, media_refs);
  }
  return { prompt_summaries: prompt_summaries.slice(0, 6), media_refs: media_refs.slice(0, 12) };
}

function graphGroups(workflow: GraphWorkflowPayload): GraphGroup[] {
  const groups = workflow.metadata?.groups;
  return Array.isArray(groups) ? (groups.filter((group) => group && typeof group === "object") as GraphGroup[]).slice(0, 24) : [];
}

function workflowBounds(workflow: GraphWorkflowPayload, groups: GraphGroup[]) {
  const rects = [
    ...workflow.nodes.map((node) => ({ x: node.position.x, y: node.position.y, width: 360, height: 280 })),
    ...groups.map((group) => group.bounds).filter(Boolean),
  ];
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function compactSelectedIds(ids: string[] | undefined, availableIds: Set<string>) {
  const selected: string[] = [];
  for (const id of ids ?? []) {
    const normalized = String(id || "").trim();
    if (!normalized || !availableIds.has(normalized) || selected.includes(normalized)) continue;
    selected.push(normalized);
  }
  return selected;
}

export function buildCreativeAssistantCanvasContext(
  workflow: GraphWorkflowPayload,
  options: BuildCreativeAssistantCanvasContextOptions = {},
): CreativeAssistantCanvasContext {
  const groups = graphGroups(workflow);
  const bounds = workflowBounds(workflow, groups);
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const groupIds = new Set(groups.map((group) => group.id));
  const selectedNodeIds = compactSelectedIds(options.selectedNodeIds, nodeIds);
  const selectedGroupIds = compactSelectedIds(options.selectedGroupIds, groupIds);
  return {
    version: 1,
    workflow_id: workflow.workflow_id ?? null,
    workflow_name: workflow.name,
    node_count: workflow.nodes.length,
    edge_count: workflow.edges.length,
    selection_available: selectedNodeIds.length > 0 || selectedGroupIds.length > 0,
    selected_node_ids: selectedNodeIds,
    selected_group_ids: selectedGroupIds,
    viewport: workflow.viewport,
    nodes: workflow.nodes.map((node) => {
      const fieldSummary = summarizeNodeFields(node.fields ?? {});
      return {
        id: node.id,
        type: node.type,
        title: titleForNode(node),
        position: { x: Number(node.position.x) || 0, y: Number(node.position.y) || 0 },
        field_keys: Object.keys(node.fields ?? {}).filter((key) => !isSensitiveKey(key)).sort(),
        ...fieldSummary,
      };
    }),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      source_port: edge.source_port,
      target: edge.target,
      target_port: edge.target_port,
    })),
    groups,
    layout: {
      bounds,
      next_section_hint: bounds ? { x: bounds.x + bounds.width + SECTION_GAP, y: bounds.y } : { x: 0, y: 0 },
    },
  };
}
