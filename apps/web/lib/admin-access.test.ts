import { describe, expect, it } from "vitest";

import { hasValidBasicAuthorization, isLoopbackHostname, isTrustedLocalRequest, parseBasicAuthorization } from "@/lib/admin-access";

describe("admin-access", () => {
  it("parses a valid basic authorization header", () => {
    const header = `Basic ${Buffer.from("studio:secret").toString("base64")}`;
    expect(parseBasicAuthorization(header)).toEqual({ username: "studio", password: "secret" });
    expect(hasValidBasicAuthorization(header, "studio", "secret")).toBe(true);
  });

  it("rejects malformed basic authorization headers", () => {
    expect(parseBasicAuthorization("Bearer token")).toBeNull();
    expect(hasValidBasicAuthorization(null, "studio", "secret")).toBe(false);
  });

  it("recognizes loopback hosts", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("localhost:3000")).toBe(true);
    expect(isLoopbackHostname("192.168.1.5")).toBe(false);
  });

  it("accepts only loopback requests when credentials are not configured", () => {
    expect(isTrustedLocalRequest(new URL("http://127.0.0.1:3000/studio"), new Headers())).toBe(true);
    expect(
      isTrustedLocalRequest(
        new URL("http://localhost:3000/studio"),
        new Headers({ "x-forwarded-for": "127.0.0.1" }),
      ),
    ).toBe(true);
    expect(
      isTrustedLocalRequest(
        new URL("http://127.0.0.1:3000/studio"),
        new Headers({ "x-forwarded-for": "203.0.113.8" }),
      ),
    ).toBe(false);
    expect(isTrustedLocalRequest(new URL("http://192.168.1.5:3000/studio"), new Headers())).toBe(false);
  });
});
