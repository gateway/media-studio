"use client";

import type { GraphMediaPreview, GraphNodeData } from "./types";

type OutputRef = {
  kind?: string | null;
  media_type?: string | null;
  asset_id?: string | null;
  reference_id?: string | null;
  job_id?: string | null;
  value?: unknown;
  metadata?: Record<string, unknown>;
};

function refsForPort(snapshot: Record<string, unknown> | undefined, port: string): OutputRef[] {
  const refs = snapshot?.[port];
  if (!Array.isArray(refs)) return [];
  return refs.filter((item): item is OutputRef => Boolean(item && typeof item === "object"));
}

function displayPayload(data: GraphNodeData): unknown {
  const snapshot = data.outputSnapshot;
  const valueRefs = refsForPort(snapshot, "value");
  if (valueRefs.length === 1) return valueRefs[0].value ?? valueRefs[0];
  if (valueRefs.length > 1) return valueRefs.map((ref) => ref.value ?? ref);
  const jsonRef = refsForPort(snapshot, "json")[0];
  if (jsonRef) return jsonRef.value ?? jsonRef;
  return null;
}

function displayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function MediaPreviewButton({
  preview,
  previews,
  index,
  onOpenPreview,
}: {
  preview: GraphMediaPreview;
  previews: GraphMediaPreview[];
  index: number;
  onOpenPreview?: (preview: GraphMediaPreview, collection?: GraphMediaPreview[]) => void;
}) {
  return (
    <button
      className="graph-display-any-media-item nodrag"
      onClick={(event) => {
        event.stopPropagation();
        onOpenPreview?.(preview, previews);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      type="button"
    >
      {preview.mediaType === "image" ? (
        <img src={preview.url} alt={preview.label ?? `Display item ${index + 1}`} />
      ) : preview.mediaType === "video" ? (
        <video src={preview.url} poster={preview.posterUrl ?? undefined} muted playsInline />
      ) : (
        <audio src={preview.url} controls />
      )}
    </button>
  );
}

export function GraphNodeDisplayAny({ data }: { data: GraphNodeData }) {
  const previews = data.mediaPreviews?.length ? data.mediaPreviews : data.mediaPreview ? [data.mediaPreview] : [];
  const text = displayText(displayPayload(data));

  if (!data.outputSnapshot) {
    return <div className="graph-display-any-empty">Run to display incoming value.</div>;
  }

  return (
    <div className="graph-display-any">
      {previews.length ? (
        <div className={previews.length > 1 ? "graph-display-any-media-grid" : "graph-display-any-media-single"}>
          {previews.slice(0, 8).map((preview, index) => (
            <MediaPreviewButton key={`${preview.url}-${index}`} preview={preview} previews={previews} index={index} onOpenPreview={data.onOpenPreview} />
          ))}
        </div>
      ) : null}
      {text ? <pre className="graph-display-any-text">{text}</pre> : previews.length ? null : <div className="graph-display-any-empty">No displayable value.</div>}
    </div>
  );
}
