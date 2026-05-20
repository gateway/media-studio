import { cn } from "@/lib/utils";

export type StudioBadgeTone = "default" | "accent" | "project" | "danger";
export type StudioBadgeSize = "default" | "compact";

export function studioBadgeClassName({
  tone = "default",
  size = "default",
  className,
}: {
  tone?: StudioBadgeTone;
  size?: StudioBadgeSize;
  className?: string;
} = {}) {
  return cn(
    "studio-badge",
    size === "compact" ? "studio-badge-compact" : "",
    tone === "accent"
      ? "studio-badge-accent"
      : tone === "project"
        ? "studio-badge-project"
        : tone === "danger"
          ? "studio-badge-danger"
          : "",
    className,
  );
}

export function studioBadgeIconClassName({
  tone = "default",
  className,
}: {
  tone?: StudioBadgeTone;
  className?: string;
} = {}) {
  return cn(
    "studio-badge-icon",
    tone === "accent"
      ? "studio-badge-icon-accent"
      : tone === "project"
        ? "studio-badge-icon-project"
        : tone === "danger"
          ? "studio-badge-icon-danger"
          : "",
    className,
  );
}

export function studioMetaLabelClassName({ className }: { className?: string } = {}) {
  return cn("studio-meta-label", className);
}

export function studioMetaValueClassName({
  tone = "default",
  className,
}: {
  tone?: "default" | "accent";
  className?: string;
}) {
  return cn(tone === "accent" ? "studio-meta-value-accent" : "studio-meta-value", className);
}

export function studioCaptionClassName({ className }: { className?: string } = {}) {
  return cn("studio-caption", className);
}

export function studioPreviewFallbackClassName({ className }: { className?: string } = {}) {
  return cn("studio-preview-fallback", className);
}

export function studioPreviewOverlayClassName({ className }: { className?: string } = {}) {
  return cn("studio-preview-overlay", className);
}
