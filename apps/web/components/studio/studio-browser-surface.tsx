"use client";

import { forwardRef, type ReactNode } from "react";

import {
  OverlayHeader,
  OverlayShell,
  SurfaceInputShell,
} from "@/components/ui/surface-primitives";
import { cn } from "@/lib/utils";

export function StudioBrowserOverlay({
  children,
  testId,
  zIndexClassName,
  eyebrow,
  title,
  description,
  actions,
}: {
  children: ReactNode;
  testId: string;
  zIndexClassName: string;
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <OverlayShell
      backdropClassName={zIndexClassName}
      panelClassName="studio-browser-panel"
    >
      <div data-testid={testId} className="studio-browser-shell">
        <div className="studio-browser-header">
          <OverlayHeader
            appearance="studio"
            eyebrow={eyebrow}
            title={title}
            description={description}
            actions={actions}
            className="border-0 pb-0"
          />
        </div>
        <div className="studio-browser-body">{children}</div>
      </div>
    </OverlayShell>
  );
}

export function StudioBrowserToolbar({
  children,
  countLabel,
}: {
  children?: ReactNode;
  countLabel?: ReactNode;
}) {
  return (
    <div className="studio-browser-toolbar">
      <div className="studio-browser-toolbar-main">{children}</div>
      {countLabel ? <div className="studio-browser-count">{countLabel}</div> : null}
    </div>
  );
}

export function StudioBrowserSearchInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <SurfaceInputShell className="studio-browser-search-shell">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="surface-input-control h-11 text-sm"
      />
    </SurfaceInputShell>
  );
}

export function StudioBrowserGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("studio-browser-grid", className)}>{children}</div>;
}

export const StudioBrowserLoadSentinel = forwardRef<
  HTMLDivElement,
  {
    loading: boolean;
    label?: string;
  }
>(function StudioBrowserLoadSentinel(
  { loading, label = "Loading more..." },
  ref,
) {
  return (
    <div
      ref={ref}
      className="studio-browser-load-sentinel"
      aria-live="polite"
      aria-hidden={!loading}
    >
      {loading ? label : null}
    </div>
  );
});
