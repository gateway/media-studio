import { NextResponse } from "next/server";

import { getControlApiFile } from "@/lib/control-api";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const resolved = await params;
  const result = await getControlApiFile(resolved.path);

  if (!result.ok || !result.response) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Unable to load Control API file." },
      { status: 502 },
    );
  }

  const headers = new Headers();

  for (const header of [
    "content-type",
    "content-length",
    "content-disposition",
    "content-security-policy",
    "x-content-type-options",
    "cache-control",
    "etag",
    "last-modified",
    "accept-ranges",
    "content-range",
  ]) {
    const value = result.response.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  }

  applyFileDisposition(headers, request.url, resolved.path.at(-1));

  return new Response(result.response.body, {
    status: result.response.status,
    headers,
  });
}

function applyFileDisposition(headers: Headers, url: string, filename?: string) {
  const { searchParams } = new URL(url);
  const svg = headers.get("content-type")?.startsWith("image/svg+xml");
  if (svg) {
    headers.set("content-security-policy", "sandbox; default-src 'none'");
    headers.set("x-content-type-options", "nosniff");
  }
  if (svg || searchParams.get("download") === "1") {
    const requestedName = searchParams.get("filename") ?? filename;
    const safeName = safeDownloadFilename(requestedName);
    headers.set("content-disposition", `attachment; filename="${safeName}"`);
  } else if (searchParams.get("inline") === "1") {
    headers.delete("content-disposition");
  }
}

function safeDownloadFilename(name = "download") {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "download";
}
