import { NextResponse } from "next/server";

import { unarchiveMediaProject } from "@/lib/control-api";

export async function POST(_: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  const result = await unarchiveMediaProject(projectId);
  if (!result.ok || !result.data.project) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to restore the project." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, project: result.data.project });
}
