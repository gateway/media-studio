"use client";
import {
  Archive,
  EyeOff,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { MediaBrowserRow } from "@/components/media/media-browser-row";
import { IconButton } from "@/components/ui/icon-button";
import type { MediaProject } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function StudioProjectRow({
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
  return (
    <MediaBrowserRow
      name={project.name}
      description={project.description?.trim() || "No description yet."}
      imageUrl={project.cover_thumb_url ?? project.cover_image_url}
      selected={selected}
      onOpen={onOpen}
      testId={`studio-project-card-${project.project_id}`}
      metadata={
        <>
          {project.updated_at && Number.isFinite(Date.parse(project.updated_at))
            ? formatDateTime(project.updated_at)
            : "date unavailable"}
        </>
      }
      status={
        project.hidden_from_global_gallery ? (
          <span title="Hidden from main gallery">
            <EyeOff aria-label="Hidden from main gallery" size={16} />
          </span>
        ) : null
      }
      actions={
        <ProjectRowActions
          project={project}
          busy={busy}
          archived={archived}
          onEdit={onEdit}
          onArchive={onArchive}
          onRestore={onRestore}
          onDelete={onDelete}
        />
      }
    />
  );
}

function ProjectRowActions({
  project,
  busy,
  archived,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  project: MediaProject;
  busy: string | null;
  archived: boolean;
  onEdit?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}) {
  const actions = archived
    ? [
        {
          key: "restore",
          label: "Restore",
          title: "Restore project",
          icon: RotateCcw,
          onClick: onRestore,
          tone: "subtle" as const,
        },
        {
          key: "delete",
          label: "Delete",
          title: "Delete permanently",
          icon: Trash2,
          onClick: onDelete,
          tone: "danger" as const,
        },
      ]
    : [
        {
          key: "edit",
          label: "Edit",
          title: "Edit project",
          icon: Pencil,
          onClick: onEdit,
          tone: "subtle" as const,
        },
        {
          key: "archive",
          label: "Archive",
          title: "Archive project",
          icon: Archive,
          onClick: onArchive,
          tone: "subtle" as const,
        },
      ];
  return actions.map((action) => {
    const loading = busy === `${action.key}:${project.project_id}`;
    return (
      <IconButton
        key={action.key}
        appearance="admin"
        size="default"
        tone={action.tone}
        icon={loading ? LoaderCircle : action.icon}
        iconClassName={loading ? "animate-spin" : undefined}
        disabled={busy !== null}
        onClick={action.onClick}
        aria-label={`${action.label} ${project.name}`}
        title={action.title}
      />
    );
  });
}
