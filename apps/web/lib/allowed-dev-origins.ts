type NetworkAddress = {
  address?: string;
  family?: string | number;
  internal?: boolean;
};

type NetworkMap = Record<string, NetworkAddress[] | undefined>;

function splitOrigins(value: string | undefined) {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeDevOrigin(value: string) {
  let origin = value.trim();
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    origin = parsed.hostname || origin;
  } catch {
    origin = origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0] ?? "";
  }
  origin = origin.trim();
  if (!origin) return null;
  if (origin.startsWith("[") && origin.endsWith("]")) {
    return origin.slice(1, -1);
  }
  const hostWithPort = origin.match(/^([^:]+):\d+$/);
  return hostWithPort?.[1] ?? origin;
}

function privateNetworkAccessEnabled(env: Record<string, string | undefined>) {
  return env.MEDIA_STUDIO_ALLOW_PRIVATE_NETWORK_ACCESS?.trim().toLowerCase() === "true";
}

function networkDevOrigins(networks: NetworkMap) {
  const origins: string[] = [];
  for (const entries of Object.values(networks)) {
    for (const entry of entries ?? []) {
      if (!entry?.address || entry.internal) continue;
      const family = String(entry.family);
      if (family !== "4" && family !== "IPv4") continue;
      origins.push(entry.address);
    }
  }
  return origins;
}

export function mediaStudioAllowedDevOrigins(env: Record<string, string | undefined>, networks: NetworkMap) {
  const origins = new Set(["127.0.0.1", "localhost"]);
  for (const origin of splitOrigins(env.MEDIA_STUDIO_ALLOWED_DEV_ORIGINS)) {
    const normalized = normalizeDevOrigin(origin);
    if (normalized) origins.add(normalized);
  }
  if (privateNetworkAccessEnabled(env)) {
    for (const origin of networkDevOrigins(networks)) {
      const normalized = normalizeDevOrigin(origin);
      if (normalized) origins.add(normalized);
    }
  }
  return Array.from(origins);
}
