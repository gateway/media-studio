#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  auditPromptQuality,
  briefCoverage,
  scoreConversation,
  scoreFieldUsefulness,
  scoreFixMyPhotoPlanner,
  scoreGenerationDirectness,
  scoreImageSlots,
} from "./lib/media_assistant_audit_scoring.mjs";

const API_URL = process.env.MEDIA_STUDIO_API_URL || "http://127.0.0.1:8000";
const DEFAULT_LOCAL_CONTROL_API_TOKEN = "media-studio-local-control-token";

function loadDotEnv() {
  try {
    const text = readFileSync(".env", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Local development can fall back to the known development token.
  }
}

loadDotEnv();

const CONTROL_API_TOKEN = process.env.MEDIA_STUDIO_CONTROL_API_TOKEN || DEFAULT_LOCAL_CONTROL_API_TOKEN;

const STYLE_CASES = [
  { id: "style1", filenames: ["style1.jpg"] },
  { id: "style2", filenames: ["style2.jpg"] },
  { id: "style3-style4", filenames: ["style3.jpg", "style4.jpg"] },
  { id: "cyborg-2", filenames: ["cyborg-2.jpg"] },
  { id: "style5", filenames: ["style5.jpg"] },
  { id: "style6", filenames: ["style6.jpg"] },
  { id: "skate2", filenames: ["skate2.jpg"] },
  { id: "1989", filenames: ["1989.jpg"] },
  { id: "car", filenames: ["car.jpg"] },
  { id: "style7", filenames: ["style7.jpg"] },
];

const DEFAULT_MODES = ["image-to-image", "text-to-image"];
const DEFAULT_MIN_SCORE = 9;

function cliArg(name, fallback = undefined) {
  const exactIndex = process.argv.indexOf(`--${name}`);
  if (exactIndex >= 0) {
    const values = [];
    for (let index = exactIndex + 1; index < process.argv.length; index += 1) {
      const value = process.argv[index];
      if (value.startsWith("--")) break;
      values.push(value);
    }
    return values.length > 1 ? values : values[0] ?? fallback;
  }
  const prefix = `--${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function normalizeMode(value) {
  const lowered = String(value || "").trim().toLowerCase();
  if (["t2i", "text", "text-to-image", "text_to_image"].includes(lowered)) return "text-to-image";
  if (["i2i", "image", "image-to-image", "image_to_image"].includes(lowered)) return "image-to-image";
  throw new Error(`Unsupported mode: ${value}`);
}

function parseList(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => parseList(entry));
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function configuredStyleCases() {
  const refs = parseList(cliArg("refs", ""));
  if (!refs.length) return STYLE_CASES;
  return refs.map((filename) => ({
    id: filename.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase(),
    filenames: [filename],
  }));
}

function configuredModes() {
  const modes = parseList(cliArg("modes", ""));
  return modes.length ? modes.map(normalizeMode) : DEFAULT_MODES;
}

function configuredMinScore() {
  const value = Number(cliArg("min-score", DEFAULT_MIN_SCORE));
  return Number.isFinite(value) ? value : DEFAULT_MIN_SCORE;
}

const workflow = (name) => ({
  schema_version: 1,
  name,
  nodes: [],
  edges: [],
  metadata: {},
});

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-media-studio-control-token": CONTROL_API_TOKEN,
      "x-media-studio-access-mode": "admin",
      ...(options.headers || {}),
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
    throw new Error(`${options.method || "GET"} ${path} failed ${response.status}: ${text.slice(0, 500)}`);
  }
  return payload;
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

async function runCase(testCase, refs, mode, minScore) {
  const found = testCase.filenames.map((filename) => refs.get(filename.toLowerCase()));
  const missing = testCase.filenames.filter((_, index) => !found[index]);
  if (missing.length) {
    return { id: testCase.id, ok: false, error: `Missing reference media: ${missing.join(", ")}` };
  }

  const ownerId = `prompt-audit-${testCase.id}-${mode}-${Date.now()}`;
  const baseWorkflow = workflow(`Prompt audit ${testCase.id} ${mode}`);
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

  for (const ref of found) {
    await api(`/media/assistant/sessions/${sessionId}/attachments`, {
      method: "POST",
      body: JSON.stringify({
        reference_id: ref.reference_id,
        label: ref.original_filename,
      }),
    });
  }

  const plural = found.length > 1 ? "these images" : "this image";
  const intakeText = mode === "text-to-image"
    ? `Create a reusable text-to-image media preset from ${plural}. Suggest a few useful fields, but no image input.`
    : `Create a reusable image-to-image media preset from ${plural}. Suggest the best image input and a few useful fields first.`;
  const message = await api(`/media/assistant/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content_text: intakeText,
      workflow: baseWorkflow,
      assistant_mode: "preset",
      metadata: {
        preset_loop_lane: mode === "text-to-image" ? "text_to_image" : "image_to_image",
        source: "prompt_quality_matrix",
      },
    }),
  });

  const latest = message.messages?.[message.messages.length - 1] || {};
  const latestText = String(latest.content_text || "");
  if (/could not analyze|timed out|try again once the assistant connection is ready/i.test(latestText)) {
    throw new Error(`Transient reference analysis failure: ${latestText.slice(0, 220)}`);
  }
  const summary = message.summary_json || {};
  const brief = summary.reference_style_brief || latest.content_json?.reference_style_brief || null;

  const plan = await api(`/media/assistant/sessions/${sessionId}/plans`, {
    method: "POST",
    body: JSON.stringify({
      message: mode === "text-to-image"
        ? "Create the text-to-image test workflow now with the suggested fields."
        : "Create the image-to-image test workflow now with the suggested setup.",
      workflow: baseWorkflow,
      capability: "plan_graph",
      assistant_mode: "preset",
    }),
  });

  const prompt = promptNode(plan.workflow)?.fields?.text || "";
  const fields = brief?.preset_contract?.fields || [];
  const slots = mode === "text-to-image" ? [] : brief?.preset_contract?.image_slots || [];
  const quality = auditPromptQuality({ prompt, brief, fields, slots, minScore });
  const fixQuality = scoreFixMyPhotoPlanner({ prompt, brief, fields, slots, minScore });
  const directQuality = scoreGenerationDirectness({ prompt, slots, minScore });
  const fieldQuality = scoreFieldUsefulness({ fields, prompt, minScore });
  const slotQuality = scoreImageSlots({ slots, mode, prompt, minScore });
  const conversationQuality = scoreConversation({ assistantReply: latest.content_text, fields, slots, minScore });
  const localCombinedScore = Math.min(
    quality.score,
    fixQuality.score,
    directQuality.score,
    fieldQuality.score,
    slotQuality.score,
    conversationQuality.score,
  );
  const localCombinedIssues = [
    ...quality.issues,
    ...fixQuality.issues.map((issue) => `FixMyPhoto planner: ${issue}`),
    ...directQuality.issues.map((issue) => `GPT/Nano directness: ${issue}`),
    ...fieldQuality.issues.map((issue) => `Field usefulness: ${issue}`),
    ...slotQuality.issues.map((issue) => `Image slot: ${issue}`),
    ...conversationQuality.issues.map((issue) => `Conversation: ${issue}`),
  ];
  const planPromptScore = Number(plan.graph_plan?.metadata?.prompt_quality_score ?? NaN);
  const planFixScore = Number(plan.graph_plan?.metadata?.fixmyphoto_planner_score ?? NaN);
  const planDirectScore = Number(plan.graph_plan?.metadata?.generation_directness_score ?? NaN);
  const productScoresAvailable = Number.isFinite(planPromptScore) && Number.isFinite(planFixScore) && Number.isFinite(planDirectScore);
  const combinedScore = productScoresAvailable
    ? Math.min(planPromptScore, planFixScore, planDirectScore, fieldQuality.score, slotQuality.score, conversationQuality.score)
    : localCombinedScore;
  const productIssues = productScoresAvailable && Math.min(planPromptScore, planFixScore, planDirectScore) >= minScore
    ? []
    : [
        ...quality.issues,
        ...fixQuality.issues.map((issue) => `FixMyPhoto planner: ${issue}`),
        ...directQuality.issues.map((issue) => `GPT/Nano directness: ${issue}`),
      ];
  const combinedIssues = [
    ...productIssues,
    ...fieldQuality.issues.map((issue) => `Field usefulness: ${issue}`),
    ...slotQuality.issues.map((issue) => `Image slot: ${issue}`),
    ...conversationQuality.issues.map((issue) => `Conversation: ${issue}`),
  ];

  return {
    id: `${testCase.id}-${mode}`,
    style_id: testCase.id,
    mode,
    ok: Boolean(prompt && combinedScore >= minScore && combinedIssues.length === 0),
    session_id: sessionId,
    title: brief?.preset_direction?.title || latest.content_json?.preset_builder_proposal?.title || "",
    assistant_reply: String(latest.content_text || "").slice(0, 500),
    fields: fields.map((field) => ({
      key: field.key,
      label: field.label || field.key,
      example: field.default_value || field.placeholder || field.example || null,
    })),
    image_slots: slots.map((slot) => ({
      key: slot.key,
      label: slot.label || slot.key,
      description: slot.description || null,
    })),
    coverage: briefCoverage(brief),
    prompt_quality_score: combinedScore,
    prompt_quality_passed: combinedScore >= minScore && combinedIssues.length === 0,
    prompt_quality_issues: combinedIssues,
    field_score: fieldQuality.score,
    field_issues: fieldQuality.issues,
    slot_score: slotQuality.score,
    slot_issues: slotQuality.issues,
    conversation_score: conversationQuality.score,
    conversation_issues: conversationQuality.issues,
    structural_prompt_score: productScoresAvailable ? planPromptScore : quality.score,
    structural_prompt_issues: productScoresAvailable && planPromptScore >= minScore ? [] : quality.issues,
    fixmyphoto_planner_score: productScoresAvailable ? planFixScore : fixQuality.score,
    fixmyphoto_planner_issues: productScoresAvailable && planFixScore >= minScore ? [] : fixQuality.issues,
    generation_directness_score: productScoresAvailable ? planDirectScore : directQuality.score,
    generation_directness_issues: productScoresAvailable && planDirectScore >= minScore ? [] : directQuality.issues,
    local_structural_prompt_score: quality.score,
    local_structural_prompt_issues: quality.issues,
    local_fixmyphoto_planner_score: fixQuality.score,
    local_fixmyphoto_planner_issues: fixQuality.issues,
    local_generation_directness_score: directQuality.score,
    local_generation_directness_issues: directQuality.issues,
    template_id: plan.graph_plan?.metadata?.template_id,
    plan_prompt_quality_score: plan.graph_plan?.metadata?.prompt_quality_score,
    plan_fixmyphoto_planner_score: plan.graph_plan?.metadata?.fixmyphoto_planner_score,
    plan_generation_directness_score: plan.graph_plan?.metadata?.generation_directness_score,
    prompt_preview: prompt.slice(0, 900),
  };
}

async function main() {
  const styleCases = configuredStyleCases();
  const modes = configuredModes();
  const minScore = configuredMinScore();
  const reportPath = cliArg("report", "");
  const health = await api("/health");
  if (health.status !== "ok") {
    throw new Error(`API is not healthy: ${JSON.stringify(health)}`);
  }
  const list = await api("/media/reference-media?kind=image&limit=500");
  const refs = referenceMap(list.items || []);
  const results = [];
  for (const testCase of styleCases) {
    for (const mode of modes) {
      console.error(`Auditing ${testCase.id} ${mode}...`);
      try {
        let result = null;
        let lastError = null;
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          try {
            result = await runCase(testCase, refs, mode, minScore);
            break;
          } catch (error) {
            lastError = error;
            const message = String(error?.message || error);
            if (!/Transient reference analysis failure|timed out/i.test(message) || attempt === 4) {
              throw error;
            }
            console.error(`Retrying ${testCase.id} ${mode} after transient analysis failure...`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
        results.push(result);
      } catch (error) {
        results.push({ id: `${testCase.id}-${mode}`, style_id: testCase.id, mode, ok: false, error: String(error?.message || error) });
      }
    }
  }
  const failed = results.filter((result) => !result.ok);
  const report = {
    ok: failed.length === 0,
    api_url: API_URL,
    min_score: minScore,
    requested_refs: styleCases.map((testCase) => testCase.filenames).flat(),
    requested_modes: modes,
    generated_at: new Date().toISOString(),
    cases: results,
  };
  const json = JSON.stringify(report, null, 2);
  if (reportPath) {
    const absoluteReportPath = path.resolve(reportPath);
    mkdirSync(path.dirname(absoluteReportPath), { recursive: true });
    writeFileSync(absoluteReportPath, `${json}\n`);
    console.error(`Wrote audit report: ${absoluteReportPath}`);
  }
  console.log(json);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
