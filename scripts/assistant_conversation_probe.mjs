#!/usr/bin/env node
import { spawn, execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import {
  evaluateMechanicalTurn,
  planPreviewFromSession,
  toolCallsFromTrace,
  workflowForProbeSession,
} from "./lib/assistant_conversation_probe_contract.mjs";

const execFile = promisify(execFileCallback);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const suiteRoot = path.join(root, "docs", "development", "artifacts", "assistant-conversation-suite");
const defaultRunRoot = path.join(root, "docs", "development", "artifacts", "assistant-runs");
function parseArgs(argv) {
  const options = { group: null, scenario: null, validateOnly: false, outputRoot: defaultRunRoot };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--group") options.group = argv[++index];
    else if (argument === "--scenario") options.scenario = argv[++index];
    else if (argument === "--output-root") options.outputRoot = path.resolve(argv[++index]);
    else if (argument === "--validate-only") options.validateOnly = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function resolveKieRoot() {
  const configured = process.env.MEDIA_STUDIO_KIE_API_REPO_PATH || process.env.KIE_ROOT;
  if (configured) return path.resolve(configured);
  const sibling = path.resolve(root, "..", "kie-api");
  const legacy = path.resolve(root, "..", "kie-ai", "kie_codex_bootstrap");
  return existsSync(sibling) ? sibling : legacy;
}

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  checksum.writeUInt32BE(pngCrc32(Buffer.concat([typeBuffer, payload])));
  return Buffer.concat([length, typeBuffer, payload, checksum]);
}

function syntheticReferencePng(kind) {
  const width = 256;
  const height = 256;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const dx = x - 128;
      const dy = y - 102;
      let color = kind === "portrait" ? [32, 104, 112] : [244, 224, 180];
      if (kind === "portrait") {
        if (dx * dx + dy * dy < 58 * 58) color = [234, 174, 126];
        if (dy < -12 && dx * dx + (dy + 8) * (dy + 8) < 62 * 62) color = [48, 30, 24];
        if ((dx + 20) ** 2 + (dy + 2) ** 2 < 5 ** 2 || (dx - 20) ** 2 + (dy + 2) ** 2 < 5 ** 2) {
          color = [35, 24, 20];
        }
        if (y > 174 && Math.abs(dx) < 82 - (y - 174) / 2) color = [212, 76, 62];
      } else {
        if (x > 91 && x < 165 && y > 70 && y < 212) color = [212, 112, 42];
        if (x > 106 && x < 150 && y > 46 && y <= 70) color = [62, 48, 34];
        if (x > 101 && x < 155 && y > 115 && y < 167) color = [250, 244, 220];
        if ((x - 62) ** 2 / 900 + (y - 120) ** 2 / 250 < 1) color = [64, 142, 76];
        if ((x - 192) ** 2 / 900 + (y - 150) ** 2 / 250 < 1) color = [82, 158, 88];
      }
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = 255;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("\x89PNG\r\n\x1a\n", "binary"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

function startProcess(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  const append = (chunk) => {
    logs.push(chunk.toString());
    if (logs.length > 100) logs.splice(0, logs.length - 100);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { child, logs };
}

function stopProcess(proc) {
  if (!proc?.child || proc.child.killed) return;
  try {
    if (process.platform === "win32") proc.child.kill();
    else process.kill(-proc.child.pid, "SIGTERM");
  } catch {
    try {
      proc.child.kill("SIGTERM");
    } catch {
      // Best-effort cleanup of processes started by this script.
    }
  }
}

async function waitForUrl(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error(`${url} did not become ready`);
}

async function loadScenarios(options) {
  const files = (await fs.readdir(suiteRoot)).filter((name) => name.endsWith(".yaml")).sort();
  const groups = [];
  for (const file of files) {
    const payload = JSON.parse(await fs.readFile(path.join(suiteRoot, file), "utf8"));
    if (payload.schema_version !== 1 || !Array.isArray(payload.scenarios)) {
      throw new Error(`${file} does not match conversation suite schema version 1.`);
    }
    if (options.group && payload.group !== options.group) continue;
    groups.push(payload);
  }
  const scenarios = groups.flatMap((group) =>
    group.scenarios
      .filter((scenario) => !options.scenario || scenario.id === options.scenario)
      .map((scenario) => ({ ...scenario, group: group.group })),
  );
  const ids = scenarios.map((scenario) => scenario.id);
  if (new Set(ids).size !== ids.length) throw new Error("Scenario ids must be unique.");
  for (const scenario of scenarios) {
    if (!scenario.id || !scenario.setup || !Array.isArray(scenario.turns) || !scenario.mechanical || !scenario.rubric_notes) {
      throw new Error(`${scenario.id || "Unknown scenario"} is missing required fields.`);
    }
    for (const turn of scenario.turns) {
      if (!String(turn.user || "").trim()) throw new Error(`${scenario.id} contains an empty user turn.`);
    }
  }
  if (!scenarios.length) throw new Error("No scenarios matched the requested filters.");
  return scenarios;
}

function workflowFixture(name) {
  const base = { schema_version: 1, name: `Probe ${name}`, nodes: [], edges: [], metadata: {} };
  if (name === "existing_prompt") {
    return {
      ...base,
      nodes: [
        {
          id: "prompt",
          type: "prompt.text",
          position: { x: 40, y: 80 },
          fields: { text: "A quiet lighthouse at blue hour." },
        },
      ],
    };
  }
  if (name === "invalid_graph") {
    return {
      ...base,
      nodes: [
        { id: "save", type: "media.save_image", position: { x: 340, y: 80 }, fields: {} },
      ],
    };
  }
  return base;
}

function canvasContext(workflow) {
  return {
    node_count: workflow.nodes.length,
    edge_count: workflow.edges.length,
    selected_node_ids: [],
    selected_group_ids: [],
    nodes: workflow.nodes.map((node) => ({ id: node.id, type: node.type, title: node.metadata?.ui?.customTitle ?? null })),
  };
}

async function apiJson(apiBaseUrl, token, route, init = {}) {
  const response = await fetch(`${apiBaseUrl}${route}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-media-studio-control-token": token,
      "x-media-studio-access-mode": "admin",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${text.slice(0, 600)}`);
  return payload;
}

async function seedReferences({ pythonPath, dataRoot, dbPath, kieRoot }) {
  const imageDir = path.join(dataRoot, "reference-media", "images");
  await fs.mkdir(imageDir, { recursive: true });
  const copies = [
    {
      filename: "probe-face-reference.png",
      bytes: syntheticReferencePng("portrait"),
    },
    {
      filename: "probe-product-reference.png",
      bytes: syntheticReferencePng("product"),
    },
  ];
  const records = [];
  for (const copy of copies) {
    await fs.writeFile(path.join(imageDir, copy.filename), copy.bytes);
    records.push({
      kind: "image",
      original_filename: copy.filename,
      stored_path: `reference-media/images/${copy.filename}`,
      mime_type: "image/png",
      file_size_bytes: copy.bytes.length,
      sha256: createHash("sha256").update(copy.bytes).digest("hex"),
      width: null,
      height: null,
      metadata_json: { source: "assistant_conversation_probe", synthetic: true },
    });
  }
  const python = [
    "import json, os",
    "from app import store",
    "store.bootstrap_schema()",
    "records=json.loads(os.environ['MEDIA_ASSISTANT_PROBE_RECORDS'])",
    "print(json.dumps([store.create_or_reuse_reference_media(item, increment_usage=False) for item in records]))",
  ].join("; ");
  const { stdout } = await execFile(pythonPath, ["-c", python], {
    cwd: path.join(root, "apps", "api"),
    env: {
      ...process.env,
      MEDIA_STUDIO_DB_PATH: dbPath,
      MEDIA_STUDIO_DATA_ROOT: dataRoot,
      MEDIA_STUDIO_KIE_API_REPO_PATH: kieRoot,
      MEDIA_ASSISTANT_PROBE_RECORDS: JSON.stringify(records),
    },
  });
  return JSON.parse(stdout);
}

async function latestUsage(dbPath, sessionId) {
  if (!/^asst_[a-z0-9]+$/.test(sessionId)) return null;
  const query = `
    select provider_kind, provider_model_id, provider_response_id,
           token_input_count, token_output_count, image_count, latency_ms, cost_usd, usage_json, created_at
    from assistant_turn_usage
    where assistant_session_id='${sessionId}'
    order by created_at desc limit 1;
  `;
  try {
    const { stdout } = await execFile("sqlite3", ["-json", dbPath, query]);
    const rows = JSON.parse(stdout || "[]");
    if (!rows[0]) return null;
    return {
      ...rows[0],
      usage_json: rows[0].usage_json ? JSON.parse(rows[0].usage_json) : {},
    };
  } catch {
    return null;
  }
}

function providerMetricsFromTrace(trace) {
  const providerSteps = Array.isArray(trace?.provider_steps) ? trace.provider_steps : [];
  return {
    thread_ids: [...new Set(providerSteps.map((step) => step?.provider_thread_id).filter(Boolean))],
    turn_ids: providerSteps.map((step) => step?.provider_turn_id).filter(Boolean),
    process_spawns: Number(trace?.provider_process_spawns || 0),
    process_reuses: providerSteps.filter((step) => step?.process_lifecycle === "process_reused").length,
    reuse_modes: Array.isArray(trace?.provider_reuse_modes) ? trace.provider_reuse_modes : [],
    provider_steps: providerSteps.length,
    tool_steps: toolCallsFromTrace(trace).length,
    prompt_bytes: Number(trace?.provider_prompt_bytes || 0),
    latency_ms: Number(trace?.provider_latency_ms || 0),
    total_tokens: Number(trace?.provider_total_tokens || 0),
  };
}

async function jobCount(apiBaseUrl, token) {
  const payload = await apiJson(apiBaseUrl, token, "/media/jobs?limit=100");
  if (Array.isArray(payload?.items)) return payload.items.length;
  if (Array.isArray(payload)) return payload.length;
  throw new Error("Jobs endpoint returned an unexpected payload while checking the no-run invariant.");
}

async function createSession({ apiBaseUrl, token, scenario, workflow, references }) {
  const session = await apiJson(apiBaseUrl, token, "/media/assistant/sessions", {
    method: "POST",
    body: JSON.stringify({
      owner_kind: "graph_workflow",
      owner_id: `conversation-probe-${scenario.session_key}`,
      provider_kind: "codex_local",
      provider_model_id: process.env.MEDIA_ASSISTANT_PROBE_MODEL || "gpt-5.6-sol",
      workflow,
    }),
  });
  for (const reference of references.slice(0, scenario.setup.attachments ?? 0)) {
    await apiJson(apiBaseUrl, token, `/media/assistant/sessions/${session.assistant_session_id}/attachments`, {
      method: "POST",
      body: JSON.stringify({ reference_id: reference.reference_id, label: reference.original_filename }),
    });
  }
  return session;
}

async function runScenario({ apiBaseUrl, token, dbPath, scenario, sessions, references }) {
  if (scenario.setup.global_check) {
    return { id: scenario.id, group: scenario.group, skipped_turn: true, rubric_notes: scenario.rubric_notes };
  }
  const workflow = workflowForProbeSession(
    workflowFixture(scenario.setup.workflow || "blank"),
    scenario.session_key,
  );
  let session = sessions.get(scenario.session_key);
  if (!session || !scenario.setup.continue_session) {
    session = await createSession({ apiBaseUrl, token, scenario, workflow, references });
    sessions.set(scenario.session_key, session);
  }
  const turns = [];
  for (const turn of scenario.turns) {
    const jobsBefore = await jobCount(apiBaseUrl, token);
    const startedAt = performance.now();
    session = await apiJson(apiBaseUrl, token, `/media/assistant/sessions/${session.assistant_session_id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content_text: turn.user,
        workflow,
        canvas_context: canvasContext(workflow),
        run_id: scenario.setup.run_id ?? null,
        assistant_mode: scenario.setup.assistant_mode ?? "graph",
        metadata: { source: "assistant_conversation_probe", scenario_id: scenario.id },
      }),
    });
    sessions.set(scenario.session_key, session);
    const latencyMs = Math.round(performance.now() - startedAt);
    const assistantMessage = [...session.messages].reverse().find((message) => message.role === "assistant");
    const reply = String(assistantMessage?.content_text || "");
    const contentJson = assistantMessage?.content_json ?? {};
    const plan = planPreviewFromSession(session, scenario.mechanical);
    const jobsAfter = await jobCount(apiBaseUrl, token);
    const usage = await latestUsage(dbPath, session.assistant_session_id);
    turns.push({
      user: turn.user,
      assistant: reply,
      assistant_message_id: assistantMessage?.assistant_message_id ?? null,
      latency_ms: latencyMs,
      content_json: contentJson,
      tool_trace: contentJson.assistant_turn_trace ?? null,
      provider_metrics: providerMetricsFromTrace(contentJson.assistant_turn_trace),
      next_action: contentJson.next_action ?? null,
      legacy_suggested_action: contentJson.suggested_action ?? null,
      validation: plan?.validation ?? null,
      price: plan?.pricing?.pricing_summary?.total ?? null,
      plan: plan
        ? {
            assistant_plan_id: plan.plan?.assistant_plan_id ?? null,
            status: plan.plan?.status ?? null,
            capability: plan.graph_plan?.capability ?? null,
            summary: plan.graph_plan?.summary ?? null,
            operations: plan.graph_plan?.operations ?? [],
            questions: plan.graph_plan?.questions ?? [],
            warnings: plan.graph_plan?.warnings ?? [],
            error: plan.error ?? null,
          }
        : null,
      token_usage: usage,
      checks: evaluateMechanicalTurn({ scenario, reply, contentJson, plan, jobsBefore, jobsAfter }),
    });
  }
  return {
    id: scenario.id,
    group: scenario.group,
    session_id: session.assistant_session_id,
    setup: scenario.setup,
    rubric_notes: scenario.rubric_notes,
    turns,
    pass: turns.every((turn) => turn.checks.pass),
  };
}

function renderTranscript(results) {
  const lines = ["# Media Assistant conversation baseline", "", `Captured: ${new Date().toISOString()}`, ""];
  for (const result of results) {
    lines.push(`## ${result.id} — ${result.group}`, "");
    if (result.skipped_turn) {
      lines.push("_Global check; scored across every captured reply._", "");
      continue;
    }
    for (const turn of result.turns) {
      lines.push("**User**", "", turn.user, "", "**Media Assistant**", "", turn.assistant || "_No reply_", "");
      lines.push(
        `Provider: ${turn.provider_metrics.process_spawns} spawn(s), ${turn.provider_metrics.process_reuses} live reuse(s), ${turn.provider_metrics.prompt_bytes} prompt byte(s), ${turn.provider_metrics.latency_ms} ms`,
        "",
      );
      if (turn.plan) {
        lines.push(
          `Plan preview: ${turn.plan.status ?? "none"} · ${turn.validation?.valid === true ? "valid" : "not valid"} · ${turn.plan.operations.length} operation(s)`,
          "",
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderSummary(results, runtime) {
  const scored = results.filter((result) => !result.skipped_turn);
  const passing = scored.filter((result) => result.pass).length;
  const lines = [
    "# Media Assistant post-prompt-fix baseline",
    "",
    `Captured: ${runtime.finished_at}`,
    `Provider: real Codex Local (${runtime.model})`,
    `Mechanical scenarios passing: ${passing}/${scored.length}`,
    "",
    "| Scenario | Mechanical | Banned terms | Words | Tools | Typed tools | Lifecycle | Steps | Plan valid | Price | Presentation |",
    "| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- |",
  ];
  for (const result of scored) {
    const checks = result.turns.at(-1)?.checks;
    lines.push(
      `| ${result.id} | ${result.pass ? "pass" : "fail"} | ${checks.banned_vocabulary.hits.join(", ") || "none"} | ${checks.reply_length.words} | ${checks.tool_evidence.tool_call_count} | ${checks.typed_actions.pass ? "pass" : "fail"} | ${checks.process_lifecycle.pass ? "pass" : "fail"} | ${checks.step_limit.step_count}/${checks.step_limit.max_tool_steps} | ${checks.workflow_validity.checked ? String(checks.workflow_validity.valid) : "n/a"} | ${checks.price_present.checked ? (checks.price_present.price === null ? "missing" : "present") : "n/a"} | ${checks.presentation.anomalies.join(", ") || "none"} |`,
    );
  }
  lines.push(
    "",
    "## Verified amended expectations",
    "",
    "- G1, G2, and G3 are judged against their observed post-prompt-fix behavior; the baseline does not assume the Stage A prediction.",
    "- R1 and S1 are judged as conversational capabilities, including presentation quality, not against an exact sentence.",
    "- P1 must show real reference-aware intake without saving, applying, or running.",
    "",
    "## Manual in-app browser rubric",
    "",
    "Manual scores use five binary fields: human, grounded, correct, useful, safe. Screenshots and completed scores are added after the HTTP baseline run.",
    "",
    "| Scenario | Human | Grounded | Correct | Useful | Safe | Screenshot | Notes |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...scored.map((result) => `| ${result.id} | pending | pending | pending | pending | pending | pending | ${result.rubric_notes} |`),
    "",
    "No paid generation, graph apply, artifact save, import, export, or destructive action was performed.",
  );
  return `${lines.join("\n")}\n`;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const scenarios = await loadScenarios(options);
  if (options.validateOnly) {
    console.log(`Conversation suite valid: ${scenarios.length} scenario(s).`);
    return;
  }

  const kieRoot = resolveKieRoot();
  const pythonPath = path.join(kieRoot, ".venv", "bin", "python");
  if (!existsSync(pythonPath)) throw new Error(`Python runtime not found: ${pythonPath}`);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "media-assistant-conversation-"));
  const dataRoot = path.join(tempRoot, "data");
  const dbPath = path.join(tempRoot, "media-studio.db");
  const apiPort = await freePort();
  const webPort = await freePort();
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const webBaseUrl = `http://127.0.0.1:${webPort}`;
  const token = "assistant-conversation-probe-token";
  const runDir = path.join(options.outputRoot, isoStamp());
  let apiProc = null;
  let webProc = null;
  const runtime = {
    started_at: new Date().toISOString(),
    finished_at: null,
    model: process.env.MEDIA_ASSISTANT_PROBE_MODEL || "gpt-5.6-sol",
    scenario_count: scenarios.length,
    api_base_url: apiBaseUrl,
    web_base_url: webBaseUrl,
  };

  await fs.mkdir(runDir, { recursive: true });
  try {
    await fs.mkdir(dataRoot, { recursive: true });
    apiProc = startProcess(pythonPath, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(apiPort)], {
      cwd: path.join(root, "apps", "api"),
      env: {
        ...process.env,
        MEDIA_STUDIO_APP_ENV: "test",
        MEDIA_STUDIO_DB_PATH: dbPath,
        MEDIA_STUDIO_DATA_ROOT: dataRoot,
        MEDIA_STUDIO_KIE_API_REPO_PATH: kieRoot,
        MEDIA_ENABLE_LIVE_SUBMIT: "false",
        MEDIA_BACKGROUND_POLL_ENABLED: "false",
        MEDIA_PRICING_REFRESH_ON_STARTUP: "false",
        MEDIA_STUDIO_CONTROL_API_TOKEN: token,
        KIE_API_KEY: "",
        OPENROUTER_API_KEY: "",
      },
    });
    await waitForUrl(`${apiBaseUrl}/health`);

    const references = await seedReferences({ pythonPath, dataRoot, dbPath, kieRoot });
    const webMode = existsSync(path.join(root, "apps", "web", ".next", "BUILD_ID")) ? "start" : "dev";
    webProc = startProcess("npm", ["--workspace", "apps/web", "run", webMode, "--", "--hostname", "127.0.0.1", "--port", String(webPort)], {
      cwd: root,
      env: {
        ...process.env,
        MEDIA_STUDIO_APP_ENV: "test",
        MEDIA_STUDIO_CONTROL_API_BASE_URL: apiBaseUrl,
        NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL: apiBaseUrl,
        MEDIA_STUDIO_CONTROL_API_TOKEN: token,
        MEDIA_STUDIO_ALLOW_PRIVATE_NETWORK_ACCESS: "false",
      },
    });
    await waitForUrl(`${webBaseUrl}/graph-studio`);

    const sessions = new Map();
    const results = [];
    for (const scenario of scenarios) {
      process.stdout.write(`${scenario.id} `);
      const result = await runScenario({ apiBaseUrl, token, dbPath, scenario, sessions, references });
      results.push(result);
      process.stdout.write(result.skipped_turn ? "global\n" : `${result.pass ? "pass" : "fail"}\n`);
    }
    const globalVoice = results.find((result) => result.id === "V1");
    if (globalVoice) {
      const captured = results.flatMap((result) => result.turns ?? []);
      globalVoice.pass = captured.every(
        (turn) => turn.checks.banned_vocabulary.pass && turn.checks.reply_length.pass,
      );
      globalVoice.global_checks = {
        banned_vocabulary: captured.every((turn) => turn.checks.banned_vocabulary.pass),
        reply_length: captured.every((turn) => turn.checks.reply_length.pass),
      };
    }
    runtime.finished_at = new Date().toISOString();
    await fs.writeFile(path.join(runDir, "trace.json"), `${JSON.stringify({ runtime, results }, null, 2)}\n`);
    await fs.writeFile(path.join(runDir, "transcript.md"), renderTranscript(results));
    await fs.writeFile(path.join(runDir, "summary.md"), renderSummary(results, runtime));
    console.log(`Conversation baseline written to ${runDir}`);
  } catch (error) {
    await fs.writeFile(path.join(runDir, "failure.json"), `${JSON.stringify({
      error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
      api_logs: apiProc?.logs ?? [],
      web_logs: webProc?.logs ?? [],
    }, null, 2)}\n`);
    throw error;
  } finally {
    stopProcess(webProc);
    stopProcess(apiProc);
    await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
