import { NextResponse } from "next/server";

import { postControlApiJson } from "@/lib/control-api";

const SHARED_PROVIDER_CATALOG_TTL_MS = 5 * 60 * 1000;
const sharedProviderCatalogCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();
const sharedProviderCatalogInFlight = new Map<string, Promise<{ status: number; payload: Record<string, unknown> }>>();

function requestSignature(payload: Record<string, unknown>) {
  return JSON.stringify({
    provider_kind: payload.provider_kind ?? null,
    provider_model_id: payload.provider_model_id ?? null,
    provider_base_url: payload.provider_base_url ?? null,
    require_images: Boolean(payload.require_images),
  });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const signature = requestSignature(payload);
  const cached = sharedProviderCatalogCache.get(signature);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }
  const existing = sharedProviderCatalogInFlight.get(signature);
  if (existing) {
    const sharedResponse = await existing;
    return NextResponse.json(sharedResponse.payload, { status: sharedResponse.status });
  }

  const responsePromise = (async () => {
    const result = await postControlApiJson<Record<string, unknown>>(
      "/media/shared-provider-catalog/probe",
      {
        provider_kind: payload.provider_kind ?? null,
        selected_model_id: payload.provider_model_id ?? null,
        base_url: payload.provider_base_url ?? null,
        require_images: Boolean(payload.require_images),
      },
      "admin",
    );

    if (!result.ok || !result.data) {
      return {
        status: 502,
        payload: { ok: false, error: result.error ?? "Unable to load provider models." },
      };
    }

    const responsePayload = { ok: true, ...result.data };
    sharedProviderCatalogCache.set(signature, {
      expiresAt: Date.now() + SHARED_PROVIDER_CATALOG_TTL_MS,
      payload: responsePayload,
    });
    return {
      status: 200,
      payload: responsePayload,
    };
  })().finally(() => {
    sharedProviderCatalogInFlight.delete(signature);
  });

  sharedProviderCatalogInFlight.set(signature, responsePromise);
  const response = await responsePromise;
  return NextResponse.json(response.payload, { status: response.status });
}
