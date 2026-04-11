import { describe, expect, it } from "vitest";

import { PROTECTED_ROUTE_MATCHER, isProtectedPath } from "@/proxy";

describe("web proxy route protection", () => {
  it("protects all admin surfaces including presets", () => {
    expect(isProtectedPath("/studio")).toBe(true);
    expect(isProtectedPath("/models")).toBe(true);
    expect(isProtectedPath("/presets")).toBe(true);
    expect(isProtectedPath("/jobs")).toBe(true);
    expect(isProtectedPath("/pricing")).toBe(true);
    expect(isProtectedPath("/settings")).toBe(true);
    expect(isProtectedPath("/setup")).toBe(true);
  });

  it("keeps presets in the matcher list", () => {
    expect(PROTECTED_ROUTE_MATCHER).toContain("/presets/:path*");
  });
});
