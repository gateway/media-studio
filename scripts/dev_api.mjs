#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  controlApiBaseUrl,
  findAvailablePort,
  isPortAvailable,
  mediaRoot,
  withResolvedRuntimeEnv,
  writeApiRuntimeState,
} from "./media_runtime.mjs";

function usage() {
  console.log("Usage: node ./scripts/dev_api.mjs [--host HOST] [--port PORT] [--no-reload] [--dry-run]");
}

function parseArgs(argv) {
  const options = { reload: true, explicitApiPort: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --host.");
      }
      options.apiHost = argv[index];
    } else if (arg === "--port") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --port.");
      }
      options.apiPort = argv[index];
      options.explicitApiPort = true;
    } else if (arg === "--no-reload") {
      options.reload = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = withResolvedRuntimeEnv(options);

  if (!(await isPortAvailable(runtime.apiHost, runtime.apiPort))) {
    if (!options.explicitApiPort) {
      const originalApiPort = runtime.apiPort;
      const selectedApiPort = await findAvailablePort(runtime.apiHost, Number(runtime.apiPort) + 1);
      const selectedControlApiBaseUrl = controlApiBaseUrl(runtime.apiHost, selectedApiPort);
      runtime.apiPort = selectedApiPort;
      runtime.controlApiBaseUrl = selectedControlApiBaseUrl;
      runtime.env.MEDIA_STUDIO_API_PORT = selectedApiPort;
      runtime.env.MEDIA_STUDIO_CONTROL_API_BASE_URL = selectedControlApiBaseUrl;
      runtime.env.NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL = selectedControlApiBaseUrl;
      console.log(`API port ${originalApiPort} is already in use; using ${selectedApiPort} for this launch.`);
      console.log("The selected port is temporary. To make it permanent, set MEDIA_STUDIO_API_PORT in .env.");
      console.log("");
    } else {
      throw new Error(
        `API port ${runtime.apiPort} is already in use. Stop the existing process or choose a different --port value.`,
      );
    }
  }

  if (options.dryRun) {
    console.log(`API: ${runtime.apiHost}:${runtime.apiPort}`);
    return;
  }

  if (!existsSync(runtime.pythonPath)) {
    throw new Error(`Shared KIE Python runtime not found at ${runtime.pythonPath}. Run setup first.`);
  }

  if (!(await isPortAvailable(runtime.apiHost, runtime.apiPort))) {
    throw new Error(
      `API port ${runtime.apiPort} is already in use. Stop the existing process or choose a different API port.`,
    );
  }

  writeApiRuntimeState(runtime);

  const args = [
    "-m",
    "uvicorn",
    "app.main:app",
    "--app-dir",
    path.join(mediaRoot, "apps", "api"),
    "--host",
    runtime.apiHost,
    "--port",
    runtime.apiPort,
    "--timeout-graceful-shutdown",
    "3",
  ];
  if (runtime.reload) {
    args.push(
      "--reload",
      "--reload-dir",
      path.join(mediaRoot, "apps", "api", "app"),
    );
  }

  const child = spawn(runtime.pythonPath, args, {
    cwd: mediaRoot,
    env: runtime.env,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
