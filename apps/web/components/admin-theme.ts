import { surfaceCardClassName, surfaceInsetClassName } from "@/components/ui/surface-primitives";

export const adminThemeVarsClassName = "admin-theme-root";

export const studioAdminShellClassName =
  "admin-shell";

export const studioAdminNavClassName =
  "admin-nav";

export const studioAdminPageIntroClassName = "admin-page-intro";

export const adminThemeLayoutClassName = `grid min-w-0 gap-6 ${adminThemeVarsClassName}`;
export const adminThemeLayoutOverflowClassName = `${adminThemeLayoutClassName} overflow-x-hidden`;
export const adminSectionStackClassName = "admin-section-stack";
export const adminHeaderActionRowClassName = "flex flex-wrap items-center justify-end gap-2";
export const adminFilterToolbarClassName = "mt-5 grid gap-3 p-4 xl:grid-cols-[minmax(260px,1fr)_minmax(180px,220px)_minmax(180px,220px)]";
export const adminMetricGridFourClassName = "admin-metric-grid mt-5";
export const adminFeatureGridThreeClassName = "mt-4 grid gap-3 lg:grid-cols-3";
export const adminSummaryGridThreeClassName = "grid gap-2 sm:grid-cols-3";
export const adminListRowClassName =
  "admin-library-row flex min-w-0 flex-col items-stretch gap-4 p-4 sm:flex-row sm:items-start";
export const adminListThumbnailClassName = "surface-preview-frame relative h-20 w-20 shrink-0 overflow-hidden";
export const adminListThumbnailFallbackClassName =
  "surface-preview-frame flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-white/34";
export const adminListContentClassName =
  "min-w-0 w-full flex-1 space-y-2 break-words sm:w-auto";
export const adminListMetaClassName =
  "flex flex-wrap gap-2 break-all text-xs text-[var(--muted-strong)] [overflow-wrap:anywhere]";
export const adminListActionGroupClassName =
  "flex w-full min-w-0 shrink-0 flex-wrap justify-start gap-2 sm:w-auto sm:justify-end";

export const adminSurfaceCardClassName =
  surfaceCardClassName({ appearance: "admin" });

export const adminInsetCompactClassName =
  surfaceInsetClassName({ appearance: "admin", density: "compact" });
