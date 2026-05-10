#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

import { mediaRoot, runtimePaths, withResolvedRuntimeEnv } from "./media_runtime.mjs";

function usage() {
  console.log("Usage: node ./scripts/stop_studio.mjs [--api-port PORT] [--web-port PORT]");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-port") {
      index += 1;
      if (!argv[index]) {
        throw new Error("Missing value for --api-port.");
      }
      options.apiPort = argv[index];
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

function readPid(pidFile) {
  if (!existsSync(pidFile)) {
    return null;
  }
  const value = readFileSync(pidFile, "utf8").trim();
  return /^\d+$/.test(value) ? value : null;
}

function waitForPidExit(pid, timeoutMs = 800) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(Number(pid), 0);
    } catch {
      return true;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return false;
}

function killPid(pid, { recursive = true } = {}) {
  if (!pid) {
    return;
  }
  if (process.platform === "win32" && recursive) {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  const children = recursive && process.platform !== "win32" ? spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }) : null;
  if (children?.status === 0) {
    for (const childPid of children.stdout.split(/\s+/)) {
      if (childPid) {
        killPid(childPid);
      }
    }
  }
  try {
    process.kill(Number(pid), "SIGTERM");
  } catch {
    return;
  }
  if (waitForPidExit(pid)) {
    return;
  }
  try {
    process.kill(Number(pid), "SIGKILL");
  } catch {
    // Already stopped.
  }
}

function stopPidFile(pidFile, options = {}) {
  const pid = readPid(pidFile);
  killPid(pid, options);
  rmSync(pidFile, { force: true });
}

function stopUnixPort(port, mediaRoot) {
  if (process.platform === "win32") {
    return;
  }
  const pidResult = spawnSync("lsof", ["-tiTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8" });
  if (pidResult.status !== 0 || !pidResult.stdout.trim()) {
    return;
  }
  const pid = pidResult.stdout.trim().split(/\s+/)[0];
  const command = spawnSync("ps", ["-p", pid, "-o", "command="], { encoding: "utf8" }).stdout.trim();
  if (
    command.includes("media-studio") ||
    command.includes(mediaRoot) ||
    command.includes("app.main:app") ||
    command.includes("next dev") ||
    command.includes("next start")
  ) {
    killPid(pid);
  } else {
    console.error(`Skipping port ${port} because it is owned by another app:`);
    console.error(`  ${command}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = withResolvedRuntimeEnv(options);
  const paths = runtimePaths(mediaRoot, runtime.env);
  console.log("Stopping local Media Studio...");
  stopPidFile(paths.launcherPidFile, { recursive: false });
  stopPidFile(paths.webPidFile);
  stopPidFile(paths.apiPidFile);
  stopUnixPort(runtime.webPort, mediaRoot);
  stopUnixPort(runtime.apiPort, mediaRoot);
  console.log(`Media Studio stopped for ports ${runtime.webPort} and ${runtime.apiPort}.`);
}

main();
