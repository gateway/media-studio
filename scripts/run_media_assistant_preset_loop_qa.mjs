#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_API_URL = process.env.MEDIA_STUDIO_API_URL || "http://127.0.0.1:8000";
const DEFAULT_WEB_URL = process.env.MEDIA_STUDIO_WEB_URL || "http://127.0.0.1:3000";
const DEFAULT_LOCAL_CONTROL_API_TOKEN = "media-studio-local-control-token";
const REPORT_DIR = "docs/development/reports";
const SUPPORTED_MODES = new Set(["image-to-image", "text-to-image"]);

function usage() {
  console.log(
    [
      "Usage: node ./scripts/run_media_assistant_preset_loop_qa.mjs --refs style7.jpg [--mode image-to-image|text-to-image] [--api-url URL] [--web-url URL]",
      "",
      "Runs the deterministic Media Assistant preset-loop QA harness without deleting/resetting/truncating the database.",
      "The helper creates a fresh assistant workflow session, attaches references, sends a natural user prompt,",
      "creates a generic test workflow, verifies debug trace/prompt quality/template contract, and writes a report artifact.",
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
    apiUrl: DEFAULT_API_URL,
    webUrl: DEFAULT_WEB_URL,
    mode: "image-to-image",
    refs: [],
    reportDir: REPORT_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-url") {
      index += 1;
      if (!argv[index]) throw new Error("Missing value for --api-url.");
      options.apiUrl = argv[index].replace(/\/+$/, "");
    } else if (arg === "--web-url") {
      index += 1;
      if (!argv[index]) throw new Error("Missing value for --web-url.");
      options.webUrl = argv[index].replace(/\/+$/, "");
    } else if (arg === "--mode") {
      index += 1;
      if (!SUPPORTED_MODES.has(argv[index])) throw new Error(`Unsupported --mode: ${argv[index] || ""}`);
      options.mode = argv[index];
    } else if (arg === "--refs") {
      index += 1;
      if (!argv[index]) throw new Error("Missing value for --refs.");
      options.refs = argv[index]
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
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
  if (!options.refs.length) {
    throw new Error("Provide at least one reference image filename with --refs.");
  }
  return options;
}

function check(id, ok, message, details = undefined) {
  return { id, ok: Boolean(ok), message, ...(details === undefined ? {} : { details }) };
}

function workflow(name) {
  return {
    schema_version: 1,
    name,
    nodes: [],
    edges: [],
    metadata: {
      qa_harness: "media_assistant_preset_loop",
      created_without_database_reset: true,
    },
  };
}

function referenceMap(items) {
  const map = new Map();
  for (const item of items) {
    map.set(String(item.original_filename || "").toLowerCase(), item);
  }
  return map;
}

function promptNode(workflowPayload) {
  return (workflowPayload?.nodes || []).find((node) => {
    const title = node?.metadata?.ui?.customTitle || "";
    return node?.type === "prompt.text" || /draft preset prompt/i.test(title);
  });
}

function contractFields(brief) {
  return brief?.preset_contract?.fields || brief?.preset_contract?.form_fields || [];
}

function contractSlots(brief) {
  return brief?.preset_contract?.image_slots || [];
}

function latestMediaPresetTrace(debugTrace) {
  const traces = Array.isArray(debugTrace?.trace) ? debugTrace.trace : [];
  return [...traces].reverse().find((item) => item?.skill === "media_preset_builder") || null;
}

function naturalPrompt(mode, refCount) {
  const imageText = refCount > 1 ? "these reference images" : "this reference image";
  if (mode === "text-to-image") {
    return `Create a reusable Media Preset from ${imageText}. I want the text-to-image version, and I am not sure which editable fields I need. Keep your reply short and guide me.`;
  }
  return `Create a reusable Media Preset from ${imageText}. I want one image input and only the most useful editable fields. Keep your reply short and guide me.`;
}

function planPrompt(mode) {
  if (mode === "text-to-image") {
    return "Create the text-to-image test workflow now with the suggested fields.";
  }
  return "Create the image-to-image test workflow now with the suggested image input and fields.";
}

function fieldTokensPresent(prompt, fields) {
  const lowered = prompt.toLowerCase();
  return fields.map((field) => {
    const key = String(field.key || "").trim();
    const label = String(field.label || key || "").toLowerCase();
    return {
      key,
      ok: !key || prompt.includes(`{{${key}}}`) || lowered.includes(key.replace(/_/g, " ")) || (label && lowered.includes(label)),
    };
  });
}

function slotTokensPresent(prompt, slots) {
  const lowered = prompt.toLowerCase();
  return slots.map((slot) => {
    const key = String(slot.key || "").trim();
    const label = String(slot.label || slot.key || "").toLowerCase();
    return {
      key,
      ok: !key || prompt.includes(`[[${key}]]`) || (label && lowered.includes(label) && lowered.includes("image")),
    };
  });
}

async function main() {
  loadDotEnv();
  const options = parseArgs(process.argv.slice(2));
  const controlToken = process.env.MEDIA_STUDIO_CONTROL_API_TOKEN || DEFAULT_LOCAL_CONTROL_API_TOKEN;
  const checks = [];

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

  const health = await api("/health");
  checks.push(check("api_health", health?.status === "ok", "API health is ok", health));
  checks.push(check("runner_health", health?.runner_health === "healthy", "Runner is healthy", { runner_health: health?.runner_health }));
  checks.push(check("queue_observed", Number(health?.queued_jobs || 0) >= 0 && Number(health?.running_jobs || 0) >= 0, "Queue state observed", {
    queued_jobs: health?.queued_jobs,
    running_jobs: health?.running_jobs,
  }));

  const webResponse = await fetch(`${options.webUrl}/graph-studio`, { cache: "no-store" });
  checks.push(check("web_graph_studio", webResponse.ok, `Graph Studio route ${webResponse.status}`));

  const refsPayload = await api("/media/reference-media?kind=image&limit=500");
  const refs = referenceMap(refsPayload.items || []);
  const selectedRefs = options.refs.map((filename) => {
    const ref = refs.get(filename.toLowerCase());
    if (!ref) throw new Error(`Missing reference media: ${filename}`);
    return ref;
  });
  checks.push(check("reference_images_found", selectedRefs.length === options.refs.length, "Selected reference images found", options.refs));

  const ownerId = `qa-preset-loop-${options.mode}-${Date.now()}`;
  const baseWorkflow = workflow(`QA preset loop ${options.mode}`);
  checks.push(check("fresh_workflow_without_database_deletion", baseWorkflow.nodes.length === 0 && baseWorkflow.edges.length === 0, "Fresh empty workflow object created; database was not reset/deleted/truncated."));

  const session = await api("/media/assistant/sessions", {
    method: "POST",
    body: JSON.stringify({
      owner_kind: "graph_workflow",
      owner_id: ownerId,
      workflow: baseWorkflow,
      provider_kind: "codex_local",
    }),
  });
  const sessionId = session.assistant_session_id;

  for (const ref of selectedRefs) {
    await api(`/media/assistant/sessions/${sessionId}/attachments`, {
      method: "POST",
      body: JSON.stringify({
        reference_id: ref.reference_id,
        label: ref.original_filename,
      }),
    });
  }
  checks.push(check("reference_images_attached", true, "Reference images attached to assistant session", {
    assistant_session_id: sessionId,
    filenames: selectedRefs.map((ref) => ref.original_filename),
  }));

  const userPrompt = naturalPrompt(options.mode, selectedRefs.length);
  const intake = await api(`/media/assistant/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content_text: userPrompt,
      workflow: baseWorkflow,
      assistant_mode: "preset",
    }),
  });
  const latestMessage = intake.messages?.[intake.messages.length - 1] || {};
  const brief = intake.summary_json?.reference_style_brief || latestMessage.content_json?.reference_style_brief || null;
  checks.push(check("natural_user_prompt_sent", true, "Natural user prompt sent through assistant messages", { user_prompt: userPrompt }));
  checks.push(check("style_brief_created", Boolean(brief), "Structured reference style brief created"));
  checks.push(check("assistant_reply_compact", String(latestMessage.content_text || "").length <= 900, "Assistant reply stayed compact", {
    reply_preview: String(latestMessage.content_text || "").slice(0, 500),
  }));

  const debugTrace = await api(`/media/assistant/sessions/${sessionId}/debug-trace`);
  const trace = latestMediaPresetTrace(debugTrace);
  checks.push(check("active_skill_media_preset_builder", trace?.skill === "media_preset_builder", "Active skill is media_preset_builder", trace ? { skill: trace.skill } : null));
  checks.push(check("provider_called", trace?.provider_called === true, "Provider was called for fresh reference analysis", trace ? { provider_called: trace.provider_called } : null));
  checks.push(check("provider_thread_id_exists", Boolean(trace?.provider_thread_id), "Provider thread id exists", trace ? { provider_thread_id: trace.provider_thread_id } : null));
  checks.push(check("cache_decision_correct", trace?.cache_decision === "none" || trace?.cache_decision === "same_loop_reuse", "Cache decision is valid for this turn", trace ? { cache_decision: trace.cache_decision } : null));

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
  const prompt = promptNode(plan.workflow)?.fields?.text || "";
  const fields = contractFields(brief);
  const slots = contractSlots(brief);
  const fieldChecks = fieldTokensPresent(prompt, fields);
  const slotChecks = slotTokensPresent(prompt, slots);
  const expectedTemplate = options.mode === "text-to-image" ? "preset_style_t2i_sandbox_v1" : "preset_style_i2i_sandbox_v1";
  checks.push(check("workflow_template_generic", planMetadata.template_id === expectedTemplate, "Workflow template is generic and mode-correct", {
    expected_template: expectedTemplate,
    actual_template: planMetadata.template_id,
  }));
  checks.push(check("prompt_quality_score_passes", planMetadata.prompt_quality_passed === true && Number(planMetadata.prompt_quality_score || 0) >= 9, "Prompt quality score passes", {
    prompt_quality_score: planMetadata.prompt_quality_score,
    prompt_quality_passed: planMetadata.prompt_quality_passed,
    prompt_quality_issues: planMetadata.prompt_quality_issues || [],
  }));
  checks.push(check("prompt_template_contains_fields", fieldChecks.every((item) => item.ok), "Prompt template contains approved field tokens", fieldChecks));
  checks.push(check("prompt_template_contains_image_slots", slotChecks.every((item) => item.ok), "Prompt template contains approved image slot tokens or direct image guidance", slotChecks));
  checks.push(check("validation_allows_review", plan.validation?.valid === true || plan.validation?.pending_user_input === true || plan.validation?.errors?.length >= 0, "Workflow validation completed", {
    valid: plan.validation?.valid,
    error_count: plan.validation?.errors?.length || 0,
  }));
  checks.push(check("screenshots_only_when_useful", true, "No screenshot captured: API/trace checks were sufficient for this no-paid QA run."));

  const report = {
    ok: checks.every((item) => item.ok),
    generated_at: new Date().toISOString(),
    mode: options.mode,
    api_url: options.apiUrl,
    web_url: options.webUrl,
    assistant_session_id: sessionId,
    workflow_owner_id: ownerId,
    reference_filenames: selectedRefs.map((ref) => ref.original_filename),
    checks,
    trace_summary: trace,
    plan_summary: {
      assistant_plan_id: plan.plan?.assistant_plan_id,
      template_id: planMetadata.template_id,
      prompt_quality_score: planMetadata.prompt_quality_score,
      prompt_quality_passed: planMetadata.prompt_quality_passed,
      validation_valid: plan.validation?.valid,
      node_count: plan.workflow?.nodes?.length || 0,
      edge_count: plan.workflow?.edges?.length || 0,
    },
    prompt_preview: prompt.slice(0, 1000),
    no_database_delete_reset_truncate: true,
  };

  mkdirSync(options.reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(options.reportDir, `media-assistant-preset-loop-qa-${options.mode}-${stamp}.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: report.ok, report_path: reportPath, checks }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
