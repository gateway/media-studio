#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

import {
  controlApiBaseUrl,
  findAvailablePort,
  isPortAvailable,
  mediaRoot,
  npmCommand,
  runtimeAccessHost,
  runtimePaths,
  withResolvedRuntimeEnv,
} from "./media_runtime.mjs";

const children = new Set();
let shuttingDown = false;
let activePaths = null;

function usage() {
  console.log(
    [
      "Usage: node ./scripts/run_studio.mjs [options]",
      "",
      "Options:",
      "  --production        Run production-style API and web app.",
      "  --open              Open Studio in the default browser after startup.",
      "  --no-open           Do not open the browser.",
      "  --api-host HOST     API bind host.",
      "  --api-port PORT     API port.",
      "  --web-host HOST     Web bind host.",
      "  --web-port PORT     Web port.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = { production: false, openBrowser: false, explicitApiPort: false, explicitWebPort: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--production") {
      options.production = true;
    } else if (arg === "--open") {
      options.openBrowser = true;
    } else if (arg === "--no-open") {
      options.openBrowser = false;
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
      options.explicitWebPort = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function terminatePid(pid) {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  const childrenResult = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
  if (childrenResult.status === 0) {
    for (const childPid of childrenResult.stdout.split(/\s+/)) {
      if (childPid) {
        terminatePid(childPid);
      }
    }
  }
  try {
    process.kill(Number(pid), "SIGTERM");
  } catch {
    return;
  }
  const killAfterDelay = () => {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // Already stopped.
    }
  };
  setTimeout(killAfterDelay, 300).unref();
}

function terminateChild(child) {
  if (!child || child.killed) {
    return;
  }
  terminatePid(child.pid);
}

function removeRuntimeFiles(paths) {
  for (const file of [paths.apiPidFile, paths.webPidFile, paths.launcherPidFile]) {
    rmSync(file, { force: true });
  }
}

function shutdown(paths = activePaths, exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    terminateChild(child);
  }
  if (paths) {
    removeRuntimeFiles(paths);
  }
  process.exit(exitCode);
}

function pipeWithPrefix(stream, prefix, logStream) {
  let pending = "";
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    logStream?.write(text);
    pending += text;
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

function commandDisplay(command, args) {
  const displayCommand = process.platform === "win32" && command.toLowerCase().endsWith("npm.cmd") ? "npm" : command;
  return [displayCommand, ...args].join(" ");
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

function startProcess(label, command, args, env, { logFile, pidFile } = {}) {
  const invocation = windowsCommandShim(command, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: mediaRoot,
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  children.add(child);
  const logStream = logFile ? createWriteStream(logFile, { flags: "a" }) : null;
  pipeWithPrefix(child.stdout, label, logStream);
  pipeWithPrefix(child.stderr, label, logStream);
  if (pidFile && child.pid) {
    writeFileSync(pidFile, String(child.pid));
  }
  child.on("exit", (code, signal) => {
    children.delete(child);
    logStream?.end();
    if (!shuttingDown) {
      console.error(`${label} exited ${signal ? `with signal ${signal}` : `with code ${code ?? 0}`}.`);
      shutdown(activePaths, code && code !== 0 ? code : 1);
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

function spawnChecked(command, args, env, label) {
  const invocation = windowsCommandShim(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: mediaRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const commandLine = commandDisplay(command, args);
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}. Re-run this command for full details: ${commandLine}`);
  }
}

function isNewerThanAny(target, candidates) {
  if (!existsSync(target)) {
    return true;
  }
  const targetMtime = statSync(target).mtimeMs;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    const stats = statSync(candidate);
    if (stats.isDirectory()) {
      continue;
    }
    if (stats.mtimeMs > targetMtime) {
      return true;
    }
  }
  return false;
}

function walkFiles(root, files = []) {
  if (!existsSync(root)) {
    return files;
  }
  const entries = spawnSync(process.platform === "win32" ? "cmd.exe" : "find", process.platform === "win32"
    ? ["/d", "/s", "/c", `dir /b /s "${root}"`]
    : [root, "-type", "f"], { encoding: "utf8" });
  if (entries.status !== 0) {
    return files;
  }
  for (const line of entries.stdout.split(/\r?\n/)) {
    if (line.trim()) {
      files.push(line.trim());
    }
  }
  return files;
}

function ensureWebBuild(runtime) {
  const stamp = path.join(mediaRoot, "node_modules", ".package-lock.json");
  const requiredPackages = [
    path.join(mediaRoot, "node_modules", "jszip", "package.json"),
    path.join(mediaRoot, "node_modules", "typescript", "package.json"),
    path.join(mediaRoot, "node_modules", "tailwindcss", "package.json"),
    path.join(mediaRoot, "node_modules", "@tailwindcss", "postcss", "package.json"),
  ];
  const packageFiles = [
    path.join(mediaRoot, "package.json"),
    path.join(mediaRoot, "package-lock.json"),
    path.join(mediaRoot, "apps", "web", "package.json"),
  ];
  if (
    !existsSync(path.join(mediaRoot, "node_modules")) ||
    !existsSync(stamp) ||
    requiredPackages.some((packageFile) => !existsSync(packageFile)) ||
    isNewerThanAny(stamp, packageFiles)
  ) {
    console.log("Refreshing Media Studio web dependencies...");
    spawnChecked(npmCommand(), ["install", "--include=dev", "--no-fund", "--no-audit"], runtime.env, "npm install");
  }

  const buildId = path.join(mediaRoot, "apps", "web", ".next", "BUILD_ID");
  const sourceFiles = [
    ...walkFiles(path.join(mediaRoot, "apps", "web", "app")),
    ...walkFiles(path.join(mediaRoot, "apps", "web", "components")),
    ...walkFiles(path.join(mediaRoot, "apps", "web", "hooks")),
    ...walkFiles(path.join(mediaRoot, "apps", "web", "lib")),
    path.join(mediaRoot, "apps", "web", "next.config.ts"),
    path.join(mediaRoot, "apps", "web", "tsconfig.json"),
    ...packageFiles,
  ];
  if (!isNewerThanAny(buildId, sourceFiles)) {
    console.log("Using existing production web build.");
    return;
  }
  console.log("Building Media Studio web app for production...");
  spawnChecked(npmCommand(), ["run", "build:web"], runtime.env, "web build");
}

function pythonModuleAvailable(runtime, moduleName) {
  const result = spawnSync(runtime.pythonPath, ["-c", `import ${moduleName}`], {
    cwd: mediaRoot,
    env: runtime.env,
    stdio: "ignore",
  });
  return result.status === 0;
}

function ensurePythonDependencies(runtime, { force = false } = {}) {
  if (!force && pythonModuleAvailable(runtime, "imageio_ffmpeg")) {
    return;
  }
  console.log("Refreshing shared Python dependencies...");
  spawnChecked(
    runtime.pythonPath,
    ["-m", "pip", "install", "-e", runtime.kieRoot, "-e", path.join(mediaRoot, "apps", "api")],
    runtime.env,
    "shared Python dependency install",
  );
}

function runPythonJson(scriptName, args, runtime) {
  const result = spawnSync(runtime.pythonPath, [path.join(mediaRoot, "scripts", scriptName), ...args], {
    cwd: mediaRoot,
    env: runtime.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${scriptName} failed.`);
  }
  return JSON.parse(result.stdout);
}

function runPythonText(scriptName, args, runtime) {
  const result = spawnSync(runtime.pythonPath, [path.join(mediaRoot, "scripts", scriptName), ...args], {
    cwd: mediaRoot,
    env: runtime.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${scriptName} failed.`);
  }
  return result.stdout.trim();
}

function migrationPreflight(runtime) {
  const dbPath = runtime.env.MEDIA_STUDIO_DB_PATH;
  if (!existsSync(dbPath)) {
    return;
  }
  let status;
  try {
    status = runPythonJson("migration_status.py", ["--db", dbPath], runtime);
  } catch (error) {
    throw new Error(`Unable to inspect Media Studio migration status for ${dbPath}: ${error.message}`);
  }
  const pendingCount = Array.isArray(status.pending_migrations) ? status.pending_migrations.length : 0;
  if (!status.user_schema_present || pendingCount === 0) {
    return;
  }
  console.log(`Detected ${pendingCount} pending database migration(s) for an existing Media Studio install.`);
  console.log("Creating a safety backup before startup...");
  const backupDir = path.join(runtime.env.MEDIA_STUDIO_DATA_ROOT, "backups");
  mkdirSync(backupDir, { recursive: true });
  const output = runPythonText("backup_db.py", ["--source", dbPath, "--backup-dir", backupDir], runtime);
  if (output) {
    console.log(output);
  }
  runtime.env.MEDIA_AUTO_BACKUP_BEFORE_MIGRATION = "0";
  console.log("Backup complete. Continuing with startup.");
  console.log("");
}

function git(args, cwd, options = {}) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
}

async function promptYesNo(question, defaultAnswer = "N") {
  if (!process.stdin.isTTY) {
    return defaultAnswer.toLowerCase() === "y";
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [${defaultAnswer}]: `)).trim() || defaultAnswer;
    return answer.toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}

async function kieRepoPreflight(runtime) {
  const kieRoot = runtime.kieRoot;
  if (!existsSync(path.join(kieRoot, ".git"))) {
    return false;
  }
  const fetch = git(["fetch", "--quiet", "--prune", "origin"], kieRoot);
  if (fetch.status !== 0) {
    console.log("Warning: unable to check whether kie-api is up to date with GitHub.");
    console.log(`Reusing the current kie-api checkout at: ${kieRoot}`);
    console.log("");
    return false;
  }
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], kieRoot).stdout.trim();
  const upstreamResult = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], kieRoot);
  const upstream = upstreamResult.status === 0 ? upstreamResult.stdout.trim() : branch ? `origin/${branch}` : "";
  if (!upstream) {
    return false;
  }
  const counts = git(["rev-list", "--left-right", "--count", `${upstream}...HEAD`], kieRoot).stdout.trim().split(/\s+/);
  const behind = Number.parseInt(counts[0] || "0", 10);
  if (!behind) {
    return false;
  }
  const dirty = git(["status", "--porcelain", "--untracked-files=no"], kieRoot).stdout.trim().length > 0;
  console.log("************************************************************");
  console.log("********** KIE-API UPDATE AVAILABLE ***********************");
  console.log("************************************************************");
  console.log(`Local kie-api checkout is behind ${upstream} by ${behind} commit(s).`);
  console.log("************************************************************");
  if (dirty) {
    console.log("Local kie-api changes are present, so startup will not try to update it.");
    console.log(`Update it manually with: git -C "${kieRoot}" fetch --prune origin && git -C "${kieRoot}" pull --ff-only`);
    console.log("");
    return false;
  }

  const policy = (runtime.env.MEDIA_STUDIO_UPDATE_KIE_API || "ask").toLowerCase();
  let shouldUpdate = ["1", "true", "yes", "always"].includes(policy);
  if (policy === "ask" || !["1", "true", "yes", "always", "0", "false", "no", "never"].includes(policy)) {
    shouldUpdate = await promptYesNo("Update kie-api now before starting Studio?", "Y");
  }
  if (!shouldUpdate) {
    console.log("Keeping the current kie-api checkout.");
    console.log("");
    return false;
  }
  console.log("Updating kie-api checkout...");
  const pull = git(["pull", "--ff-only", "origin", branch], kieRoot, { stdio: "inherit" });
  if (pull.status !== 0) {
    console.log("Warning: kie-api update failed. Studio will continue with the current checkout.");
    console.log("");
    return false;
  } else {
    console.log("kie-api updated successfully.");
  }
  console.log("");
  return true;
}

function openBrowser(url) {
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
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

function updateRuntimePorts(runtime, apiPort, webPort) {
  runtime.apiPort = String(apiPort);
  runtime.webPort = String(webPort);
  runtime.controlApiBaseUrl = controlApiBaseUrl(runtime.apiHost, runtime.apiPort);
  runtime.env.MEDIA_STUDIO_API_PORT = runtime.apiPort;
  runtime.env.MEDIA_STUDIO_WEB_PORT = runtime.webPort;
  runtime.env.MEDIA_STUDIO_CONTROL_API_BASE_URL = runtime.controlApiBaseUrl;
  runtime.env.NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL = runtime.controlApiBaseUrl;
  runtime.env.PORT = runtime.webPort;
}

async function resolveAvailablePorts(runtime, options) {
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

  if ((!apiAvailable && options.explicitApiPort) || (!webAvailable && options.explicitWebPort)) {
    await failIfPortsUnavailable(runtime);
    return;
  }

  const originalApiPort = runtime.apiPort;
  const originalWebPort = runtime.webPort;
  const selectedApiPort = apiAvailable
    ? runtime.apiPort
    : await findAvailablePort(runtime.apiHost, Number(runtime.apiPort) + 1);
  const selectedWebPort = webAvailable
    ? runtime.webPort
    : await findAvailablePort(runtime.webHost, Number(runtime.webPort) + 1, {
        exclude: new Set([String(selectedApiPort)]),
      });

  updateRuntimePorts(runtime, selectedApiPort, selectedWebPort);

  if (!apiAvailable) {
    console.log(`API port ${originalApiPort} is already in use; using ${selectedApiPort} for this launch.`);
  }
  if (!webAvailable) {
    console.log(`Web port ${originalWebPort} is already in use; using ${selectedWebPort} for this launch.`);
  }
  console.log("The selected ports are temporary. To make them permanent, set MEDIA_STUDIO_API_PORT and MEDIA_STUDIO_WEB_PORT in .env.");
  console.log("");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtime = withResolvedRuntimeEnv({ ...options, reload: !options.production });
  const paths = runtimePaths(mediaRoot, runtime.env);
  activePaths = paths;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => shutdown(paths, 0));
  }

  if (!existsSync(runtime.pythonPath)) {
    throw new Error(`Shared KIE Python runtime not found at ${runtime.pythonPath}. Run setup first.`);
  }

  await resolveAvailablePorts(runtime, options);

  const studioUrl = `http://${runtimeAccessHost(runtime.webHost)}:${runtime.webPort}/studio`;
  const settingsUrl = `http://${runtimeAccessHost(runtime.webHost)}:${runtime.webPort}/settings`;
  const apiHealthUrl = `${runtime.controlApiBaseUrl}/health`;
  const webReadyUrl = `http://${runtimeAccessHost(runtime.webHost)}:${runtime.webPort}/icon.svg`;

  rmSync(paths.apiLog, { force: true });
  rmSync(paths.webLog, { force: true });
  writeFileSync(paths.launcherPidFile, String(process.pid));

  console.log(`Starting Media Studio in one terminal window (${options.production ? "production" : "development"} mode)...`);
  console.log(` - API: ${runtime.controlApiBaseUrl}`);
  console.log(` - Web: http://${runtimeAccessHost(runtime.webHost)}:${runtime.webPort}`);
  console.log(` - Studio: ${studioUrl}`);
  console.log(` - Settings: ${settingsUrl}`);
  console.log(` - API log: ${paths.apiLog}`);
  console.log(` - Web log: ${paths.webLog}`);
  console.log(` - Data root: ${paths.dataRoot}`);
  console.log("");
  console.log("Local Studio data under ./data is persistent user content and is never cleaned by this launcher.");
  console.log("Press Ctrl+C to stop both processes.");
  console.log("");

  if (options.production) {
    const kieUpdated = await kieRepoPreflight(runtime);
    ensurePythonDependencies(runtime, { force: kieUpdated });
    migrationPreflight(runtime);
    ensureWebBuild(runtime);
  }

  const apiArgs = [
    path.join(mediaRoot, "scripts", "dev_api.mjs"),
    "--host",
    runtime.apiHost,
    "--port",
    runtime.apiPort,
  ];
  if (options.production) {
    apiArgs.push("--no-reload");
  }

  startProcess("api", process.execPath, apiArgs, runtime.env, {
    logFile: paths.apiLog,
    pidFile: paths.apiPidFile,
  });

  const webArgs = options.production
    ? ["--workspace", "apps/web", "run", "start", "--", "--hostname", runtime.webHost, "--port", runtime.webPort]
    : ["--workspace", "apps/web", "run", "dev", "--", "--hostname", runtime.webHost, "--port", runtime.webPort];

  startProcess("web", npmCommand(), webArgs, runtime.env, {
    logFile: paths.webLog,
    pidFile: paths.webPidFile,
  });

  console.log("Waiting for the API and Studio to become ready...");
  if (!(await waitForUrl(apiHealthUrl))) {
    console.error("The Media Studio API did not become ready.");
    shutdown(paths, 1);
  }
  if (!(await waitForUrl(webReadyUrl))) {
    console.error("The Media Studio web app did not become ready.");
    shutdown(paths, 1);
  }
  console.log(`Media Studio is ready: ${studioUrl}`);
  if (options.openBrowser) {
    console.log(`Opening browser to ${studioUrl}`);
    openBrowser(studioUrl);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  shutdown(activePaths, 1);
});
