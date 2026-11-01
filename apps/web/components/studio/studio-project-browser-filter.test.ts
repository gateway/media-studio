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
  it("combines search with each calendar window across a month boundary", () => {
    const now = new Date(2026, 10, 1, 12);
    const midnight = (month: number, day: number) => new Date(2026, month, day).getTime();
    const at = (time: number) => new Date(time).toISOString();
    const projects = [
      project("today", "Sadi", at(midnight(10, 1))),
      project("week", "Sadi week", at(midnight(9, 26))),
      project("before-week", "Sadi older", at(midnight(9, 26) - 1)),
      project("month", "Sadi month", at(midnight(9, 3))),
      project("before-month", "Sadi old", at(midnight(9, 3) - 1)),
      project("other", "Other", at(midnight(10, 1))),
      project("tomorrow", "Sadi future", at(midnight(10, 2))),
    ];
    expect(ids(filterProjects(projects, "  SADI ", "today", "recent", now))).toEqual(["today"]);
    expect(ids(filterProjects(projects, "sadi", "7", "oldest", now))).toEqual(["week", "today"]);
    expect(ids(filterProjects(projects, "sadi", "30", "recent", now))).toEqual(["today", "week", "before-week", "month"]);
    expect(filterProjects(projects, "missing", "30", "name", now)).toEqual([]);
    expect(filterProjects(projects, "sadi", "all", "name", now)).toHaveLength(6);
  });
  it("breaks equal activity dates by name and ID for both date sorts", () => {
    const projects = [project("z", "Alpha", "2026-11-01"), project("a", "Alpha", "2026-11-01"), project("b", "Beta", "2026-11-01")];
    for (const sort of ["recent", "oldest", "name"] as const) {
      expect(ids(filterProjects(projects, "", "all", sort))).toEqual(["a", "z", "b"]);
    }
  });

});
