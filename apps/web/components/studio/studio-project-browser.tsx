"use client";

import { LoaderCircle, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { IconButton } from "@/components/ui/icon-button";
import {
  CalloutPanel,
  OverlayHeader,
  OverlayShell,
} from "@/components/ui/surface-primitives";
import {
  GeneratedThumbnailPickerDialog,
  type GeneratedThumbnailPickerItem,
} from "@/components/media/generated-thumbnail-picker-dialog";
import {
  fetchGeneratedImagePickerPage,
  generatedImagePickerItem,
} from "@/components/media/media-image-picker-sources";
import { useMediaImagePickerPagination } from "@/components/media/use-media-image-picker-pagination";
import { ThumbnailField } from "@/components/media/thumbnail-field";
import type { MediaAssetPickerItem, MediaProject } from "@/lib/types";
import {
  AdminInput,
  AdminTextarea,
  AdminToggleRow,
} from "@/components/admin-controls";

import { StudioBrowserOverlay } from "./studio-browser-surface";
import { StudioProjectBrowserContents } from "./studio-project-browser-contents";

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
  const [coverAssetSelectionId, setCoverAssetSelectionId] = useState<
    string | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverPicker = useMediaImagePickerPagination<MediaAssetPickerItem>({
    fetchPage: fetchGeneratedImagePickerPage,
    getItemId: (asset) => String(asset.asset_id),
    onError: setError,
  });

  const coverPickerItems: GeneratedThumbnailPickerItem[] = coverPicker.items
    .map((asset) => {
      const item = generatedImagePickerItem(asset);
      return item
        ? {
            ...item,
            ariaLabel: `Use generated image ${item.id} as project image`,
          }
        : null;
    })
    .filter((item): item is GeneratedThumbnailPickerItem => Boolean(item));

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
    coverPicker.closePicker();
    setCoverAssetSelectionId(null);
    setError(null);
  }

  function closeDialog() {
    setDialogOpen(false);
    resetDialogState();
  }

  const editorRef = useDialogFocus(() => {
    if (!busyAction) closeDialog();
  }, !dialogOpen || coverPicker.open);

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
      coverAssetId: project.cover_asset_id ?? undefined,
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
      } else if (draft.coverAssetId !== undefined) {
        payload.coverAssetId = draft.coverAssetId;
        payload.coverReferenceId = draft.coverReferenceId ?? null;
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
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to save the project.",
      );
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
    setDraft((current) => ({ ...current, coverAssetId: null }));
    if (coverPreviewUrl && coverPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(URL.createObjectURL(file));
  }

  function removeCover() {
    setCoverFile(null);
    setDraft((current) => ({
      ...current,
      coverAssetId: null,
      coverReferenceId: null,
    }));
    setClearCover(true);
    if (coverPreviewUrl && coverPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(null);
  }

  function applyCoverFromAsset(assetId: string | number) {
    const selectedAsset = coverPicker.items.find(
      (asset) => String(asset.asset_id) === String(assetId),
    );
    const previewUrl =
      generatedImagePickerItem(selectedAsset)?.previewUrl ?? null;
    setCoverAssetSelectionId(String(assetId));
    setCoverFile(null);
    setClearCover(false);
    setDraft((current) => ({
      ...current,
      coverAssetId: String(assetId),
      coverReferenceId: null,
    }));
    if (coverPreviewUrl && coverPreviewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(previewUrl);
    coverPicker.closePicker();
    setCoverAssetSelectionId(null);
  }

  async function runProjectAction(
    actionKey: string,
    callback: () => Promise<void>,
  ) {
    setError(null);
    try {
      setBusyAction(actionKey);
      await callback();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to update the project.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <StudioBrowserOverlay
        testId="studio-project-browser"
        zIndexClassName="z-[121]"
        layout="list"
        title="Projects"
        description="Your workspaces, outputs, and references."
        onClose={() => {
          if (!busyAction) onClose();
        }}
        suspended={dialogOpen}
        actions={
          <>
            <Button
              appearance="admin"
              data-testid="studio-project-create-button"
              variant="primary"
              onClick={beginCreate}
            >
              <Plus className="mr-2 size-4" />
              Create project
            </Button>
            <IconButton
              appearance="admin"
              quiet
              icon={X}
              onClick={onClose}
              aria-label="Close projects"
            />
          </>
        }
      >
        {error ? (
          <CalloutPanel tone="danger" className="mb-4">
            {error}
          </CalloutPanel>
        ) : null}
        <StudioProjectBrowserContents
          projects={projects}
          selectedProjectId={selectedProjectId}
          busyAction={busyAction}
          onSelectProject={onSelectProject}
          onEdit={beginEdit}
          onAction={(action, id) => {
            const callbacks = {
              archive: onArchiveProject,
              restore: onUnarchiveProject,
              delete: onDeleteProject,
            };
            runProjectAction(`${action}:${id}`, () =>
              callbacks[action](id),
            ).catch((error: unknown) => setError(String(error)));
          }}
        />
      </StudioBrowserOverlay>

      {dialogOpen ? (
        <OverlayShell
          backdropClassName="admin-theme-root studio-browser-theme z-[122]"
          innerClassName="flex min-h-dvh items-center justify-center p-4"
          panelClassName="w-full max-w-[36rem] p-5 md:p-6"
        >
          <div
            ref={editorRef}
            role="dialog"
            aria-modal={!coverPicker.open || undefined}
            aria-label={mode === "create" ? "Create project" : "Edit project"}
            tabIndex={-1}
            inert={coverPicker.open || undefined}
          >
            <OverlayHeader
              appearance="admin"
              eyebrow={mode === "create" ? "Create Project" : "Edit Project"}
              title={mode === "create" ? "Create Project" : "Edit Project"}
              description="Add a name, a description, and an optional image to make the workspace easier to recognize."
              actions={
                <IconButton
                  appearance="admin"
                  quiet
                  icon={X}
                  onClick={closeDialog}
                  aria-label="Close project dialog"
                  className="h-10 w-10"
                />
              }
              className="mb-5 border-0 pb-0"
            />

            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className="studio-field-label">Name</span>

                <AdminInput
                  data-testid="studio-project-name-input"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Campaign launch, client brief, concept board..."
                />
              </label>
              <label className="grid gap-2">
                <span className="studio-field-label">Description</span>

                <AdminTextarea
                  data-testid="studio-project-description-input"
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  rows={5}
                  placeholder="What content belongs in this workspace, what references it uses, and what the goal is."
                />
              </label>

              <AdminToggleRow
                title="Hide from main gallery"
                ariaLabel="Hide from main gallery"
                description="Keep this project and its media out of the global gallery and global filters. It will only show inside the project workspace."
                checked={Boolean(draft.hiddenFromGlobalGallery)}
                onToggle={() =>
                  setDraft((current) => ({
                    ...current,
                    hiddenFromGlobalGallery: !current.hiddenFromGlobalGallery,
                  }))
                }
              />

              <CalloutPanel tone="default" className="rounded-[18px] p-4">
                <ThumbnailField
                  label="Image (optional)"
                  imageUrl={coverPreviewUrl}
                  imageAlt="Project cover preview"
                  emptyLabel="No project image"
                  chooseLabel="Choose from generated images"
                  browseLabel="Browse generated images"
                  uploadLabel={
                    coverPreviewUrl ? "Replace image" : "Upload image"
                  }
                  removeLabel="Remove image"
                  appearance="admin"
                  aspect="square"
                  surface={false}
                  inputRef={fileInputRef}
                  isBrowsing={coverPicker.loading}
                  onChoose={coverPicker.openPicker}
                  onUploadFile={handleCoverFileChange}
                  onRemove={removeCover}
                />
                <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                  Add an image to make this project easier to recognize.
                </p>
              </CalloutPanel>

              {error ? (
                <CalloutPanel tone="danger" className="text-sm">
                  {error}
                </CalloutPanel>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  appearance="admin"
                  data-testid={
                    mode === "create"
                      ? "studio-project-submit-create"
                      : "studio-project-submit-save"
                  }
                  variant="primary"
                  size="compact"
                  onClick={() => {
                    handleSubmit().catch((error: unknown) =>
                      setError(String(error)),
                    );
                  }}
                  disabled={busyAction != null}
                >
                  {busyAction === "create" ||
                  busyAction?.startsWith("save:") ? (
                    <LoaderCircle className="mr-1.5 size-3.5 animate-spin" />
                  ) : null}
                  {mode === "create" ? "Create project" : "Save changes"}
                </Button>
                <Button
                  appearance="admin"
                  variant="subtle"
                  size="compact"
                  onClick={closeDialog}
                  disabled={busyAction != null}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </OverlayShell>
      ) : null}

      <GeneratedThumbnailPickerDialog
        open={coverPicker.open}
        dialogLabel="Generated image project covers"
        title="Choose a project image"
        description="Pick a recent generated image to use as this project cover."
        items={coverPickerItems}
        loading={coverPicker.loading}
        loadingMore={coverPicker.loadingMore}
        nextOffset={coverPicker.nextOffset}
        selectionId={coverAssetSelectionId}
        onClose={coverPicker.closePicker}
        onLoadMore={() => {
          coverPicker
            .loadNextPage()
            .catch((error: unknown) => setError(String(error)));
        }}
        onSelectItem={applyCoverFromAsset}
      />
    </>
  );
}
