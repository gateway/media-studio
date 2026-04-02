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
