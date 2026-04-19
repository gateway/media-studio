import { NextRequest, NextResponse } from "next/server";

import { createMediaProject, listMediaProjects } from "@/lib/control-api";

export async function GET(request: NextRequest) {
  const statusParam = request.nextUrl.searchParams.get("status");
  const status = statusParam === "active" || statusParam === "archived" || statusParam === "all" ? statusParam : "active";
  const result = await listMediaProjects(status);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to load projects." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, projects: result.data.projects });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await createMediaProject(payload);
  if (!result.ok || !result.data.project) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to create the project." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, project: result.data.project });
}
