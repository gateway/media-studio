import type { Edge, Node } from "@xyflow/react";

export type GraphMediaPreview = {
  mediaType: "image" | "video";
  url: string;
  label?: string | null;
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
  advanced?: boolean;
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
};

export type GraphNodeDefinition = {
  type: string;
  title: string;
  description?: string | null;
  category: string;
  search_aliases?: string[];
  source?: Record<string, unknown>;
  execution?: Record<string, unknown>;
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
  outputSnapshot?: Record<string, unknown>;
  connectedInputPorts?: string[];
  status?: string;
  progress?: number | null;
  onFieldChange: (nodeId: string, fieldId: string, value: unknown) => void;
  onSetFields?: (nodeId: string, fields: Record<string, unknown>) => void;
  onOpenImageLibrary?: (nodeId: string) => void;
  onImageDrop?: (nodeId: string, file: File) => void;
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

export type GraphRun = {
  run_id: string;
  workflow_id: string;
  status: string;
  error?: string | null;
  output_snapshot_json?: Record<string, unknown>;
  nodes?: Array<{
    node_id: string;
    node_type: string;
    status: string;
    progress?: number | null;
    error?: string | null;
    output_snapshot_json?: Record<string, unknown>;
  }>;
};

export type GraphRunEvent = {
  event_id: string;
  run_id: string;
  node_id?: string | null;
  event_type: string;
  payload_json?: Record<string, unknown>;
  created_at?: string | null;
};

export type StudioNode = Node<GraphNodeData>;
export type StudioEdge = Edge;
