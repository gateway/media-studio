import { describe, expect, it } from "vitest";

import { controlErrorResponse } from "@/app/api/control/responses";

describe("control route response helpers", () => {
  it("preserves upstream string errors in the shared error envelope", async () => {
    const response = controlErrorResponse(
      "Upstream failed.",
      "Fallback error.",
      502,
    );
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({ ok: false, error: "Upstream failed." });
  });

  it("uses fallback text for empty errors and Error messages for thrown errors", async () => {
    const fallbackResponse = controlErrorResponse("", "Fallback error.", 500);
    const errorResponse = controlErrorResponse(
      new Error("Thrown failure."),
      "Fallback error.",
      503,
    );

    await expect(fallbackResponse.json()).resolves.toEqual({
      ok: false,
      error: "Fallback error.",
    });
    expect(fallbackResponse.status).toBe(500);
    await expect(errorResponse.json()).resolves.toEqual({
      ok: false,
      error: "Thrown failure.",
    });
    expect(errorResponse.status).toBe(503);
  });
});
