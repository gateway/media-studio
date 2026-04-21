import type { ComponentPropsWithoutRef, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type SurfaceAppearance = "studio" | "admin";
export type SurfaceTone = "default" | "accent" | "muted" | "danger" | "warning" | "success";
export type SurfaceDensity = "default" | "compact";

export function surfaceCardClassName({
  appearance = "studio",
  tone = "default",
  density = "default",
  interactive = false,
  className,
}: {
  appearance?: SurfaceAppearance;
  tone?: SurfaceTone;
  density?: SurfaceDensity;
  interactive?: boolean;
  className?: string;
}) {
  return cn(
    tone === "accent" ? "surface-card-accent" : "surface-card",
    appearance === "studio" ? "text-[var(--text-primary)]" : "text-[var(--foreground)]",
    density === "compact" ? "px-4 py-4" : "px-5 py-5",
    interactive ? "transition-colors duration-150" : "",
    className,
  );
}

export function surfaceInsetClassName({
  density = "default",
  className,
}: {
  appearance?: SurfaceAppearance;
  density?: SurfaceDensity;
  className?: string;
}) {
  return cn(density === "compact" ? "surface-inset px-3 py-3" : "surface-inset px-4 py-4", className);
}

export function infoRowClassName({
  interactive = false,
  className,
}: {
  appearance?: SurfaceAppearance;
  interactive?: boolean;
  className?: string;
}) {
  return cn(
    "surface-info-row",
    interactive ? "text-left transition hover:bg-white/[0.05]" : "",
    className,
  );
}

export function emptyStateClassName({
  density = "default",
  className,
}: {
  appearance?: SurfaceAppearance;
  density?: SurfaceDensity;
  className?: string;
}) {
  return cn(
    "surface-empty-state",
    density === "compact" ? "px-5 py-6" : "px-8 py-10",
    className,
  );
}

export function overlayPanelClassName({
  className,
}: {
  appearance?: SurfaceAppearance;
  density?: SurfaceDensity;
  className?: string;
}) {
  return cn("overlay-panel", className);
}

export function mediaBrowserCardClassName({
  selected = false,
  muted = false,
  className,
}: {
  appearance?: SurfaceAppearance;
  selected?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return cn(
    "media-browser-card",
    selected ? "ring-1 ring-[rgba(208,255,72,0.32)]" : "",
    muted ? "opacity-80" : "",
    className,
  );
}

export function calloutPanelClassName({
  tone = "default",
  className,
}: {
  appearance?: SurfaceAppearance;
  tone?: SurfaceTone;
  className?: string;
}) {
  return cn(
    "callout-panel",
    tone === "danger"
      ? "callout-panel-danger"
      : tone === "warning"
        ? "callout-panel-warning"
        : tone === "success"
          ? "callout-panel-success"
          : tone === "accent"
            ? "callout-panel-accent"
            : tone === "muted"
              ? "callout-panel-muted"
              : "",
    className,
  );
}

export function propertyStackClassName({
  className,
}: {
  appearance?: SurfaceAppearance;
  className?: string;
}) {
  return cn("property-stack", className);
}

export function surfaceInputShellClassName({
  className,
}: {
  appearance?: SurfaceAppearance;
  density?: SurfaceDensity;
  className?: string;
}) {
  return cn("surface-input-shell", className);
}

export function SurfaceCard({
  as: Component = "div",
  appearance = "studio",
  tone = "default",
  density = "default",
  interactive = false,
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  as?: "div" | "section";
  appearance?: SurfaceAppearance;
  tone?: SurfaceTone;
  density?: SurfaceDensity;
  interactive?: boolean;
}) {
  return <Component {...props} className={surfaceCardClassName({ appearance, tone, density, interactive, className })} />;
}

export function SurfaceInset({
  appearance = "studio",
  density = "default",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  appearance?: SurfaceAppearance;
  density?: SurfaceDensity;
}) {
  return <div {...props} className={surfaceInsetClassName({ appearance, density, className })} />;
}

export function InfoRow({
  appearance = "studio",
  label,
  value,
  interactive = false,
  className,
  valueClassName,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  appearance?: SurfaceAppearance;
  label: ReactNode;
  value: ReactNode;
  interactive?: boolean;
  valueClassName?: string;
}) {
  return (
    <div {...props} className={infoRowClassName({ appearance, interactive, className })}>
      <span className={appearance === "studio" ? "text-sm text-white/56" : "text-sm text-[var(--muted-strong)]"}>{label}</span>
      <span
        className={cn(
          appearance === "studio"
            ? "text-sm font-medium text-white/92"
            : "text-sm font-medium text-[var(--foreground)]",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function SectionHeader({
  appearance = "studio",
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  appearance?: SurfaceAppearance;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-start lg:justify-between", appearance === "admin" ? "border-[var(--surface-border-soft)]" : "border-white/8", className)}>
      <div className="space-y-2">
        {eyebrow ? (
          <div className={appearance === "admin" ? "admin-panel-eyebrow" : "surface-label-accent"}>{eyebrow}</div>
        ) : null}
        <div>
          <div className={appearance === "admin" ? "admin-panel-title" : "surface-section-title"}>{title}</div>
          {description ? (
            <div className={appearance === "admin" ? "admin-panel-description" : "surface-section-description"}>{description}</div>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function OverlayShell({
  children,
  backdropClassName,
  panelClassName,
  innerClassName,
}: {
  children: ReactNode;
  backdropClassName?: string;
  panelClassName?: string;
  innerClassName?: string;
}) {
  return (
    <div className={cn("overlay-backdrop", backdropClassName)}>
      <div className={cn("min-h-dvh p-0 lg:p-6", innerClassName)}>
        <div className={cn("overlay-panel", panelClassName)}>{children}</div>
      </div>
    </div>
  );
}

export function OverlayHeader({
  appearance = "studio",
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  appearance?: SurfaceAppearance;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overlay-header", appearance === "admin" ? "border-[var(--surface-border-soft)]" : "", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className={appearance === "admin" ? "admin-label-accent" : "surface-label-accent"}>{eyebrow}</div>
        ) : null}
        <div className={cn(eyebrow ? "mt-2" : "", appearance === "admin" ? "admin-section-title" : "surface-section-title")}>
          {title}
        </div>
        {description ? (
          <div className={appearance === "admin" ? "admin-section-description" : "surface-section-description"}>
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="overlay-header-actions">{actions}</div> : null}
    </div>
  );
}

export function MediaBrowserCard({
  appearance = "studio",
  selected = false,
  muted = false,
  interactive = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  appearance?: SurfaceAppearance;
  selected?: boolean;
  muted?: boolean;
  interactive?: boolean;
}) {
  return (
    <SurfaceCard
      {...props}
      appearance={appearance}
      density="compact"
      interactive={interactive}
      className={mediaBrowserCardClassName({ appearance, selected, muted, className })}
    >
      {children}
    </SurfaceCard>
  );
}

export function CalloutPanel({
  appearance = "studio",
  tone = "default",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  appearance?: SurfaceAppearance;
  tone?: SurfaceTone;
}) {
  return <div {...props} className={calloutPanelClassName({ appearance, tone, className })}>{children}</div>;
}

export function PropertyStack({
  appearance = "studio",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  appearance?: SurfaceAppearance;
}) {
  return <div {...props} className={propertyStackClassName({ appearance, className })}>{children}</div>;
}

export function PropertyStackItem({
  appearance = "studio",
  label,
  value,
  className,
  valueClassName,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  appearance?: SurfaceAppearance;
  label: ReactNode;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div {...props} className={cn("property-stack-item", className)}>
      <div className={appearance === "admin" ? "admin-label-muted" : "surface-label-muted"}>{label}</div>
      <div
        className={cn(
          appearance === "admin" ? "text-sm font-medium text-[var(--foreground)]" : "text-sm font-medium text-white/92",
          valueClassName,
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function SurfaceInputShell({
  appearance = "studio",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  appearance?: SurfaceAppearance;
}) {
  return (
    <div {...props} className={surfaceInputShellClassName({ appearance, className })}>
      {children}
    </div>
  );
}

export function EmptyState({
  appearance = "studio",
  eyebrow,
  title,
  description,
  className,
}: {
  appearance?: SurfaceAppearance;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <div className={emptyStateClassName({ appearance, className })}>
      {eyebrow ? <div className={appearance === "admin" ? "admin-label-accent" : "surface-label-accent"}>{eyebrow}</div> : null}
      <div className={cn(eyebrow ? "mt-4" : "", appearance === "admin" ? "admin-section-title" : "text-2xl font-semibold tracking-[-0.02em] text-white")}>
        {title}
      </div>
      {description ? (
        <div className={cn("mt-3 text-sm leading-6", appearance === "admin" ? "text-[var(--muted-strong)]" : "text-white/68")}>
          {description}
        </div>
      ) : null}
    </div>
  );
}
