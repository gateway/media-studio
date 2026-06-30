import { NextResponse } from "next/server";

export function controlErrorResponse(
  error: unknown,
  fallback: string,
  status: number,
) {
  const message =
    typeof error === "string" && error.trim()
      ? error
      : error instanceof Error && error.message
        ? error.message
        : fallback;
  return NextResponse.json({ ok: false, error: message }, { status });
}
