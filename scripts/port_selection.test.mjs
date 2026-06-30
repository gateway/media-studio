import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findAvailablePort, isPortAvailable } from "./media_runtime.mjs";

function listen(host = "127.0.0.1", port = 0) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function listenHealth(host = "127.0.0.1", port = 0) {
  const server = createHttpServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function runNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

test("findAvailablePort skips busy and excluded ports", async (t) => {
  const first = await listen();
  const firstPort = first.address().port;
  t.after(() => {
    first.close();
  });

  assert.equal(await isPortAvailable("127.0.0.1", firstPort), false);

  const selected = await findAvailablePort("127.0.0.1", firstPort, {
    exclude: new Set([String(firstPort + 2)]),
  });

  assert.notEqual(selected, String(firstPort));
  assert.notEqual(selected, String(firstPort + 2));
  assert.equal(await isPortAvailable("127.0.0.1", selected), true);
});

test("standalone API launcher auto-selects a free non-explicit port", async (t) => {
  const server = await listen();
  const busyPort = server.address().port;
  t.after(() => server.close());

  const result = spawnSync(process.execPath, ["scripts/dev_api.mjs", "--dry-run"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      MEDIA_STUDIO_API_PORT: String(busyPort),
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`API port ${busyPort} is already in use; using \\d+`));
  assert.doesNotMatch(result.stdout, new RegExp(`API: 127\\.0\\.0\\.1:${busyPort}\\b`));
});

test("standalone API launcher keeps explicit busy ports strict", async (t) => {
  const server = await listen();
  const busyPort = server.address().port;
  t.after(() => server.close());

  const result = spawnSync(process.execPath, ["scripts/dev_api.mjs", "--port", String(busyPort), "--dry-run"], {
    cwd: new URL("..", import.meta.url),
    env: process.env,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`API port ${busyPort} is already in use`));
});

test("standalone web launcher auto-selects a free non-explicit port", async (t) => {
  const server = await listen();
  const busyPort = server.address().port;
  t.after(() => server.close());

  const result = spawnSync(process.execPath, ["scripts/web_app.mjs", "--mode", "dev", "--dry-run"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      MEDIA_STUDIO_WEB_PORT: String(busyPort),
      MEDIA_STUDIO_API_PORT: String(busyPort + 1),
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Web port ${busyPort} is already in use; using \\d+`));
  assert.doesNotMatch(result.stdout, new RegExp(`Web: 127\\.0\\.0\\.1:${busyPort}\\b`));
});

test("standalone web launcher keeps explicit busy ports strict", async (t) => {
  const server = await listen();
  const busyPort = server.address().port;
  t.after(() => server.close());

  const result = spawnSync(
    process.execPath,
    ["scripts/web_app.mjs", "--mode", "dev", "--port", String(busyPort), "--dry-run"],
    {
      cwd: new URL("..", import.meta.url),
      env: process.env,
      encoding: "utf8",
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`Web port ${busyPort} is already in use`));
});

test("standalone web launcher reuses a verified API runtime port when API shifted", async (t) => {
  const api = await listenHealth();
  const apiPort = api.address().port;
  t.after(() => api.close());

  const dataRoot = mkdtempSync(join(tmpdir(), "media-studio-runtime-"));
  const runtimeDir = join(dataRoot, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, "media-studio-api-runtime.json"),
    JSON.stringify({
      host: "127.0.0.1",
      port: String(apiPort),
      controlApiBaseUrl: `http://127.0.0.1:${apiPort}`,
    }),
  );

  const result = await runNode(["scripts/web_app.mjs", "--mode", "dev", "--dry-run"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      MEDIA_STUDIO_DATA_ROOT: dataRoot,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Control API: http://127\\.0\\.0\\.1:${apiPort}`));
});
