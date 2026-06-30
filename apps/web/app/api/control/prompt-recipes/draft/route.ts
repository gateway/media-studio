import { NextResponse } from "next/server";

import { controlErrorResponse } from "@/app/api/control/responses";
import {
  mapPromptRecipeDraftPayload,
  postControlApiJson,
} from "@/lib/control-api";

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const result = await postControlApiJson<Record<string, unknown>>(
    "/prompt-recipes/draft",
    payload,
    "admin",
  );

  if (!result.ok || !result.data) {
    return controlErrorResponse(
      result.error,
      "Unable to generate the Prompt Recipe draft.",
      502,
    );
  }

  return NextResponse.json({
    ok: true,
    draft: result.data.draft
      ? mapPromptRecipeDraftPayload(
          result.data.draft as Record<string, unknown>,
        )
      : null,
    validation_warnings: Array.isArray(result.data.validation_warnings)
      ? result.data.validation_warnings
      : [],
    drafting_model: result.data.drafting_model ?? null,
  });
}
