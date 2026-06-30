import { describe, expect, it } from "vitest";

import { mediaStudioAllowedDevOrigins } from "./allowed-dev-origins";

describe("mediaStudioAllowedDevOrigins", () => {
  it("keeps localhost as the default dev origin set", () => {
    expect(mediaStudioAllowedDevOrigins({}, {})).toEqual(["127.0.0.1", "localhost"]);
  });

  it("normalizes explicit dev origins from env", () => {
    expect(
      mediaStudioAllowedDevOrigins(
        { MEDIA_STUDIO_ALLOWED_DEV_ORIGINS: "http://100.64.157.91:3000, studio.local:3000" },
        {},
      ),
    ).toEqual(["127.0.0.1", "localhost", "100.64.157.91", "studio.local"]);
  });

  it("adds non-internal IPv4 interfaces when private network access is enabled", () => {
    expect(
      mediaStudioAllowedDevOrigins(
        { MEDIA_STUDIO_ALLOW_PRIVATE_NETWORK_ACCESS: "true" },
        {
          lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
          tailscale0: [{ address: "100.64.157.91", family: "IPv4", internal: false }],
          en0: [{ address: "192.168.1.20", family: 4, internal: false }],
        },
      ),
    ).toEqual(["127.0.0.1", "localhost", "100.64.157.91", "192.168.1.20"]);
  });
});
