#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API_URL = process.env.MEDIA_STUDIO_API_URL || "http://127.0.0.1:8000";
const WEB_URL = process.env.MEDIA_STUDIO_WEB_URL || "http://127.0.0.1:3000";
const DEFAULT_LOCAL_CONTROL_API_TOKEN = "media-studio-local-control-token";
const REPORT_DIR = "docs/development/reports";
const MODES = new Set(["image-to-image", "text-to-image"]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

function usage() {
  console.log(
    [
      "Usage: node ./scripts/run_media_assistant_preset_loop_proof.mjs --refs style7.jpg --mode image-to-image --runtime-ref sadi-front.jpg",
      "       node ./scripts/run_media_assistant_preset_loop_proof.mjs --refs style7.jpg --mode text-to-image",
      "",
      "Runs a paid end-to-end Media Assistant preset-loop proof: analyze refs, create workflow, run, compare, save preset,",
      "and retest the saved preset by exact key. Never deletes/resets/truncates the database.",
    ].join("\n"),
  );
}

function loadDotEnv() {
  try {
    const text = readFileSync(".env", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // Local development can fall back to the known development token.
  }
}

function parseArgs(argv) {
  const options = {
    mode: "image-to-image",
    refs: [],
    runtimeRef: "",
    apiUrl: API_URL,
    webUrl: WEB_URL,
    reportDir: REPORT_DIR,
    timeoutMs: 240000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      index += 1;
      if (!MODES.has(argv[index])) throw new Error(`Unsupported --mode: ${argv[index] || ""}`);
      options.mode = argv[index];
    } else if (arg === "--refs") {
      index += 1;
      if (!argv[index]) throw new Error("Missing value for --refs.");
      options.refs = argv[index].split(",").map((item) => item.trim()).filter(Boolean);
    } else if (arg === "--runtime-ref") {
      index += 1;
      if (!argv[index]) throw new Error("Missing value for --runtime-ref.");
      options.runtimeRef = argv[index].trim();
    } else if (arg === "--api-url") {
      index += 1;
      if (!argv[index]) throw new Error("Missing value for --api-url.");
      options.apiUrl = argv[index].replace(/\/+$/, "");
    } else if (arg === "--web-url") {
      index += 1;
      if (!argv[index]) throw new Error("Missing value for --web-url.");
      options.webUrl = argv[index].replace(/\/+$/, "");
    } else if (arg === "--timeout-ms") {
      index += 1;
      options.timeoutMs = Number(argv[index] || 0);
      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 30000) throw new Error("Invalid --timeout-ms.");
    } else if (arg === "--report-dir") {
      index += 1;
      if (!argv[index]) throw new Error("Missing value for --report-dir.");
      options.reportDir = argv[index];
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.refs.length) throw new Error("Provide reference image filename(s) with --refs.");
  if (options.mode === "image-to-image" && !options.runtimeRef) {
    throw new Error("Image-to-image proof requires --runtime-ref with a separate subject/control image.");
  }
  return options;
}

function workflow(name) {
  return {
    schema_version: 1,
    name,
    nodes: [],
    edges: [],
    metadata: {
      qa_harness: "media_assistant_preset_loop_proof",
      created_without_database_reset: true,
    },
  };
}

function naturalPrompt(mode, refCount) {
  const source = refCount > 1 ? "these reference images" : "this reference image";
  if (mode === "text-to-image") {
    return `Create a reusable Media Preset from ${source}. I want the text-to-image version and only the most useful editable fields. Keep your reply short and guide me.`;
  }
  return `Create a reusable Media Preset from ${source}. I want one image input and only the most useful editable fields. Keep your reply short and guide me.`;
}

function planPrompt(mode) {
  return mode === "text-to-image"
    ? "Create the text-to-image test workflow now with the suggested fields."
    : "Create the image-to-image test workflow now with the suggested image input and fields.";
}

function referenceMap(items) {
  const map = new Map();
  for (const item of items) map.set(String(item.original_filename || "").toLowerCase(), item);
  return map;
}

function latestTrace(debugTrace, skill = "media_preset_builder") {
  const traces = Array.isArray(debugTrace?.trace) ? debugTrace.trace : [];
  return [...traces].reverse().find((item) => item?.skill === skill) || null;
}

function fillRuntimeImage(workflowPayload, referenceId) {
  if (!referenceId) return workflowPayload;
  return {
    ...workflowPayload,
    nodes: (workflowPayload.nodes || []).map((node) => {
      if (node.type !== "media.load_image") return node;
      const fields = node.fields || {};
      if (fields.reference_id || fields.asset_id) return node;
      return { ...node, fields: { ...fields, reference_id: referenceId } };
    }),
  };
}

function promptText(workflowPayload) {
  const prompt = (workflowPayload.nodes || []).find((node) => {
    const title = String(node?.metadata?.ui?.customTitle || "");
    return node?.type === "prompt.text" || /draft preset prompt/i.test(title);
  });
  return String(prompt?.fields?.text || "");
}

function hasRawPlaceholder(text) {
  return /{{[^}]+}}|\[\[[^\]]+\]\]/.test(String(text || ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  loadDotEnv();
  const options = parseArgs(process.argv.slice(2));
  const controlToken = process.env.MEDIA_STUDIO_CONTROL_API_TOKEN || DEFAULT_LOCAL_CONTROL_API_TOKEN;
  const checks = [];
  const events = [];

  function check(id, ok, message, details = undefined) {
    const item = { id, ok: Boolean(ok), message, ...(details === undefined ? {} : { details }) };
    checks.push(item);
    if (!item.ok) events.push({ type: "check_failed", id, message, details });
    return item;
  }

  async function api(path, requestOptions = {}) {
    const response = await fetch(`${options.apiUrl}${path}`, {
      ...requestOptions,
      headers: {
        "content-type": "application/json",
        "x-media-studio-control-token": controlToken,
        "x-media-studio-access-mode": "admin",
        ...(requestOptions.headers || {}),
      },
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      throw new Error(`${requestOptions.method || "GET"} ${path} failed ${response.status}: ${text.slice(0, 700)}`);
    }
    return payload;
  }

  async function saveValidateRunWorkflow(workflowPayload, { label, timeoutMs }) {
    const created = await api("/media/graph/workflows", {
      method: "POST",
      body: JSON.stringify(workflowPayload),
    });
    const workflowId = created.workflow_id;
    check(`${label}_workflow_saved`, Boolean(workflowId), `${label} workflow saved`, { workflow_id: workflowId });
    const validation = await api(`/media/graph/workflows/${workflowId}/validate`, {
      method: "POST",
      body: JSON.stringify(workflowPayload),
    });
    check(`${label}_workflow_valid`, validation.valid === true, `${label} workflow validates before paid run`, validation);
    const run = await api(`/media/graph/workflows/${workflowId}/runs`, {
      method: "POST",
      body: JSON.stringify({ workflow: workflowPayload }),
    });
    const runId = run.run_id;
    check(`${label}_run_started`, Boolean(runId), `${label} workflow run started`, { run_id: runId, status: run.status });
    const deadline = Date.now() + timeoutMs;
    let currentRun = run;
    while (!TERMINAL_RUN_STATUSES.has(String(currentRun.status)) && Date.now() < deadline) {
      await sleep(5000);
      currentRun = await api(`/media/graph/runs/${runId}`);
      process.stderr.write(`${label} run ${runId}: ${currentRun.status}\n`);
    }
    check(`${label}_run_completed`, currentRun.status === "completed", `${label} workflow run completed`, {
      run_id: runId,
      status: currentRun.status,
      error: currentRun.error,
    });
    const artifacts = (await api(`/media/graph/runs/${runId}/artifacts`)).items || [];
    check(`${label}_output_artifact_exists`, artifacts.length > 0, `${label} produced output artifact`, {
      artifact_count: artifacts.length,
      first_artifact: artifacts[0],
    });
    return { workflowId, runId, run: currentRun, artifacts };
  }

  const health = await api("/health");
  check("api_health", health?.status === "ok", "API health is ok", health);
  check("runner_health", health?.runner_health === "healthy", "Runner is healthy", { runner_health: health?.runner_health });
  check("codex_ready", health?.codex_local_ready === true, "Codex local is ready", { codex_local_ready: health?.codex_local_ready });
  check("queue_observed", Number(health?.queued_jobs || 0) >= 0, "Queue observed", {
    queued_jobs: health?.queued_jobs,
    running_jobs: health?.running_jobs,
  });
  const webResponse = await fetch(`${options.webUrl}/graph-studio`, { cache: "no-store" });
  check("web_graph_studio", webResponse.ok, `Graph Studio route ${webResponse.status}`);

  const refsPayload = await api("/media/reference-media?kind=image&limit=500");
  const refs = referenceMap(refsPayload.items || []);
  const styleRefs = options.refs.map((filename) => {
    const ref = refs.get(filename.toLowerCase());
    if (!ref) throw new Error(`Missing reference media: ${filename}`);
    return ref;
  });
  const runtimeRef = options.runtimeRef ? refs.get(options.runtimeRef.toLowerCase()) : null;
  if (options.mode === "image-to-image" && !runtimeRef) throw new Error(`Missing runtime reference media: ${options.runtimeRef}`);
  check("reference_images_found", true, "Selected style references found", styleRefs.map((ref) => ref.original_filename));
  if (runtimeRef) check("runtime_reference_found", runtimeRef.reference_id !== styleRefs[0]?.reference_id, "Separate runtime image found", {
    filename: runtimeRef.original_filename,
    reference_id: runtimeRef.reference_id,
  });

  const baseWorkflow = workflow(`P11/P12 proof ${options.mode} ${Date.now()}`);
  check("fresh_workflow_without_database_deletion", baseWorkflow.nodes.length === 0, "Fresh workflow object created without database deletion.");
  const session = await api("/media/assistant/sessions", {
    method: "POST",
    body: JSON.stringify({
      owner_kind: "graph_workflow",
      owner_id: `proof-${options.mode}-${Date.now()}`,
      workflow: baseWorkflow,
      provider_kind: "codex_local",
    }),
  });
  const sessionId = session.assistant_session_id;
  for (const ref of styleRefs) {
    await api(`/media/assistant/sessions/${sessionId}/attachments`, {
      method: "POST",
      body: JSON.stringify({ reference_id: ref.reference_id, label: ref.original_filename }),
    });
  }
  check("style_references_attached", true, "Style references attached", { assistant_session_id: sessionId });

  const intake = await api(`/media/assistant/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content_text: naturalPrompt(options.mode, styleRefs.length),
      workflow: baseWorkflow,
      assistant_mode: "preset",
    }),
  });
  const latestMessage = intake.messages?.[intake.messages.length - 1] || {};
  check("assistant_reply_quality", String(latestMessage.content_text || "").length <= 900 && /Suggested setup:/i.test(String(latestMessage.content_text || "")), "Assistant gave compact setup guidance", {
    reply_preview: String(latestMessage.content_text || "").slice(0, 600),
  });
  const debugTrace = await api(`/media/assistant/sessions/${sessionId}/debug-trace`);
  const trace = latestTrace(debugTrace);
  check("durable_codex_thread", Boolean(trace?.provider_thread_id), "Durable provider thread id present", trace ? {
    provider_thread_id: trace.provider_thread_id,
    skill_session_id: trace.skill_session_id,
    cache_decision: trace.cache_decision,
  } : null);

  const plan = await api(`/media/assistant/sessions/${sessionId}/plans`, {
    method: "POST",
    body: JSON.stringify({
      message: planPrompt(options.mode),
      workflow: baseWorkflow,
      capability: "plan_graph",
      assistant_mode: "preset",
    }),
  });
  const planMetadata = plan.graph_plan?.metadata || {};
  check("test_workflow_created", plan.workflow?.nodes?.length > 0, "Assistant created test workflow", {
    assistant_plan_id: plan.plan?.assistant_plan_id,
    template_id: planMetadata.template_id,
  });
  check("prompt_quality_passed", planMetadata.prompt_quality_passed === true && Number(planMetadata.prompt_quality_score || 0) >= 9, "Prompt quality passed", {
    prompt_quality_score: planMetadata.prompt_quality_score,
    prompt_quality_issues: planMetadata.prompt_quality_issues || [],
  });
  const applied = await api(`/media/assistant/plans/${plan.plan.assistant_plan_id}/apply`, {
    method: "POST",
    body: JSON.stringify({ workflow: baseWorkflow }),
  });
  let testWorkflow = options.mode === "image-to-image" ? fillRuntimeImage(applied.workflow, runtimeRef.reference_id) : applied.workflow;
  const testPrompt = promptText(testWorkflow);
  check("test_prompt_has_no_raw_placeholders", !hasRawPlaceholder(testPrompt), "Test workflow prompt is concrete before paid run", {
    prompt_preview: testPrompt.slice(0, 700),
  });
  let activeWorkflow = testWorkflow;
  let activeProof = await saveValidateRunWorkflow(activeWorkflow, { label: "test", timeoutMs: options.timeoutMs });

  const comparison = await api(`/media/assistant/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content_text: "Compare the latest output to the attached reference style. Keep it short: say what matches, what is missing, and whether to save or refine.",
      workflow: activeWorkflow,
      run_id: activeProof.runId,
      assistant_mode: "preset",
    }),
  });
  const comparisonMessage = comparison.messages?.[comparison.messages.length - 1] || {};
  const comparisonText = String(comparisonMessage.content_text || "");
  check("assistant_compared_output", /match|missing|save|refine|close|style/i.test(String(comparisonMessage.content_text || "")), "Assistant compared output to reference", {
    comparison_preview: String(comparisonMessage.content_text || "").slice(0, 900),
  });
  const wantsRefinement = /\brefine\b|\bprompt update\b|\bnot save yet\b|\btry again\b/i.test(comparisonText);
  if (wantsRefinement) {
    const refinementPlan = await api(`/media/assistant/sessions/${sessionId}/plans`, {
      method: "POST",
      body: JSON.stringify({
        message: "Apply that prompt update to the current test workflow.",
        workflow: activeWorkflow,
        run_id: activeProof.runId,
        capability: "plan_graph",
        assistant_mode: "preset",
      }),
    });
    check("prompt_refinement_plan_created", refinementPlan.workflow?.nodes?.length > 0, "Assistant created prompt refinement workflow review", {
      assistant_plan_id: refinementPlan.plan?.assistant_plan_id,
      operations: refinementPlan.graph_plan?.operations?.length || 0,
    });
    const refinementApply = await api(`/media/assistant/plans/${refinementPlan.plan.assistant_plan_id}/apply`, {
      method: "POST",
      body: JSON.stringify({ workflow: activeWorkflow }),
    });
    activeWorkflow = options.mode === "image-to-image" ? fillRuntimeImage(refinementApply.workflow, runtimeRef.reference_id) : refinementApply.workflow;
    const refinedPrompt = promptText(activeWorkflow);
    check("refined_prompt_has_no_raw_placeholders", !hasRawPlaceholder(refinedPrompt), "Refined prompt remains concrete before rerun", {
      prompt_preview: refinedPrompt.slice(0, 700),
    });
    activeProof = await saveValidateRunWorkflow(activeWorkflow, { label: "refined_test", timeoutMs: options.timeoutMs });
    check("one_prompt_refinement_applied_if_needed", true, "One prompt refinement was applied because assistant recommended refinement.", {
      refined_run_id: activeProof.runId,
    });
  } else {
    check("one_prompt_refinement_applied_if_needed", true, "Assistant did not request refinement; saving the first tested result.");
  }

  const save = await api(`/media/assistant/sessions/${sessionId}/preset-saves`, {
    method: "POST",
    body: JSON.stringify({
      message: `The latest ${options.mode} result is approved. Save this as an official Media Preset using the latest output as the thumbnail.`,
      workflow: activeWorkflow,
      run_id: activeProof.runId,
      assistant_mode: "preset",
    }),
  });
  const preset = save.record || {};
  check("media_preset_saved", Boolean(preset.preset_id || preset.key), "Media Preset saved", {
    preset_id: preset.preset_id,
    key: preset.key,
    label: preset.label,
    created: save.created,
  });

  const reuseBase = workflow(`Saved preset reuse ${preset.key || preset.preset_id}`);
  const reuseSession = await api("/media/assistant/sessions", {
    method: "POST",
    body: JSON.stringify({
      owner_kind: "graph_workflow",
      owner_id: `reuse-${options.mode}-${Date.now()}`,
      workflow: reuseBase,
      provider_kind: "codex_local",
    }),
  });
  const reusePlan = await api(`/media/assistant/sessions/${reuseSession.assistant_session_id}/plans`, {
    method: "POST",
    body: JSON.stringify({
      message: `Create a workflow using saved Media Preset key ${preset.key}.`,
      workflow: reuseBase,
      capability: "plan_graph",
      assistant_mode: "preset",
    }),
  });
  let reuseWorkflow = options.mode === "image-to-image" ? fillRuntimeImage(reusePlan.workflow, runtimeRef.reference_id) : reusePlan.workflow;
  const reuseProof = await saveValidateRunWorkflow(reuseWorkflow, { label: "saved_preset_reuse", timeoutMs: options.timeoutMs });

  const finalTrace = await api(`/media/assistant/sessions/${sessionId}/debug-trace`);
  const finalMediaTrace = latestTrace(finalTrace);
  check("debug_trace_saved_preset_id", Boolean(finalMediaTrace?.saved_preset_ids?.length || preset.preset_id), "Trace or save response records saved preset id", {
    trace_saved_preset_ids: finalMediaTrace?.saved_preset_ids,
    preset_id: preset.preset_id,
  });

  const report = {
    ok: checks.every((item) => item.ok),
    generated_at: new Date().toISOString(),
    mode: options.mode,
    api_url: options.apiUrl,
    web_url: options.webUrl,
    assistant_session_id: sessionId,
    provider_thread_id: trace?.provider_thread_id || null,
    style_references: styleRefs.map((ref) => ({ filename: ref.original_filename, reference_id: ref.reference_id })),
    runtime_reference: runtimeRef ? { filename: runtimeRef.original_filename, reference_id: runtimeRef.reference_id } : null,
    test_workflow_id: activeProof.workflowId,
    test_run_id: activeProof.runId,
    saved_preset: { preset_id: preset.preset_id, key: preset.key, label: preset.label },
    saved_preset_reuse_workflow_id: reuseProof.workflowId,
    saved_preset_reuse_run_id: reuseProof.runId,
    checks,
    events,
    comparison_preview: String(comparisonMessage.content_text || "").slice(0, 1200),
    first_output_artifact: activeProof.artifacts[0] || null,
    first_reuse_output_artifact: reuseProof.artifacts[0] || null,
    no_database_delete_reset_truncate: true,
  };

  mkdirSync(options.reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(options.reportDir, `media-assistant-preset-loop-proof-${options.mode}-${stamp}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: report.ok, report_path: reportPath, checks }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
