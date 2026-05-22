"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";

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

function fallbackCopyTextToClipboard(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
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
  const mediaUrl = preview.mediaType === "image" ? preview.fullUrl ?? preview.url : preview.url;
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
        <img src={mediaUrl} alt={preview.label ?? `Display item ${index + 1}`} />
      ) : preview.mediaType === "video" ? (
        <video src={mediaUrl} poster={preview.posterUrl ?? undefined} muted playsInline />
      ) : (
        <audio src={mediaUrl} controls />
      )}
    </button>
  );
}

export function GraphNodeDisplayAny({ data }: { data: GraphNodeData }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyStatusTimerRef = useRef<number | null>(null);
  const previews = data.mediaPreviews?.length ? data.mediaPreviews : data.mediaPreview ? [data.mediaPreview] : [];
  const text = displayText(displayPayload(data));
  const hasPreviews = previews.length > 0;
  const displayClass = ["graph-display-any", hasPreviews ? "graph-display-any-has-media" : "graph-display-any-text-only"].join(" ");

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }
    copyStatusTimerRef.current = window.setTimeout(() => {
      setCopyStatus("idle");
      copyStatusTimerRef.current = null;
    }, 1800);
    return () => {
      if (copyStatusTimerRef.current != null) {
        window.clearTimeout(copyStatusTimerRef.current);
        copyStatusTimerRef.current = null;
      }
    };
  }, [copyStatus]);

  async function handleCopyText(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (!text) {
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!fallbackCopyTextToClipboard(text)) {
        throw new Error("Clipboard copy is unavailable.");
      }
      setCopyStatus("copied");
    } catch {
      if (fallbackCopyTextToClipboard(text)) {
        setCopyStatus("copied");
        return;
      }
      setCopyStatus("error");
    }
  }

  if (!data.outputSnapshot) {
    return <div className="graph-display-any-empty">Run to display incoming value.</div>;
  }

  return (
    <div className={displayClass}>
      {hasPreviews ? (
        <div className={previews.length > 1 ? "graph-display-any-media-grid" : "graph-display-any-media-single"}>
          {previews.slice(0, 8).map((preview, index) => (
            <MediaPreviewButton key={`${preview.url}-${index}`} preview={preview} previews={previews} index={index} onOpenPreview={data.onOpenPreview} />
          ))}
        </div>
      ) : null}
      {text ? (
        <div className="graph-display-any-text-wrap">
          <button
            type="button"
            className="graph-display-any-copy nodrag nopan"
            data-status={copyStatus}
            aria-label="Copy output"
            title={copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy output"}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => void handleCopyText(event)}
          >
            {copyStatus === "copied" ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <pre
            className="graph-display-any-text nodrag nopan"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {text}
          </pre>
        </div>
      ) : hasPreviews ? null : <div className="graph-display-any-empty">No displayable value.</div>}
    </div>
  );
}
