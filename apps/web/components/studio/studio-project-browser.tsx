"use client";

import {
  Archive,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { CalloutPanel, MediaBrowserCard, OverlayHeader, OverlayShell, SurfaceInputShell } from "@/components/ui/surface-primitives";
import type { MediaProject } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type ProjectDraft = {
  name: string;
  description: string;
  hiddenFromGlobalGallery?: boolean;
  coverAssetId?: string | null;
  coverReferenceId?: string | null;
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
  return { name: "", description: "", hiddenFromGlobalGallery: false };
}

function projectCoverUrl(project: MediaProject) {
  return project.cover_thumb_url ?? project.cover_image_url ?? null;
}

function ProjectCard({
  project,
  selected,
  busy,
  archived = false,
  onOpen,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  project: MediaProject;
  selected: boolean;
  busy: string | null;
  archived?: boolean;
  onOpen: () => void;
  onEdit?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}) {
  const coverUrl = projectCoverUrl(project);

  return (
    <MediaBrowserCard
      data-testid={`studio-project-card-${project.project_id}`}
      appearance="studio"
      selected={selected && !archived}
      muted={archived}
      className="shadow-[0_18px_40px_rgba(0,0,0,0.24)]"
    >
      <button
        type="button"
        onClick={onOpen}
        className="media-browser-card-thumbnail group relative aspect-square text-left"
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={project.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/44">
            <Folder className="size-8" />
          </div>
        )}
      </button>
      <div className="media-browser-card-copy">
        <div className="media-browser-card-title truncate">{project.name}</div>
        <div className="media-browser-card-description line-clamp-2 min-h-[2rem]">
          {project.description?.trim() || "No description yet."}
        </div>
      </div>
      <div className="media-browser-card-meta">
        Updated {project.updated_at ? formatDateTime(project.updated_at) : "recently"}
      </div>
      {project.hidden_from_global_gallery ? (
        <div className="media-browser-card-meta font-semibold uppercase tracking-[0.14em] text-[rgba(255,183,107,0.88)]">
          Hidden from main gallery
        </div>
      ) : null}
      <div className="media-browser-card-actions">
        <Button
          onClick={onOpen}
          variant="primary"
          size="compact"
          className="h-8 min-w-0 rounded-full px-3 text-[0.62rem] tracking-[0.12em] text-[#172200]"
        >
          <FolderOpen className="mr-1.5 size-3.5" />
          Open
        </Button>
        <div className="flex items-center gap-2">
          {archived ? (
            <>
              <IconButton
                icon={busy === `restore:${project.project_id}` ? LoaderCircle : RotateCcw}
                onClick={onRestore}
                disabled={busy === `restore:${project.project_id}`}
                iconClassName={busy === `restore:${project.project_id}` ? "animate-spin" : undefined}
                className="h-8 w-8 rounded-full"
                aria-label={`Restore ${project.name}`}
                title="Restore project"
              />
              <IconButton
                icon={busy === `delete:${project.project_id}` ? LoaderCircle : Trash2}
                onClick={onDelete}
                disabled={busy === `delete:${project.project_id}`}
                tone="danger"
                iconClassName={busy === `delete:${project.project_id}` ? "animate-spin" : undefined}
                className="h-8 w-8 rounded-full bg-[rgba(40,16,14,0.68)] text-[#ffb5a6]"
                aria-label={`Delete ${project.name}`}
                title="Delete permanently"
              />
            </>
          ) : (
            <>
              <IconButton
                icon={Pencil}
                onClick={onEdit}
                className="h-8 w-8 rounded-full"
                aria-label={`Edit ${project.name}`}
                title="Edit project"
              />
              <IconButton
                icon={busy === `archive:${project.project_id}` ? LoaderCircle : Archive}
                onClick={onArchive}
                disabled={busy === `archive:${project.project_id}`}
                iconClassName={busy === `archive:${project.project_id}` ? "animate-spin" : undefined}
                className="h-8 w-8 rounded-full"
                aria-label={`Archive ${project.name}`}
                title="Archive project"
              />
            </>
          )}
        </div>
      </div>
    </MediaBrowserCard>
  );
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [clearCover, setClearCover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeProjects = useMemo(
    () => projects.filter((project) => project.status !== "archived"),
    [projects],
  );
  const archivedProjects = useMemo(
    () => projects.filter((project) => project.status === "archived"),
    [projects],
  );

  useEffect(() => {
    return () => {
      if (coverPreviewUrl && coverPreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(coverPreviewUrl);
      }
    };
  }, [coverPreviewUrl]);

  function resetDialogState() {
    setEditingProjectId(null);
    setDraft(emptyDraft());
    setCoverFile(null);
    setClearCover(false);
    if (coverPreviewUrl && coverPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(null);
    setError(null);
  }

  function closeDialog() {
    setDialogOpen(false);
    resetDialogState();
  }

  function beginCreate() {
    setMode("create");
    resetDialogState();
    setDialogOpen(true);
  }

  function beginEdit(project: MediaProject) {
    setMode("edit");
    setEditingProjectId(project.project_id);
    setDraft({
      name: project.name,
      description: project.description ?? "",
      hiddenFromGlobalGallery: Boolean(project.hidden_from_global_gallery),
      coverReferenceId: project.cover_reference_id ?? undefined,
    });
    setCoverFile(null);
    setClearCover(false);
    if (coverPreviewUrl && coverPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(projectCoverUrl(project));
    setError(null);
    setDialogOpen(true);
  }

  async function uploadCoverReference(file: File) {
    const formData = new FormData();
    formData.set("file", file);
    const response = await fetch("/api/control/reference-media/import", {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      error?: string;
      item?: { reference_id?: string | null };
    };
    if (!response.ok || !payload.ok || !payload.item?.reference_id) {
      throw new Error(payload.error ?? "Unable to upload the project image.");
    }
    return payload.item.reference_id;
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
      const payload: ProjectDraft = {
        name: trimmedName,
        description: draft.description.trim(),
        hiddenFromGlobalGallery: Boolean(draft.hiddenFromGlobalGallery),
      };

      if (coverFile) {
        payload.coverAssetId = null;
        payload.coverReferenceId = await uploadCoverReference(coverFile);
      } else if (clearCover) {
        payload.coverAssetId = null;
        payload.coverReferenceId = null;
      } else if (draft.coverReferenceId !== undefined) {
        payload.coverReferenceId = draft.coverReferenceId;
      }

      if (mode === "create") {
        await onCreateProject(payload);
      } else if (editingProjectId) {
        await onUpdateProject(editingProjectId, payload);
      }
      closeDialog();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to save the project.");
    } finally {
      setBusyAction(null);
    }
  }

  function handleCoverFileChange(file: File | null) {
    if (!file) {
      return;
    }
    setCoverFile(file);
    setClearCover(false);
    if (coverPreviewUrl && coverPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(URL.createObjectURL(file));
  }

  function removeCover() {
    setCoverFile(null);
    setDraft((current) => ({ ...current, coverReferenceId: null }));
    setClearCover(true);
    if (coverPreviewUrl && coverPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(null);
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
    <OverlayShell
      backdropClassName="z-[121]"
      panelClassName="flex min-h-dvh min-w-0 flex-col lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:max-h-[calc(100dvh-3rem)] lg:overflow-hidden"
    >
        <div className="flex min-h-dvh min-w-0 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-4 md:px-6">
            <OverlayHeader
              appearance="studio"
              eyebrow="Projects"
              title="Projects"
              description="Create a workspace, enter it, and keep its outputs and attached references grouped together."
              actions={(
                <div className="flex items-center gap-2">
                  <Button
                    data-testid="studio-project-create-button"
                    variant="subtle"
                    size="compact"
                    onClick={beginCreate}
                    className="h-10 rounded-full px-4 text-[0.68rem] tracking-[0.12em]"
                  >
                    <Plus className="mr-1.5 size-3.5" />
                    Create Project
                  </Button>
                  <IconButton icon={X} onClick={onClose} aria-label="Close projects" className="h-10 w-10" />
                </div>
              )}
              className="w-full border-0 pb-0"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 md:px-6 md:py-6">
            {error ? (
              <CalloutPanel tone="danger" className="mb-4 rounded-[18px] px-4 py-3 text-sm">
                {error}
              </CalloutPanel>
            ) : null}

            <section className="mb-5">
              <div className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                Active Projects
              </div>
              {activeProjects.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {activeProjects.map((project) => (
                    <ProjectCard
                      key={project.project_id}
                      project={project}
                      selected={project.project_id === selectedProjectId}
                      busy={busyAction}
                      onOpen={() => onSelectProject(project.project_id)}
                      onEdit={() => beginEdit(project)}
                      onArchive={() =>
                        void runProjectAction(`archive:${project.project_id}`, () => onArchiveProject(project.project_id))
                      }
                    />
                  ))}
                </div>
              ) : (
                <CalloutPanel tone="muted" className="rounded-[20px] px-4 py-8 text-sm leading-6 text-white/58">
                  No projects yet. Create one and Studio will start assigning new work to it.
                </CalloutPanel>
              )}
            </section>

            {archivedProjects.length ? (
              <section>
                <div className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-white/54">
                  Archived
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                  {archivedProjects.map((project) => (
                    <ProjectCard
                      key={project.project_id}
                      project={project}
                      selected={false}
                      busy={busyAction}
                      archived
                      onOpen={() => {}}
                      onRestore={() =>
                        void runProjectAction(`restore:${project.project_id}`, () => onUnarchiveProject(project.project_id))
                      }
                      onDelete={() =>
                        void runProjectAction(`delete:${project.project_id}`, () => onDeleteProject(project.project_id))
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>

      {dialogOpen ? (
        <OverlayShell backdropClassName="z-[122]" innerClassName="flex min-h-dvh items-center justify-center p-4" panelClassName="w-full max-w-[36rem] p-5 md:p-6">
              <OverlayHeader
                appearance="studio"
                eyebrow={mode === "create" ? "Create Project" : "Edit Project"}
                title={mode === "create" ? "Create Project" : "Edit Project"}
                description="Add a name, a description, and an optional image to make the workspace easier to recognize."
                actions={<IconButton icon={X} onClick={closeDialog} aria-label="Close project dialog" className="h-10 w-10" />}
                className="mb-5 border-0 pb-0"
              />

              <div className="grid gap-4">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-white/76">Name</span>
                  <SurfaceInputShell className="px-4">
                    <input
                      data-testid="studio-project-name-input"
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                      className="surface-input-control h-11 text-sm"
                      placeholder="Campaign launch, client brief, concept board..."
                    />
                  </SurfaceInputShell>
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-white/76">Description</span>
                  <SurfaceInputShell className="px-4 py-3">
                    <textarea
                      data-testid="studio-project-description-input"
                      value={draft.description}
                      onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                      rows={5}
                      className="surface-input-control resize-none text-sm leading-6"
                      placeholder="What content belongs in this workspace, what references it uses, and what the goal is."
                    />
                  </SurfaceInputShell>
                </label>

                <button
                  type="button"
                  data-testid="studio-project-hide-global-toggle"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      hiddenFromGlobalGallery: !current.hiddenFromGlobalGallery,
                    }))
                  }
                  className="flex items-start justify-between gap-4 rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-4 text-left transition hover:bg-white/[0.05]"
                >
                  <div>
                    <div className="text-sm font-medium text-white/86">Hide from main gallery</div>
                    <div className="mt-1 text-sm leading-6 text-white/58">
                      Keep this project and its media out of the global gallery and global filters. It will only show inside the project workspace.
                    </div>
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full border transition",
                      draft.hiddenFromGlobalGallery
                        ? "border-[rgba(216,141,67,0.48)] bg-[rgba(216,141,67,0.22)]"
                        : "border-white/12 bg-white/[0.06]",
                    )}
                  >
                    <span
                      className={cn(
                        "m-[2px] h-5 w-5 rounded-full transition",
                        draft.hiddenFromGlobalGallery
                          ? "translate-x-[20px] bg-[rgba(255,183,107,0.98)]"
                          : "translate-x-0 bg-white/82",
                      )}
                    />
                  </div>
                </button>

                <div className="grid gap-2">
                  <span className="text-sm font-medium text-white/76">Image (optional)</span>
                  <CalloutPanel tone="default" className="flex items-start gap-4 rounded-[18px] p-4">
                    <div className="media-browser-card-thumbnail h-24 w-24 shrink-0">
                      {coverPreviewUrl ? (
                        <img src={coverPreviewUrl} alt="Project cover preview" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/42">
                          <ImageIcon className="size-6" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm leading-6 text-white/62">
                        Upload an image to use as the project cover. This is only for organization and visual identity.
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          data-testid="studio-project-upload-button"
                          variant="subtle"
                          size="compact"
                          onClick={() => fileInputRef.current?.click()}
                          className="h-9 rounded-full px-4 text-[0.66rem] tracking-[0.12em]"
                        >
                          <Upload className="mr-1.5 size-3.5" />
                          {coverPreviewUrl ? "Replace image" : "Upload image"}
                        </Button>
                        {coverPreviewUrl ? (
                          <Button
                            variant="ghost"
                            size="compact"
                            onClick={removeCover}
                            className="h-9 rounded-full px-4 text-[0.66rem] tracking-[0.12em]"
                          >
                            Remove image
                          </Button>
                        ) : null}
                      </div>
                      <input
                        data-testid="studio-project-cover-input"
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => handleCoverFileChange(event.target.files?.[0] ?? null)}
                      />
                    </div>
                  </CalloutPanel>
                </div>

                {error ? <CalloutPanel tone="danger" className="text-sm">{error}</CalloutPanel> : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    data-testid={mode === "create" ? "studio-project-submit-create" : "studio-project-submit-save"}
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
                  <Button
                    variant="subtle"
                    size="compact"
                    onClick={closeDialog}
                    disabled={busyAction != null}
                    className="h-10 rounded-full px-4 text-[0.68rem] tracking-[0.12em]"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
        </OverlayShell>
      ) : null}
    </OverlayShell>
  );
}
