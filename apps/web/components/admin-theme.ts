import { surfaceCardClassName, surfaceInsetClassName } from "@/components/ui/surface-primitives";

export const adminThemeVarsClassName = "admin-theme-root";

export const studioAdminShellClassName =
  "admin-theme-root mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-8 px-4 pb-10 pt-8 sm:px-6 lg:px-8";

export const studioAdminNavClassName =
  "flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/8 pb-3";

export const studioAdminPageIntroClassName = "space-y-3";

export const adminThemeLayoutClassName = `grid min-w-0 gap-6 ${adminThemeVarsClassName}`;
export const adminThemeLayoutOverflowClassName = `${adminThemeLayoutClassName} overflow-x-hidden`;
export const adminSectionStackClassName = "space-y-5";
export const adminTabsRowClassName = "flex flex-wrap gap-2 border-b border-white/8 pb-2";
export const adminCompactTabButtonClassName = "px-4 py-2 text-sm normal-case tracking-normal";
export const adminHeaderActionRowClassName = "flex flex-wrap items-center justify-end gap-2";
export const adminFilterToolbarClassName = "mt-5 grid gap-3 p-4 xl:grid-cols-[minmax(260px,1fr)_minmax(180px,220px)_minmax(180px,220px)]";
export const adminMetricGridFourClassName = "mt-5 grid gap-3 lg:grid-cols-4";
export const adminFeatureGridThreeClassName = "mt-4 grid gap-3 lg:grid-cols-3";
export const adminSummaryGridThreeClassName = "grid gap-2 sm:grid-cols-3";
export const adminListRowClassName = "admin-row-surface items-start gap-4 p-4";
export const adminListThumbnailClassName = "admin-preview-frame h-20 w-20 shrink-0 overflow-hidden";
export const adminListThumbnailFallbackClassName =
  "admin-preview-frame flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-white/34";
export const adminListActionGroupClassName = "flex shrink-0 flex-wrap justify-end gap-2";

export const adminSurfaceCardClassName =
  surfaceCardClassName({ appearance: "admin" });

export const adminStatCardClassName =
  surfaceInsetClassName({ appearance: "admin" });

export const adminInsetCompactClassName =
  surfaceInsetClassName({ appearance: "admin", density: "compact" });
