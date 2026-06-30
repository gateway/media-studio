"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { buildStudioScopedHref } from "@/lib/studio-navigation";
import type { MediaProject } from "@/lib/types";

export type StudioProjectDraft = {
  name: string;
  description: string;
  hiddenFromGlobalGallery?: boolean;
  coverAssetId?: string | null;
  coverReferenceId?: string | null;
};

type UseStudioProjectWorkspaceOptions = {
  projects: MediaProject[];
  initialSelectedProjectId: string | null;
  onBeforeProjectChange: () => void;
  onCloseProjectBrowser: () => void;
};

type ProjectResponsePayload = {
  project?: MediaProject | null;
  detail?: string;
  error?: string;
};

function projectDraftPayload(draft: StudioProjectDraft) {
  return {
    name: draft.name,
    description: draft.description,
    hidden_from_global_gallery: Boolean(draft.hiddenFromGlobalGallery),
    ...(draft.coverAssetId !== undefined ? { cover_asset_id: draft.coverAssetId } : {}),
    ...(draft.coverReferenceId !== undefined ? { cover_reference_id: draft.coverReferenceId } : {}),
  };
}

export function useStudioProjectWorkspace({
  projects,
  initialSelectedProjectId,
  onBeforeProjectChange,
  onCloseProjectBrowser,
}: UseStudioProjectWorkspaceOptions) {
  const pathname = usePathname();
  const [localProjects, setLocalProjects] = useState<MediaProject[]>(projects);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialSelectedProjectId);

  const selectedProject = useMemo(
    () => localProjects.find((project) => project.project_id === selectedProjectId) ?? null,
    [localProjects, selectedProjectId],
  );

  useEffect(() => {
    setLocalProjects(projects);
  }, [projects]);

  useEffect(() => {
    setSelectedProjectId(initialSelectedProjectId);
  }, [initialSelectedProjectId]);

  const studioHrefForProject = useCallback(
    (projectId: string | null, assetId?: string | number | null) => {
      const params = new URLSearchParams();
      if (assetId != null) {
        params.set("asset", String(assetId));
      }
      const baseHref = buildStudioScopedHref(pathname, projectId);
      if (!params.size) {
        return baseHref;
      }
      const separator = baseHref.includes("?") ? "&" : "?";
      return `${baseHref}${separator}${params.toString()}`;
    },
    [pathname],
  );

  const openProjectWorkspace = useCallback(
    (projectId: string | null) => {
      onBeforeProjectChange();
      onCloseProjectBrowser();
      setSelectedProjectId(projectId);
      window.location.assign(studioHrefForProject(projectId, null));
    },
    [onBeforeProjectChange, onCloseProjectBrowser, studioHrefForProject],
  );

  const createProjectInStudio = useCallback(
    async (draft: StudioProjectDraft) => {
      const response = await fetch("/api/control/media/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(projectDraftPayload(draft)),
      });
      const payload = (await response.json()) as ProjectResponsePayload;
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? payload.detail ?? "Unable to create the project.");
      }
      setLocalProjects((current) => [
        payload.project as MediaProject,
        ...current.filter((item) => item.project_id !== payload.project?.project_id),
      ]);
      openProjectWorkspace(String(payload.project.project_id));
    },
    [openProjectWorkspace],
  );

  const updateProjectInStudio = useCallback(async (projectId: string, draft: StudioProjectDraft) => {
    const response = await fetch(`/api/control/media/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(projectDraftPayload(draft)),
    });
    const payload = (await response.json()) as ProjectResponsePayload;
    if (!response.ok || !payload.project) {
      throw new Error(payload.error ?? payload.detail ?? "Unable to update the project.");
    }
    setLocalProjects((current) =>
      current.map((item) => (item.project_id === projectId ? (payload.project as MediaProject) : item)),
    );
  }, []);

  const archiveProjectInStudio = useCallback(
    async (projectId: string) => {
      const response = await fetch(`/api/control/media/projects/${projectId}/archive`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as ProjectResponsePayload;
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? payload.detail ?? "Unable to archive the project.");
      }
      setLocalProjects((current) =>
        current.map((item) => (item.project_id === projectId ? (payload.project as MediaProject) : item)),
      );
      if (selectedProjectId === projectId) {
        openProjectWorkspace(null);
      }
    },
    [openProjectWorkspace, selectedProjectId],
  );

  const unarchiveProjectInStudio = useCallback(async (projectId: string) => {
    const response = await fetch(`/api/control/media/projects/${projectId}/unarchive`, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const payload = (await response.json()) as ProjectResponsePayload;
    if (!response.ok || !payload.project) {
      throw new Error(payload.error ?? payload.detail ?? "Unable to restore the project.");
    }
    setLocalProjects((current) =>
      current.map((item) => (item.project_id === projectId ? (payload.project as MediaProject) : item)),
    );
  }, []);

  const deleteProjectInStudio = useCallback(
    async (projectId: string) => {
      const response = await fetch(`/api/control/media/projects/${projectId}?permanent=true`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as { ok?: boolean; detail?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? payload.detail ?? "Unable to delete the project.");
      }
      setLocalProjects((current) => current.filter((item) => item.project_id !== projectId));
      if (selectedProjectId === projectId) {
        openProjectWorkspace(null);
      }
    },
    [openProjectWorkspace, selectedProjectId],
  );

  return {
    localProjects,
    selectedProjectId,
    selectedProject,
    setLocalProjects,
    setSelectedProjectId,
    studioHrefForProject,
    openProjectWorkspace,
    createProjectInStudio,
    updateProjectInStudio,
    archiveProjectInStudio,
    unarchiveProjectInStudio,
    deleteProjectInStudio,
  };
}
