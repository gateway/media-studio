import assert from "node:assert/strict";
import test from "node:test";

import {
  planPreviewFromSession,
  workflowForProbeSession,
} from "./assistant_conversation_probe_contract.mjs";

test("workflowForProbeSession aligns the workflow and Assistant owner identity", () => {
  assert.deepEqual(
    workflowForProbeSession({ schema_version: 1, nodes: [], edges: [] }, "graph-one"),
    {
      schema_version: 1,
      workflow_id: "conversation-probe-graph-one",
      nodes: [],
      edges: [],
    },
  );
});

test("planPreviewFromSession reuses the plan returned by the message response", () => {
  const latestPlan = {
    plan: { assistant_plan_id: "asplan_current", status: "validated" },
    validation: { valid: true },
    pricing: { pricing_summary: { total: { estimated_credits: 6 } } },
  };

  assert.equal(
    planPreviewFromSession({ latest_plan: latestPlan }, { plan_preview: true }),
    latestPlan,
  );
});

test("planPreviewFromSession stays empty when preview evidence is not required or absent", () => {
  assert.equal(
    planPreviewFromSession({ latest_plan: { validation: { valid: true } } }, { plan_preview: false }),
    null,
  );
  assert.equal(planPreviewFromSession({}, { plan_preview: true }), null);
});
