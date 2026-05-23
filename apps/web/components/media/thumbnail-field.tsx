"use client";

import Image from "next/image";
import { useState } from "react";
import type { ButtonHTMLAttributes, DragEvent, ReactNode, RefObject } from "react";
import { ImageIcon, Images, Trash2, Upload } from "lucide-react";

import { AdminIconButton } from "@/components/admin-controls";
import { iconButtonClassName } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

export function ThumbnailField({
  label = "Thumbnail",
  imageUrl,
  imageAlt = "",
  emptyLabel = "No thumbnail",
  chooseLabel = "Choose from generated images",
  browseLabel = "Browse generated images",
  uploadLabel = "Upload thumbnail",
  removeLabel = "Remove thumbnail",
  appearance = "admin",
  aspect = "video",
  isUploading = false,
  isBrowsing = false,
  inputRef,
  onChoose,
  onUploadFile,
  onRemove,
  surface = true,
  className,
}: {
  label?: string;
  imageUrl?: string | null;
  imageAlt?: string;
  emptyLabel?: string;
  chooseLabel?: string;
  browseLabel?: string;
  uploadLabel?: string;
  removeLabel?: string;
  appearance?: "admin" | "studio";
  aspect?: "video" | "square";
  isUploading?: boolean;
  isBrowsing?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChoose: () => void;
  onUploadFile: (file: File) => void;
  onRemove: () => void;
  surface?: boolean;
  className?: string;
}) {
  const hasImage = Boolean(imageUrl);
  const [dragActive, setDragActive] = useState(false);
  const uploadButtonLabel = isUploading ? "Uploading thumbnail" : uploadLabel;
  const browseButtonLabel = isBrowsing ? "Loading generated images" : browseLabel;
  const labelClassName = appearance === "studio" ? "studio-field-label" : "admin-label-accent mb-4";
  const previewSizeClassName = aspect === "square" ? "h-48 sm:h-60" : "h-40 sm:h-52";
  const previewClassName =
    appearance === "studio"
      ? cn(
        "media-browser-card-thumbnail group relative overflow-hidden text-left",
        previewSizeClassName,
        dragActive ? "border-[var(--accent-strong)] bg-[var(--accent-soft)]" : "",
      )
      : cn(
        "group relative overflow-hidden rounded-[var(--admin-radius-sm)] border border-[var(--surface-border-soft)] bg-[var(--surface-preview-bg)] text-left transition hover:border-[var(--surface-border)]",
        previewSizeClassName,
        dragActive ? "border-[var(--accent-strong)] bg-[var(--accent-soft)]" : "",
      );

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLButtonElement>) {
    const nextTarget = event.relatedTarget;
    if (!nextTarget || !(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setDragActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file?.type.startsWith("image/")) {
      onUploadFile(file);
    }
  }

  return (
    <div className={cn(surface ? "admin-surface-accent p-4 sm:p-5" : "grid gap-2", className)}>
      <div className={labelClassName}>{label}</div>
      <div className="grid gap-4">
        <button
          type="button"
          onClick={onChoose}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={previewClassName}
          aria-label={chooseLabel}
        >
          {imageUrl ? (
            <Image src={imageUrl} alt={imageAlt} fill sizes="420px" className="object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[var(--muted-strong)]">
              <ImageIcon className="size-7" aria-hidden="true" />
              <span className="sr-only">{emptyLabel}</span>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-3 right-3 grid size-9 place-items-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-overlay-panel)] text-[var(--foreground)] opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
            <Images className="size-4" aria-hidden="true" />
          </div>
          {dragActive ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[var(--surface-overlay-panel)] text-sm font-semibold text-[var(--foreground)]">
              Drop image to upload
            </div>
          ) : null}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onUploadFile(file);
            }
            event.currentTarget.value = "";
          }}
        />
        <div className="flex flex-wrap gap-2">
          <ThumbnailIconButton
            appearance={appearance}
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            label={uploadButtonLabel}
          >
            <Upload className="size-4" aria-hidden="true" />
          </ThumbnailIconButton>
          <ThumbnailIconButton
            appearance={appearance}
            onClick={onChoose}
            disabled={isBrowsing}
            label={browseButtonLabel}
          >
            <Images className="size-4" aria-hidden="true" />
          </ThumbnailIconButton>
          <ThumbnailIconButton
            appearance={appearance}
            onClick={onRemove}
            disabled={!hasImage}
            label={removeLabel}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </ThumbnailIconButton>
        </div>
      </div>
    </div>
  );
}

function ThumbnailIconButton({
  appearance,
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  appearance: "admin" | "studio";
  label: string;
  children: ReactNode;
}) {
  if (appearance === "admin") {
    return (
      <AdminIconButton {...props} label={label}>
        {children}
      </AdminIconButton>
    );
  }

  return (
    <button
      {...props}
      type={props.type ?? "button"}
      aria-label={label}
      className={iconButtonClassName({
        appearance: "studio",
        tone: "subtle",
        className: cn("group/icon relative", props.className),
      })}
    >
      {children}
      <span className="pointer-events-none absolute bottom-[calc(100%+0.45rem)] left-1/2 z-20 max-w-48 -translate-x-1/2 rounded-[var(--radius-control)] border border-[var(--surface-border-soft)] bg-[var(--surface-overlay-panel)] px-2.5 py-1.5 text-[0.66rem] leading-tight font-semibold text-[var(--text-primary)] opacity-0 shadow-sm transition group-hover/icon:opacity-100 group-focus-visible/icon:opacity-100">
        {label}
      </span>
    </button>
  );
}
