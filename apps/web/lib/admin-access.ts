const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function normalizeHostname(value: string | null | undefined) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.startsWith("[") && raw.includes("]")) {
    return raw.slice(1, raw.indexOf("]"));
  }
  return raw.split(":")[0];
}

export function isLoopbackHostname(value: string | null | undefined) {
  return LOOPBACK_HOSTS.has(normalizeHostname(value));
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
