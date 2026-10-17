import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Focused runs never load repository .env files or write dependency caches.
  envDir: process.env.MEDIA_STUDIO_TEST_CACHE ? false : undefined,
  cacheDir: process.env.MEDIA_STUDIO_TEST_CACHE,
  test: {
    environment: "node",
    include: process.env.MEDIA_STUDIO_TEST_FILES ? JSON.parse(process.env.MEDIA_STUDIO_TEST_FILES) as string[] : [
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "hooks/**/*.test.ts",
      "hooks/**/*.test.tsx",
      "components/**/*.test.ts",
      "components/**/*.test.tsx",
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
