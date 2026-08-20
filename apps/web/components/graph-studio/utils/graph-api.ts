export class JsonFetchError extends Error {
  constructor(message: string, readonly code: string | null = null) {
    super(message);
    this.name = "JsonFetchError";
  }
}

export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: init?.cache ?? "no-store",
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    let code: string | null = null;
    try {
      const payload = await response.json();
      const detail = payload.detail ?? payload.error;
      if (detail && typeof detail === "object") {
        message = typeof detail.message === "string" ? detail.message : message;
        code = typeof detail.code === "string" ? detail.code : null;
      } else if (typeof detail === "string") {
        message = detail;
      }
    } catch {
      // Keep the generic status message.
    }
    throw new JsonFetchError(message, code);
  }
  return (await response.json()) as T;
}

export function creditBalanceFromPayload(payload: Record<string, unknown>): number | null {
  const raw = payload.raw && typeof payload.raw === "object" && !Array.isArray(payload.raw) ? (payload.raw as Record<string, unknown>) : null;
  for (const value of [payload.available_credits, payload.remaining_credits, raw?.available_credits, raw?.remaining_credits]) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}
