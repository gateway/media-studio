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
