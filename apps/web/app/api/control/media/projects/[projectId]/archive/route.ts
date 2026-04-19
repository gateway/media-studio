import { NextResponse } from "next/server";

import { archiveMediaProject } from "@/lib/control-api";

export async function POST(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const result = await archiveMediaProject(projectId);
  if (!result.ok || !result.data.project) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to archive the project." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, project: result.data.project });
}
