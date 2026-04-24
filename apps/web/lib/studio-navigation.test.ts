import { describe, expect, it } from "vitest";

import { buildStudioScopedHref } from "./studio-navigation";

describe("studio-navigation", () => {
  it("adds the project query when a project is active", () => {
    expect(buildStudioScopedHref("/studio", "project-123")).toBe("/studio?project=project-123");
  });

  it("preserves existing query params while adding project context", () => {
    expect(buildStudioScopedHref("/jobs?page=2&perPage=50", "project-123")).toBe(
      "/jobs?page=2&perPage=50&project=project-123",
    );
  });

  it("replaces a stale project query", () => {
    expect(buildStudioScopedHref("/settings?project=old-project", "project-123")).toBe(
      "/settings?project=project-123",
    );
  });

  it("removes the project query when no project is active", () => {
    expect(buildStudioScopedHref("/studio?project=project-123&asset=asset-1", null)).toBe(
      "/studio?asset=asset-1",
    );
  });
});
