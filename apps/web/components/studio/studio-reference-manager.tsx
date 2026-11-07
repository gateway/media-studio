"use client";

import {
  AudioLines,
  Clapperboard,
  FolderOpen,
  Image as ImageIcon,
  Maximize2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  StudioBrowserGrid,
  StudioBrowserOverlay,
} from "@/components/studio/studio-browser-surface";
import { StudioMediaSlotAddTile } from "@/components/studio/studio-media-slot-add-tile";
import {
  StudioStagedMediaReplaceControl,
  StudioStagedMediaTile,
} from "@/components/studio/studio-staged-media-tile";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ToastBanner } from "@/components/ui/toast-banner";
import type { ComposerStatusMessage } from "@/lib/media-studio-contract";
import type { StudioReferencePreview } from "@/lib/media-studio-helpers";

const referenceKinds = {
  images: { label: "Images", singular: "image", icon: ImageIcon },
  videos: { label: "Videos", singular: "video", icon: Clapperboard },
  audios: { label: "Audio", singular: "audio", icon: AudioLines },
} as const;

export type StudioReferenceKind = keyof typeof referenceKinds;

type PickFiles = (files: FileList | null, input: HTMLInputElement) => void;

export type StudioReferenceGroup = {
  kind: StudioReferenceKind;
  limit: number;
  slots: {
    key: string;
    testId: string;
    preview: StudioReferencePreview;
    visualUrl: string | null;
    onRemove: () => void;
    onReplace?: (files: FileList, input: HTMLInputElement) => void;
  }[];
  uploadTestId: string;
  onAdd: PickFiles;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onOpenLibrary?: () => void;
};

export type StudioReferenceManagerProps = {
  expanded: boolean;
  suspended: boolean;
  onExpandedChange: (expanded: boolean) => void;
  isDragActive: boolean;
  onSetDragActive: (active: boolean) => void;
  onOpenPreview: (preview: StudioReferencePreview) => void;
  feedback?: ComposerStatusMessage | null;
};

type ReferenceTabsProps = {
  groups: StudioReferenceGroup[];
  selectedKind: StudioReferenceKind;
  onSelect: (kind: StudioReferenceKind) => void;
  id: string;
  showLabels: boolean;
  onDragOver?: (event: DragEvent<HTMLElement>) => void;
  onDragLeave?: () => void;
};

function ReferenceCount({ group }: { group: StudioReferenceGroup }) {
  return (
    <span>
      {group.slots.length}/{group.limit}
    </span>
  );
}

function ReferenceTabs({
  groups,
  selectedKind,
  onSelect,
  id,
  showLabels,
  onDragOver,
  onDragLeave,
}: ReferenceTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Reference media"
      className="studio-reference-tabs"
    >
      {groups.map((group, index) => {
        const { label, icon: Icon } = referenceKinds[group.kind];
        const selected = group.kind === selectedKind;
        return (
          <Button
            key={group.kind}
            id={`${id}-${group.kind}`}
            appearance="admin"
            variant="ghost"
            role="tab"
            aria-label={`${label} ${group.slots.length}/${group.limit}`}
            aria-selected={selected}
            aria-controls={id}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(group.kind)}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDragOver ? group.onDrop : undefined}
            onKeyDown={(event) => {
              const lastIndex = groups.length - 1;
              let nextIndex: number;
              switch (event.key) {
                case "ArrowLeft":
                  nextIndex = index === 0 ? lastIndex : index - 1;
                  break;
                case "ArrowRight":
                  nextIndex = index === lastIndex ? 0 : index + 1;
                  break;
                case "Home":
                  nextIndex = 0;
                  break;
                case "End":
                  nextIndex = lastIndex;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              const nextKind = groups[nextIndex].kind;
              onSelect(nextKind);
              document.getElementById(`${id}-${nextKind}`)?.focus();
            }}
          >
            <Icon aria-hidden="true" />
            {showLabels ? <span>{label}</span> : null}
            <ReferenceCount group={group} />
          </Button>
        );
      })}
    </div>
  );
}

function ReferenceTiles({
  group,
  visibleCount,
  expanded = false,
  onOpenPreview,
}: {
  group: StudioReferenceGroup;
  visibleCount: number;
  expanded?: boolean;
  onOpenPreview: StudioReferenceManagerProps["onOpenPreview"];
}) {
  const { singular, icon: Icon } = referenceKinds[group.kind];
  return group.slots.slice(0, visibleCount).map((slot, index) => (
    <StudioStagedMediaTile
      key={slot.key}
      preview={slot.preview}
      positionBadge={
        <span aria-hidden="true" className="studio-staged-media-position">
          {index + 1}
        </span>
      }
      previewBadge={
        expanded ? (
          <Icon aria-hidden="true" className="studio-reference-tile-kind" />
        ) : undefined
      }
      visualUrl={slot.visualUrl}
      onOpenPreview={onOpenPreview}
      onRemove={slot.onRemove}
      replaceControl={
        slot.onReplace && (
          <StudioStagedMediaReplaceControl
            label={`Replace ${singular} reference ${index + 1}`}
            accept={`${singular}/*`}
            testId={`${slot.testId}-replace`}
            onPickFiles={slot.onReplace}
          />
        )
      }
      className="studio-ordered-reference-tile"
      testId={slot.testId}
    />
  ));
}

type ReferenceViewProps = {
  group: StudioReferenceGroup;
  groups: StudioReferenceGroup[];
  onSelect: (kind: StudioReferenceKind) => void;
  onOpenPreview: StudioReferenceManagerProps["onOpenPreview"];
  upload: ReactNode;
  expandRef: RefObject<HTMLButtonElement | null>;
};

function ReferenceOverview({
  group,
  groups,
  onSelect,
  onOpenPreview,
  upload,
  expandRef,
  compact,
  expanded,
  isDragActive,
  onOpen,
  onDragOver,
  onDragLeave,
}: ReferenceViewProps & {
  compact: boolean;
  expanded: boolean;
  isDragActive: boolean;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
}) {
  const overviewId = useId();
  const { singular, icon: KindIcon } = referenceKinds[group.kind];
  const used = group.slots.length;
  const showTabs = groups.length > 1;
  const maxThumbnails = compact ? 4 : 2;
  const visibleCount = overviewThumbnailCount(
    used,
    maxThumbnails,
    used < group.limit,
  );
  const overflow = used - visibleCount;
  const expandLabel = `Expand ${singular} references`;
  const panelProps = showTabs
    ? {
        id: overviewId,
        role: "tabpanel",
        "aria-labelledby": `${overviewId}-${group.kind}`,
      }
    : {};
  const dropProps = compact
    ? {
        onDragOver,
        onDragLeave,
        onDrop: group.onDrop,
        "data-drag-active": isDragActive,
      }
    : {};

  return (
    <section
      className="studio-ordered-references"
      data-reference-density={compact ? "compact" : "large"}
      aria-label="Staged references"
    >
      <div className="studio-ordered-reference-heading">
        {showTabs ? (
          <ReferenceTabs
            groups={groups}
            selectedKind={group.kind}
            onSelect={onSelect}
            id={overviewId}
            showLabels={false}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
          />
        ) : (
          <>
            <div className="studio-meta-label">References</div>
            <span className="studio-ordered-reference-count">
              <KindIcon aria-hidden="true" />
              <ReferenceCount group={group} />
            </span>
          </>
        )}
        <IconButton
          ref={expandRef}
          icon={Maximize2}
          aria-label={expandLabel}
          title={expandLabel}
          aria-haspopup="dialog"
          onClick={onOpen}
          size="compact"
          shape="soft"
        />
      </div>
      <div
        {...panelProps}
        {...dropProps}
        className="studio-ordered-reference-strip"
      >
        {expanded ? null : (
          <ReferenceTiles
            group={group}
            visibleCount={visibleCount}
            onOpenPreview={onOpenPreview}
          />
        )}
        {overflow > 0 && (
          <Button
            appearance="admin"
            variant="subtle"
            className="studio-ordered-reference-overflow"
            aria-haspopup="dialog"
            aria-label={`Show ${overflow} more ${singular} references`}
            onClick={onOpen}
          >
            +{overflow}
          </Button>
        )}
        {upload}
      </div>
    </section>
  );
}

function overviewThumbnailCount(
  used: number,
  maxThumbnails: number,
  canAdd: boolean,
) {
  return used > maxThumbnails && canAdd
    ? maxThumbnails - 1
    : Math.min(used, maxThumbnails);
}

function ExpandedReferenceManager({
  group,
  groups,
  onSelect,
  onOpenPreview,
  upload,
  expandRef,
  suspended,
  onClose,
  feedback,
}: ReferenceViewProps & {
  suspended: boolean;
  onClose: () => void;
  feedback?: ComposerStatusMessage | null;
}) {
  const managerId = useId();
  const { singular } = referenceKinds[group.kind];

  return createPortal(
    <StudioBrowserOverlay
      testId="studio-expanded-references"
      zIndexClassName="z-[118] studio-expanded-references"
      title="References"
      heading={
        <ReferenceTabs
          groups={groups}
          selectedKind={group.kind}
          onSelect={onSelect}
          id={managerId}
          showLabels
        />
      }
      onClose={onClose}
      suspended={suspended}
      returnFocusFallback={expandRef}
      actions={
        <IconButton
          icon={X}
          appearance="admin"
          quiet
          aria-label="Close expanded references"
          onClick={onClose}
        />
      }
      footer={
        upload && (
          <div className="studio-expanded-reference-actions">
            {upload}
            {group.onOpenLibrary && (
              <Button
                appearance="admin"
                variant="subtle"
                onClick={group.onOpenLibrary}
              >
                <FolderOpen aria-hidden="true" /> Choose from library
              </Button>
            )}
          </div>
        )
      }
    >
      <div
        id={managerId}
        role="tabpanel"
        aria-labelledby={`${managerId}-${group.kind}`}
      >
        {feedback && (
          <ToastBanner
            appearance="admin"
            role="status"
            tone={feedback.tone}
            message={feedback.text}
            className="studio-expanded-reference-feedback"
          />
        )}
        {group.slots.length ? (
          <StudioBrowserGrid className="studio-expanded-reference-grid">
            <ReferenceTiles
              group={group}
              visibleCount={group.slots.length}
              expanded
              onOpenPreview={onOpenPreview}
            />
          </StudioBrowserGrid>
        ) : (
          <p className="studio-browser-state">
            No {singular} references added.
          </p>
        )}
      </div>
    </StudioBrowserOverlay>,
    document.body,
  );
}

export function StudioReferenceManager({
  groups,
  compact,
  expanded,
  suspended,
  onExpandedChange,
  isDragActive,
  onSetDragActive,
  onOpenPreview,
  feedback,
}: StudioReferenceManagerProps & {
  groups: StudioReferenceGroup[];
  compact: boolean;
}) {
  const [selectedKind, setSelectedKind] =
    useState<StudioReferenceKind>("images");
  const [feedbackAtOpen, setFeedbackAtOpen] = useState(feedback);
  const expandRef = useRef<HTMLButtonElement>(null);
  const supportedGroups = groups.filter(
    (group) => group.limit > 0 || group.slots.length > 0,
  );
  const group =
    supportedGroups.find(({ kind }) => kind === selectedKind) ??
    supportedGroups[0];
  if (!group) return null;

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    onSetDragActive(true);
  };
  const onDragLeave = () => onSetDragActive(false);
  const { singular } = referenceKinds[group.kind];
  const uploadAppearance = expanded
    ? { actionLabel: "Upload", icon: Upload }
    : { icon: Plus };
  const viewProps = {
    group,
    groups: supportedGroups,
    onSelect: setSelectedKind,
    onOpenPreview,
    expandRef,
    upload:
      group.slots.length < group.limit ? (
        <StudioMediaSlotAddTile
          key={group.kind}
          accept={`${singular}/*`}
          multiple
          inputLabel={`Add ${singular} references`}
          {...uploadAppearance}
          isDragActive={isDragActive}
          testId={group.uploadTestId}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={group.onDrop}
          onPickFiles={group.onAdd}
        />
      ) : null,
  };

  return (
    <>
      <ReferenceOverview
        {...viewProps}
        upload={expanded ? null : viewProps.upload}
        compact={compact}
        expanded={expanded}
        isDragActive={isDragActive}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onOpen={(event) => {
          event.currentTarget.focus();
          setFeedbackAtOpen(feedback);
          onExpandedChange(true);
        }}
      />
      {expanded && (
        <ExpandedReferenceManager
          {...viewProps}
          suspended={suspended}
          feedback={feedback === feedbackAtOpen ? null : feedback}
          onClose={() => onExpandedChange(false)}
        />
      )}
    </>
  );
}
