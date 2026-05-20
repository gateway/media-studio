import type { Edge, Node } from "@xyflow/react";
import type { GraphExecutionMode } from "./utils/graph-node-execution";

export type GraphMediaPreview = {
  mediaType: "image" | "video" | "audio";
  url: string;
  fullUrl?: string | null;
  posterUrl?: string | null;
  label?: string | null;
  aspectLabel?: string | null;
  resolutionLabel?: string | null;
};

export type GraphNodePort = {
  id: string;
  label: string;
  type: string;
  array?: boolean;
  min?: number;
  max?: number | null;
  required?: boolean;
  accepts?: string[];
  description?: string | null;
  advanced?: boolean;
  visible_if?: {
    field?: string;
    equals?: unknown;
    not_equals?: unknown;
    in?: unknown[];
    not_in?: unknown[];
  } | null;
};

export type GraphNodeField = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string | null;
  options?: unknown[];
  min?: number | null;
  max?: number | null;
  help_text?: string | null;
  advanced?: boolean;
  hidden?: boolean;
  connectable?: boolean;
  port_type?: string | null;
  visible_if?: {
    field?: string;
    equals?: unknown;
    not_equals?: unknown;
    in?: unknown[];
    not_in?: unknown[];
  } | null;
};

export type GraphNodeDefinition = {
  type: string;
  title: string;
  description?: string | null;
  help_text?: string | null;
  category: string;
  search_aliases?: string[];
  source?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  ui?: Record<string, unknown>;
  ports: {
    inputs: GraphNodePort[];
    outputs: GraphNodePort[];
  };
  fields: GraphNodeField[];
};

export type GraphNodeData = {
  definition: GraphNodeDefinition;
  fields: Record<string, unknown>;
  mediaPreview?: GraphMediaPreview | null;
  mediaPreviews?: GraphMediaPreview[];
  referenceBadges?: Array<{
    id: string;
    label: string;
    token: string;
    mediaType: "image" | "video" | "audio";
    index: number;
    targetNodeId: string;
    targetTitle: string;
    targetPortId: string;
    targetPortLabel: string;
  }>;
  outputSnapshot?: Record<string, unknown>;
  connectedInputPorts?: string[];
  connectedOutputPorts?: string[];
  activeConnection?: {
    portType: string;
    from: "input" | "output";
  } | null;
  collapsed?: boolean;
  advancedExpanded?: boolean;
  autoSizedHeight?: number | null;
  accentColor?: string | null;
  nodeColor?: string | null;
  nodeHeaderColor?: string | null;
  customTitle?: string | null;
  executionMode?: GraphExecutionMode;
  executionCache?: {
    cachedRunId?: string | null;
    cachedArtifactIds?: Record<string, string[]>;
  } | null;
  isRenamingTitle?: boolean;
  titleDraft?: string;
  status?: string;
  progress?: number | null;
  errorMessage?: string | null;
  activityLabel?: string | null;
  activityDetail?: string | null;
  activityTone?: "active" | "success" | "warning" | "error" | "muted" | null;
  pricingEstimate?: GraphNodePricingEstimate | null;
  onFieldChange: (nodeId: string, fieldId: string, value: unknown) => void;
  onSetFields?: (nodeId: string, fields: Record<string, unknown>) => void;
  onOpenImageLibrary?: (nodeId: string) => void;
  onImageDrop?: (nodeId: string, file: File) => void;
  onInputRewireStart?: (nodeId: string, portId: string, point: { clientX: number; clientY: number; pointerId?: number }) => void;
  onToggleCollapsed?: (nodeId: string) => void;
  onToggleAdvancedExpanded?: (nodeId: string) => void;
  onEnsureNodeHeight?: (nodeId: string, requiredHeight: number) => void;
  onOpenPreview?: (preview: GraphMediaPreview, collection?: GraphMediaPreview[]) => void;
  onStartRenameNode?: (nodeId: string) => void;
  onRenameNodeDraftChange?: (value: string) => void;
  onCommitRenameNode?: () => void;
  onCancelRenameNode?: () => void;
};

export type GraphError = { code: string; message: string; node_id?: string | null; edge_id?: string | null; field_id?: string | null; port_id?: string | null };

export type GraphPricingSummary = {
  currency?: string | null;
  total?: { estimated_credits?: number | null; estimated_cost_usd?: number | null };
  per_output?: { estimated_credits?: number | null; estimated_cost_usd?: number | null };
  has_numeric_estimate?: boolean;
  has_unknown_pricing?: boolean;
  is_authoritative?: boolean;
  is_stale?: boolean;
  pricing_version?: string | null;
  pricing_source_kind?: string | null;
  pricing_status?: string | null;
  output_count?: number;
};

export type GraphNodePricingEstimate = {
  node_id: string;
  node_type: string;
  model_key?: string | null;
  task_mode?: string | null;
  output_count?: number;
  pricing_summary: GraphPricingSummary;
  assumptions?: string[];
  warnings?: GraphError[];
};

export type GraphEstimateResponse = {
  pricing_summary: GraphPricingSummary;
  nodes: Record<string, GraphNodePricingEstimate>;
  warnings: GraphError[];
};

export type GraphWorkflowPayload = {
  schema_version: 1;
  workflow_id?: string | null;
  name: string;
  description?: string | null;
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    fields: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    source_port: string;
    target: string;
    target_port: string;
  }>;
  viewport?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type GraphGroup = {
  id: string;
  title: string;
  color: string;
  node_ids: string[];
  bounds: { x: number; y: number; width: number; height: number };
  execution?: { mode?: string | null } | null;
};

export type GraphWorkflowRecord = {
  workflow_id: string;
  name: string;
  description?: string | null;
  status?: string;
  schema_version?: number;
  workflow_json?: GraphWorkflowPayload;
  created_at?: string | null;
  updated_at?: string | null;
};

export type GraphTemplateRecord = {
  template_id: string;
  name: string;
  description?: string | null;
  tags?: string[];
  thumbnail_path?: string | null;
  workflow_json?: GraphWorkflowPayload;
  status?: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type GraphWorkspaceTab = {
  tab_id: string;
  workflow_id?: string | null;
  workflow_name: string;
  workflow_json?: GraphWorkflowPayload | null;
  saved_workflow_signature?: string | null;
  workflow_updated_at?: string | null;
  run_id?: string | null;
  console_lines?: string[];
  dirty?: boolean;
  updated_at?: string | null;
};

export type GraphRun = {
  run_id: string;
  workflow_id: string;
  status: string;
  error?: string | null;
  workflow_json?: GraphWorkflowPayload;
  output_snapshot_json?: Record<string, unknown>;
  metrics_json?: Record<string, unknown>;
  nodes?: Array<{
    run_node_id?: string;
    run_id?: string;
    node_id: string;
    node_type: string;
    status: string;
    progress?: number | null;
    error?: string | null;
    output_snapshot_json?: Record<string, unknown>;
    artifacts?: GraphArtifact[];
    metrics_json?: Record<string, unknown>;
    started_at?: string | null;
    finished_at?: string | null;
    updated_at?: string | null;
  }>;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at?: string | null;
};

export type GraphRunStatusNode = {
  run_node_id: string;
  run_id: string;
  node_id: string;
  node_type: string;
  status: string;
  progress?: number | null;
  has_output_snapshot?: boolean;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at?: string | null;
};

export type GraphRunStatusSnapshot = {
  run_id: string;
  workflow_id: string;
  status: string;
  error?: string | null;
  latest_event_id?: string | null;
  nodes: GraphRunStatusNode[];
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at?: string | null;
};

export type GraphRunTransportMetrics = {
  statusRequests: number;
  fullRunRequests: number;
  eventRequests: number;
  streamConnections: number;
  streamErrors: number;
};

export type GraphRunEvent = {
  event_id: string;
  run_id: string;
  node_id?: string | null;
  event_type: string;
  payload_json?: Record<string, unknown>;
  created_at?: string | null;
};

export type GraphArtifact = {
  artifact_id: string;
  workflow_id: string;
  run_id: string;
  node_id: string;
  node_type: string;
  output_port: string;
  output_index: number;
  kind: string;
  media_type?: string | null;
  asset_id?: string | null;
  reference_id?: string | null;
  job_id?: string | null;
  parent_artifact_id?: string | null;
  parent_asset_id?: string | null;
  parent_reference_id?: string | null;
  transform_type?: string | null;
  transform_params_json?: Record<string, unknown>;
  metadata_json?: Record<string, unknown>;
  created_at?: string | null;
};

export type StudioNode = Node<GraphNodeData>;
export type StudioEdge = Edge;
