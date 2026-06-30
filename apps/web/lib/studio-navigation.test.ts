import { describe, expect, it } from "vitest";

import { buildGraphStudioHref, buildStudioGraphReturnHref, buildStudioScopedHref } from "./studio-navigation";

describe("studio navigation helpers", () => {
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

  it("builds a Studio return href that preserves the graph tab id", () => {
    expect(buildStudioGraphReturnHref("tab-7")).toBe("/studio?graphTab=tab-7");
    expect(buildStudioGraphReturnHref("tab-7", "project-1")).toBe("/studio?project=project-1&graphTab=tab-7");
  });

  it("falls back to the normal Studio href when no graph tab id exists", () => {
    expect(buildStudioGraphReturnHref(null, "project-1")).toBe(buildStudioScopedHref("/studio", "project-1"));
  });

  it("builds a Graph Studio href that targets a specific tab", () => {
    expect(buildGraphStudioHref("tab-9")).toBe("/graph-studio?tab=tab-9");
    expect(buildGraphStudioHref("")).toBe("/graph-studio");
  });
});
