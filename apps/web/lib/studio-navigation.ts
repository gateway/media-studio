export function buildStudioScopedHref(pathname: string, projectId?: string | null) {
  const [rawBasePath, rawQuery = ""] = pathname.split("?", 2);
  const basePath = rawBasePath.trim() || "/";
  const params = new URLSearchParams(rawQuery);
  const normalizedProjectId = String(projectId ?? "").trim();

  if (normalizedProjectId) {
    params.set("project", normalizedProjectId);
  } else {
    params.delete("project");
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function buildStudioGraphReturnHref(graphTabId?: string | null, projectId?: string | null) {
  const baseHref = buildStudioScopedHref("/studio", projectId);
  if (!graphTabId) {
    return baseHref;
  }
  const [basePath, rawQuery = ""] = baseHref.split("?", 2);
  const params = new URLSearchParams(rawQuery);
  params.set("graphTab", graphTabId);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function buildGraphStudioHref(graphTabId?: string | null) {
  if (!graphTabId) {
    return "/graph-studio";
  }
  const params = new URLSearchParams();
  params.set("tab", graphTabId);
  return `/graph-studio?${params.toString()}`;
}
