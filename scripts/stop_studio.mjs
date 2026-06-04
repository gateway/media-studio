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

function normalizeCommandText(value) {
  return String(value || "").toLowerCase().replaceAll("\\", "/");
}

function commandLooksLikeMediaStudio(command, mediaRoot) {
  const normalized = normalizeCommandText(command);
  const normalizedRoot = normalizeCommandText(mediaRoot);
  if (!normalized.includes(normalizedRoot) && !normalized.includes("media-studio")) {
    return false;
  }
  return (
    normalized.includes("scripts/run_studio.mjs") ||
    normalized.includes("scripts/dev_api.mjs") ||
    normalized.includes("uvicorn app.main:app") ||
    normalized.includes("next/dist/bin/next") ||
    normalized.includes("next start") ||
    normalized.includes("next dev")
  );
}

function runWindowsProcessQuery(script) {
  if (process.platform !== "win32") {
    return [];
  }
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function windowsListeningProcesses(port) {
  const numericPort = Number.parseInt(String(port), 10);
  if (!Number.isInteger(numericPort)) {
    return [];
  }
  return runWindowsProcessQuery(`
$ErrorActionPreference = 'SilentlyContinue'
Get-NetTCPConnection -State Listen -LocalPort ${numericPort} |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $_"
    if ($process) {
      [pscustomobject]@{ ProcessId = $process.ProcessId; CommandLine = $process.CommandLine }
    }
  } |
  ConvertTo-Json -Compress
`);
}

function windowsMediaStudioProcesses(root) {
  const escapedRoot = root.replaceAll("'", "''");
  return runWindowsProcessQuery(`
$ErrorActionPreference = 'SilentlyContinue'
$root = '${escapedRoot}'
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) } |
  Select-Object ProcessId, CommandLine |
  ConvertTo-Json -Compress
`);
}

function stopWindowsRuntimeProcesses(runtime, root) {
  if (process.platform !== "win32") {
    return;
  }

  const processIds = new Set();
  for (const port of [runtime.webPort, runtime.apiPort]) {
    for (const entry of windowsListeningProcesses(port)) {
      if (entry.ProcessId && commandLooksLikeMediaStudio(entry.CommandLine, root)) {
        processIds.add(String(entry.ProcessId));
      }
    }
  }
  for (const entry of windowsMediaStudioProcesses(root)) {
    if (entry.ProcessId && commandLooksLikeMediaStudio(entry.CommandLine, root)) {
      processIds.add(String(entry.ProcessId));
    }
  }

  processIds.delete(String(process.pid));
  for (const pid of processIds) {
    killPid(pid);
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
  stopWindowsRuntimeProcesses(runtime, mediaRoot);
  stopUnixPort(runtime.webPort, mediaRoot);
  stopUnixPort(runtime.apiPort, mediaRoot);
  console.log(`Media Studio stopped for ports ${runtime.webPort} and ${runtime.apiPort}.`);
}

main();
