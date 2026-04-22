const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const TAILSCALE_HOST_SUFFIX = ".ts.net";

function normalizeHostname(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.startsWith("[") && raw.includes("]")) {
    return raw.slice(1, raw.indexOf("]"));
  }
  if (raw.startsWith("::ffff:")) {
    return raw.slice("::ffff:".length);
  }
  const firstColon = raw.indexOf(":");
  const lastColon = raw.lastIndexOf(":");
  if (firstColon >= 0 && firstColon !== lastColon) {
    return raw;
  }
  return firstColon >= 0 ? raw.slice(0, firstColon) : raw;
}

export function isLoopbackHostname(value: string | null | undefined) {
  return LOOPBACK_HOSTS.has(normalizeHostname(value));
}

function isPrivateIpv4Address(hostname: string) {
  const normalized = normalizeHostname(hostname);
  const parts = normalized.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) {
    return false;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
  return false;
}

function isPrivateIpv6Address(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return normalized.startsWith("fc") || normalized.startsWith("fd");
}

export function isTrustedPrivateNetworkHostname(value: string | null | undefined) {
  const normalized = normalizeHostname(value);
  if (!normalized) {
    return false;
  }
  return (
    normalized === "0.0.0.0" ||
    isPrivateIpv4Address(normalized) ||
    isPrivateIpv6Address(normalized) ||
    normalized.endsWith(TAILSCALE_HOST_SUFFIX)
  );
}

export function isTrustedLocalRequest(url: URL, headers: Headers) {
  if (!isLoopbackHostname(url.hostname)) {
    return false;
  }
  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return true;
  }
  const remoteHost = forwardedFor.split(",")[0]?.trim() ?? "";
  return isLoopbackHostname(remoteHost);
}

export function isTrustedPrivateNetworkRequest(url: URL, headers: Headers) {
  if (isTrustedPrivateNetworkHostname(url.hostname)) {
    return true;
  }
  const forwardedFor = headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return false;
  }
  const remoteHost = forwardedFor.split(",")[0]?.trim() ?? "";
  return isTrustedPrivateNetworkHostname(remoteHost);
}

export function parseBasicAuthorization(headerValue: string | null | undefined) {
  const raw = String(headerValue ?? "").trim();
  if (!raw.toLowerCase().startsWith("basic ")) {
    return null;
  }
  const encoded = raw.slice(6).trim();
  if (!encoded) {
    return null;
  }
  try {
    const decoded = atob(encoded);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) {
      return null;
    }
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function hasValidBasicAuthorization(
  headerValue: string | null | undefined,
  expectedUsername: string,
  expectedPassword: string,
) {
  const parsed = parseBasicAuthorization(headerValue);
  return parsed?.username === expectedUsername && parsed.password === expectedPassword;
}
