import { describe, expect, it } from "vitest";
import { filterProjects } from "./studio-project-browser-filter";
import type { MediaProject } from "@/lib/types";
const project = (id: string, name: string, updated_at?: string): MediaProject => ({ project_id: id, name, status: "active", updated_at });
const ids = (items: MediaProject[]) => items.map((item) => item.project_id);
describe("project browsing filters", () => {
  it("combines case-insensitive name filtering with stable sorts without mutating records", () => {
    const projects = [project("a", "Zebra", "2026-10-01"), project("b", "Alpha", "2026-10-10"), project("c", "Alpha")];
    expect(ids(filterProjects(projects, "  ALP ", "all", "recent"))).toEqual(["b", "c"]);
    expect(ids(filterProjects(projects, "", "all", "oldest"))).toEqual(["a", "b", "c"]);
    expect(ids(filterProjects(projects, "", "all", "name"))).toEqual(["b", "c", "a"]);
    expect(ids(projects)).toEqual(["a", "b", "c"]);
  });
  it("uses inclusive local calendar-day starts and excludes tomorrow and missing dates", () => {
    const now = new Date(2026, 9, 30, 12);
    const at = (day: number, hour = 0) => new Date(2026, 9, day, hour).toISOString();
    const projects = [project("today", "Today", at(30)), project("tomorrow", "Tomorrow", at(31)), project("week", "Week", at(24)), project("old", "Old", at(23, 23)), project("month", "Month", at(1)), project("unknown", "Unknown", "invalid")];
    expect(ids(filterProjects(projects, "", "today", "recent", now))).toEqual(["today"]);
    expect(ids(filterProjects(projects, "", "7", "recent", now))).toEqual(["today", "week"]);
    expect(ids(filterProjects(projects, "", "30", "oldest", now))).toEqual(["month", "old", "week", "today"]);
    expect(ids(filterProjects(projects, "", "all", "recent", now)).at(-1)).toBe("unknown");
  });
});
