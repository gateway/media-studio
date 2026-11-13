import "server-only";

import path from "node:path";

export function resolveThumbnailRelativePath(
  thumbnailPath: string | null | undefined,
  storagePrefix: RegExp,
) {
  const normalized = String(thumbnailPath ?? "").trim().replace(/^\/+/, "");
  if (!normalized) return null;
  const safePath = path.normalize(normalized)
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(storagePrefix, "");
  return safePath && !safePath.startsWith("..") ? safePath : null;
}
