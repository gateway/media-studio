import { NextResponse } from "next/server";

import { controlErrorResponse } from "@/app/api/control/responses";
import {
  getControlApiJson,
  mapPromptRecipeRecord,
  postControlApiJson,
} from "@/lib/control-api";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  if (status) {
    params.set("status", status);
  }
  if (category) {
    params.set("category", category);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const result = await getControlApiJson<Record<string, unknown>[]>(
    `/prompt-recipes${suffix}`,
  );

  if (!result.ok || !result.data) {
    return controlErrorResponse(
      result.error,
      "Unable to load prompt recipes.",
      502,
    );
  }

  return NextResponse.json({
    ok: true,
    recipes: result.data.map(mapPromptRecipeRecord),
  });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await postControlApiJson<Record<string, unknown>>(
    "/prompt-recipes",
    payload,
    "admin",
  );

  if (!result.ok || !result.data) {
    return controlErrorResponse(
      result.error,
      "Unable to create the prompt recipe.",
      502,
    );
  }

  return NextResponse.json({
    ok: true,
    recipe: mapPromptRecipeRecord(result.data),
  });
}
