#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  controlApiBaseUrl,
  isPortAvailable,
  mediaRoot,
  npmCommand,
  runtimeAccessHost,
  withResolvedRuntimeEnv,
} from "./media_runtime.mjs";

const children = new Set();
let shuttingDown = false;

function usage() {
  console.log(
    "Usage: node ./scripts/run_studio.mjs [--api-host HOST] [--api-port PORT] [--web-host HOST] [--web-port PORT]",
  );
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-host") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --api-host.");
      }
      options.apiHost = argv[index];
    } else if (arg === "--api-port") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --api-port.");
      }
      options.apiPort = argv[index];
    } else if (arg === "--web-host") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --web-host.");
      }
      options.webHost = argv[index];
    } else if (arg === "--web-port") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --web-port.");
      }
      options.webPort = argv[index];
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function terminateChild(child) {
  if (!child || child.killed) {
    return;
  }
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    terminateChild(child);
  }
  process.exit(exitCode);
}

function pipeWithPrefix(stream, prefix) {
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length) {
        console.log(`[${prefix}] ${line}`);
      }
    }
  });
  stream.on("end", () => {
    if (pending.length) {
      console.log(`[${prefix}] ${pending}`);
    }
  });
}

function startProcess(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: mediaRoot,
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.add(child);
  pipeWithPrefix(child.stdout, label);
  pipeWithPrefix(child.stderr, label);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown) {
      console.error(`${label} exited ${signal ? `with signal ${signal}` : `with code ${code ?? 0}`}.`);
      shutdown(code && code !== 0 ? code : 1);
    }
  });
  return child;
}

async function waitForUrl(url, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep polling until timeout.
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function failIfPortsUnavailable(runtime) {
  const apiAvailable = await isPortAvailable(runtime.apiHost, runtime.apiPort);
  const webAvailable = await isPortAvailable(runtime.webHost, runtime.webPort);
  if (apiAvailable && webAvailable) {
    return;
  }

  const apiHealthUrl = `${controlApiBaseUrl(runtime.apiHost, runtime.apiPort)}/health`;
  const webReadyUrl = `http://${runtimeAccessHost(runtime.webHost)}:${runtime.webPort}/icon.svg`;
  const apiReady = !apiAvailable && (await waitForUrl(apiHealthUrl, 1500));
  const webReady = !webAvailable && (await waitForUrl(webReadyUrl, 1500));
  if (apiReady && webReady) {
    console.log("Media Studio already appears to be running.");
    console.log(`Studio: http://${runtimeAccessHost(runtime.webHost)}:${runtime.webPort}/studio`);
    process.exit(0);
  }

  if (!apiAvailable) {
    console.error(`API port ${runtime.apiPort} is already in use.`);
    console.error("Stop the existing process, set MEDIA_STUDIO_API_PORT in .env, or pass --api-port.");
  }
  if (!webAvailable) {
    console.error(`Web port ${runtime.webPort} is already in use.`);
    console.error("Stop the existing process, set MEDIA_STUDIO_WEB_PORT in .env, or pass --web-port.");
  }
  process.exit(1);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = withResolvedRuntimeEnv(options);
  if (!existsSync(runtime.pythonPath)) {
    throw new Error(`Shared KIE Python runtime not found at ${runtime.pythonPath}. Run setup first.`);
  }

  await failIfPortsUnavailable(runtime);

  const studioUrl = `http://${runtimeAccessHost(runtime.webHost)}:${runtime.webPort}/studio`;
  const apiHealthUrl = `${runtime.controlApiBaseUrl}/health`;
  const webReadyUrl = `http://${runtimeAccessHost(runtime.webHost)}:${runtime.webPort}/icon.svg`;

  console.log("Starting Media Studio in one terminal window...");
  console.log(` - API: ${runtime.controlApiBaseUrl}`);
  console.log(` - Web: http://${runtimeAccessHost(runtime.webHost)}:${runtime.webPort}`);
  console.log(` - Studio: ${studioUrl}`);
  console.log("Press Ctrl+C to stop both processes.");
  console.log("");

  startProcess("api", process.execPath, [
    path.join(mediaRoot, "scripts", "dev_api.mjs"),
    "--host",
    runtime.apiHost,
    "--port",
    runtime.apiPort,
  ], runtime.env);

  startProcess("web", npmCommand(), [
    "--workspace",
    "apps/web",
    "run",
    "dev",
    "--",
    "--hostname",
    runtime.webHost,
    "--port",
    runtime.webPort,
  ], runtime.env);

  console.log("Waiting for the API and Studio to become ready...");
  if (!(await waitForUrl(apiHealthUrl))) {
    console.error("The Media Studio API did not become ready.");
    shutdown(1);
  }
  if (!(await waitForUrl(webReadyUrl))) {
    console.error("The Media Studio web app did not become ready.");
    shutdown(1);
  }
  console.log(`Media Studio is ready: ${studioUrl}`);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(1);
});
