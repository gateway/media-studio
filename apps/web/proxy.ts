import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { hasValidBasicAuthorization, isTrustedLocalRequest } from "@/lib/admin-access";

export function isProtectedPath(pathname: string) {
  return (
    pathname.startsWith("/api/control") ||
    pathname.startsWith("/jobs") ||
    pathname.startsWith("/models") ||
    pathname.startsWith("/presets") ||
    pathname.startsWith("/pricing") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/setup") ||
    pathname.startsWith("/studio")
  );
}

function unauthorizedResponse() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Media Studio"',
    },
  });
}

export function proxy(request: NextRequest) {
  if (!isProtectedPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const adminUsername = process.env.MEDIA_STUDIO_ADMIN_USERNAME?.trim() ?? "";
  const adminPassword = process.env.MEDIA_STUDIO_ADMIN_PASSWORD?.trim() ?? "";
  if (adminUsername && adminPassword) {
    if (hasValidBasicAuthorization(request.headers.get("authorization"), adminUsername, adminPassword)) {
      return NextResponse.next();
    }
    return unauthorizedResponse();
  }

  // When browser credentials are not configured yet, keep the dashboard
  // limited to loopback traffic instead of silently exposing operator routes.
  if (isTrustedLocalRequest(request.nextUrl, request.headers)) {
    return NextResponse.next();
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        "Media Studio is only available on localhost until admin credentials are configured. Open http://127.0.0.1:3000/studio or http://localhost:3000/studio on this machine, or set MEDIA_STUDIO_ADMIN_USERNAME and MEDIA_STUDIO_ADMIN_PASSWORD for non-local access.",
    },
    { status: 403 },
  );
}

export const PROTECTED_ROUTE_MATCHER = [
  "/api/control/:path*",
  "/jobs/:path*",
  "/models/:path*",
  "/presets/:path*",
  "/pricing/:path*",
  "/settings/:path*",
  "/setup/:path*",
  "/studio/:path*",
] as const;

export const config = {
  matcher: [
    "/api/control/:path*",
    "/jobs/:path*",
    "/models/:path*",
    "/presets/:path*",
    "/pricing/:path*",
    "/settings/:path*",
    "/setup/:path*",
    "/studio/:path*",
  ],
};
