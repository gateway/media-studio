"use client";

import {
  AudioLines,
  Clapperboard,
  Image as ImageIcon,
  Maximize2,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  StudioBrowserGrid,
  StudioBrowserOverlay,
} from "@/components/studio/studio-browser-surface";
import { StudioReferenceSourceMenu } from "@/components/studio/studio-reference-source-menu";
import { StudioStagedMediaTile } from "@/components/studio/studio-staged-media-tile";
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

const audioOverview = {
  density: "compact",
  stripClassName: "studio-ordered-reference-strip",
};
const visualOverview = {
  density: undefined,
  stripClassName: "studio-ordered-reference-strip studio-media-slot-grid",
};

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
    token?: string;
    onRemove: () => void;
    onDrop?: (event: DragEvent<HTMLElement>) => void;
    onReplace: (files: FileList, input: HTMLInputElement) => void;
    onOpenReplacementLibrary: (returnFocusTo: HTMLElement | null) => void;
  }[];
  uploadTestId: string;
  onAdd: PickFiles;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onOpenLibrary: (returnFocusTo: HTMLElement | null) => void;
};

export type StudioReferenceManagerProps = {
  modelLabel: string;
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
            {showLabels ? (
              <span className="studio-reference-tab-label">{label}</span>
            ) : null}
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
  expandRef,
  onDragOver,
  onDragLeave,
}: {
  group: StudioReferenceGroup;
  visibleCount: number;
  expanded?: boolean;
  onOpenPreview: StudioReferenceManagerProps["onOpenPreview"];
  expandRef: RefObject<HTMLButtonElement | null>;
} & Pick<ReferenceUploadProps, "onDragOver" | "onDragLeave">) {
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
          <span aria-hidden="true" className="studio-reference-tile-caption">
            <Icon />
            <span>{slot.token ?? slot.preview.label}</span>
          </span>
        ) : undefined
      }
      visualUrl={slot.visualUrl}
      onOpenPreview={onOpenPreview}
      onRemove={slot.onRemove}
      dropTarget={
        slot.onDrop
          ? { onDragOver, onDragLeave, onDrop: slot.onDrop }
          : undefined
      }
      replaceControl={
        <StudioReferenceSourceMenu
          action="Replace"
          label={`Replace ${singular} reference ${index + 1}`}
          accept={`${singular}/*`}
          testId={`${slot.testId}-replace`}
          onPickFiles={(files, input) => {
            if (files?.length) slot.onReplace(files, input);
          }}
          onOpenLibrary={() => slot.onOpenReplacementLibrary(expandRef.current)}
        />
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
  uploadProps: ReferenceUploadProps;
  expandRef: RefObject<HTMLButtonElement | null>;
};

function ReferenceOverview({
  group,
  groups,
  onSelect,
  onOpenPreview,
  uploadProps,
  expandRef,
  dropOnStrip,
  expanded,
  onOpen,
}: ReferenceViewProps & {
  dropOnStrip: boolean;
  expanded: boolean;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const { onDragOver, onDragLeave } = uploadProps;
  const overviewId = useId();
  const { singular, icon: KindIcon } = referenceKinds[group.kind];
  const used = group.slots.length;
  const showTabs = groups.length > 1;
  const compact = group.kind === "audios";
  const { density, stripClassName } = compact ? audioOverview : visualOverview;
  const gridRef = useRef<HTMLDivElement>(null);
  const columns = useReferenceGridColumns(gridRef, compact);
  const rows = useSyncExternalStore(
    subscribeToViewportResize,
    referenceRows,
    () => 1,
  );
  const visibleCount = overviewThumbnailCount(group, compact, rows * columns);
  const overflow = (
    <ReferenceOverflowButton
      overflow={used - visibleCount}
      singular={singular}
      onOpen={onOpen}
    />
  );
  const expandLabel = `Expand ${singular} references`;

  return (
    <section
      className="studio-ordered-references"
      data-reference-density={density}
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
        {!compact && overflow}
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
        {...overviewPanelProps(overviewId, showTabs, dropOnStrip, uploadProps)}
        ref={gridRef}
        className={stripClassName}
      >
        {expanded ? null : (
          <ReferenceTiles
            group={group}
            visibleCount={visibleCount}
            onOpenPreview={onOpenPreview}
            expandRef={expandRef}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
          />
        )}
        {compact && overflow}
        {!expanded && (
          <ReferenceUpload
            {...uploadProps}
            expandRef={expandRef}
            mode="overview"
          />
        )}
      </div>
    </section>
  );
}

function overviewPanelProps(
  id: string,
  showTabs: boolean,
  dropOnStrip: boolean,
  { group, onDragOver, onDragLeave, isDragActive }: ReferenceUploadProps,
) {
  return {
    ...(showTabs && {
      id,
      role: "tabpanel",
      "aria-labelledby": `${id}-${group.kind}`,
    }),
    ...(dropOnStrip && {
      onDragOver,
      onDragLeave,
      onDrop: group.onDrop,
      "data-drag-active": isDragActive,
    }),
  };
}

function useReferenceGridColumns(
  gridRef: RefObject<HTMLDivElement | null>,
  compact: boolean,
) {
  const [columns, setColumns] = useState(2);
  useEffect(() => {
    const grid = gridRef.current;
    if (compact || !grid) return;

    const measure = () => {
      const tracks =
        getComputedStyle(grid).gridTemplateColumns.match(/[\d.]+px/g);
      if (tracks?.length) setColumns(tracks.length);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [compact, gridRef]);
  return columns;
}

function subscribeToViewportResize(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

function referenceRows() {
  if (window.innerWidth < 768) return 1;
  // Reserve room for the header, model, prompt and options as the rail grows.
  return Math.max(1, Math.floor((window.innerHeight - 550) / 210));
}

function ReferenceOverflowButton({
  overflow,
  singular,
  onOpen,
}: {
  overflow: number;
  singular: string;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  if (overflow <= 0) return null;
  return (
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
  );
}

function overviewThumbnailCount(
  { slots, limit }: StudioReferenceGroup,
  compact: boolean,
  cells: number,
) {
  const used = slots.length;
  const canAdd = used < limit;
  if (!compact) return Math.min(used, Math.max(1, cells - Number(canAdd)));
  return used > 4 && canAdd ? 3 : Math.min(used, 4);
}

type ReferenceUploadProps = {
  group: StudioReferenceGroup;
  isDragActive: boolean;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: () => void;
};

function ReferenceUpload({
  group,
  isDragActive,
  onDragOver,
  onDragLeave,
  expandRef,
  mode,
}: ReferenceUploadProps & {
  expandRef: RefObject<HTMLButtonElement | null>;
  mode: "overview" | "tile" | "footer";
}) {
  if (group.slots.length >= group.limit) return null;
  const { singular } = referenceKinds[group.kind];
  const footer = mode === "footer";
  return (
    <div
      className={`studio-reference-add-${mode}`}
      data-drag-active={isDragActive}
      onDragOver={(event) => {
        event.stopPropagation();
        onDragOver(event);
      }}
      onDragLeave={(event) => {
        event.stopPropagation();
        onDragLeave();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        group.onDrop(event);
      }}
    >
      <StudioReferenceSourceMenu
        key={group.kind}
        action="Add"
        label={`Add ${footer ? "more " : ""}${singular} references`}
        accept={`${singular}/*`}
        testId={footer ? `${group.uploadTestId}-upload` : group.uploadTestId}
        onPickFiles={group.onAdd}
        onOpenLibrary={() => group.onOpenLibrary(expandRef.current)}
      />
    </div>
  );
}

function ExpandedReferenceManager({
  group,
  groups,
  onSelect,
  onOpenPreview,
  uploadProps,
  expandRef,
  suspended,
  onClose,
  feedback,
  modelLabel,
}: ReferenceViewProps & {
  suspended: boolean;
  onClose: () => void;
  feedback?: ComposerStatusMessage | null;
  modelLabel: string;
}) {
  const managerId = useId();
  const { label, singular } = referenceKinds[group.kind];
  const available = Math.max(0, group.limit - group.slots.length);
  return createPortal(
    <StudioBrowserOverlay
      testId="studio-expanded-references"
      zIndexClassName="z-[118] studio-expanded-references"
      title="References"
      heading={
        <div className="studio-expanded-reference-title">
          <span>References</span>
          <span aria-hidden="true">·</span>
          <span>{modelLabel}</span>
        </div>
      }
      toolbar={
        <div className="studio-expanded-reference-toolbar">
          <ReferenceTabs
            groups={groups}
            selectedKind={group.kind}
            onSelect={onSelect}
            id={managerId}
            showLabels
          />
          <span className="studio-expanded-reference-summary">
            {group.slots.length} {label.toLowerCase()} added · {available}{" "}
            available
          </span>
        </div>
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
        <footer className="studio-expanded-reference-footer">
          <span role="status" className="studio-expanded-reference-summary">
            <span className="studio-expanded-reference-usage">
              {available > 0
                ? `${group.slots.length} of ${group.limit} ${label.toLowerCase()}`
                : "Reference limit reached"}
            </span>
            <span className="studio-expanded-reference-availability">
              {available > 0
                ? `${available} ${singular} slots available`
                : "Reference limit reached"}
            </span>
          </span>
          <div className="studio-expanded-reference-actions">
            <ReferenceUpload
              {...uploadProps}
              expandRef={expandRef}
              mode="footer"
            />
          </div>
          <Button
            appearance="admin"
            variant="primary"
            className="studio-expanded-reference-done"
            onClick={onClose}
          >
            Done
          </Button>
        </footer>
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
        <StudioBrowserGrid className="studio-expanded-reference-grid">
          <ReferenceTiles
            group={group}
            visibleCount={group.slots.length}
            expanded
            onOpenPreview={onOpenPreview}
            expandRef={expandRef}
            onDragOver={uploadProps.onDragOver}
            onDragLeave={uploadProps.onDragLeave}
          />
          <ReferenceUpload {...uploadProps} expandRef={expandRef} mode="tile" />
        </StudioBrowserGrid>
      </div>
    </StudioBrowserOverlay>,
    document.body,
  );
}

export function StudioReferenceManager({
  modelLabel,
  groups,
  dropOnStrip = false,
  expanded,
  suspended,
  onExpandedChange,
  isDragActive,
  onSetDragActive,
  onOpenPreview,
  feedback,
}: StudioReferenceManagerProps & {
  groups: StudioReferenceGroup[];
  dropOnStrip?: boolean;
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
  const viewProps = {
    group,
    groups: supportedGroups,
    onSelect: setSelectedKind,
    onOpenPreview,
    expandRef,
    uploadProps: { group, isDragActive, onDragOver, onDragLeave },
  };

  return (
    <>
      <ReferenceOverview
        {...viewProps}
        dropOnStrip={dropOnStrip}
        expanded={expanded}
        onOpen={(event) => {
          event.currentTarget.focus();
          setFeedbackAtOpen(feedback);
          onExpandedChange(true);
        }}
      />
      {expanded && (
        <ExpandedReferenceManager
          {...viewProps}
          modelLabel={modelLabel}
          suspended={suspended}
          feedback={feedback === feedbackAtOpen ? null : feedback}
          onClose={() => onExpandedChange(false)}
        />
      )}
    </>
  );
}
