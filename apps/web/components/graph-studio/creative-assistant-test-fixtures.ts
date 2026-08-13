import type { AssistantSession, GraphWorkflowPayload } from "./types";

export const assistantTestWorkflow: GraphWorkflowPayload = {
  schema_version: 1,
  workflow_id: "workflow-1",
  name: "Assistant Graph",
  nodes: [],
  edges: [],
  metadata: {},
};

export const assistantTestSession: Omit<AssistantSession, "messages"> = {
  assistant_session_id: "session-1",
  owner_kind: "graph_workflow",
  owner_id: "workflow-1",
  provider_kind: "codex_local",
  status: "active",
  attachments: [],
};

export function assistantJsonResponse(payload: unknown) {
  return Promise.resolve(new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}
