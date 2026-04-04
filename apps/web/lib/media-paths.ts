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
  if (!pathValue.includes("/runtime/control-api/data/")) {
    return toControlApiDataProxyPath(pathValue);
  }
  const marker = "/runtime/control-api/data/";
  const markerIndex = pathValue.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const relative = pathValue.slice(markerIndex + marker.length).replaceAll("\\", "/");
  if (!relative || relative.startsWith("../")) {
    return null;
  }
  return `/api/control/files/${relative}`;
}
