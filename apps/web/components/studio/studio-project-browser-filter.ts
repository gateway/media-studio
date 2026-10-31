import type { MediaProject } from "@/lib/types";

export type ProjectDateFilter = "all" | "today" | "7" | "30";
export type ProjectSort = "recent" | "oldest" | "name";
export const projectDateChoices = [
  { value: "all", label: "Updated: Any time" },
  { value: "today", label: "Updated: Today" },
  { value: "7", label: "Updated: Last 7 days" },
  { value: "30", label: "Updated: Last 30 days" },
];
export const projectSortChoices = [
  { value: "recent", label: "Recently updated" },
  { value: "oldest", label: "Oldest updated" },
  { value: "name", label: "Name A–Z" },
];
function updatedTime(project: MediaProject) {
  const time = project.updated_at ? Date.parse(project.updated_at) : NaN;
  return Number.isFinite(time) ? time : null;
}
/** Date windows include today and the preceding N-1 local calendar days. Unknown dates sort last. */
export function filterProjects(
  projects: MediaProject[],
  query: string,
  date: ProjectDateFilter,
  sort: ProjectSort,
  now = new Date(),
) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (date === "7" || date === "30")
    start.setDate(start.getDate() - Number(date) + 1);
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const name = query.trim().toLocaleLowerCase();
  return projects
    .filter((project) => {
      if (!project.name.toLocaleLowerCase().includes(name)) return false;
      const time = updatedTime(project);
      return (
        date === "all" ||
        (time !== null && time >= start.getTime() && time < end.getTime())
      );
    })
    .sort((a, b) => {
      const byName =
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.project_id.localeCompare(b.project_id);
      if (sort === "name") return byName;
      const left = updatedTime(a);
      const right = updatedTime(b);
      if (left === null) return right === null ? byName : 1;
      if (right === null) return -1;
      return (sort === "recent" ? right - left : left - right) || byName;
    });
}
