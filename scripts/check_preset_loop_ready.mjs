#!/usr/bin/env node

const DEFAULT_API_URL = process.env.MEDIA_STUDIO_API_URL || "http://127.0.0.1:8000";
const DEFAULT_WEB_URL = process.env.MEDIA_STUDIO_WEB_URL || "http://127.0.0.1:3000";

function usage() {
  console.log(
    [
      "Usage: node ./scripts/check_preset_loop_ready.mjs [--api-url URL] [--web-url URL] [--allow-running-job]",
      "",
      "Checks deterministic preset-loop readiness before spending generation credits.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    apiUrl: DEFAULT_API_URL,
    webUrl: DEFAULT_WEB_URL,
    allowRunningJob: false,
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
    } else if (arg === "--allow-running-job") {
      options.allowRunningJob = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { response, payload };
}

function check(id, ok, message, details = undefined) {
  return { id, ok: ok === null ? null : Boolean(ok), message, ...(details === undefined ? {} : { details }) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks = [];

  try {
    const { response, payload } = await fetchJson(`${options.apiUrl}/health`);
    checks.push(check("api_health", response.ok && payload?.status === "ok", `API health ${response.status}`, payload));
    const runnerHealthy = payload?.runner_health === "healthy" || payload?.runner?.status === "healthy";
    checks.push(check("runner_health", runnerHealthy, runnerHealthy ? "Runner healthy" : "Runner is not healthy", payload?.runner_health ?? payload?.runner));
    const queuedJobs = Number(payload?.queued_jobs ?? payload?.queue?.queued_jobs ?? 0);
    const runningJobs = Number(payload?.running_jobs ?? payload?.queue?.running_jobs ?? 0);
    const queueReady = options.allowRunningJob ? queuedJobs === 0 : queuedJobs === 0 && runningJobs === 0;
    checks.push(
      check(
        "queue_ready",
        queueReady,
        queueReady ? "Queue ready for a paid preset-loop test" : `Queue not idle: ${runningJobs} running, ${queuedJobs} queued`,
        { running_jobs: runningJobs, queued_jobs: queuedJobs },
      ),
    );
  } catch (error) {
    checks.push(check("api_health", false, error instanceof Error ? error.message : String(error)));
  }

  try {
    const response = await fetch(`${options.webUrl}/graph-studio`, { cache: "no-store" });
    checks.push(check("web_graph_studio", response.ok, `Graph Studio route ${response.status}`));
  } catch (error) {
    checks.push(check("web_graph_studio", false, error instanceof Error ? error.message : String(error)));
  }

  checks.push(
    check("browser_clean_workflow", null, "Browser checkpoint: exactly one workflow tab, zero nodes unless intentionally provided."),
    check("browser_media_preset_mode", null, "Browser checkpoint: Media Assistant open in Media Presets mode."),
    check("browser_reference_picker", null, "Browser checkpoint: reference picker opens and shows/selects images."),
    check("browser_template_proof", null, "Browser checkpoint: plan card shows template id/mode/slot count before apply."),
  );

  const hardFailed = checks.some((item) => item.ok === false && !String(item.id).startsWith("browser_"));
  const result = {
    ok: !hardFailed,
    generated_at: new Date().toISOString(),
    api_url: options.apiUrl,
    web_url: options.webUrl,
    checks,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(hardFailed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
