import { NextResponse } from "next/server";

import { postControlApiJson } from "@/lib/control-api";

const GRAPH_ESTIMATE_TTL_MS = 30 * 1000;
const graphEstimateCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();
const graphEstimateInFlight = new Map<string, Promise<{ status: number; payload: Record<string, unknown> }>>();

function signatureForGraphEstimate(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const signature = signatureForGraphEstimate(payload);
  const cached = graphEstimateCache.get(signature);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }
  const existing = graphEstimateInFlight.get(signature);
  if (existing) {
    const sharedResponse = await existing;
    return NextResponse.json(sharedResponse.payload, { status: sharedResponse.status });
  }

  const responsePromise = (async () => {
    const result = await postControlApiJson<Record<string, unknown>>("/media/graph/estimate", payload, "admin");
    if (!result.ok || !result.data) {
      return {
        status: 502,
        payload: { detail: result.error ?? "Unable to estimate graph pricing." },
      };
    }
    graphEstimateCache.set(signature, {
      expiresAt: Date.now() + GRAPH_ESTIMATE_TTL_MS,
      payload: result.data,
    });
    return {
      status: 200,
      payload: result.data,
    };
  })().finally(() => {
    graphEstimateInFlight.delete(signature);
  });

  graphEstimateInFlight.set(signature, responsePromise);
  const response = await responsePromise;
  return NextResponse.json(response.payload, { status: response.status });
}
