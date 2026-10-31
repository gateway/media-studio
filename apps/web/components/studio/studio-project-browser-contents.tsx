"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { PillSelect } from "@/components/ui/pill-select";
import { ArrowDownUp, CalendarDays } from "lucide-react";
import {
  StudioBrowserToolbar,
  StudioBrowserSearchInput,
} from "./studio-browser-surface";
import { StudioProjectRow } from "./studio-project-row";
import {
  filterProjects,
  projectDateChoices,
  projectSortChoices,
  type ProjectDateFilter,
  type ProjectSort,
} from "./studio-project-browser-filter";
import type { MediaProject } from "@/lib/types";
export function StudioProjectBrowserContents({
  projects,
  selectedProjectId,
  busyAction,
  onSelectProject,
  onEdit,
  onAction,
}: {
  projects: MediaProject[];
  selectedProjectId: string | null;
  busyAction: string | null;
  onSelectProject: (id: string | null) => void;
  onEdit: (project: MediaProject) => void;
  onAction: (action: "archive" | "restore" | "delete", id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<ProjectDateFilter>("all");
  const [sort, setSort] = useState<ProjectSort>("recent");
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const filteredProjects = useMemo(
    () => filterProjects(projects, query, dateFilter, sort),
    [projects, query, dateFilter, sort],
  );
  const activeProjects = filteredProjects.filter(
    (project) => project.status !== "archived",
  );
  const archivedProjects = filteredProjects.filter(
    (project) => project.status === "archived",
  );
  return (
    <>
      <StudioBrowserToolbar>
        <div className="studio-project-filters">
          <StudioBrowserSearchInput
            id="project-search"
            label="Search projects by name"
            placeholder="Search projects by name…"
            value={query}
            onChange={setQuery}
          />
          <PillSelect
            appearance="admin"
            pickerId="project-date"
            icon={CalendarDays}
            label={
              projectDateChoices.find((choice) => choice.value === dateFilter)!
                .label
            }
            menuTitle="Updated date"
            choices={projectDateChoices}
            selectedValue={dateFilter}
            open={openFilter === "date"}
            onToggle={() =>
              setOpenFilter(openFilter === "date" ? null : "date")
            }
            onClose={() => setOpenFilter(null)}
            onSelect={(value) => {
              setDateFilter(value as ProjectDateFilter);
              setOpenFilter(null);
            }}
          />
          <PillSelect
            appearance="admin"
            pickerId="project-sort"
            icon={ArrowDownUp}
            label={
              projectSortChoices.find((choice) => choice.value === sort)!.label
            }
            menuTitle="Sort projects"
            choices={projectSortChoices}
            selectedValue={sort}
            open={openFilter === "sort"}
            onToggle={() =>
              setOpenFilter(openFilter === "sort" ? null : "sort")
            }
            onClose={() => setOpenFilter(null)}
            onSelect={(value) => {
              setSort(value as ProjectSort);
              setOpenFilter(null);
            }}
          />
        </div>
      </StudioBrowserToolbar>
      {filteredProjects.length === 0 ? (
        <div className="studio-browser-state">
          {projects.length
            ? "No projects match these filters."
            : "No projects yet. Create one to organize your work."}
          {projects.length > 0 ? (
            <Button
              appearance="admin"
              variant="ghost"
              onClick={() => {
                setQuery("");
                setDateFilter("all");
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}
      {[
        { label: "Active projects", projects: activeProjects },
        { label: "Archived", projects: archivedProjects },
      ].map((section) =>
        section.projects.length > 0 ? (
          <section className="studio-project-section" key={section.label}>
            <div className="studio-project-section-heading">
              <h3>
                {section.label} ({section.projects.length})
              </h3>
              <span>Updated</span>
            </div>
            <div className="studio-project-list">
              {section.projects.map((project) => (
                <StudioProjectRow
                  key={project.project_id}
                  project={project}
                  selected={project.project_id === selectedProjectId}
                  busy={busyAction}
                  archived={project.status === "archived"}
                  onOpen={() => onSelectProject(project.project_id)}
                  onEdit={() => onEdit(project)}
                  onArchive={() => onAction("archive", project.project_id)}
                  onRestore={() => onAction("restore", project.project_id)}
                  onDelete={() => onAction("delete", project.project_id)}
                />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </>
  );
}
