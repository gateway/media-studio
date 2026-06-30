import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

import { mediaStudioAllowedDevOrigins } from "./lib/allowed-dev-origins";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: mediaStudioAllowedDevOrigins(process.env, networkInterfaces()),
  env: {
    NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG:
      process.env.NEXT_PUBLIC_MEDIA_STUDIO_ASSISTANT_DEBUG ?? "",
  },
  experimental: {
    proxyClientMaxBodySize: "100mb",
  },
};

export default nextConfig;
