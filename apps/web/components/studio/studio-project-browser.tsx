"use client";

import { Archive, FolderOpen, LoaderCircle, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { overlayBackdropClassName, overlayPanelClassName, softPanelClassName } from "@/components/ui/surfaces";
import type { MediaProject } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type ProjectDraft = {
  name: string;
  description: string;
};

type StudioProjectBrowserProps = {
  projects: MediaProject[];
  selectedProjectId: string | null;
  onClose: () => void;
  onSelectProject: (projectId: string | null) => void;
  onCreateProject: (draft: ProjectDraft) => Promise<void>;
  onUpdateProject: (projectId: string, draft: ProjectDraft) => Promise<void>;
  onArchiveProject: (projectId: string) => Promise<void>;
  onUnarchiveProject: (projectId: string) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
};

function emptyDraft(): ProjectDraft {
  return { name: "", description: "" };
}

export function StudioProjectBrowser({
  projects,
  selectedProjectId,
  onClose,
  onSelectProject,
  onCreateProject,
  onUpdateProject,
  onArchiveProject,
  onUnarchiveProject,
  onDeleteProject,
}: StudioProjectBrowserProps) {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "edit">("create");

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status !== "archived"),
    [projects],
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => project.status === "archived"),
    [projects],
  );

  useEffect(() => {
    if (mode !== "edit" || !editingProjectId) {
      return;
    }
    const project = projects.find((item) => item.project_id === editingProjectId);
    if (!project) {
      setMode("create");
      setEditingProjectId(null);
      setDraft(emptyDraft());
      return;
    }
    setDraft({
      name: project.name,
      description: project.description ?? "",
    });
  }, [editingProjectId, mode, projects]);

  function beginCreate() {
    setMode("create");
    setEditingProjectId(null);
    setDraft(emptyDraft());
    setError(null);
  }

  function beginEdit(project: MediaProject) {
    setMode("edit");
    setEditingProjectId(project.project_id);
    setDraft({ name: project.name, description: project.description ?? "" });
    setError(null);
  }

  async function handleSubmit() {
    setError(null);
    const trimmedName = draft.name.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return;
    }
    try {
      setBusyAction(mode === "create" ? "create" : `save:${editingProjectId}`);
      if (mode === "create") {
        await onCreateProject({
          name: trimmedName,
          description: draft.description.trim(),
        });
        beginCreate();
      } else if (editingProjectId) {
        await onUpdateProject(editingProjectId, {
          name: trimmedName,
          description: draft.description.trim(),
        });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save the project.");
    } finally {
      setBusyAction(null);
    }
  }

  async function runProjectAction(actionKey: string, callback: () => Promise<void>) {
    setError(null);
    try {
      setBusyAction(actionKey);
      await callback();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update the project.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className={cn(overlayBackdropClassName, "z-[121]")}>
      <div className="min-h-dvh p-0 lg:p-6">
        <div
          className={cn(
            "flex min-h-dvh min-w-0 flex-col lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[34px]",
            overlayPanelClassName,
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-4 md:px-6">
            <div>
              <div className="text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[rgba(208,255,72,0.94)]">
                Projects
              </div>
              <div className="mt-1 text-sm text-white/68">
                Create a workspace, enter it, and keep its outputs and attached references grouped together.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="subtle"
                size="compact"
                onClick={() => onSelectProject(null)}
                className="h-10 rounded-full px-4 text-[0.68rem] tracking-[0.12em]"
              >
                All media
              </Button>
              <IconButton icon={X} onClick={onClose} aria-label="Close projects" className="h-10 w-10" />
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden px-4 py-4 md:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)] md:px-6 md:py-6">
            <div className="min-h-0 overflow-y-auto">
              <div className="grid gap-4">
                <section className={cn(softPanelClassName, "rounded-[24px] p-4")}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                      Active Projects
                    </div>
                    <Button
                      variant="subtle"
                      size="compact"
                      onClick={beginCreate}
                      className="h-8 rounded-full px-3 text-[0.64rem] tracking-[0.12em]"
                    >
                      <Plus className="mr-1.5 size-3.5" />
                      New project
                    </Button>
                  </div>
                  <div className="grid gap-3">
                    {activeProjects.length ? (
                      activeProjects.map((project) => {
                        const selected = project.project_id === selectedProjectId;
                        return (
                          <div
                            key={project.project_id}
                            className={cn(
                              "rounded-[20px] border px-4 py-4 transition",
                              selected
                                ? "border-[rgba(208,255,72,0.28)] bg-[rgba(208,255,72,0.08)]"
                                : "border-white/8 bg-white/[0.03]",
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-base font-semibold text-white">{project.name}</div>
                                <div className="mt-1 text-sm leading-6 text-white/58">
                                  {project.description?.trim() || "No description yet."}
                                </div>
                              </div>
                              {selected ? (
                                <span className="rounded-full border border-[rgba(208,255,72,0.24)] bg-[rgba(208,255,72,0.12)] px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[rgba(208,255,72,0.92)]">
                                  Active
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.68rem] text-white/45">
                              <span>Updated {project.updated_at ? formatDateTime(project.updated_at) : "recently"}</span>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Button
                                variant="primary"
                                size="compact"
                                onClick={() => onSelectProject(project.project_id)}
                                className="h-9 rounded-full px-4 text-[0.66rem] tracking-[0.12em] text-[#172200]"
                              >
                                <FolderOpen className="mr-1.5 size-3.5" />
                                Open project
                              </Button>
                              <Button
                                variant="subtle"
                                size="compact"
                                onClick={() => beginEdit(project)}
                                className="h-9 rounded-full px-4 text-[0.66rem] tracking-[0.12em]"
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="compact"
                                onClick={() => void runProjectAction(`archive:${project.project_id}`, () => onArchiveProject(project.project_id))}
                                disabled={busyAction === `archive:${project.project_id}`}
                                className="h-9 rounded-full px-4 text-[0.66rem] tracking-[0.12em]"
                              >
                                {busyAction === `archive:${project.project_id}` ? (
                                  <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                                ) : (
                                  <Archive className="mr-1.5 size-3.5" />
                                )}
                                Archive
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-sm leading-6 text-white/58">
                        No projects yet. Create one and Studio will start assigning new work to it.
                      </div>
                    )}
                  </div>
                </section>

                {archivedProjects.length ? (
                  <section className={cn(softPanelClassName, "rounded-[24px] p-4")}>
                    <div className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                      Archived
                    </div>
                    <div className="grid gap-3">
                      {archivedProjects.map((project) => (
                        <div key={project.project_id} className="rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-4">
                          <div className="text-sm font-semibold text-white">{project.name}</div>
                          <div className="mt-1 text-sm leading-6 text-white/54">
                            {project.description?.trim() || "No description yet."}
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              variant="subtle"
                              size="compact"
                              onClick={() => void runProjectAction(`restore:${project.project_id}`, () => onUnarchiveProject(project.project_id))}
                              disabled={busyAction === `restore:${project.project_id}`}
                              className="h-9 rounded-full px-4 text-[0.66rem] tracking-[0.12em]"
                            >
                              {busyAction === `restore:${project.project_id}` ? (
                                <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="mr-1.5 size-3.5" />
                              )}
                              Restore
                            </Button>
                            <Button
                              variant="danger"
                              size="compact"
                              onClick={() => void runProjectAction(`delete:${project.project_id}`, () => onDeleteProject(project.project_id))}
                              disabled={busyAction === `delete:${project.project_id}`}
                              className="h-9 rounded-full px-4 text-[0.66rem] tracking-[0.12em]"
                            >
                              {busyAction === `delete:${project.project_id}` ? (
                                <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="mr-1.5 size-3.5" />
                              )}
                              Delete permanently
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto">
              <section className={cn(softPanelClassName, "rounded-[24px] p-4")}>
                <div className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                  {mode === "create" ? "Create Project" : "Edit Project"}
                </div>
                <div className="mt-4 grid gap-4">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-white/76">Name</span>
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                      className="h-11 rounded-[16px] border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none transition focus:border-[rgba(208,255,72,0.28)]"
                      placeholder="Campaign launch, client brief, concept board..."
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-white/76">Description</span>
                    <textarea
                      value={draft.description}
                      onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                      rows={5}
                      className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-white outline-none transition focus:border-[rgba(208,255,72,0.28)]"
                      placeholder="What content belongs in this workspace, what references it uses, and what the goal is."
                    />
                  </label>
                  {error ? <div className="text-sm text-[#ff9c8f]">{error}</div> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      size="compact"
                      onClick={() => void handleSubmit()}
                      disabled={busyAction != null}
                      className="h-10 rounded-full px-4 text-[0.68rem] tracking-[0.12em] text-[#172200]"
                    >
                      {busyAction === "create" || busyAction?.startsWith("save:") ? (
                        <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                      ) : null}
                      {mode === "create" ? "Create project" : "Save changes"}
                    </Button>
                    {mode === "edit" ? (
                      <Button
                        variant="subtle"
                        size="compact"
                        onClick={beginCreate}
                        disabled={busyAction != null}
                        className="h-10 rounded-full px-4 text-[0.68rem] tracking-[0.12em]"
                      >
                        Cancel edit
                      </Button>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
