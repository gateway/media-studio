import assert from "node:assert/strict";
import test from "node:test";

import { buildNoPaidProofTelemetry } from "./run_media_assistant_preset_loop_qa.mjs";

test("no-paid proof telemetry captures comparable turn, cache, plan, and no-job evidence", () => {
  const telemetry = buildNoPaidProofTelemetry({
    sessionId: "asst_fixture",
    intakeMessage: {
      content_json: {
        kernel_turn: {
          trace: {
            duration_ms: 1250,
            termination: "completed",
            provider_steps: [
              {
                provider_thread_id: "thread_fixture",
                process_lifecycle: "process_spawned",
                reuse_mode: "new_thread",
                latency_ms: 900,
              },
              {
                provider_thread_id: "thread_fixture",
                process_lifecycle: "process_reused",
                reuse_mode: "live_process",
                latency_ms: 200,
              },
            ],
            tool_calls: [{ tool_name: "analyze_reference_images", duration_ms: 100, cache_status: "miss" }],
          },
        },
      },
    },
    planMessage: {
      content_json: {
        kernel_turn: {
          trace: {
            duration_ms: 700,
            termination: "completed",
            provider_steps: [
              {
                provider_thread_id: "thread_fixture",
                process_lifecycle: "process_reused",
                reuse_mode: "live_process",
                latency_ms: 500,
              },
            ],
            tool_calls: [{ tool_name: "propose_graph_operations", duration_ms: 50 }],
          },
        },
      },
    },
    summary: {
      reference_analysis_cache: {
        cached_fixture: {
          attachment_set_hash: "attachment_hash_fixture",
          reference_count: 2,
        },
      },
    },
    selectedRefs: [
      { reference_id: "ref_1", original_filename: "first.png", bytes: "base64-image-bytes" },
      { reference_id: "ref_2", original_filename: "second.png", secret: "secret-token" },
    ],
    plan: {
      plan: { assistant_plan_id: "asplan_fixture" },
      graph_plan: { metadata: { base_workflow_fingerprint: "workflow_hash_fixture" } },
      validation: { valid: true, errors: [] },
      pricing: {
        pricing_summary: {
          is_authoritative: true,
          total: { estimated_credits: 6, estimated_cost_usd: 0.03, authoritative: false },
        },
      },
    },
    jobIdsBefore: ["job_existing"],
    jobIdsAfter: ["job_existing"],
  });

  assert.deepEqual(telemetry.provider, {
    thread_id: "thread_fixture",
    process_spawns: 1,
    reuse_modes: ["new_thread", "live_process"],
  });
  assert.deepEqual(telemetry.turns[0], {
    name: "reference_intake",
    duration_ms: 1250,
    provider_steps: 2,
    tool_steps: 1,
    provider_latency_ms: 1100,
    termination: "completed",
  });
  assert.deepEqual(telemetry.turns[1], {
    name: "test_graph_plan",
    duration_ms: 700,
    provider_steps: 1,
    tool_steps: 1,
    provider_latency_ms: 500,
    termination: "completed",
  });
  assert.deepEqual(telemetry.attachments, {
    reference_count: 2,
    attachment_set_hash: "attachment_hash_fixture",
    cache_statuses: ["miss"],
  });
  assert.deepEqual(telemetry.plan, {
    assistant_plan_id: "asplan_fixture",
    workflow_fingerprint: "workflow_hash_fixture",
    validation_valid: true,
    validation_error_count: 0,
    estimated_credits: 6,
    estimated_cost_usd: 0.03,
    pricing_authoritative: true,
  });
  assert.deepEqual(telemetry.run, { run_id: null, new_job_ids: [], no_job_created: true });
  assert.deepEqual(telemetry.saved_preset, { preset_id: null, key: null });
  assert.doesNotMatch(JSON.stringify(telemetry), /base64-image-bytes|secret-token/);
});
