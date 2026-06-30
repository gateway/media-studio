import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import { isTrustedLocalRequest, isTrustedPrivateNetworkRequest } from "@/lib/admin-access";

const execFileAsync = promisify(execFile);

type RuntimeService = "api" | "web";
type SupervisorKind = "launchd" | "manual" | "unknown";

type ServiceStatus = {
  service: RuntimeService;
  supervisor: SupervisorKind;
  status: "running" | "failed" | "inactive";
  manageable: boolean;
  detail: string;
};

const LABELS: Record<RuntimeService, string> = {
  api: "com.media-studio.api",
  web: "com.media-studio.web",
};

function isTrustedRuntimeRequest(url: URL, headers: Headers) {
  if (isTrustedLocalRequest(url, headers)) {
    return true;
  }
  return (
    process.env.MEDIA_STUDIO_ALLOW_PRIVATE_NETWORK_ACCESS?.trim().toLowerCase() === "true" &&
    isTrustedPrivateNetworkRequest(url, headers)
  );
}

function getMediaRoot() {
  if (process.env.MEDIA_STUDIO_DATA_ROOT) {
    return path.dirname(process.env.MEDIA_STUDIO_DATA_ROOT);
  }
  if (process.cwd().endsWith(path.join("apps", "web"))) {
    return path.resolve(process.cwd(), "..", "..");
  }
  return process.cwd();
}

async function listLaunchdLines() {
  try {
    const { stdout } = await execFileAsync("launchctl", ["list"]);
    return stdout.split("\n");
  } catch {
    return [];
  }
}

function parseLaunchdLine(lines: string[], label: string) {
  const line = lines.find((entry) => entry.trim().endsWith(label));
  if (!line) {
    return null;
  }
  const parts = line.trim().split(/\s+/);
  return {
    pid: parts[0] ?? "-",
    exit: parts[1] ?? "-",
    label: parts[2] ?? label,
  };
}

function normalizeCommandText(value: string | null | undefined) {
  return String(value ?? "").toLowerCase().replaceAll("\\", "/");
}

function commandIncludesAppRoot(command: string, appRoot: string) {
  const normalized = normalizeCommandText(command);
  const normalizedRoot = normalizeCommandText(appRoot);
  return normalized.includes(normalizedRoot) || normalized.includes("media-studio");
}

function commandMatchesService(command: string, service: RuntimeService, appRoot: string) {
  if (!commandIncludesAppRoot(command, appRoot)) {
    return false;
  }
  const normalized = normalizeCommandText(command);
  if (service === "api") {
    return normalized.includes("scripts/dev_api.mjs") || normalized.includes("uvicorn app.main:app");
  }
  return (
    normalized.includes("next/dist/bin/next") ||
    normalized.includes("next start") ||
    normalized.includes("next dev") ||
    normalized.includes("npm run start:web")
  );
}

async function hasWindowsManualProcess(service: RuntimeService) {
  const appRoot = getMediaRoot();
  const escapedRoot = appRoot.replaceAll("'", "''");
  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
$ErrorActionPreference = 'SilentlyContinue'
$root = '${escapedRoot}'
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($root) } |
  Select-Object ProcessId, CommandLine |
  ConvertTo-Json -Compress
`,
    ]);
    const trimmed = stdout.trim();
    if (!trimmed) {
      return false;
    }
    const parsed = JSON.parse(trimmed) as { CommandLine?: string } | Array<{ CommandLine?: string }>;
    const processes = Array.isArray(parsed) ? parsed : [parsed];
    return processes.some((processInfo) => commandMatchesService(processInfo.CommandLine ?? "", service, appRoot));
  } catch {
    return false;
  }
}

async function hasManualProcess(service: RuntimeService) {
  if (process.platform === "win32") {
    return hasWindowsManualProcess(service);
  }

  const pattern =
    service === "api"
      ? "uvicorn app.main:app"
      : "next dev|next start|npm run start:web";
  try {
    const { stdout } = await execFileAsync("/bin/zsh", ["-lc", `pgrep -fal '${pattern}' || true`]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .some((line) => line && !line.includes("pgrep -fal"));
  } catch {
    return false;
  }
}

async function detectService(service: RuntimeService): Promise<ServiceStatus> {
  const label = LABELS[service];
  const launchdLines = await listLaunchdLines();
  const launchdEntry = parseLaunchdLine(launchdLines, label);
  const manualProcessActive = await hasManualProcess(service);
  if (launchdEntry) {
    if (launchdEntry.pid !== "-") {
      return {
        service,
        supervisor: "launchd",
        status: "running",
        manageable: true,
        detail: `Managed by launchd (${label}).`,
      };
    }
    if (manualProcessActive) {
      return {
        service,
        supervisor: "manual",
        status: "running",
        manageable: false,
        detail: `Running manually. launchd is loaded for ${label}, but that managed process is not active.`,
      };
    }
    return {
      service,
      supervisor: "launchd",
      status: "failed",
      manageable: true,
      detail: `launchd loaded ${label}, but it is not currently running.`,
    };
  }

  if (manualProcessActive) {
    return {
      service,
      supervisor: "manual",
      status: "running",
      manageable: false,
      detail: "Started manually in a terminal session.",
    };
  }

  return {
    service,
    supervisor: "unknown",
    status: "inactive",
    manageable: false,
    detail: "No supported supervisor or active process was detected.",
  };
}

function scheduleLaunchdRestart(service: RuntimeService) {
  const label = LABELS[service];
  const uid = String(process.getuid?.() ?? "");
  const target = uid ? `gui/${uid}/${label}` : label;
  const child = spawn(
    "/bin/zsh",
    ["-lc", `sleep 1; launchctl kickstart -k ${target}`],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!isTrustedRuntimeRequest(url, request.headers)) {
    return NextResponse.json({ ok: false, error: "Runtime controls require a local operator request." }, { status: 403 });
  }
  const [api, web] = await Promise.all([detectService("api"), detectService("web")]);
  return NextResponse.json({ ok: true, services: { api, web } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!isTrustedRuntimeRequest(url, request.headers)) {
    return NextResponse.json({ ok: false, error: "Runtime controls require a local operator request." }, { status: 403 });
  }
  try {
    const payload = (await request.json()) as { service?: RuntimeService; action?: "restart" };
    const service = payload.service;
    if (service !== "api" && service !== "web") {
      return NextResponse.json({ ok: false, error: "Unknown runtime target." }, { status: 400 });
    }
    if (payload.action !== "restart") {
      return NextResponse.json({ ok: false, error: "Unsupported runtime action." }, { status: 400 });
    }
    const current = await detectService(service);
    if (current.supervisor !== "launchd") {
      return NextResponse.json(
        {
          ok: false,
          error: `Restart is only available for launchd-managed services right now. Current mode: ${current.supervisor}.`,
        },
        { status: 400 },
      );
    }
    scheduleLaunchdRestart(service);
    return NextResponse.json({ ok: true, message: `Restart scheduled for ${service}.` });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to manage runtime.",
      },
      { status: 500 },
    );
  }
}
