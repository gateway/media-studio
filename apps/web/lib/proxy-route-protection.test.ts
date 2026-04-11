import { afterEach, describe, expect, it, vi } from "vitest";

import { PROTECTED_ROUTE_MATCHER, isProtectedPath } from "@/proxy";
import { isTrustedPrivateNetworkHostname, isTrustedPrivateNetworkRequest } from "@/lib/admin-access";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("recognizes private-network and TailScale hostnames", () => {
    expect(isTrustedPrivateNetworkHostname("192.168.1.20")).toBe(true);
    expect(isTrustedPrivateNetworkHostname("10.0.0.5")).toBe(true);
    expect(isTrustedPrivateNetworkHostname("100.88.12.34")).toBe(true);
    expect(isTrustedPrivateNetworkHostname("studio-machine.tailnet.ts.net")).toBe(true);
    expect(isTrustedPrivateNetworkHostname("8.8.8.8")).toBe(false);
  });

  it("accepts a private network request when the host is private", () => {
    const headers = new Headers();
    expect(isTrustedPrivateNetworkRequest(new URL("http://100.88.12.34:3000/studio"), headers)).toBe(true);
  });

  it("accepts a private network request when forwarded-for is private", () => {
    const headers = new Headers({ "x-forwarded-for": "100.101.102.103" });
    expect(isTrustedPrivateNetworkRequest(new URL("http://studio.example.test/studio"), headers)).toBe(true);
  });
});
