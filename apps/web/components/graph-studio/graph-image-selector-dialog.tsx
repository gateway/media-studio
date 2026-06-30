"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Search, X } from "lucide-react";

import { AdminButton } from "@/components/admin-controls";
import { MediaImagePickerGrid } from "@/components/media/media-image-picker-grid";
import { MediaImagePickerPreview } from "@/components/media/media-image-picker-preview";
import type {
  MediaImagePickerItem,
  MediaPickerMediaType,
} from "@/components/media/media-image-picker-types";
import {
  overlayBackdropClassName,
  overlayPanelClassName,
} from "@/components/ui/surfaces";

export type GraphImageSelectorSource = "generated" | "imported";

export type GraphImageSelectorMode =
  | { kind: "add-node" }
  | { kind: "attach-node"; nodeId: string };

export type GraphImageSelectorFields =
  | { asset_id: string }
  | { reference_id: string };

export type GraphImageSelectorSourceState = {
  items: MediaImagePickerItem[];
  loading: boolean;
  loadingMore: boolean;
  nextOffset: number | null;
  selectionId?: string | null;
  error?: string | null;
};

export type GraphImageSelectorProjectOption = {
  projectId: string;
  label: string;
  status?: string | null;
  hiddenFromGlobalGallery?: boolean;
};

type GraphImageSelectorDialogProps = {
  open: boolean;
  mediaType?: MediaPickerMediaType;
  mode: GraphImageSelectorMode;
  generated: GraphImageSelectorSourceState;
  imported: GraphImageSelectorSourceState;
  searchQuery: string;
  projectId?: string | null;
  projectOptions?: GraphImageSelectorProjectOption[];
  loadingProjectOptions?: boolean;
  initialSource?: GraphImageSelectorSource;
  onClose: () => void;
  onSearchChange: (source: GraphImageSelectorSource, query: string) => void;
  onLoadMore: (source: GraphImageSelectorSource) => void;
  onProjectScopeChange?: (
    source: GraphImageSelectorSource,
    projectId: string | null,
  ) => void;
  onAddNode: (fields: GraphImageSelectorFields) => void;
  onAttachToNode: (nodeId: string, fields: GraphImageSelectorFields) => void;
  onDragItem?: (
    source: GraphImageSelectorSource,
    item: MediaImagePickerItem,
    event: DragEvent<HTMLButtonElement>,
  ) => void;
};

type MediaSelectorCopy = {
  title: string;
  description: string;
  closeLabel: string;
  searchPlaceholder: string;
  searchLabel: string;
  sourceLabel: string;
  projectLabel: string;
  globalProjectLabel: string;
  importedFooter: string;
  generatedFooter: string;
};

const mediaTypeCopy: Record<MediaPickerMediaType, MediaSelectorCopy> = {
  image: {
    title: "Image Assets",
    description:
      "Search generated images or imported reference images from one selector.",
    closeLabel: "Close Image Assets",
    searchPlaceholder: "Search image assets...",
    searchLabel: "Search image assets",
    sourceLabel: "Image asset source",
    projectLabel: "Image asset project",
    globalProjectLabel: "Global images",
    importedFooter: "Imported maps to reference-media image records.",
    generatedFooter: "Global generated images exclude hidden-project media.",
  },
  video: {
    title: "Video Assets",
    description:
      "Search generated videos or imported reference videos from one selector.",
    closeLabel: "Close Video Assets",
    searchPlaceholder: "Search video assets...",
    searchLabel: "Search video assets",
    sourceLabel: "Video asset source",
    projectLabel: "Video asset project",
    globalProjectLabel: "Global videos",
    importedFooter: "Imported maps to reference-media video records.",
    generatedFooter: "Global generated videos exclude hidden-project media.",
  },
  audio: {
    title: "Audio Assets",
    description:
      "Search generated audio or imported reference audio from one selector.",
    closeLabel: "Close Audio Assets",
    searchPlaceholder: "Search audio assets...",
    searchLabel: "Search audio assets",
    sourceLabel: "Audio asset source",
    projectLabel: "Audio asset project",
    globalProjectLabel: "Global audio",
    importedFooter: "Imported maps to reference-media audio records.",
    generatedFooter: "Global generated audio excludes hidden-project media.",
  },
};

const mediaTypePlural: Record<MediaPickerMediaType, string> = {
  image: "images",
  video: "videos",
  audio: "audio",
};

function sourceCopyFor(mediaType: MediaPickerMediaType): Record<
  GraphImageSelectorSource,
  {
    label: string;
    eyebrow: string;
    loading: string;
    empty: string;
    loadMore: string;
    itemLabel: string;
    itemLabelPlural: string;
  }
> {
  const plural = mediaTypePlural[mediaType];
  const singular = mediaType;
  const itemSingular = mediaType === "audio" ? "audio item" : singular;
  const itemPlural = mediaType === "audio" ? "audio items" : plural;
  const titleCasePlural = plural.charAt(0).toUpperCase() + plural.slice(1);
  return {
    generated: {
      label: "Generated",
      eyebrow: `Generated ${titleCasePlural}`,
      loading: `Loading generated ${plural}...`,
      empty: `No generated ${plural} found.`,
      loadMore: `Load more generated ${singular} assets`,
      itemLabel: `generated ${itemSingular}`,
      itemLabelPlural: `generated ${itemPlural}`,
    },
    imported: {
      label: "Imported",
      eyebrow: `Imported ${titleCasePlural}`,
      loading: `Loading imported ${plural}...`,
      empty: `No imported ${plural} found.`,
      loadMore: `Load more imported ${singular} assets`,
      itemLabel: `imported ${itemSingular}`,
      itemLabelPlural: `imported ${itemPlural}`,
    },
  };
}

function selectionFields(
  source: GraphImageSelectorSource,
  itemId: string,
): GraphImageSelectorFields {
  return source === "generated"
    ? { asset_id: itemId }
    : { reference_id: itemId };
}

export function GraphImageSelectorDialog({
  open,
  mediaType = "image",
  mode,
  generated,
  imported,
  searchQuery,
  projectId = null,
  projectOptions = [],
  loadingProjectOptions = false,
  initialSource = "generated",
  onClose,
  onSearchChange,
  onLoadMore,
  onProjectScopeChange,
  onAddNode,
  onAttachToNode,
  onDragItem,
}: GraphImageSelectorDialogProps) {
  const descriptionId = useId();
  const statusId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const [activeSource, setActiveSource] =
    useState<GraphImageSelectorSource>(initialSource);
  const [queryDraft, setQueryDraft] = useState(searchQuery);
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const dialogCopy = mediaTypeCopy[mediaType];
  const sourceCopy = sourceCopyFor(mediaType);
  const sourceState = activeSource === "generated" ? generated : imported;
  const copy = sourceCopy[activeSource];
  const previewItem = previewItemId
    ? (sourceState.items.find((item) => item.id === previewItemId) ?? null)
    : null;
  const selectedProject = projectId
    ? (projectOptions.find((project) => project.projectId === projectId) ?? null)
    : null;

  useEffect(() => {
    if (!open) return;
    setActiveSource(initialSource);
  }, [initialSource, open]);

  useEffect(() => {
    if (!open) return;
    setQueryDraft(searchQuery);
  }, [open, searchQuery]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      previousActiveElementRef.current?.focus();
      previousActiveElementRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  function handleSourceChange(source: GraphImageSelectorSource) {
    setActiveSource(source);
    setPreviewItemId(null);
    onSearchChange(source, queryDraft);
  }

  function handleSearchChange(query: string) {
    setQueryDraft(query);
    onSearchChange(activeSource, query);
  }

  function handleProjectScopeChange(nextProjectId: string) {
    onProjectScopeChange?.(activeSource, nextProjectId || null);
  }

  function handleSelect(itemId: string) {
    const fields = selectionFields(activeSource, itemId);
    if (mode.kind === "attach-node") {
      onAttachToNode(mode.nodeId, fields);
      return;
    }
    onAddNode(fields);
  }

  return (
    <div
      className={`${overlayBackdropClassName} z-[140] flex items-center justify-center bg-[var(--surface-overlay-backdrop)] p-4`}
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={dialogCopy.title}
        aria-describedby={`${descriptionId} ${statusId}`}
        tabIndex={-1}
        className={`media-image-picker-dialog nodrag ${overlayPanelClassName}`}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="media-image-picker-header">
          <div className="grid gap-1">
            <div className="admin-label-accent">Media Assets</div>
            <h2 className="text-xl font-semibold text-[var(--foreground)]">
              {dialogCopy.title}
            </h2>
            <p id={descriptionId} className="text-sm text-[var(--muted-strong)]">
              {dialogCopy.description}
            </p>
          </div>
          <AdminButton
            variant="subtle"
            size="compact"
            onClick={onClose}
            aria-label={dialogCopy.closeLabel}
          >
            <X className="size-4" />
          </AdminButton>
        </div>

        <div className="media-image-picker-body">
          <div className="grid gap-3 border-b border-[var(--media-picker-border)] px-5 py-4">
            <label className="admin-input flex items-center gap-2 px-3">
              <Search className="size-4 text-[var(--muted-strong)]" />
              <input
                type="search"
                value={queryDraft}
                onChange={(event) => handleSearchChange(event.target.value)}
                placeholder={dialogCopy.searchPlaceholder}
                aria-label={dialogCopy.searchLabel}
                className="min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-strong)]"
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                className="inline-flex w-fit gap-1 rounded-[var(--media-picker-radius)] border border-[var(--media-picker-border)] bg-[var(--media-picker-raised)] p-1"
                role="tablist"
                aria-label={dialogCopy.sourceLabel}
              >
                {(Object.keys(sourceCopy) as GraphImageSelectorSource[]).map(
                  (source) => (
                    <button
                      key={source}
                      type="button"
                      role="tab"
                      aria-selected={activeSource === source}
                      className={`rounded-[calc(var(--media-picker-radius)-2px)] px-3 py-2 text-sm font-semibold transition ${
                        activeSource === source
                          ? "bg-[var(--media-picker-hover)] text-[var(--foreground)]"
                          : "text-[var(--muted-strong)] hover:text-[var(--foreground)]"
                      }`}
                      onClick={() => handleSourceChange(source)}
                    >
                      {sourceCopy[source].label}
                    </button>
                  ),
                )}
              </div>
              {onProjectScopeChange ? (
                <label className="grid min-w-48 gap-1">
                  <span className="admin-label-accent">
                    {loadingProjectOptions ? "Loading projects" : "Projects"}
                  </span>
                  <select
                    value={projectId ?? ""}
                    onChange={(event) =>
                      handleProjectScopeChange(event.target.value)
                    }
                    aria-label={dialogCopy.projectLabel}
                    className="admin-input h-10 px-3 text-sm"
                    disabled={loadingProjectOptions}
                  >
                    <option value="">{dialogCopy.globalProjectLabel}</option>
                    {projectOptions.map((project) => (
                      <option key={project.projectId} value={project.projectId}>
                        {project.label}
                        {project.hiddenFromGlobalGallery ? " (hidden)" : ""}
                        {project.status && project.status !== "active"
                          ? ` (${project.status})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </div>

          <div className="scrollbar-none flex-1 overflow-y-auto px-5 py-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="admin-label-accent">{copy.eyebrow}</div>
              <div
                id={statusId}
                className="text-xs text-[var(--muted-strong)]"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {sourceState.loadingMore
                  ? `Loading more ${copy.itemLabelPlural}...`
                  : `Showing ${sourceState.items.length} ${
                      sourceState.items.length === 1
                        ? copy.itemLabel
                        : copy.itemLabelPlural
                    }.`}
              </div>
            </div>

            {sourceState.error ? (
              <div className="admin-surface-inset flex min-h-60 items-center justify-center p-6 text-center text-sm text-[var(--muted-strong)]">
                {sourceState.error}
              </div>
            ) : sourceState.loading && !sourceState.items.length ? (
              <div className="admin-surface-inset flex min-h-60 items-center justify-center p-6 text-sm text-[var(--muted-strong)]">
                {copy.loading}
              </div>
            ) : sourceState.items.length ? (
              <MediaImagePickerGrid
                items={sourceState.items}
                purpose="reference"
                imageFit="cover"
                selectionId={sourceState.selectionId ?? null}
                onSelectItem={handleSelect}
                onPreviewItem={setPreviewItemId}
                onDragItem={
                  onDragItem
                    ? (item, event) => onDragItem(activeSource, item, event)
                    : undefined
                }
              />
            ) : (
              <div className="admin-surface-inset flex min-h-60 items-center justify-center p-6 text-sm text-[var(--muted-strong)]">
                {copy.empty}
              </div>
            )}
          </div>

          <div className="media-image-picker-footer">
            <div className="media-image-picker-footer-count">
              {selectedProject
                ? `Project: ${selectedProject.label}${
                    selectedProject.hiddenFromGlobalGallery
                      ? " (hidden)"
                      : ""
                  }.`
                : activeSource === "imported"
                  ? dialogCopy.importedFooter
                  : dialogCopy.generatedFooter}
            </div>
            {sourceState.nextOffset != null ? (
              <AdminButton
                variant="subtle"
                size="compact"
                onClick={() => onLoadMore(activeSource)}
                disabled={sourceState.loadingMore}
                aria-label={copy.loadMore}
              >
                {sourceState.loadingMore ? "Loading..." : "Load more"}
              </AdminButton>
            ) : null}
          </div>
        </div>

        {previewItem ? (
          <MediaImagePickerPreview
            item={previewItem}
            onClose={() => setPreviewItemId(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
