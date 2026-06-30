import { Socket, createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const mediaRoot = path.resolve(scriptsDir, "..");

export function loadMediaEnv(root = mediaRoot, baseEnv = process.env) {
  const resolved = { ...baseEnv };
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) {
    return resolved;
  }

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) {
      continue;
    }
    const [, name, rawValue] = match;
    let value = rawValue.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (resolved[name] == null || resolved[name] === "") {
      resolved[name] = value;
    }
  }

  return resolved;
}

export function ensureMediaStudioInstallId(root = mediaRoot, baseEnv = process.env) {
  const existingEnvValue = String(baseEnv.MEDIA_STUDIO_INSTALL_ID || "").trim();
  if (existingEnvValue) {
    return existingEnvValue;
  }

  const envPath = path.join(root, ".env");
  const prefix = "MEDIA_STUDIO_INSTALL_ID=";
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      const value = line.slice(prefix.length).trim();
      if (value) {
        return value;
      }
    }
  }

  const installId = `install-${randomBytes(16).toString("hex")}`;
  const normalizedLines = lines.filter((line, index) => index < lines.length - 1 || line.trim() !== "");
  let insertAt = normalizedLines.length;
  const tokenIndex = normalizedLines.findIndex((line) => line.startsWith("MEDIA_STUDIO_CONTROL_API_TOKEN="));
  if (tokenIndex >= 0) {
    insertAt = tokenIndex + 1;
  }
  normalizedLines.splice(insertAt, 0, `${prefix}${installId}`);
  writeFileSync(envPath, `${normalizedLines.join("\n").trimEnd()}\n`);
  return installId;
}

export function resolveKieRoot(root = mediaRoot, env = process.env) {
  if (env.KIE_ROOT) {
    return path.resolve(env.KIE_ROOT);
  }
  if (env.MEDIA_STUDIO_KIE_API_REPO_PATH) {
    return path.resolve(env.MEDIA_STUDIO_KIE_API_REPO_PATH);
  }

  const parentRoot = path.dirname(root);
  const defaultKieRoot = path.join(parentRoot, "kie-api");
  const legacyKieRoot = path.join(parentRoot, "kie-ai", "kie_codex_bootstrap");
  if (existsSync(defaultKieRoot)) {
    return defaultKieRoot;
  }
  if (existsSync(legacyKieRoot)) {
    return legacyKieRoot;
  }
  return defaultKieRoot;
}

export function venvPythonPath(kieRoot) {
  return process.platform === "win32"
    ? path.join(kieRoot, ".venv", "Scripts", "python.exe")
    : path.join(kieRoot, ".venv", "bin", "python");
}

export function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function runtimePaths(root = mediaRoot, env = process.env) {
  const dataRoot = env.MEDIA_STUDIO_DATA_ROOT || path.join(root, "data");
  const runtimeDir = path.join(dataRoot, "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  return {
    dataRoot,
    runtimeDir,
    apiLog: path.join(runtimeDir, "media-studio-api.log"),
    webLog: path.join(runtimeDir, "media-studio-web.log"),
    apiPidFile: path.join(runtimeDir, "media-studio-api.pid"),
    webPidFile: path.join(runtimeDir, "media-studio-web.pid"),
    launcherPidFile: path.join(runtimeDir, "media-studio-launcher.pid"),
  };
}

export function apiRuntimeStatePath(root = mediaRoot, env = process.env) {
  return path.join(runtimePaths(root, env).runtimeDir, "media-studio-api-runtime.json");
}

export function writeApiRuntimeState(runtime) {
  writeFileSync(
    apiRuntimeStatePath(mediaRoot, runtime.env),
    `${JSON.stringify(
      {
        host: runtime.apiHost,
        port: runtime.apiPort,
        controlApiBaseUrl: controlApiBaseUrl(runtime.apiHost, runtime.apiPort),
        installId: runtime.env.MEDIA_STUDIO_INSTALL_ID || "",
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

export function readApiRuntimeState(root = mediaRoot, env = process.env) {
  const statePath = apiRuntimeStatePath(root, env);
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    const payload = JSON.parse(readFileSync(statePath, "utf8"));
    const host = typeof payload.host === "string" ? payload.host.trim() : "";
    const port = typeof payload.port === "string" || typeof payload.port === "number" ? String(payload.port).trim() : "";
    const controlApiBaseUrl =
      typeof payload.controlApiBaseUrl === "string" ? payload.controlApiBaseUrl.trim() : "";
    if (!host || !port) {
      return null;
    }
    return { host, port, controlApiBaseUrl };
  } catch {
    return null;
  }
}

export function runtimeAccessHost(host) {
  if (!host || host === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (host === "::" || host === "[::]") {
    return "::1";
  }
  return host;
}

export function controlApiBaseUrl(host, port) {
  const accessHost = runtimeAccessHost(host);
  if (accessHost.includes(":") && !accessHost.startsWith("[")) {
    return `http://[${accessHost}]:${port}`;
  }
  return `http://${accessHost}:${port}`;
}

export function parsePositivePort(value, label) {
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a TCP port from 1 to 65535.`);
  }
  return String(port);
}

export function isPortAvailable(host, port) {
  const accessHost = runtimeAccessHost(host);
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(false));
    socket.once("timeout", () => finish(true));
    socket.once("error", () => finish(true));
    socket.connect(Number(port), accessHost);
  }).then((connectAvailable) => {
    if (!connectAvailable) {
      return false;
    }
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", (error) => {
        if (error && error.code === "EADDRINUSE") {
          resolve(false);
          return;
        }
        reject(error);
      });
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(Number(port), host);
    });
  });
}

export async function findAvailablePort(host, preferredPort, { maxAttempts = 100, exclude = new Set() } = {}) {
  const start = Number.parseInt(String(preferredPort), 10);
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = String(start + offset);
    if (Number(candidate) > 65535 || exclude.has(candidate)) {
      continue;
    }
    if (await isPortAvailable(host, candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not find an open port near ${preferredPort}.`);
}

export function withResolvedRuntimeEnv({
  apiHost,
  apiPort,
  webHost,
  webPort,
  reload = true,
  env = process.env,
} = {}) {
  const mediaStudioInstallId = ensureMediaStudioInstallId(mediaRoot, env);
  const loadedEnv = loadMediaEnv(mediaRoot, { ...env, MEDIA_STUDIO_INSTALL_ID: mediaStudioInstallId });
  const kieRoot = resolveKieRoot(mediaRoot, loadedEnv);

  const resolvedApiHost = apiHost || loadedEnv.MEDIA_STUDIO_API_HOST || "127.0.0.1";
  const resolvedApiPort = parsePositivePort(apiPort || loadedEnv.MEDIA_STUDIO_API_PORT || "8000", "API port");
  const resolvedWebHost = webHost || loadedEnv.MEDIA_STUDIO_WEB_HOST || "127.0.0.1";
  const resolvedWebPort = parsePositivePort(webPort || loadedEnv.MEDIA_STUDIO_WEB_PORT || loadedEnv.PORT || "3000", "Web port");
  const configuredControlApiBaseUrl =
    loadedEnv.MEDIA_STUDIO_CONTROL_API_BASE_URL ||
    loadedEnv.NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL ||
    "";
  const derivedControlApiBaseUrl = controlApiBaseUrl(resolvedApiHost, resolvedApiPort);
  const resolvedControlApiBaseUrl =
    !configuredControlApiBaseUrl ||
    configuredControlApiBaseUrl === "http://127.0.0.1:8000" ||
    configuredControlApiBaseUrl === "http://localhost:8000"
      ? derivedControlApiBaseUrl
      : configuredControlApiBaseUrl;

  return {
    env: {
      ...loadedEnv,
      MEDIA_STUDIO_KIE_API_REPO_PATH: loadedEnv.MEDIA_STUDIO_KIE_API_REPO_PATH || kieRoot,
      MEDIA_STUDIO_DB_PATH: loadedEnv.MEDIA_STUDIO_DB_PATH || path.join(mediaRoot, "data", "media-studio.db"),
      MEDIA_STUDIO_DATA_ROOT: loadedEnv.MEDIA_STUDIO_DATA_ROOT || path.join(mediaRoot, "data"),
      MEDIA_STUDIO_API_HOST: resolvedApiHost,
      MEDIA_STUDIO_API_PORT: resolvedApiPort,
      MEDIA_STUDIO_WEB_HOST: resolvedWebHost,
      MEDIA_STUDIO_WEB_PORT: resolvedWebPort,
      MEDIA_STUDIO_SUPERVISOR: loadedEnv.MEDIA_STUDIO_SUPERVISOR || "manual",
      MEDIA_STUDIO_CONTROL_API_BASE_URL: resolvedControlApiBaseUrl,
      MEDIA_STUDIO_INSTALL_ID: loadedEnv.MEDIA_STUDIO_INSTALL_ID || mediaStudioInstallId,
      NEXT_PUBLIC_MEDIA_STUDIO_CONTROL_API_BASE_URL: resolvedControlApiBaseUrl,
      PORT: resolvedWebPort,
      NPM_CONFIG_FUND: loadedEnv.NPM_CONFIG_FUND || "false",
      NPM_CONFIG_AUDIT: loadedEnv.NPM_CONFIG_AUDIT || "false",
    },
    apiHost: resolvedApiHost,
    apiPort: resolvedApiPort,
    webHost: resolvedWebHost,
    webPort: resolvedWebPort,
    controlApiBaseUrl: resolvedControlApiBaseUrl,
    kieRoot,
    pythonPath: venvPythonPath(kieRoot),
    reload,
  };
}
