import { NextResponse } from "next/server";

import { mapPromptRecipeRecord, sendControlApiJson } from "@/lib/control-api";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ recipeId: string }> },
) {
  const { recipeId } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await sendControlApiJson<Record<string, unknown>>(`/prompt-recipes/${recipeId}`, {
    method: "PATCH",
    payload,
    authMode: "admin",
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to update the prompt recipe." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, recipe: mapPromptRecipeRecord(result.data) });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ recipeId: string }> },
) {
  const { recipeId } = await context.params;
  const result = await sendControlApiJson<Record<string, unknown>>(`/prompt-recipes/${recipeId}`, {
    method: "DELETE",
    authMode: "admin",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Unable to archive the prompt recipe." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, recipe: result.data ? mapPromptRecipeRecord(result.data) : null });
}
