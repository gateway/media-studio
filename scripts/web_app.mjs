#!/usr/bin/env node
import { spawn } from "node:child_process";

import {
  findAvailablePort,
  isPortAvailable,
  mediaRoot,
  npmCommand,
  readApiRuntimeState,
  withResolvedRuntimeEnv,
} from "./media_runtime.mjs";

function usage() {
  console.log(
    [
      "Usage: node ./scripts/web_app.mjs --mode dev|start [options]",
      "",
      "Options:",
      "  --mode MODE                 Web mode: dev or start.",
      "  --host HOST                 Web bind host.",
      "  --port PORT                 Web port.",
      "  --api-host HOST             API host used for browser control API calls.",
      "  --api-port PORT             API port used for browser control API calls.",
      "  --control-api-base-url URL  Explicit browser control API base URL.",
      "  --dry-run                   Print selected ports without starting Next.js.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = { mode: "", explicitWebPort: false, explicitApiPort: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --mode.");
      }
      options.mode = argv[index];
    } else if (arg === "--host") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --host.");
      }
      options.webHost = argv[index];
    } else if (arg === "--port") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --port.");
      }
      options.webPort = argv[index];
      options.explicitWebPort = true;
    } else if (arg === "--api-host") {
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
      options.explicitApiPort = true;
    } else if (arg === "--control-api-base-url") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --control-api-base-url.");
      }
      options.controlApiBaseUrl = argv[index];
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!["dev", "start"].includes(options.mode)) {
    throw new Error("Missing or invalid --mode. Use --mode dev or --mode start.");
  }
  return options;
}

async function apiRuntimeStateLooksReady(state) {
  if (!state) {
    return false;
  }
  const baseUrl = state.controlApiBaseUrl || `http://${state.host === "0.0.0.0" ? "127.0.0.1" : state.host}:${state.port}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 700);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function windowsCommandShim(command, args) {
  if (process.platform !== "win32" || !command.toLowerCase().endsWith("npm.cmd")) {
    return { command, args };
  }
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", "npm", ...args],
  };
}

function updateRuntimeWebPort(runtime, webPort) {
  runtime.webPort = String(webPort);
  runtime.env.MEDIA_STUDIO_WEB_PORT = runtime.webPort;
  runtime.env.PORT = runtime.webPort;
}

async function resolveWebPort(runtime, options) {
  if (await isPortAvailable(runtime.webHost, runtime.webPort)) {
    return;
  }
  if (options.explicitWebPort) {
    throw new Error(
      `Web port ${runtime.webPort} is already in use. Stop the existing process or choose a different --port value.`,
    );
  }
  const originalWebPort = runtime.webPort;
  const selectedWebPort = await findAvailablePort(runtime.webHost, Number(runtime.webPort) + 1, {
    exclude: new Set([String(runtime.apiPort)]),
  });
  updateRuntimeWebPort(runtime, selectedWebPort);
  console.log(`Web port ${originalWebPort} is already in use; using ${selectedWebPort} for this launch.`);
  console.log("The selected port is temporary. To make it permanent, set MEDIA_STUDIO_WEB_PORT in .env.");
  console.log("");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.explicitApiPort && !options.controlApiBaseUrl) {
    const apiRuntimeState = readApiRuntimeState(mediaRoot, process.env);
    if (await apiRuntimeStateLooksReady(apiRuntimeState)) {
      options.apiHost = options.apiHost || apiRuntimeState.host;
      options.apiPort = apiRuntimeState.port;
      options.controlApiBaseUrl = apiRuntimeState.controlApiBaseUrl;
    }
  }
  const runtimeEnv = options.controlApiBaseUrl
    ? {
        ...process.env,
        MEDIA_STUDIO_CONTROL_API_BASE_URL: options.controlApiBaseUrl,
        NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL: options.controlApiBaseUrl,
      }
    : process.env;
  const runtime = withResolvedRuntimeEnv({
    apiHost: options.apiHost,
    apiPort: options.apiPort,
    webHost: options.webHost,
    webPort: options.webPort,
    env: runtimeEnv,
  });

  await resolveWebPort(runtime, options);

  if (options.dryRun) {
    console.log(`Web: ${runtime.webHost}:${runtime.webPort}`);
    console.log(`Control API: ${runtime.controlApiBaseUrl}`);
    return;
  }

  const args = [
    "--workspace",
    "apps/web",
    "run",
    options.mode,
    "--",
    "--hostname",
    runtime.webHost,
    "--port",
    runtime.webPort,
  ];
  const command = npmCommand();
  const invocation = windowsCommandShim(command, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: mediaRoot,
    env: {
      ...runtime.env,
      NODE_ENV: options.mode === "start" ? "production" : runtime.env.NODE_ENV,
      NPM_CONFIG_FUND: runtime.env.NPM_CONFIG_FUND || "false",
      NPM_CONFIG_AUDIT: runtime.env.NPM_CONFIG_AUDIT || "false",
    },
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
