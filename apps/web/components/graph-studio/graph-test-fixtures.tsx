"use client";

import { useMemo, useState, type ReactNode } from "react";

import { MediaImagePickerDialog } from "@/components/media/media-image-picker-dialog";
import { referenceMediaPickerItem } from "@/components/media/media-image-picker-sources";
import type { MediaReference } from "@/lib/types";
import { NODE_COLOR_CHOICES } from "./graph-studio-constants";
import { GraphGroupContextMenu } from "./graph-group-context-menu";
import { GraphNodeContextMenu } from "./graph-node-context-menu";
import { GraphNodeDisplayAny } from "./graph-node-display-any";
import { GraphNodeMediaPreview } from "./graph-node-media-preview";
import { GraphPreviewOverlay } from "./graph-preview-overlay";
import { GraphPricingConfirmation } from "./graph-pricing-confirmation";
import { GraphToolbar } from "./graph-toolbar";
import type {
  GraphEstimateResponse,
  GraphMediaPreview,
  GraphNodeData,
  GraphNodeDefinition,
  GraphRun,
  GraphRunTransportMetrics,
  GraphWorkspaceTab,
} from "./types";
import { previewFromReference } from "./utils/graph-media-preview";

export type GraphStudioFixtureKind =
  | "audio-picker"
  | "display-any"
  | "load-video"
  | "preview-overlay"
  | "pricing-modal"
  | "toolbar"
  | "video-picker"
  | "wires-context-status";

const FIXTURE_KINDS = new Set<GraphStudioFixtureKind>([
  "audio-picker",
  "display-any",
  "load-video",
  "preview-overlay",
  "pricing-modal",
  "toolbar",
  "video-picker",
  "wires-context-status",
]);

const noop = () => undefined;

function localGraphFixtureEnabled() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("graphTestHarness") !== "1") return false;
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1"
  );
}

export function graphStudioFixtureKind(): GraphStudioFixtureKind | null {
  if (!localGraphFixtureEnabled()) return null;
  const value = new URLSearchParams(window.location.search).get("graphFixture");
  if (!value || !FIXTURE_KINDS.has(value as GraphStudioFixtureKind)) {
    return "display-any";
  }
  return value as GraphStudioFixtureKind;
}

function fixtureSvg(label: string, primary: string, secondary: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="${primary}"/><circle cx="236" cy="62" r="36" fill="${secondary}"/><path d="M0 152 C58 102 96 118 144 82 C196 42 242 116 320 58 V180 H0 Z" fill="black" opacity="0.42"/><text x="22" y="42" font-family="Arial" font-size="24" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const fixturePreviews: GraphMediaPreview[] = [
  {
    mediaType: "image",
    url: fixtureSvg("AURORA", "midnightblue", "lime"),
    label: "Aurora gate",
    width: 320,
    height: 180,
    resolutionLabel: "320 x 180",
  },
  {
    mediaType: "image",
    url: fixtureSvg("EMBER", "darkred", "gold"),
    label: "Ember archive",
    width: 320,
    height: 180,
    resolutionLabel: "320 x 180",
  },
  {
    mediaType: "image",
    url: fixtureSvg("VOID", "rebeccapurple", "cyan"),
    label: "Void relay",
    width: 320,
    height: 180,
    resolutionLabel: "320 x 180",
  },
];

const fixtureVideoReference = {
  reference_id: "graph-fixture-motion-driving-video",
  kind: "video",
  status: "ready",
  attached_project_ids: ["project-fixture-motion"],
  original_filename: "graph-motion-driving-20s-720x1280.mp4",
  stored_path: "reference-media/videos/e999def30e2ef482d3aff3d381459ec76f7def3ab4b7b32aa9b62e601240b402.mp4",
  mime_type: "video/mp4",
  file_size_bytes: 57_816,
  sha256: "e999def30e2ef482d3aff3d381459ec76f7def3ab4b7b32aa9b62e601240b402",
  width: 720,
  height: 1280,
  duration_seconds: 20.083333,
  stored_url: "/api/control/files/reference-media/videos/e999def30e2ef482d3aff3d381459ec76f7def3ab4b7b32aa9b62e601240b402.mp4",
  thumb_url: fixtureSvg("VIDEO", "black", "deepskyblue"),
  poster_url: fixtureSvg("VIDEO", "black", "deepskyblue"),
  usage_count: 0,
  last_used_at: null,
  metadata: {},
  created_at: "2026-06-19T00:00:00.000Z",
  updated_at: "2026-06-19T00:00:00.000Z",
} satisfies MediaReference;

const fixtureAudioReference = {
  reference_id: "graph-fixture-dialog-audio",
  kind: "audio",
  status: "ready",
  attached_project_ids: ["project-fixture-audio"],
  original_filename: "graph-dialog-line-2s.wav",
  stored_path: "reference-media/audios/4e5d8acf78c0931e346766bffe75efc79b3d1ee84dbe9e1944a26e6969f74b58.wav",
  mime_type: "audio/wav",
  file_size_bytes: 88_278,
  sha256: "4e5d8acf78c0931e346766bffe75efc79b3d1ee84dbe9e1944a26e6969f74b58",
  width: null,
  height: null,
  duration_seconds: 2,
  stored_url: "/api/control/files/reference-media/audios/4e5d8acf78c0931e346766bffe75efc79b3d1ee84dbe9e1944a26e6969f74b58.wav",
  thumb_url: null,
  poster_url: null,
  usage_count: 0,
  last_used_at: null,
  metadata: {
    format_name: "wav",
    sample_rate: 44100,
    channels: 1,
  },
  created_at: "2026-06-19T00:00:00.000Z",
  updated_at: "2026-06-19T00:00:00.000Z",
} satisfies MediaReference;

const displayAnyDefinition: GraphNodeDefinition = {
  type: "display.any",
  title: "Display Any",
  category: "Output",
  ports: {
    inputs: [],
    outputs: [],
  },
  fields: [],
};

function displayAnyData(data: Partial<GraphNodeData> = {}): GraphNodeData {
  return {
    definition: displayAnyDefinition,
    fields: {},
    status: "idle",
    progress: null,
    errorMessage: null,
    activityLabel: null,
    activityDetail: null,
    activityTone: null,
    onFieldChange: noop,
    ...data,
  };
}

const pricingEstimate: GraphEstimateResponse = {
  pricing_summary: {
    total: {
      estimated_credits: 42,
      estimated_cost_usd: 0.21,
    },
    has_numeric_estimate: true,
    has_unknown_pricing: true,
  },
  nodes: {},
  warnings: [
    {
      code: "missing_model_pricing",
      message: "One fixture node uses unknown pricing.",
    },
  ],
};

const transportMetrics: GraphRunTransportMetrics = {
  statusRequests: 0,
  fullRunRequests: 0,
  eventRequests: 0,
  streamConnections: 0,
  streamErrors: 0,
};

const fixtureTabs: GraphWorkspaceTab[] = [
  {
    tab_id: "fixture-running",
    workflow_name: "Fixture running",
    run_status: "running",
  },
  {
    tab_id: "fixture-dirty",
    workflow_name: "Fixture draft",
    dirty: true,
  },
];

const runningRun: GraphRun = {
  run_id: "fixture-run-running",
  workflow_id: "fixture-workflow",
  status: "running",
};

const cancellingRun: GraphRun = {
  run_id: "fixture-run-cancelling",
  workflow_id: "fixture-workflow",
  status: "cancelling",
};

function FixtureShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      className="graph-fixture-layer"
      data-testid="graph-fixture-layer"
      aria-label={title}
    >
      <div className="graph-fixture-header">
        <strong>{title}</strong>
      </div>
      {children}
    </section>
  );
}

function DisplayAnyFixture() {
  return (
    <FixtureShell title="Graph Display Any fixture">
      <div className="graph-fixture-grid graph-fixture-grid-display-any">
        <div className="graph-fixture-card">
          <span>Empty</span>
          <GraphNodeDisplayAny data={displayAnyData()} />
        </div>
        <div className="graph-fixture-card">
          <span>Media</span>
          <GraphNodeDisplayAny
            data={displayAnyData({
              mediaPreviews: fixturePreviews,
              outputSnapshot: {},
            })}
          />
        </div>
        <div className="graph-fixture-card">
          <span>Copied</span>
          <button
            type="button"
            className="graph-display-any-copy nodrag nopan"
            data-status="copied"
            aria-label="Fixture copied output"
          >
            OK
          </button>
        </div>
        <div className="graph-fixture-card">
          <span>Error</span>
          <button
            type="button"
            className="graph-display-any-copy nodrag nopan"
            data-status="error"
            aria-label="Fixture copy failed"
          >
            !
          </button>
        </div>
      </div>
    </FixtureShell>
  );
}

function LoadVideoFixture() {
  const preview = previewFromReference(fixtureVideoReference);
  const data: GraphNodeData = {
    definition: {
      type: "media.load_video",
      title: "Load Video",
      description: "Load an existing Media Studio video asset or reference video.",
      category: "Media",
      fields: [],
      ports: {
        inputs: [],
        outputs: [{ id: "video", label: "Video", type: "video" }],
      },
    },
    fields: { reference_id: fixtureVideoReference.reference_id },
    mediaPreview: preview,
    onFieldChange: noop,
    onSetFields: noop,
    onOpenImageLibrary: noop,
    onOpenPreview: noop,
  };
  return (
    <FixtureShell title="Graph Load Video fixture">
      <div className="graph-fixture-grid graph-fixture-grid-load-video">
        <div
          className="graph-node graph-fixture-load-video-node"
          data-testid="graph-fixture-load-video-node"
          data-reference-id={fixtureVideoReference.reference_id}
        >
          <div className="graph-node-header">
            <div className="graph-node-header-text">
              <div className="graph-node-title">Load Video</div>
              <div className="graph-node-kind">Media input</div>
            </div>
          </div>
          <div className="graph-node-body">
            <GraphNodeMediaPreview
              nodeId="graph-fixture-load-video"
              data={data}
              isLoadMedia
              isSaveMedia={false}
            />
          </div>
        </div>
      </div>
    </FixtureShell>
  );
}

function VideoPickerFixture() {
  const item = referenceMediaPickerItem(fixtureVideoReference, "video");
  return (
    <MediaImagePickerDialog
      open
      dialogLabel="Video picker fixture"
      eyebrow="Imported Videos"
      title="Choose a video"
      description="Fixture for proving video metadata tile rows."
      items={item ? [item] : []}
      loading={false}
      loadingMore={false}
      nextOffset={null}
      selectionId={null}
      purpose="reference"
      imageFit="cover"
      itemLabel="video"
      emptyMessage="No fixture videos."
      onClose={noop}
      onLoadMore={noop}
      onSelectItem={noop}
    />
  );
}

function AudioPickerFixture() {
  const item = referenceMediaPickerItem(fixtureAudioReference, "audio");
  return (
    <MediaImagePickerDialog
      open
      dialogLabel="Audio picker fixture"
      eyebrow="Imported Audio"
      title="Choose audio"
      description="Fixture for proving audio metadata tile rows."
      items={item ? [item] : []}
      loading={false}
      loadingMore={false}
      nextOffset={null}
      selectionId={null}
      purpose="reference"
      imageFit="cover"
      itemLabel="audio"
      emptyMessage="No fixture audio."
      onClose={noop}
      onLoadMore={noop}
      onSelectItem={noop}
    />
  );
}

function PreviewOverlayFixture() {
  const [index, setIndex] = useState(1);
  return (
    <GraphPreviewOverlay
      previews={fixturePreviews}
      index={index}
      onClose={noop}
      onNavigate={setIndex}
    />
  );
}

function PricingModalFixture() {
  const state = useMemo(
    () => ({
      estimate: pricingEstimate,
      resolve: noop,
    }),
    [],
  );
  return (
    <GraphPricingConfirmation
      state={state}
      availableCredits={8}
      onAnswer={noop}
    />
  );
}

function ToolbarFixture() {
  return (
    <FixtureShell title="Graph toolbar fixture">
      <div className="graph-fixture-stack">
        <GraphToolbar
          workflowName="Fixture workflow"
          tabs={fixtureTabs}
          activeTabId="fixture-running"
          workflowMenuOpen={false}
          renameDialogOpen={false}
          renameDraft="Fixture workflow"
          run={runningRun}
          transportMetrics={transportMetrics}
          creditText="Credits unavailable"
          creditsUnavailable
          graphPricing={pricingEstimate}
          onToggleWorkflowMenu={noop}
          onSwitchTab={noop}
          onNewTab={noop}
          onCloseTab={noop}
          canUndo={false}
          canRedo={false}
          onUndo={noop}
          onRedo={noop}
          onSave={noop}
          onSaveAs={noop}
          onExportWorkflow={noop}
          onExportBundle={noop}
          onOpenRename={noop}
          onCloseWorkflow={noop}
          onRenameDraftChange={noop}
          onCommitRename={noop}
          onCancelRename={noop}
          onRun={noop}
          onCancelRun={noop}
        />
        <GraphToolbar
          workflowName="Fixture workflow"
          tabs={fixtureTabs}
          activeTabId="fixture-running"
          workflowMenuOpen={false}
          renameDialogOpen={false}
          renameDraft="Fixture workflow"
          run={cancellingRun}
          transportMetrics={transportMetrics}
          creditText="12 credits"
          creditsUnavailable={false}
          graphPricing={pricingEstimate}
          onToggleWorkflowMenu={noop}
          onSwitchTab={noop}
          onNewTab={noop}
          onCloseTab={noop}
          canUndo={false}
          canRedo={false}
          onUndo={noop}
          onRedo={noop}
          onSave={noop}
          onSaveAs={noop}
          onExportWorkflow={noop}
          onExportBundle={noop}
          onOpenRename={noop}
          onCloseWorkflow={noop}
          onRenameDraftChange={noop}
          onCommitRename={noop}
          onCancelRename={noop}
          onRun={noop}
          onCancelRun={noop}
        />
      </div>
    </FixtureShell>
  );
}

function WiresContextStatusFixture() {
  return (
    <FixtureShell title="Graph wire, context, and status fixture">
      <div className="graph-fixture-grid graph-fixture-grid-status">
        <div className="graph-fixture-edge-board">
          <svg
            className="graph-fixture-edge-svg"
            viewBox="0 0 360 150"
            aria-label="Selected fixture wire"
          >
            <g className="react-flow__edge selected graph-edge-delete-armed graph-edge-text">
              <path
                className="react-flow__edge-path"
                d="M 32 118 C 132 28 228 132 328 42"
              />
            </g>
            <g className="react-flow__edge graph-edge-video">
              <path
                className="react-flow__edge-path"
                d="M 34 78 C 126 26 226 36 326 78"
              />
            </g>
            <g className="react-flow__edge graph-edge-job">
              <path
                className="react-flow__edge-path"
                d="M 34 96 C 128 154 238 18 326 96"
              />
            </g>
            <path
              className="graph-wire-drag-path graph-wire-drag-path-text"
              d="M 32 42 C 116 8 238 142 328 114"
            />
            <path
              className="graph-wire-drag-path graph-wire-drag-path-video"
              d="M 32 24 C 116 52 238 52 328 24"
            />
            <path
              className="graph-wire-drag-path graph-wire-drag-path-job"
              d="M 32 136 C 116 104 238 104 328 136"
            />
          </svg>
          <div className="graph-fixture-handle-row" aria-label="Fixture typed handles">
            <span className="graph-handle graph-handle-video" />
            <span className="graph-handle graph-handle-job" />
          </div>
          <button
            type="button"
            className="graph-edge-delete-button"
            aria-label="Delete wire"
          >
            x
          </button>
        </div>
        <div className="graph-fixture-context-host">
          <GraphNodeContextMenu
            x={0}
            y={0}
            colors={NODE_COLOR_CHOICES}
            targetCount={2}
            canRename={false}
            executionMode="frozen"
            onSelectColor={noop}
            onSetExecutionMode={noop}
            onClear={noop}
            onRename={noop}
            onCreateGroup={noop}
          />
          <GraphGroupContextMenu
            x={220}
            y={0}
            title="Fixture group"
            titleDraft="Fixture group"
            colors={NODE_COLOR_CHOICES}
            executionMode="frozen"
            onTitleDraftChange={noop}
            onCommitTitle={noop}
            onSelectColor={noop}
            onSetExecutionMode={noop}
            onDelete={noop}
          />
        </div>
        <div className="graph-fixture-status-grid">
          <div className="graph-node graph-node-execution-frozen">
            <div className="graph-node-header">
              <div className="graph-node-header-text">
                <div className="graph-node-title">Frozen node</div>
                <div className="graph-node-kind">Fixture</div>
              </div>
              <div className="graph-node-header-actions">
                <span className="graph-node-status graph-node-execution-chip">
                  Muted
                </span>
              </div>
            </div>
          </div>
          <div className="graph-node graph-node-execution-bypassed graph-node-bypassed">
            <div className="graph-node-header">
              <div className="graph-node-header-text">
                <div className="graph-node-title">Bypassed node</div>
                <div className="graph-node-kind">Fixture</div>
              </div>
            </div>
          </div>
          <div className="graph-node graph-node-failed">
            <div className="graph-node-header">
              <div className="graph-node-header-text">
                <div className="graph-node-title">Failed node</div>
                <div className="graph-node-kind">Fixture</div>
              </div>
              <div className="graph-node-header-actions">
                <span className="graph-node-status graph-node-activity-chip graph-node-activity-chip-error">
                  Error
                </span>
              </div>
            </div>
            <div className="graph-node-body">
              <div className="graph-node-error">Fixture node failed.</div>
            </div>
          </div>
          <div className="graph-node">
            <div className="graph-node-body">
              <div className="graph-node-warning">Fixture warning state.</div>
            </div>
          </div>
        </div>
      </div>
    </FixtureShell>
  );
}

export function GraphStudioFixtureLayer({
  kind,
}: {
  kind: GraphStudioFixtureKind | null;
}) {
  if (!kind) return null;
  switch (kind) {
    case "audio-picker":
      return <AudioPickerFixture />;
    case "display-any":
      return <DisplayAnyFixture />;
    case "load-video":
      return <LoadVideoFixture />;
    case "preview-overlay":
      return <PreviewOverlayFixture />;
    case "pricing-modal":
      return <PricingModalFixture />;
    case "toolbar":
      return <ToolbarFixture />;
    case "video-picker":
      return <VideoPickerFixture />;
    case "wires-context-status":
      return <WiresContextStatusFixture />;
  }
}
