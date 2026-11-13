import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startupModeEnv, startupModeIssue } from "./studio_startup_mode.mjs";

function reopenArgs(port, mode, forceOtherPort) {
  const args = [
    new URL("./run_studio.mjs", import.meta.url).pathname,
    "--production",
    "--no-open",
  ];
  if (mode) args.push("--startup-mode", mode);
  if (forceOtherPort)
    args.push("--api-port", port === 18089 ? "18090" : "18089");
  return args;
}

async function probeReopen({
  recorded,
  mode,
  forceOtherPort,
  health = {},
  webHealth = health,
}) {
  const data = mkdtempSync(path.join(os.tmpdir(), "studio-reopen-"));
  const server = createServer((req, res) => {
    if (req.url === "/health")
      res.end(JSON.stringify({ install_id: "desktop-test", ...health }));
    else if (req.url === "/api/control/health")
      res.end(JSON.stringify({ install_id: "desktop-test", ...webHealth }));
    else if (req.url === "/icon.svg") res.end("icon");
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    if (recorded) {
      mkdirSync(path.join(data, "runtime"));
      writeFileSync(
        path.join(data, "runtime/media-studio-session.json"),
        JSON.stringify({
          pid: process.pid,
          installId: "desktop-test",
          apiHost: "127.0.0.1",
          webHost: "127.0.0.1",
          apiPort: port,
          webPort: port,
        }),
      );
    }
    const args = reopenArgs(port, mode, forceOtherPort);
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        MEDIA_STUDIO_DATA_ROOT: data,
        MEDIA_STUDIO_INSTALL_ID: "desktop-test",
        KIE_ROOT: path.join(data, "never-exists"), // Prevents the test process from starting any real service.
        MEDIA_STUDIO_API_HOST: "127.0.0.1",
        MEDIA_STUDIO_WEB_HOST: "127.0.0.1",
        MEDIA_STUDIO_API_PORT: recorded ? "18089" : String(port),
        MEDIA_STUDIO_WEB_PORT: recorded ? "13009" : String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const exit = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    return { exit, output, port };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(data, { recursive: true, force: true });
  }
}

test("reopening a live install uses its recorded ports without starting another runtime", async () => {
  const { exit, output, port } = await probeReopen({ recorded: true });
  assert.equal(exit, 0, output);
  assert.match(
    output,
    new RegExp(`already running: http://127.0.0.1:${port}/studio`),
  );
});

for (const recorded of [true, false]) {
  const route = recorded ? "recorded session" : "occupied ports";
  test(`${route} refuses to reuse live submission with an inactive worker`, async () => {
    const { exit, output } = await probeReopen({
      recorded,
      mode: "live",
      health: {
        live_submit_enabled: true,
        kie_api_key_configured: true,
        runner_active: false,
      },
    });
    assert.equal(exit, 1, output);
    assert.match(
      output,
      /does not match live mode: Expected the media worker to be active/,
    );
    assert.doesNotMatch(output, /already running:|Starting Media Studio/);
  });

  test(`${route} can reuse a matching verification instance`, async () => {
    const { exit, output } = await probeReopen({
      recorded,
      mode: "verification",
      health: { live_submit_enabled: false, runner_active: false },
    });
    assert.equal(exit, 0, output);
    assert.match(
      output,
      /Startup mode: verification \(submission and worker verified from API health\)/,
    );
  });
}

test("explicit mode does not start another API when a recorded session uses different ports", async () => {
  const { exit, output } = await probeReopen({
    recorded: true,
    mode: "live",
    forceOtherPort: true,
  });
  assert.equal(exit, 1, output);
  assert.match(output, /A live launcher is recorded for this installation/);
  assert.doesNotMatch(output, /already running:|Starting Media Studio/);
});

test("verification reuse rejects a web app that points to live processing", async () => {
  const { exit, output } = await probeReopen({
    recorded: true,
    mode: "verification",
    health: { live_submit_enabled: false, runner_active: false },
    webHealth: { live_submit_enabled: true, runner_active: true },
  });
  assert.equal(exit, 1, output);
  assert.match(output, /running web app does not reach verification mode/);
  assert.doesNotMatch(output, /already running:|Starting Media Studio/);
});

test("explicit modes keep recovery off and a plain launch adds no overrides", () => {
  assert.deepEqual(startupModeEnv(undefined), {});
  for (const [mode, active] of [
    ["verification", "0"],
    ["live", "1"],
  ]) {
    const env = startupModeEnv(mode);
    assert.equal(env.MEDIA_ENABLE_LIVE_SUBMIT, active);
    assert.equal(env.MEDIA_BACKGROUND_POLL_ENABLED, active);
    assert.equal(env.MEDIA_STARTUP_RECOVERY_ENABLED, "0");
  }
});

test("mode readiness requires a stopped verification worker or a fresh live heartbeat", () => {
  assert.match(
    startupModeIssue("verification", {
      live_submit_enabled: false,
      runner_active: true,
    }),
    /inactive/,
  );
  const live = {
    live_submit_enabled: true,
    runner_active: true,
    kie_api_key_configured: true,
    queue_enabled: true,
    runner_health: "healthy",
    heartbeat_age_seconds: 2,
    heartbeat_max_age_seconds: 18,
  };
  assert.equal(startupModeIssue("live", live), null);
  assert.match(
    startupModeIssue("live", { ...live, heartbeat_age_seconds: null }),
    /heartbeat/,
  );
  assert.match(
    startupModeIssue("live", { ...live, heartbeat_age_seconds: 19 }),
    /heartbeat/,
  );
  assert.match(
    startupModeIssue("live", { ...live, queue_enabled: false }),
    /paused/,
  );
});
