export function toControlApiProxyPath(pathValue: string | null | undefined) {
  if (!pathValue || !pathValue.startsWith("/files/")) {
    return null;
  }
  return `/api/control/files${pathValue.slice("/files".length)}`;
}

export function toControlApiDataProxyPath(filePath: string | null | undefined) {
  if (!filePath) {
    return null;
  }
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `/api/control/files/${normalized}`;
}

export function toControlApiDataPreviewPath(pathValue: string | null | undefined) {
  if (!pathValue) {
    return null;
  }
  const normalizedPath = pathValue.replaceAll("\\", "/");
  const knownRelativePrefixes = ["outputs/", "reference-media/", "downloads/", "uploads/"];

  if (!normalizedPath.startsWith("/")) {
    return toControlApiDataProxyPath(normalizedPath);
  }

  for (const marker of ["/runtime/control-api/data/", "/data/"]) {
    const markerIndex = normalizedPath.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }
    const relative = normalizedPath.slice(markerIndex + marker.length).replace(/^\/+/, "");
    if (!relative || relative.startsWith("../")) {
      continue;
    }
    if (knownRelativePrefixes.some((prefix) => relative.startsWith(prefix))) {
      return `/api/control/files/${relative}`;
    }
  }

  return toControlApiDataProxyPath(normalizedPath);
}
