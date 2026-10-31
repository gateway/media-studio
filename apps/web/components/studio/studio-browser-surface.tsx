"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { OverlayShell } from "@/components/ui/surface-primitives";
import { cn } from "@/lib/utils";

export function StudioBrowserOverlay({
  children,
  testId,
  zIndexClassName,
  title,
  description,
  actions,
  onClose,
  suspended = false,
  layout = "grid",
}: {
  children: ReactNode;
  testId: string;
  zIndexClassName: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  suspended?: boolean;
  layout?: "grid" | "list";
}) {
  const titleId = useId();
  const panelRef = useDialogFocus(onClose, suspended);

  return (
    <OverlayShell
      backdropClassName={cn(
        "admin-theme-root studio-browser-theme studio-browser-backdrop",
        zIndexClassName,
      )}
      innerClassName="studio-browser-position"
      panelClassName={cn(
        "studio-browser-panel",
        layout === "list" && "studio-browser-panel-list",
      )}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal={!suspended || undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        className="studio-browser-shell"
        inert={suspended || undefined}
      >
        <header className="studio-browser-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <div className="studio-browser-header-actions">{actions}</div>
        </header>
        <div className="studio-browser-body scrollbar-none">{children}</div>
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
      {countLabel ? (
        <div className="studio-browser-count">{countLabel}</div>
      ) : null}
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
    <div className="studio-browser-search-shell">
      <Search aria-hidden="true" />
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="studio-browser-search-input"
      />
    </div>
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

export function StudioBrowserLoadSentinel({
  loading,
  disabled = false,
  onLoadMore,
  label = "Loading more...",
}: {
  loading: boolean;
  disabled?: boolean;
  onLoadMore: () => Promise<void>;
  label?: string;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = sentinelRef.current;
    if (
      disabled ||
      loading ||
      !target ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore().catch((error: unknown) => {
            console.error("Browser page loading failed.", error);
          });
        }
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [disabled, loading, onLoadMore]);
  return (
    <div
      ref={sentinelRef}
      className="studio-browser-load-sentinel"
      aria-live="polite"
      aria-hidden={!loading}
    >
      {loading ? label : null}
    </div>
  );
}
