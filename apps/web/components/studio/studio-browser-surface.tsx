"use client";

import { ChevronDown, LoaderCircle, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { OverlayShell } from "@/components/ui/surface-primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StudioBrowserOverlay({
  children,
  testId,
  zIndexClassName,
  title,
  description,
  heading,
  navigation,
  actions,
  toolbar,
  footer,
  returnFocusFallback,
  onClose,
  suspended = false,
  layout = "grid",
}: {
  children: ReactNode;
  testId: string;
  zIndexClassName: string;
  title: string;
  description?: ReactNode;
  heading?: ReactNode;
  navigation?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  returnFocusFallback?: RefObject<HTMLElement | null>;
  onClose: () => void;
  suspended?: boolean;
  layout?: "grid" | "list" | "presets";
}) {
  const titleId = useId();
  const panelRef = useDialogFocus(onClose, suspended, returnFocusFallback);

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
        layout === "presets" && "studio-browser-panel-presets",
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
        <StudioBrowserHeader
          titleId={titleId}
          title={title}
          heading={heading}
          navigation={navigation}
          description={description}
          actions={actions}
        />
        {toolbar}
        <div className="studio-browser-body scrollbar-none">{children}</div>
        {footer}
      </div>
    </OverlayShell>
  );
}

function StudioBrowserHeader({
  titleId,
  title,
  heading,
  navigation,
  description,
  actions,
}: {
  titleId: string;
  title: string;
  heading?: ReactNode;
  navigation?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  if (navigation)
    return (
      <>
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
        {navigation}
      </>
    );
  return (
    <header className="studio-browser-header">
      <div>
        <h2 id={titleId} className={heading ? "sr-only" : undefined}>
          {title}
        </h2>
        {heading}
        {description ? <p>{description}</p> : null}
      </div>
      <div className="studio-browser-header-actions">{actions}</div>
    </header>
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
  actionLabel,
}: {
  loading: boolean;
  disabled?: boolean;
  onLoadMore: () => Promise<void>;
  label?: string;
  actionLabel?: string;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestMore = useCallback(() => {
    onLoadMore().catch((error: unknown) => {
      console.error("Browser page loading failed.", error);
    });
  }, [onLoadMore]);
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
          requestMore();
        }
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [disabled, loading, requestMore]);
  return (
    <div
      ref={sentinelRef}
      className="studio-browser-load-sentinel"
      aria-live="polite"
      aria-hidden={!loading && !actionLabel}
    >
      {actionLabel ? (
        <BrowserLoadMoreButton
          loading={loading}
          disabled={disabled}
          label={label}
          actionLabel={actionLabel}
          onLoadMore={requestMore}
        />
      ) : loading ? (
        label
      ) : null}
    </div>
  );
}

function BrowserLoadMoreButton({
  loading,
  disabled,
  label,
  actionLabel,
  onLoadMore,
}: {
  loading: boolean;
  disabled: boolean;
  label: string;
  actionLabel: string;
  onLoadMore: () => void;
}) {
  const Icon = loading ? LoaderCircle : ChevronDown;
  return (
    <Button
      appearance="admin"
      variant="subtle"
      size="compact"
      disabled={disabled || loading}
      onClick={onLoadMore}
    >
      <Icon className={cn("size-4", loading && "animate-spin")} />
      {loading ? label : actionLabel}
    </Button>
  );
}
