import { readGraphStartup } from "./graph-startup-reads";
import { readGraphTabSession } from "./graph-tabs";

const STORAGE_KEY = "media-studio:graph-studio:installation";
export type GraphStorageBinding = { installId: string; scope: string };
export type GraphStorageChoice = GraphStorageBinding & {
  label: string;
  tabCount: number;
};
export type GraphStorageResolution = {
  binding: GraphStorageBinding | null;
  choices: GraphStorageChoice[];
};

type StoredBinding = GraphStorageBinding & { bindings?: Record<string, string> };

function readBinding(): StoredBinding | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "null",
    );
    if (
      typeof value?.installId === "string" &&
      value.installId.trim() &&
      (value.scope === value.installId || value.scope === "default")
    )
      return value;
  } catch {
    // An unavailable or invalid binding cannot establish workspace ownership.
  }
  return null;
}

export function rememberGraphStorageBinding(
  binding: GraphStorageBinding,
): boolean {
  try {
    const previous = readBinding();
    const bindings = { ...previous?.bindings };
    if (previous) bindings[previous.installId] = previous.scope;
    bindings[binding.installId] = binding.scope;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...binding, bindings }));
    return true;
  } catch {
    return false;
  }
}

async function readInstallationId(fresh: boolean): Promise<string> {
  try {
    const payload = await readGraphStartup<{ install_id?: unknown }>(
      "/api/control/health",
      fresh,
    );
    return typeof payload.install_id === "string"
      ? payload.install_id.trim()
      : "";
  } catch {
    return "";
  }
}

function bindingForInstallation(previous: StoredBinding | null, installId: string): GraphStorageBinding {
  const scope = previous?.bindings?.[installId] === "default" ? "default" : installId;
  return { installId, scope };
}

export async function resolveGraphStorageIdentity(
  fresh: boolean,
): Promise<GraphStorageResolution> {
  const installId = await readInstallationId(fresh);
  // Read after health settles so a concurrent mount's verified choice is respected.
  const previous = readBinding();
  if (!installId) return { binding: previous, choices: [] };
  if (previous?.installId === installId)
    return { binding: previous, choices: [] };
  const binding = bindingForInstallation(previous, installId);
  const legacy = !previous ? readGraphTabSession("default") : null;
  if (legacy) {
    return {
      binding: null,
      choices: [
        {
          installId,
          scope: "default",
          label: "Previous offline drafts",
          tabCount: legacy.tabs.length,
        },
        {
          ...binding,
          label: "This installation",
          tabCount: readGraphTabSession(installId)?.tabs.length ?? 0,
        },
      ],
    };
  }
  return { binding, choices: [] };
}
