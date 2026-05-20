"use client";

import { Image as ImageIcon } from "lucide-react";

import type { GraphNodeData, GraphMediaPreview } from "./types";

export function openNodeImageLibrary(nodeId: string, data: GraphNodeData) {
  data.onOpenImageLibrary?.(nodeId);
  window.dispatchEvent(new CustomEvent("graph-studio-open-image-library", { detail: { nodeId } }));
}

export function dropNodeImage(nodeId: string, data: GraphNodeData, file: File) {
  if (data.onImageDrop) {
    data.onImageDrop(nodeId, file);
    return;
  }
  window.dispatchEvent(new CustomEvent("graph-studio-node-image-drop", { detail: { nodeId, file } }));
}

export function readGraphMediaDragPayload(dataTransfer: DataTransfer): { source: "reference" | "asset"; id: string; mediaType?: string | null } | null {
  const raw = dataTransfer.getData("application/x-media-studio-graph-media");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { source?: unknown; id?: unknown; mediaType?: unknown };
    if ((parsed.source === "reference" || parsed.source === "asset") && typeof parsed.id === "string") {
      return {
        source: parsed.source,
        id: parsed.id,
        mediaType: typeof parsed.mediaType === "string" ? parsed.mediaType : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function GraphNodeMediaPreview({
  nodeId,
  data,
  isLoadMedia,
  isSaveMedia,
}: {
  nodeId: string;
  data: GraphNodeData;
  isLoadMedia: boolean;
  isSaveMedia: boolean;
}) {
  const preview: GraphMediaPreview | null | undefined = data.mediaPreview;
  const previews = data.mediaPreviews ?? [];
  if (previews.length > 1) {
    const previewType = previews.every((item) => item.mediaType === previews[0]?.mediaType) ? previews[0]?.mediaType : "media";
    return (
      <div className="graph-node-preview graph-node-preview-strip" data-testid={`graph-node-preview-${nodeId}`}>
        <div className="graph-node-preview-count">{previews.length} {previewType === "media" ? "items" : `${previewType}s`}</div>
        <div className="graph-node-preview-grid">
          {previews.slice(0, 6).map((item, index) => (
            <button
              className="graph-node-preview-thumb nodrag"
              type="button"
              key={`${item.url}-${index}`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                data.onOpenPreview?.(item, previews);
              }}
            >
              {item.mediaType === "image" ? <img src={item.fullUrl ?? item.url} alt={item.label ?? `Graph image ${index + 1}`} /> : <span>{item.mediaType}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <>
      <div className="graph-node-preview" data-testid={`graph-node-preview-${nodeId}`}>
        {preview?.url ? (
          <>
            <button
              className="graph-node-preview-button nodrag"
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                data.onOpenPreview?.(preview, [preview]);
              }}
            >
              {preview.mediaType === "video" ? (
                <video src={preview.url} poster={preview.posterUrl ?? undefined} controls muted playsInline />
              ) : preview.mediaType === "audio" ? (
                <audio src={preview.url} controls />
              ) : (
                <img src={preview.fullUrl ?? preview.url} alt={preview.label ?? "Graph node preview"} />
              )}
            </button>
            {isLoadMedia ? (
              <div className="graph-node-preview-actions nodrag">
                <button
                  type="button"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    openNodeImageLibrary(nodeId, data);
                  }}
                >
                  Replace
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onSetFields?.(nodeId, { asset_id: "", reference_id: "" });
                  }}
                >
                  Remove
                </button>
              </div>
            ) : null}
          </>
        ) : isLoadMedia ? (
          <button
            className="graph-node-preview-empty nodrag"
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openNodeImageLibrary(nodeId, data);
            }}
          >
            <ImageIcon size={18} />
            <span>Drop media or choose from library</span>
          </button>
        ) : (
          <div className="graph-node-preview-empty">
            <span>{isSaveMedia ? "Output preview" : "No preview yet"}</span>
          </div>
        )}
      </div>
      {preview && (preview.aspectLabel || preview.resolutionLabel) ? (
        <div className="graph-node-media-meta">
          {preview.aspectLabel ? <span>{preview.aspectLabel}</span> : null}
          {preview.resolutionLabel ? <span>{preview.resolutionLabel}</span> : null}
        </div>
      ) : null}
    </>
  );
}
