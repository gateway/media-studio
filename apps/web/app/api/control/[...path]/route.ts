import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";

import { CONTROL_API_BASE_URL, buildControlApiHeaders } from "@/lib/control-api";

async function proxy(request: NextRequest, params: { path?: string[] }) {
  const segments = params.path || [];
  const target = new URL(`${CONTROL_API_BASE_URL}/${segments.join("/")}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  const contentType = request.headers.get("content-type");
  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : contentType && contentType.includes("application/json")
        ? JSON.stringify(await request.json())
        : await request.text();

  const authMode = request.method === "GET" || request.method === "HEAD" ? "read" : "admin";
  const planningRequest = segments.length === 5 && segments[0] === "media" &&
    segments[1] === "assistant" && segments[2] === "sessions" &&
    (segments[4] === "messages" || segments[4] === "plans");
  if (request.method === "POST" && planningRequest) {
    // Compaction may legitimately outlast fetch's implicit headers deadline.
    // The Assistant owns planning deadlines and cancellation; this transport adds none.
    return new Promise<NextResponse>((resolve, reject) => {
      const send = target.protocol === "https:" ? httpsRequest : httpRequest;
      const upstream = send(target, {
        method: request.method,
        headers: Object.fromEntries(buildControlApiHeaders(authMode, {
          ...(contentType ? { "content-type": contentType } : {}),
          ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : {}),
        })),
        timeout: 0,
      }, (response) => {
        resolve(new NextResponse(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
          status: response.statusCode ?? 502,
          headers: { "content-type": response.headers["content-type"] ?? "application/json" },
        }));
      });
      upstream.setTimeout(0);
      const abort = () => upstream.destroy(new Error("Assistant request disconnected."));
      upstream.on("error", reject);
      upstream.on("close", () => request.signal.removeEventListener("abort", abort));
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      else upstream.end(body);
    });
  }
  const response = await fetch(target.toString(), {
    method: request.method,
    headers: buildControlApiHeaders(authMode, contentType ? { "content-type": contentType } : undefined),
    body,
    cache: "no-store",
  });

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
    },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, await context.params);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, await context.params);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, await context.params);
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, await context.params);
}
