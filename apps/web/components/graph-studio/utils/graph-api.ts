export async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.detail ?? payload.error ?? message;
    } catch {
      // Keep the generic status message.
    }
    throw new Error(message);
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
