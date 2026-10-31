"use client";

import { Folder } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The primary row and its management actions are sibling controls. */
export function MediaBrowserRow({
  name,
  description,
  imageUrl,
  metadata,
  status,
  selected,
  onOpen,
  actions,
  testId,
}: {
  name: string;
  description: string;
  imageUrl?: string | null;
  metadata: ReactNode;
  status?: ReactNode;
  selected?: boolean;
  onOpen: () => void;
  actions: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        "media-browser-row",
        selected && "media-browser-row-selected",
      )}
      data-testid={testId}
    >
      <button
        type="button"
        className="media-browser-row-open"
        onClick={onOpen}
        aria-label={`Open ${name}`}
        aria-current={selected ? "true" : undefined}
      >
        <span className="media-browser-row-preview">
          {imageUrl ? (
            <img src={imageUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            <Folder aria-hidden="true" />
          )}
        </span>
        <span className="media-browser-row-copy">
          <span className="media-browser-row-title">{name}</span>
          <span className="media-browser-row-description">{description}</span>
        </span>
        <span className="media-browser-row-metadata">{metadata}</span>
        <span className="media-browser-row-status">{status}</span>
      </button>
      <div className="media-browser-item-actions">{actions}</div>
    </div>
  );
}
