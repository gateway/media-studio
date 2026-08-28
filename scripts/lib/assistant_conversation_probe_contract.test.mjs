import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMechanicalTurn,
  planPreviewFromSession,
  workflowForProbeSession,
} from "./assistant_conversation_probe_contract.mjs";

function passingMechanicalFixture() {
  return {
    scenario: {
      mechanical: {
        expect_confirmation: true,
        expect_no_mutation: true,
        max_tool_steps: 6,
        plan_preview: true,
        require_tool_evidence: true,
      },
    },
    reply: "I checked the graph and prepared a valid proposal for your review.",
    contentJson: {
      next_action: {
        kind: "confirm_graph",
        label: "Add to canvas",
        proposal_id: "asplan_ci",
        confirmation_token: "confirm_ci",
        requires_confirmation: true,
        payload: {
          proposal_id: "asplan_ci",
          confirmation_token: "confirm_ci",
        },
      },
      kernel_turn: {
        trace: {
          provider_steps: [
            {
              provider_thread_id: "thread-ci",
              process_lifecycle: "process_spawned",
              reuse_mode: "new_thread",
            },
          ],
          tool_calls: [
            {
              tool_name: "propose_graph_operations",
              arguments_hash: "sha256:fixture",
              duration_ms: 4,
              result_size_bytes: 512,
            },
          ],
          step_count: 1,
          termination: "completed",
        },
      },
      assistant_turn_trace: {provider_process_spawns: 1},
    },
    plan: {
      plan: {status: "validated"},
      validation: {valid: true},
      pricing: {pricing_summary: {total: {estimated_credits: 6}}},
    },
    jobsBefore: 2,
    jobsAfter: 2,
  };
}

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

test("evaluateMechanicalTurn accepts a deterministic typed proposal trace", () => {
  const checks = evaluateMechanicalTurn(passingMechanicalFixture());

  assert.equal(checks.pass, true);
  assert.equal(checks.typed_actions.pass, true);
  assert.equal(checks.tool_evidence.pass, true);
  assert.equal(checks.action_shape.pass, true);
  assert.equal(checks.workflow_validity.pass, true);
  assert.equal(checks.banned_vocabulary.pass, true);
  assert.equal(checks.process_lifecycle.pass, true);
  assert.equal(checks.step_limit.pass, true);
});

test("evaluateMechanicalTurn keeps concise chat strict but permits an explicit content-heavy limit", () => {
  const defaultFixture = passingMechanicalFixture();
  defaultFixture.reply = Array.from({ length: 151 }, () => "word").join(" ");
  const boundedException = passingMechanicalFixture();
  boundedException.scenario.mechanical.max_reply_words = 400;
  boundedException.reply = Array.from({ length: 300 }, () => "word").join(" ");

  assert.equal(evaluateMechanicalTurn(defaultFixture).reply_length.pass, false);
  assert.equal(evaluateMechanicalTurn(defaultFixture).reply_length.max_words, 150);
  assert.equal(evaluateMechanicalTurn(boundedException).reply_length.pass, true);
  assert.equal(evaluateMechanicalTurn(boundedException).reply_length.max_words, 400);
});

test("evaluateMechanicalTurn rejects missing or malformed typed tool evidence", () => {
  const missing = passingMechanicalFixture();
  missing.contentJson.kernel_turn.trace.tool_calls = [];
  const malformed = passingMechanicalFixture();
  malformed.contentJson.kernel_turn.trace.tool_calls[0].arguments_hash = "";

  assert.equal(evaluateMechanicalTurn(missing).tool_evidence.pass, false);
  assert.equal(evaluateMechanicalTurn(malformed).typed_actions.pass, false);
});

test("evaluateMechanicalTurn accepts a confirmable graph whose only pending input is media", () => {
  const pendingMedia = passingMechanicalFixture();
  pendingMedia.plan.validation = {
    valid: false,
    errors: [
      {
        code: "missing_media_reference",
        message: "Choose an image before running this graph.",
      },
    ],
  };

  const checks = evaluateMechanicalTurn(pendingMedia);

  assert.equal(checks.workflow_validity.pass, true);
  assert.deepEqual(checks.workflow_validity.pending_error_codes, ["missing_media_reference"]);
});

test("evaluateMechanicalTurn rejects pending media without a validated confirmable proposal", () => {
  const missingAction = passingMechanicalFixture();
  missingAction.plan.validation = {
    valid: false,
    errors: [{code: "missing_media_reference"}],
  };
  missingAction.contentJson.next_action = {
    kind: "none",
    requires_confirmation: false,
  };
  const rejected = structuredClone(missingAction);
  rejected.plan.plan.status = "rejected";
  rejected.contentJson.next_action = passingMechanicalFixture().contentJson.next_action;

  assert.equal(evaluateMechanicalTurn(missingAction).workflow_validity.pass, false);
  assert.equal(evaluateMechanicalTurn(rejected).workflow_validity.pass, false);
});

test("evaluateMechanicalTurn rejects a valid preview without graph confirmation", () => {
  const missingAction = passingMechanicalFixture();
  missingAction.contentJson.next_action = {kind: "none", requires_confirmation: false};

  assert.equal(evaluateMechanicalTurn(missingAction).workflow_validity.pass, false);
});

test("evaluateMechanicalTurn requires the canonical tool_calls trace field", () => {
  const aliased = passingMechanicalFixture();
  aliased.contentJson.kernel_turn.trace.tools = aliased.contentJson.kernel_turn.trace.tool_calls;
  delete aliased.contentJson.kernel_turn.trace.tool_calls;

  assert.equal(evaluateMechanicalTurn(aliased).tool_evidence.pass, false);
});

test("evaluateMechanicalTurn rejects malformed next actions and invalid workflows", () => {
  const malformedAction = passingMechanicalFixture();
  malformedAction.contentJson.next_action.confirmation_token = "";
  const invalidWorkflow = passingMechanicalFixture();
  invalidWorkflow.plan.validation.valid = false;

  assert.equal(evaluateMechanicalTurn(malformedAction).action_shape.pass, false);
  assert.equal(evaluateMechanicalTurn(invalidWorkflow).workflow_validity.pass, false);
});

test("evaluateMechanicalTurn requires a typed next action for confirmation", () => {
  const missing = passingMechanicalFixture();
  delete missing.contentJson.next_action;
  missing.reply = "Please confirm before I run this workflow.";

  const checks = evaluateMechanicalTurn(missing);
  assert.equal(checks.action_shape.pass, false);
  assert.equal(checks.confirmation.pass, false);
});

test("evaluateMechanicalTurn rejects banned vocabulary and lifecycle regressions", () => {
  const banned = passingMechanicalFixture();
  banned.reply = "The provider_ trace is ready.";
  const duplicateSpawn = passingMechanicalFixture();
  duplicateSpawn.contentJson.kernel_turn.trace.provider_steps.push({
    provider_thread_id: "thread-ci",
    process_lifecycle: "process_spawned",
    reuse_mode: "new_thread",
  });
  duplicateSpawn.contentJson.assistant_turn_trace.provider_process_spawns = 2;

  assert.deepEqual(evaluateMechanicalTurn(banned).banned_vocabulary.hits, ["provider_"]);
  assert.equal(evaluateMechanicalTurn(duplicateSpawn).process_lifecycle.pass, false);
});

test("evaluateMechanicalTurn rejects step-budget and unconfirmed-mutation regressions", () => {
  const exhausted = passingMechanicalFixture();
  exhausted.contentJson.kernel_turn.trace.step_count = 7;
  exhausted.contentJson.kernel_turn.trace.termination = "step_budget_exhausted";
  const mutated = passingMechanicalFixture();
  mutated.plan.plan.status = "applied";
  mutated.jobsAfter = 3;

  assert.equal(evaluateMechanicalTurn(exhausted).step_limit.pass, false);
  assert.equal(evaluateMechanicalTurn(mutated).no_unconfirmed_mutation.pass, false);
});

test("evaluateMechanicalTurn requires an authoritative integer step count", () => {
  const missing = passingMechanicalFixture();
  delete missing.contentJson.kernel_turn.trace.step_count;

  assert.equal(evaluateMechanicalTurn(missing).step_limit.pass, false);
});
